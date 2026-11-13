// End to end, the mainnet mode on a local mainnet-style chain (zetaphy-network/scripts/devnet.sh with the mainnet's
// ids: chain id zetaphy_3659-1, EVM chain id 3659, coin ZTPHY, no faucet):
//   - an RPC whose eth_chainId is not the configured chain's is refused before anything is signed;
//     the testnet launch (no --network) refuses this chain, as before
//   - a plain key (--key-file, or a key in the environment) is refused
//   - --dry-run lists every contract, its constructor arguments and the cost in ZTPHY, and sends and writes nothing;
//     without --confirm-chain nothing is sent
//   - the full gate-8 set is deployed: the guardian multisig with an encrypted keystore (passphrase on stdin), the
//     rest through a remote signer (eth_signTransaction, as clef / web3signer / a hardware wallet would answer)
//   - every admin role ends with the ZetaphyTimelock (48 h, the gov module its only proposer and canceller, anyone
//     executes), the guardian multisig holds the emergency switches, the bridge is closed, the bounty funded, and
//     neither the deployer nor any other EOA holds a role; a --resume of that set deploys nothing; --check re-checks
//     read-only. That first run is the gate-8 set alone (--only <its steps>), as the launch deployed the mainnet.
//   - a later --resume (same state file, same deployer) adds the rest of the testnet's systems after the handover:
//     NeuroIdentity + NeuroValidation, RewardVault, QuantumWalletFactory, ComputeMarket, the DLMM, the NFT factory and
//     marketplace, the oracle; each admin role goes straight to the existing timelock, the guardian multisig gets the
//     oracle's pause, nothing testnet-only is deployed; the proposal step writes ONE timelock batch (the DLMM's set-up,
//     the NFT code keys) whose gov proposal a vote passes on this chain (the operation is then Waiting its 48 h);
//     the extended verify passes, a further --resume sends nothing, and verify fails on a contract the deployer governs
//
//   ZETAPHYD=/path/to/zetaphyd TMPDIR=/dev/shm node --test test/mainnet.e2e.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet, JsonRpcProvider, Contract, ContractFactory, Interface, Transaction, ZeroAddress, ZeroHash, id as hashText, keccak256, toUtf8Bytes, parseEther } from 'ethers';
import { GOV_MODULE, GOV_MODULE_BECH32, adminRoles, guardianRoles } from '../src/steps.js';
import { ADDED_STEPS } from '../src/mainnetall.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ZETAPHYD = process.env.ZETAPHYD || 'zetaphyd';
const PORT = Number(process.env.MAINNET_E2E_PORT || 27545);
const RPC = `http://127.0.0.1:${PORT}`;
const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'zetaphy-launch-mainnet-e2e-'));
const chainHome = join(root, 'chain');
const stateFile = join(root, 'state.json');
const deployer = Wallet.createRandom();
const PASS = `test-only-${Date.now()}`;
const owners = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()].map((w) => w.address);
const committee = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()].map((w) => w.address);
const fund = Wallet.createRandom().address;
const env = { ...process.env, ZETAPHYD, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' };
for (const k of ['ZETAPHY_DEPLOYER_KEY', 'ZETAPHY_DEPLOYER_KEY_FILE', 'ZETAPHY_PASSPHRASE']) delete env[k];
const art = (pkg, n) => JSON.parse(readFileSync(join(ROOT, pkg, 'artifacts', `${n}.json`), 'utf8'));
const f = (n) => join(root, n);
let provider, signerServer, signerUrl, signed = 0;

function launch(args, { input = '', extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    const p = execFile(process.execPath, [join(ROOT, 'zetaphy-launch/launch.js'), ...args], { env: { ...env, ...extraEnv }, timeout: 900_000, maxBuffer: 64 << 20 },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr }));
    p.stdin.end(input);
  });
}
const mainnet = ({ chain = f('chain.json'), pin = true } = {}) => ['--network', 'mainnet', '--rpc', RPC, '--chain', chain,
  ...(pin ? ['--pin', f('pinned-chain.env'), '--genesis', join(chainHome, 'config/genesis.json')] : []), '--deploy-config', f('mainnet.json'), '--state', stateFile];
const M = mainnet();
const KS = ['--keystore', f('deployer.json'), '--passphrase-stdin'];
const RS = () => ['--remote-signer', signerUrl, '--signer-address', deployer.address];
const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const outs = () => Object.assign({}, ...Object.values(state().steps).map((s) => s.out ?? {}));
// the steps of the gate-8 set: the launch's first mainnet run (before the rest of the systems existed in it)
const GATE8 = ['guardian', 'neuro', 'threats', 'reports', 'bridge', 'dex', 'bounty', 'wire', 'timelock', 'handover', 'verify'];
const NEURO_WEB = 'https://neuro.zetaphy.org/web/';
const zd = (args) => execFileSync(ZETAPHYD, args, { env, encoding: 'utf8', cwd: root });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  execFileSync(join(ROOT, 'zetaphy-network/scripts/devnet.sh'), [chainHome, String(PORT), deployer.address], {
    stdio: 'inherit', cwd: root,
    env: { ...env, EVM_CHAIN_ID: '3659', COSMOS_CHAIN_ID: 'zetaphy_3659-1', GENESIS_JQ: '.app_state.bank.denom_metadata[0].symbol="ZTPHY" | .app_state.bank.denom_metadata[0].display="ztphy" | .app_state.bank.denom_metadata[0].denom_units[1].denom="ztphy"' },
  });
  provider = new JsonRpcProvider(RPC, 3659, { staticNetwork: true });
  const g = readFileSync(join(chainHome, 'config/genesis.json'));
  const sha = createHash('sha256').update(g).digest('hex');
  writeFileSync(f('chain.json'), JSON.stringify({ chain_id: 'zetaphy_3659-1', evm_chain_id: 3659, genesis_sha256: sha, denom: 'azetaphy', symbol: 'ZTPHY', min_gas_price: '1000000000azetaphy' }));
  writeFileSync(f('chain-3660.json'), JSON.stringify({ chain_id: 'zetaphy_3660-1', evm_chain_id: 3660, genesis_sha256: sha, symbol: 'ZTPHY' }));
  writeFileSync(f('pinned-chain.env'), `GENESIS_SHA256=${sha}\nGENESIS_EVM_CHAIN_ID=3659\nPUBLIC_RPC=0\n`);
  writeFileSync(f('deployer.json'), deployer.encryptSync(PASS), { mode: 0o600 });
  writeFileSync(f('plain.key'), deployer.privateKey + '\n', { mode: 0o600 });
  writeFileSync(f('mainnet.json'), JSON.stringify({
    governance: 'gov', guardianOwners: owners, guardianThreshold: 2, communityFund: fund,
    bridge: { lockbox: '11155111:0x00000000000000000000000000000000000Bd0C5', tokenName: 'USD Coin (bridged)', tokenSymbol: 'USDC', decimals: 6, dailyLimit: '1000' },
    bounty: { committee, threshold: 2, maxPayout: '100', periodCap: '250', timelock: 172800, reportBond: '1', fund: '50' },
    identity: { web: NEURO_WEB }, nft: { feeBps: 100 }, compute: { minAgreed: 1 },
  }));
  // A remote signer as clef / web3signer answer it: eth_accounts, and eth_signTransaction of the request as given.
  signerServer = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const r = JSON.parse(body);
      let result;
      if (r.method === 'eth_accounts') result = [deployer.address];
      else if (r.method === 'eth_signTransaction') {
        const q = r.params[0];
        const t = Transaction.from({ type: Number(q.type), chainId: BigInt(q.chainId), nonce: Number(q.nonce), to: q.to ?? null, value: BigInt(q.value), data: q.data, gasLimit: BigInt(q.gas),
          ...(q.maxFeePerGas ? { maxFeePerGas: BigInt(q.maxFeePerGas), maxPriorityFeePerGas: BigInt(q.maxPriorityFeePerGas) } : { gasPrice: BigInt(q.gasPrice) }) });
        t.signature = deployer.signingKey.sign(t.unsignedHash);
        result = t.serialized;
        signed++;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result === undefined ? { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'no such method' } } : { jsonrpc: '2.0', id: r.id, result }));
    });
  });
  await new Promise((r) => signerServer.listen(0, '127.0.0.1', r));
  signerUrl = `http://127.0.0.1:${signerServer.address().port}`;
});

after(async () => {
  provider?.destroy();
  signerServer?.close();
  let pid = null;
  try { pid = Number(readFileSync(join(chainHome, 'node.pid'), 'utf8')); process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  for (let i = 0; pid && i < 30; i++) { try { process.kill(pid, 0); } catch { break; } await new Promise((r) => setTimeout(r, 500)); }
  if (!process.env.KEEP) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

test('an RPC of another chain is refused before anything is signed; the testnet launch refuses this chain', async () => {
  const r = await launch([...mainnet({ chain: f('chain-3660.json'), pin: false }), ...KS, '--dry-run']);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /the RPC is EVM chain 3659, not zetaphy_3660-1 \(EVM 3660\).*refused, nothing signed/);
  const pinMismatch = await launch([...mainnet({ chain: f('chain-3660.json') }), ...KS, '--dry-run']);
  assert.match(pinMismatch.out, /the chain sources disagree on the chain id: chain\.json zetaphy_3660-1, genesis file zetaphy_3659-1: refused/);
  assert.notEqual(pinMismatch.code, 0);
  const t = await launch(['--rpc', RPC, '--key-file', f('plain.key'), '--state', f('t.json'), '--dry-run']);
  assert.notEqual(t.code, 0);
  assert.match(t.out, /the RPC is EVM chain 3659, not the ZETAPHY testnet \(77390\): refused/);
  assert.equal(await provider.getTransactionCount(deployer.address), 0);
});

test('no plain key on mainnet: --key-file and keys or passphrases in the environment are refused', async () => {
  const a = await launch([...M, '--key-file', f('plain.key'), '--dry-run']);
  assert.match(a.out, /--key-file is refused on mainnet/);
  const b = await launch([...M, ...KS, '--dry-run'], { extraEnv: { ZETAPHY_DEPLOYER_KEY: deployer.privateKey } });
  assert.match(b.out, /ZETAPHY_DEPLOYER_KEY is set: refused on mainnet/);
  const c = await launch([...M, '--keystore', f('plain.key'), '--dry-run']);
  assert.match(c.out, /a plain private key is refused on mainnet/);
  const d = await launch([...M, ...KS, '--dry-run'], { extraEnv: { ZETAPHY_PASSPHRASE: PASS } });
  assert.match(d.out, /ZETAPHY_PASSPHRASE is set: refused on mainnet/);
  for (const r of [a, b, c, d]) assert.notEqual(r.code, 0);
});

test('dry run: every contract with its constructor arguments and the cost in ZTPHY; nothing signed, sent or written', async () => {
  const r = await launch([...M, ...KS, '--dry-run']);
  assert.equal(r.code, 0, r.out);
  for (const c of ['SimpleMultisig', 'NeuroControl', 'NeuroJobs', 'ThreatRegistry', 'ThreatReports', 'BridgeGuard', 'BridgeAirlock', 'NeuroLane', 'ZetaphyFactory', 'ZetaphyRouter', 'ZetaphyBounty', 'ZetaphyTimelock',
    'NeuroIdentity', 'NeuroValidation', 'RewardVault', 'QuantumWalletFactory', 'ComputeMarket', 'ZetaphyDlmmFactory', 'ZetaphyDlmmRouter', 'NFTFactory', 'NFTMarketplace', 'TwapRecorder', 'ZetaphyPythRelay', 'ZetaphyOracle']) {
    assert.match(r.out, new RegExp(`deploy ${c}\\(`), `${c} in the plan`);
  }
  assert.match(r.out, /deploy SimpleMultisig\(owners=\[0x[0-9a-fA-F]{40}, 0x[0-9a-fA-F]{40}, 0x[0-9a-fA-F]{40}\], threshold=2\)/);
  assert.match(r.out, new RegExp(`deploy NeuroControl\\(governance=${deployer.address}, communityFund=${fund}, maxBodies=64, maxRegrowPerHour=4\\)`));
  assert.match(r.out, /deploy ThreatRegistry\(runners=<NeuroJobs>, quorum=3, minAgreed=5/);
  assert.match(r.out, /deploy ZetaphyBounty\(members=\[.*\], threshold=2, maxPayout=100000000000000000000, periodCap=250000000000000000000, timelock=172800/);
  assert.match(r.out, /setRoute\(airlock, BridgeAirlock, 1000 tokens a day, enabled = false\)  CLOSED/);
  assert.match(r.out, /delay 172800 s/);
  assert.match(r.out, /total: 24 contract\(s\), about \d+ call\(s\), ~[\d,]+ gas at [\d.]+ gwei = [\d.,]+ ZTPHY; with a 1\.5 x margin/);
  assert.match(r.out, /plus 50 ZTPHY put into contracts/);
  // nothing testnet-only is deployed: each such step is listed as skipped on mainnet, with its reason
  assert.doesNotMatch(r.out, /deploy (TestStable|StableGateway|TestToken|\w*Faucet)\(/i);
  for (const t of ['stable', 'skill', 'configs', 'snap', 'test fixtures']) assert.match(r.out, new RegExp(`- ${t}: skipped on mainnet \\(`), t);
  assert.match(r.out, /deploy ZetaphyDlmmFactory\(governance=<ZetaphyTimelock>\)/);
  assert.match(r.out, /deploy NFTMarketplace\(governance=<ZetaphyTimelock>, /);
  assert.match(r.out, /deploy RewardVault\(governance=<ZetaphyTimelock>, shares=\[\[<NeuroJobs>, 10000, true\]\]\)/);
  assert.match(r.out, /caip2s=\[eip155:3659, /);
  assert.match(r.out, /NeuroIdentity\.setAdmin\(ZetaphyTimelock\)  one step/);
  assert.match(r.out, /ZetaphyOracle\.setGovernance\(ZetaphyTimelock\)  one step/);
  assert.match(r.out, /dry run: nothing signed, nothing sent, no state written/);
  assert.equal(existsSync(stateFile), false);
  assert.equal(await provider.getTransactionCount(deployer.address), 0);
  const n = await launch([...M, ...KS], { input: PASS });
  assert.notEqual(n.code, 0);
  assert.match(n.out, /nothing sent: read the plan above, then run again with --confirm-chain 3659/);
  assert.equal(await provider.getTransactionCount(deployer.address), 0);
});

test('the gate-8 set: the guardian with the keystore, the rest with a remote signer, every admin role to the timelock', async () => {
  const a = await launch([...M, ...KS, '--confirm-chain', '3659', '--only', 'guardian'], { input: `${PASS}\n` });
  assert.equal(a.code, 0, a.out);
  const g = outs().guardianMultisig;
  assert.notEqual(await provider.getCode(g), '0x');
  const before = await provider.getTransactionCount(deployer.address);
  assert.ok(before >= 1);
  const b = await launch([...M, ...RS(), '--confirm-chain', '3659', '--resume', '--only', GATE8.join(',')]);
  assert.equal(b.code, 0, b.out);
  assert.ok(signed > 20, `the remote signer signed ${signed} transactions`);
  assert.match(b.out, /checked on-chain: no EOA and not the deployer .* holds a role on any contract of this run; the bridge is closed/);
  const o = outs();
  // every admin role is the timelock's
  const roles = adminRoles(o);
  assert.deepEqual(roles.map((r) => r.label.split(' (')[0]), ['NeuroControl', 'ThreatRegistry', 'BridgeGuard', 'BridgeAirlock', 'DEX factory']);
  for (const r of roles) assert.equal((await new Contract(r.address, r.abi, provider)[r.read]()).toLowerCase(), o.timelock.toLowerCase(), r.label);
  for (const r of roles.filter((x) => x.twoStep)) assert.equal(await new Contract(r.address, r.abi, provider).pendingGovernance(), ZeroAddress);
  // the timelock: 48 h, itself its admin, the gov module the only proposer/canceller, anyone executes, the deployer nothing
  const tl = new Contract(o.timelock, art('zetaphy-network', 'ZetaphyTimelock').abi, provider);
  assert.equal(await tl.getMinDelay(), 172800n);
  const members = async (role) => { const n = Number(await tl.getRoleMemberCount(role)); return Promise.all(Array.from({ length: n }, (_, i) => tl.getRoleMember(role, i))); };
  assert.deepEqual(await members(ZeroHash), [o.timelock]);
  assert.deepEqual(await members(hashText('PROPOSER_ROLE')), [GOV_MODULE]);
  assert.deepEqual(await members(hashText('CANCELLER_ROLE')), [GOV_MODULE]);
  assert.deepEqual(await members(hashText('EXECUTOR_ROLE')), [ZeroAddress]);
  for (const role of [ZeroHash, hashText('PROPOSER_ROLE'), hashText('CANCELLER_ROLE'), hashText('EXECUTOR_ROLE')]) assert.equal(await tl.hasRole(role, deployer.address), false);
  // the guardian multisig holds the emergency switches; the deployer none
  for (const r of guardianRoles(o)) {
    const k = new Contract(r.address, r.abi, provider);
    assert.equal(await k[r.read](g), true, r.label);
    assert.equal(await k[r.read](deployer.address), false, r.label);
  }
  // the bridge is closed, the bounty funded and keyless, the DEX has no test tokens
  const guard = new Contract(o.bridgeGuard, art('zetaphy-network', 'BridgeGuard').abi, provider);
  const airlock = new Contract(o.bridgeAirlock, art('zetaphy-network', 'BridgeAirlock').abi, provider);
  assert.equal((await guard.routes(await airlock.route())).enabled, false);
  assert.equal(await provider.getBalance(o.zetaphyBounty), parseEther('50'));
  const bounty = new Contract(o.zetaphyBounty, art('zetaphy-network', 'ZetaphyBounty').abi, provider);
  assert.deepEqual([...(await bounty.members())], committee);
  assert.equal(await bounty.isMember(deployer.address), false);
  assert.deepEqual(o.dex.tokens, []);
  assert.equal(o.timelock && state().network, 'mainnet');
  assert.doesNotMatch(readFileSync(stateFile, 'utf8'), new RegExp(deployer.privateKey.slice(2), 'i'));
  // nothing more on a resume of that set
  const nonce = await provider.getTransactionCount(deployer.address);
  const c = await launch([...M, ...RS(), '--confirm-chain', '3659', '--resume', '--only', GATE8.join(',')]);
  assert.equal(c.code, 0, c.out);
  assert.equal(await provider.getTransactionCount(deployer.address), nonce, 'a resume sends nothing');
  // --check: the role check again, read only (no passphrase on stdin, nothing signed)
  const k = await launch([...M, '--keystore', f('deployer.json'), '--check']);
  assert.equal(k.code, 0, k.out);
  assert.match(k.out, /checked on-chain: no EOA and not the deployer .* holds a role on any contract of this run/);
  assert.match(k.out, /ZetaphyTimelock\s+0x[0-9a-fA-F]{40}  delay 172800 s/);
  assert.equal(await provider.getTransactionCount(deployer.address), nonce);
});

test('a later --resume adds the rest of the systems after the handover; every new role is the timelock\'s; the extended verify passes', async () => {
  const o0 = outs();
  const tlAddr = o0.timelock;
  const g = o0.guardianMultisig;
  // the deployer renounced every timelock role in the first run
  const tl = new Contract(tlAddr, art('zetaphy-network', 'ZetaphyTimelock').abi, provider);
  for (const role of [ZeroHash, hashText('PROPOSER_ROLE'), hashText('CANCELLER_ROLE'), hashText('EXECUTOR_ROLE')]) assert.equal(await tl.hasRole(role, deployer.address), false);
  // the dry run of the resume: only the added contracts, the gate-8 set done, nothing sent or written
  const before = readFileSync(stateFile, 'utf8');
  const nonce0 = await provider.getTransactionCount(deployer.address);
  const d = await launch([...M, ...RS(), '--resume', '--dry-run']);
  assert.equal(d.code, 0, d.out);
  for (const c of ['NeuroIdentity', 'NeuroValidation', 'RewardVault', 'QuantumWalletFactory', 'ComputeMarket', 'ZetaphyDlmmFactory', 'ZetaphyDlmmRouter', 'NFTFactory', 'NFTMarketplace', 'TwapRecorder', 'ZetaphyPythRelay', 'ZetaphyOracle']) {
    assert.match(d.out, new RegExp(`deploy ${c}\\(`), c);
  }
  for (const c of ['SimpleMultisig', 'NeuroControl', 'ZetaphyTimelock', 'ZetaphyBounty', 'BridgeGuard']) assert.doesNotMatch(d.out, new RegExp(`deploy ${c}\\(`), `${c} is not deployed again`);
  assert.match(d.out, new RegExp(`deploy RewardVault\\(governance=${tlAddr}, shares=\\[\\[${o0.neuroJobs}, 10000, true\\]\\]\\)`));
  assert.match(d.out, new RegExp(`deploy ZetaphyDlmmFactory\\(governance=${tlAddr}\\)`));
  assert.match(d.out, new RegExp(`deploy NFTMarketplace\\(governance=${tlAddr}, feeRecipient=${fund}, feeBps=100, threatRegistry=${o0.threatRegistry}, factory=<NFTFactory>\\)`));
  assert.match(d.out, new RegExp(`deploy ZetaphyPythRelay\\(governance=${tlAddr}, relayers=\\[\\], threshold=1\\)`));
  assert.match(d.out, new RegExp(`ZetaphyOracle\\.setGuardian\\(${g}, true\\)`));
  assert.match(d.out, /✓ handover: done .*; checked again on-chain/);
  assert.match(d.out, /total: 12 contract\(s\), about \d+ call\(s\)/);
  assert.match(d.out, /dry run: nothing signed, nothing sent, no state written \(9 step\(s\) would run\)/);
  assert.equal(readFileSync(stateFile, 'utf8'), before);
  assert.equal(await provider.getTransactionCount(deployer.address), nonce0);

  // the resume itself, through the remote signer
  const r = await launch([...M, ...RS(), '--confirm-chain', '3659', '--resume']);
  assert.equal(r.code, 0, r.out);
  for (const n of ADDED_STEPS) assert.ok(state().steps[n]?.doneAt, `${n} done`);
  for (const n of GATE8) assert.ok(state().steps[n]?.doneAt, `${n} still done`);
  assert.match(r.out, /checked on-chain: \d+ admin role\(s\) belong to the timelock/, 'the handover re-checked everything');
  assert.match(r.out, /checked on-chain: no EOA and not the deployer .* holds a role on any contract of this run; the bridge is closed/);
  const o = outs();
  assert.equal(o.timelock, tlAddr, 'the same timelock');
  for (const k of ['neuroIdentity', 'neuroValidation', 'rewardVault', 'quantumWalletFactory', 'computeMarket', 'twapRecorder', 'pythRelay', 'oracle']) assert.notEqual(await provider.getCode(o[k]), '0x', k);
  for (const a of [o.dlmm.contracts.dlmmFactory, o.dlmm.contracts.dlmmRouter, o.dlmm.contracts.dlmmPairDeployer, o.nft.factory, o.nft.marketplace]) assert.notEqual(await provider.getCode(a), '0x');
  // every admin role, old and new, is the timelock's; nobody waits to accept a two-step one
  const roles = adminRoles(o);
  assert.deepEqual(roles.map((x) => x.label.split(' (')[0]), ['NeuroControl', 'ThreatRegistry', 'RewardVault', 'NeuroIdentity', 'BridgeGuard', 'BridgeAirlock', 'ZetaphyOracle', 'ZetaphyPythRelay', 'NFT marketplace', 'DEX factory', 'DLMM factory']);
  for (const x of roles) assert.equal((await new Contract(x.address, x.abi, provider)[x.read]()).toLowerCase(), tlAddr.toLowerCase(), x.label);
  for (const x of roles.filter((y) => y.twoStep)) assert.equal(await new Contract(x.address, x.abi, provider).pendingGovernance(), ZeroAddress, x.label);
  // the guardian multisig can pause the oracle's feeds; the deployer cannot
  for (const x of guardianRoles(o)) {
    const k = new Contract(x.address, x.abi, provider);
    assert.equal(await k[x.read](g), true, x.label);
    assert.equal(await k[x.read](deployer.address), false, x.label);
  }
  assert.ok(guardianRoles(o).some((x) => x.label.startsWith('ZetaphyOracle')));
  // the deployer still holds no timelock role, and none of the new contracts names it
  for (const role of [ZeroHash, hashText('PROPOSER_ROLE'), hashText('CANCELLER_ROLE'), hashText('EXECUTOR_ROLE')]) assert.equal(await tl.hasRole(role, deployer.address), false);
  const idr = new Contract(o.neuroIdentity, art('zetaphy-network', 'NeuroIdentity').abi, provider);
  assert.equal(await idr.localCaip2Hash(), keccak256(toUtf8Bytes('eip155:3659')));
  assert.equal(await idr.claimRunners(), o.neuroJobs);
  assert.equal(await idr.webBase(), NEURO_WEB);
  const relay = new Contract(o.pythRelay, art('zetaphy-network', 'ZetaphyPythRelay').abi, provider);
  assert.equal(await relay.isRelayer(deployer.address), false);
  const market = new Contract(o.nft.marketplace, art('zetaphy-nft', 'NFTMarketplace').abi, provider);
  assert.equal(await market.feeRecipient(), fund);
  assert.equal(await market.threatRegistry(), o.threatRegistry);
  const dlmm = new Contract(o.dlmm.contracts.dlmmFactory, art('zetaphy-dex', 'ZetaphyDlmmFactory').abi, provider);
  assert.deepEqual([...(await dlmm.presetSteps())], [], 'no preset until the timelock batch runs');
  const vault = new Contract(o.rewardVault, art('zetaphy-network', 'RewardVault').abi, provider);
  assert.deepEqual((await vault.shares()).map((x) => [x.to, Number(x.bps), x.callFund]), [[o.neuroJobs, 10000, true]]);
  assert.doesNotMatch(readFileSync(stateFile, 'utf8'), /TestStable|StableGateway|TestToken|tUSD/);
  assert.doesNotMatch(readFileSync(stateFile, 'utf8'), new RegExp(deployer.privateKey.slice(2), 'i'));

  // the timelock batch: what only the timelock can do (the DLMM set-up, the NFT code keys), as one gov proposal
  const gp = o.governanceProposal;
  assert.equal(gp.state, 'Unset');
  assert.ok(gp.calls.some((c) => /^ZetaphyDlmmFactory\.setThreatRegistry/.test(c)));
  assert.equal(gp.calls.filter((c) => /^ZetaphyDlmmFactory\.setPreset/.test(c)).length, 4);
  assert.ok(gp.calls.some((c) => /^ThreatRegistry\.setProtected/.test(c)));
  const batch = JSON.parse(readFileSync(stateFile.replace(/\.json$/, '.timelock-batch.json'), 'utf8'));
  const prop = JSON.parse(readFileSync(stateFile.replace(/\.json$/, '.gov-proposal.json'), 'utf8'));
  assert.equal(batch.operationId, gp.operationId);
  assert.equal(batch.delay, 172800);
  assert.equal(prop.messages[0]['@type'], '/zetaphy.pq.v1.MsgEVMCall');
  assert.equal(prop.messages[0].Sender, GOV_MODULE_BECH32);
  assert.equal(prop.messages[0].To, tlAddr);
  assert.equal(prop.deposit, '10000000000000000000000azetaphy', 'the mainnet min_deposit, 10,000 ZTPHY');
  const tli = new Interface(art('zetaphy-network', 'ZetaphyTimelock').abi);
  const sched = tli.parseTransaction({ data: '0x' + Buffer.from(prop.messages[0].Data, 'base64').toString('hex') });
  assert.equal(sched.name, 'scheduleBatch');
  assert.deepEqual([...sched.args[0]], batch.calls.map((c) => c.to));
  assert.equal(sched.args[5], 172800n);
  assert.equal(await tl.hashOperationBatch([...sched.args[0]], [...sched.args[1]], [...sched.args[2]], sched.args[3], sched.args[4]), gp.operationId);
  assert.match(r.out, /gov\.sh propose-file .*\.gov-proposal\.json/);
  // a vote passes it on this chain: the gov module schedules the batch, which then waits the timelock's 48 h
  const node = ['--node', `tcp://127.0.0.1:${PORT + 100}`];
  const tx = ['--home', chainHome, '--keyring-backend', 'test', '--from', 'validator', '--chain-id', 'zetaphy_3659-1', ...node,
    '--gas', 'auto', '--gas-adjustment', '1.5', '--gas-prices', '1000000000azetaphy', '-y', '-o', 'json'];
  zd(['tx', 'gov', 'submit-proposal', stateFile.replace(/\.json$/, '.gov-proposal.json'), ...tx]);
  let pid;
  for (let i = 0; i < 30 && !pid; i++) {
    await sleep(1000);
    pid = (JSON.parse(zd(['q', 'gov', 'proposals', ...node, '-o', 'json'])).proposals ?? []).find((x) => x.title === prop.title)?.id;
  }
  assert.ok(pid, 'proposal submitted');
  await sleep(2000);
  zd(['tx', 'gov', 'vote', String(pid), 'yes', ...tx]);
  let st;
  for (let i = 0; i < 60; i++) {
    st = JSON.parse(zd(['q', 'gov', 'proposal', String(pid), ...node, '-o', 'json'])).proposal;
    if (!/VOTING_PERIOD|DEPOSIT_PERIOD/.test(st.status)) break;
    await sleep(1000);
  }
  assert.equal(st.status, 'PROPOSAL_STATUS_PASSED', `${st.status} ${st.failed_reason ?? ''}`);
  assert.equal(await tl.getOperationState(gp.operationId), 1n, 'Waiting its delay');
  assert.ok((await tl.getTimestamp(gp.operationId)) - BigInt((await provider.getBlock('latest')).timestamp) > 172000n, 'it runs 48 h later, not before');

  // nothing more on a further resume: the batch is waiting, every check passes again
  const nonce = await provider.getTransactionCount(deployer.address);
  const again = await launch([...M, ...RS(), '--confirm-chain', '3659', '--resume']);
  assert.equal(again.code, 0, again.out);
  assert.equal(await provider.getTransactionCount(deployer.address), nonce, 'a resume sends nothing');
  assert.match(again.out, new RegExp(`timelock operation ${gp.operationId} \\(Waiting\\)`));
  const k = await launch([...M, '--keystore', f('deployer.json'), '--check']);
  assert.equal(k.code, 0, k.out);
  assert.match(k.out, /NeuroIdentity\s+0x[0-9a-fA-F]{40}  admin 0x/);
  assert.match(k.out, new RegExp(`timelock batch\\s+${gp.operationId}  Waiting`));
  assert.match(k.out, /checked on-chain: no EOA and not the deployer .* holds a role on any contract of this run/);
  assert.equal(await provider.getTransactionCount(deployer.address), nonce);

  // the extended verify fails on a new contract the deployer still governs (a state naming such a marketplace)
  const w = new Wallet(deployer.privateKey, provider);
  const M2 = art('zetaphy-nft', 'NFTMarketplace');
  const rogue = await new ContractFactory(M2.abi, M2.bytecode, w).deploy(deployer.address, fund, 100, o.threatRegistry, o.nft.factory);
  await rogue.waitForDeployment();
  const bad = JSON.parse(readFileSync(stateFile, 'utf8'));
  bad.steps.nft.out.nft.marketplace = await rogue.getAddress();
  writeFileSync(f('bad-state.json'), JSON.stringify(bad));
  const v = await launch([...mainnet().map((x) => (x === stateFile ? f('bad-state.json') : x)), '--keystore', f('deployer.json'), '--check']);
  assert.notEqual(v.code, 0, v.out);
  assert.match(v.out, new RegExp(`NFT marketplace \\(fees, registry\\) ${await rogue.getAddress()}: admin ${deployer.address}, not the timelock`));
});
