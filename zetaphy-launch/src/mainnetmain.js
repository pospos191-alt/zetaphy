// launch.js --network mainnet: the checks before anything is signed, the plan, then the steps (src/mainnet.js).

import { readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, getAddress } from 'ethers';
import { loadState, saveState, newState, runSteps, outputs } from './runner.js';
import { GOV_MODULE } from './steps.js';
import { loadChain, mainnetConfig, mainnetSteps, mainnetPlan, dexWnative, verifyMainnet } from './mainnet.js';
import { dlmmPresets, addedAddressLines } from './mainnetall.js';
import { readKeystore, readPassphrase, keystoreSigner, RemoteSigner, checkSignerUrl } from './signer.js';

const HERE = fileURLToPath(new URL('..', import.meta.url));

/** Options that exist only with --network mainnet (refused on the testnet, so nobody mixes the two up). */
export const MAINNET_FLAGS = ['chain', 'pin', 'genesis', 'deploy-config', 'keystore', 'remote-signer', 'signer-address', 'signer-method', 'passphrase-stdin', 'confirm-chain', 'check'];
const ALLOWED = new Set(['network', 'rpc', 'dry-run', 'resume', 'fresh', 'only', 'state', 'help', ...MAINNET_FLAGS]);
/** Secrets the testnet tools read from the environment: their presence on mainnet is refused, not ignored. */
export const SECRET_ENV = ['ZETAPHY_DEPLOYER_KEY', 'ZETAPHY_DEPLOYER_KEY_FILE', 'ZETAPHY_PASSPHRASE', 'ZETAPHY_PRIVATE_KEY', 'ZETAPHY_KEY_FILE', 'ZETAPHY_DEX_KEY_FILE'];

function rpcUrl(u) {
  let url;
  try { url = new URL(String(u)); } catch { throw new Error('--rpc: not a URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('--rpc: must be https:// (http only for localhost)');
  if (url.username || url.password) throw new Error('--rpc: no user name or password in the URL');
  return String(u).replace(/\/+$/, '');
}

export async function mainnetMain(opt, env = process.env, log = console.log, { stdin = process.stdin } = {}) {
  for (const k of Object.keys(opt)) {
    if (ALLOWED.has(k)) continue;
    if (k === 'key-file') throw new Error('--key-file is refused on mainnet: no plain key in a file. Use --keystore <encrypted keystore JSON> or --remote-signer <url> --signer-address 0x…');
    if (k === 'devnet') throw new Error('--devnet is refused on mainnet (it allows a short timelock delay and single-key roles)');
    if (k === 'redo') throw new Error('--redo is refused on mainnet (it would deploy a second set of contracts); a step that failed resumes with --resume');
    throw new Error(`--${k} is not a mainnet option: on mainnet the governance, guardian, timelock and contract settings come from --deploy-config (zetaphy-launch/mainnet.example.json), and testnet-only steps do not exist`);
  }
  for (const k of SECRET_ENV) if (env[k]) throw new Error(`${k} is set: refused on mainnet (no key or passphrase in the environment). Unset it; use --keystore (the passphrase is asked) or --remote-signer`);
  const chain = loadChain({ chain: opt.chain, pin: opt.pin, genesis: opt.genesis });
  const rpc = rpcUrl(opt.rpc ?? env.ZETAPHY_RPC ?? '');
  // the signer: exactly one of the two; only its address is needed until the plan is confirmed
  if (!!opt.keystore === !!opt['remote-signer']) throw new Error('mainnet needs the deployer as --keystore <encrypted keystore JSON> or as --remote-signer <url> --signer-address 0x… (one of them)');
  let keystore = null, address;
  if (opt.keystore) {
    if (opt['signer-address'] || opt['signer-method']) throw new Error('--signer-address / --signer-method go with --remote-signer');
    keystore = readKeystore(String(opt.keystore));
    address = keystore.address;
  } else {
    if (opt['passphrase-stdin']) throw new Error('--passphrase-stdin goes with --keystore');
    checkSignerUrl(opt['remote-signer']);
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(opt['signer-address'] ?? ''))) throw new Error('--remote-signer needs --signer-address 0x<the deployer>');
    address = getAddress(String(opt['signer-address']));
  }
  if (!opt['deploy-config']) throw new Error('mainnet needs --deploy-config <file> (zetaphy-launch/mainnet.example.json)');
  let raw;
  try { raw = JSON.parse(readFileSync(String(opt['deploy-config']), 'utf8')); } catch (e) { throw new Error(`--deploy-config ${opt['deploy-config']}: ${e.code === 'ENOENT' ? 'no such file' : 'not JSON'}`); }
  const cfg = mainnetConfig(raw, { deployer: address });
  if (opt['confirm-chain'] != null && !opt['dry-run'] && String(opt['confirm-chain']) !== String(chain.evmChainId)) {
    throw new Error(`--confirm-chain ${opt['confirm-chain']} is not this chain's EVM chain id (${chain.evmChainId}): refused`);
  }

  // Fixed to the configured chain: every transaction carries this chain id, whatever the RPC answers later.
  const provider = new JsonRpcProvider(rpc, Number(chain.evmChainId), { staticNetwork: true, polling: true, pollingInterval: 1000 });
  try {
    const answered = BigInt(await provider.send('eth_chainId', []));
    if (answered !== chain.evmChainId) throw new Error(`the RPC is EVM chain ${answered}, not ${chain.chainId ?? 'the mainnet'} (EVM ${chain.evmChainId}) of ${chain.sources.join(', ')}: refused, nothing signed`);
    const genesisHash = (await provider.getBlock(1))?.hash ?? null;
    log(`ZETAPHY mainnet ${chain.chainId ?? ''} (EVM chain ${answered}, genesis sha256 ${chain.genesisSha256}) at ${rpc}`);
    log(`deployer ${address} (${keystore ? `keystore ${opt.keystore}` : `remote signer ${opt['remote-signer']}`}); coin ${chain.symbol}`);

    // roles named in the config are contracts (multisigs) or the gov module, checked before anything is sent
    const code = async (a) => (await provider.getCode(a)) !== '0x';
    for (const [what, a] of [['governance', cfg.governance], ...cfg.extraProposers.map((p) => ['timelockProposers', p]), ...(cfg.guardian ? [['guardian', cfg.guardian]] : [])]) {
      if (getAddress(a) === GOV_MODULE) { if (what === 'guardian') throw new Error('deploy config guardian: a multisig, not the gov module (it must act at once)'); continue; }
      if (!(await code(a))) throw new Error(`deploy config ${what} ${a} has no contract code on this chain: a multisig${what === 'guardian' ? '' : ' or "gov"'}, never a single key`);
    }

    const stateFile = resolve(opt.state ?? join(HERE, 'state', `${chain.evmChainId}.json`));
    let state = loadState(stateFile);
    if (state && opt.fresh && !opt['dry-run']) {
      const old = `${stateFile}.${new Date().toISOString().replace(/[:.]/g, '-')}.old`;
      renameSync(stateFile, old);
      log(`--fresh: the old state is kept as ${old}`);
      state = null;
    }
    if (state) {
      if (state.network !== 'mainnet') throw new Error(`${stateFile} is not a mainnet state file`);
      if (state.chainId !== Number(chain.evmChainId)) throw new Error(`${stateFile} is for chain ${state.chainId}`);
      if (state.genesisSha256 !== chain.genesisSha256) throw new Error(`${stateFile} is for genesis ${state.genesisSha256}, not ${chain.genesisSha256}`);
      if (state.genesisHash && genesisHash && state.genesisHash !== genesisHash) throw new Error(`${stateFile}: block 1 differs (another chain with the same ids)`);
      if (state.deployer !== address) throw new Error(`${stateFile} was made by deployer ${state.deployer}, not ${address}`);
      const done = Object.keys(state.steps).length;
      if (done && !opt.resume && !opt['dry-run'] && !opt.only && !opt.check) throw new Error(`${stateFile} already has ${done} finished step(s): pass --resume to continue`);
      log(`state: ${stateFile} (${done} step(s) recorded)`);
    } else {
      state = { ...newState({ chainId: Number(chain.evmChainId), genesisHash, deployer: address }), network: 'mainnet', cosmosChainId: chain.chainId, genesisSha256: chain.genesisSha256 };
      log(`state: ${stateFile} (new)`);
    }

    const ctx = {
      network: 'mainnet', rpc, publicRpc: rpc, provider, address, log, evmChainId: chain.evmChainId, cosmosChainId: chain.chainId, symbol: chain.symbol, mainnet: cfg,
      governance: cfg.governance, handover: true, devnet: false, timelockDelay: cfg.timelockDelay, guardian: cfg.guardian, guardianOwners: cfg.guardianOwners,
      guardianThreshold: cfg.guardianThreshold, extraProposers: cfg.extraProposers, executorMode: cfg.executorMode, communityFund: cfg.communityFund,
      stateFile,
    };
    if (opt.check) {
      // read only: the on-chain check of a finished run (no key, nothing signed)
      if (!state.steps.handover?.doneAt) throw new Error(`${stateFile}: the handover has not run yet: nothing to check`);
      await verifyMainnet(ctx, state);
      return 0;
    }
    ctx.dexWnative = outputs(state).dex?.contracts?.wnative ?? await dexWnative(provider);
    await dlmmPresets(ctx); // zetaphy-dex/dlmm-cli.js DEFAULT_PRESETS, for the plan and the proposal
    const steps = mainnetSteps();
    const only = opt.only ? String(opt.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
    for (const n of only ?? []) if (!steps.some((s) => s.name === n)) throw new Error(`--only ${n}: no such mainnet step (steps: ${steps.map((s) => s.name).join(', ')})`);
    const chosen = only ? steps.filter((s) => only.includes(s.name)) : steps;

    const plan = await mainnetPlan(ctx, state, chosen);
    log('\nthe plan (every contract with its constructor arguments, every call):');
    for (const l of plan.lines) log(`  ${l}`);
    const balance = await provider.getBalance(address);
    log(`deployer balance ${plan.coin(balance)}`);
    if (balance < plan.need) {
      const msg = `the deployer ${address} needs about ${plan.coin(plan.need - balance)} more ${chain.symbol}`;
      if (!opt['dry-run']) throw new Error(msg);
      log(`warning: ${msg}`);
    }
    if (opt['dry-run']) { log(`dry run: nothing signed, nothing sent, no state written (${plan.todo.length} step(s) would run)`); return 0; }
    if (String(opt['confirm-chain'] ?? '') !== String(chain.evmChainId)) {
      throw new Error(`nothing sent: read the plan above, then run again with --confirm-chain ${chain.evmChainId} to send it`);
    }

    if (keystore) {
      const pass = await readPassphrase({ fromStdin: !!opt['passphrase-stdin'], input: stdin });
      ctx.signer = await keystoreSigner(keystore, pass, provider);
    } else {
      ctx.signer = new RemoteSigner(String(opt['remote-signer']), address, provider, { chainId: chain.evmChainId, method: String(opt['signer-method'] ?? 'eth_signTransaction') });
      const holds = await ctx.signer.holds();
      if (holds === false) throw new Error(`the remote signer does not list ${address} among its accounts: refused`);
      if (holds == null) log('note: the remote signer does not list its accounts; each signed transaction is still checked to be from the deployer');
    }
    const settle = async () => {
      for (let i = 0; i < 30; i++) {
        const [p, l] = await Promise.all([provider.getTransactionCount(address, 'pending'), provider.getTransactionCount(address, 'latest')]);
        if (p >= l) return;
        await new Promise((res) => setTimeout(res, 1000));
      }
    };
    await runSteps({ steps, state, ctx, only, log, save: (s) => saveState(stateFile, s), settle });
    saveState(stateFile, state);
    const o = outputs(state);
    log('\naddresses:');
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) log(`  ${k.padEnd(22)} ${v}`);
    if (o.dex) log(`  ${'DEX factory/router'.padEnd(22)} ${o.dex.contracts.factory} / ${o.dex.contracts.router}`);
    for (const [k, v] of addedAddressLines(o)) log(`  ${k.padEnd(22)} ${v}`);
    if (o.governanceProposal?.operationId) log(`\ntimelock batch ${o.governanceProposal.operationId} (${o.governanceProposal.state}): ${o.governanceProposal.calls.length} call(s) only the timelock can make; files: ${(o.governanceProposal.files ?? []).join(', ')}`);
    log(`\nstate written to ${stateFile} (addresses only, no key)`);
    return 0;
  } finally {
    provider.destroy();
  }
}
