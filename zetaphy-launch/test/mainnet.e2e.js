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
//     neither the deployer nor any other EOA holds a role; a --resume deploys nothing; --check re-checks read-only
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
import { Wallet, JsonRpcProvider, Contract, Transaction, ZeroAddress, ZeroHash, id as hashText, parseEther } from 'ethers';
import { GOV_MODULE, adminRoles, guardianRoles } from '../src/steps.js';

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
  for (const c of ['SimpleMultisig', 'NeuroControl', 'NeuroJobs', 'ThreatRegistry', 'ThreatReports', 'BridgeGuard', 'BridgeAirlock', 'NeuroLane', 'ZetaphyFactory', 'ZetaphyRouter', 'ZetaphyBounty', 'ZetaphyTimelock']) {
    assert.match(r.out, new RegExp(`deploy ${c}\\(`), `${c} in the plan`);
  }
  assert.match(r.out, /deploy SimpleMultisig\(owners=\[0x[0-9a-fA-F]{40}, 0x[0-9a-fA-F]{40}, 0x[0-9a-fA-F]{40}\], threshold=2\)/);
  assert.match(r.out, new RegExp(`deploy NeuroControl\\(governance=${deployer.address}, communityFund=${fund}, maxBodies=64, maxRegrowPerHour=4\\)`));
  assert.match(r.out, /deploy ThreatRegistry\(runners=<NeuroJobs>, quorum=3, minAgreed=5/);
  assert.match(r.out, /deploy ZetaphyBounty\(members=\[.*\], threshold=2, maxPayout=100000000000000000000, periodCap=250000000000000000000, timelock=172800/);
  assert.match(r.out, /setRoute\(airlock, BridgeAirlock, 1000 tokens a day, enabled = false\)  CLOSED/);
  assert.match(r.out, /delay 172800 s/);
  assert.match(r.out, /total: 12 contract\(s\), about \d+ call\(s\), ~[\d,]+ gas at [\d.]+ gwei = [\d.,]+ ZTPHY; with a 1\.5 x margin/);
  assert.match(r.out, /plus 50 ZTPHY put into contracts/);
  assert.doesNotMatch(r.out, /TestStable|StableGateway|TestToken|Dlmm|faucet/i);
  assert.match(r.out, /dry run: nothing signed, nothing sent, no state written/);
  assert.equal(existsSync(stateFile), false);
  assert.equal(await provider.getTransactionCount(deployer.address), 0);
  const n = await launch([...M, ...KS], { input: PASS });
  assert.notEqual(n.code, 0);
  assert.match(n.out, /nothing sent: read the plan above, then run again with --confirm-chain 3659/);
  assert.equal(await provider.getTransactionCount(deployer.address), 0);
});

test('the full set: the guardian with the keystore, the rest with a remote signer, every admin role to the timelock', async () => {
  const a = await launch([...M, ...KS, '--confirm-chain', '3659', '--only', 'guardian'], { input: `${PASS}\n` });
  assert.equal(a.code, 0, a.out);
  const g = outs().guardianMultisig;
  assert.notEqual(await provider.getCode(g), '0x');
  const before = await provider.getTransactionCount(deployer.address);
  assert.ok(before >= 1);
  const b = await launch([...M, ...RS(), '--confirm-chain', '3659', '--resume']);
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
  // nothing more on a resume
  const nonce = await provider.getTransactionCount(deployer.address);
  const c = await launch([...M, ...RS(), '--confirm-chain', '3659', '--resume']);
  assert.equal(c.code, 0, c.out);
  assert.equal(await provider.getTransactionCount(deployer.address), nonce, 'a resume sends nothing');
  // --check: the role check again, read only (no passphrase on stdin, nothing signed)
  const k = await launch([...M, '--keystore', f('deployer.json'), '--check']);
  assert.equal(k.code, 0, k.out);
  assert.match(k.out, /checked on-chain: no EOA and not the deployer .* holds a role on any contract of this run/);
  assert.match(k.out, /ZetaphyTimelock\s+0x[0-9a-fA-F]{40}  delay 172800 s/);
  assert.equal(await provider.getTransactionCount(deployer.address), nonce);
});
