// The key watch on mainnet: key-watch-mainnet.json agrees with the committed addresses, and the Saphan bridge checks
// (src/saphanwatch.js) on two mocked chains: unbacked supply, forged queued mints and releases, large transfers,
// limits, a stalled ZETAPHY and the relayer's gas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAddress, parseEther, toBeHex, zeroPadValue, id as keccakId } from 'ethers';
import { loadConfig } from '../scripts/key-watch.js';
import { EP, checkSaphan, saphanRoutes } from '../src/saphanwatch.js';

const CFG = fileURLToPath(new URL('../key-watch-mainnet.json', import.meta.url));
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('key-watch-mainnet.json: ZETAPHY mainnet, BSC and Base; every committed governance and bridge address is watched', () => {
  const c = loadConfig(CFG);
  assert.deepEqual(Object.keys(c.chains).sort(), ['base', 'bsc', 'zetaphy']);
  assert.equal(c.chains.zetaphy.chainId, 3659);
  assert.equal(c.chains.bsc.chainId, 56);
  assert.equal(c.chains.base.chainId, 8453);
  for (const ch of Object.values(c.chains)) assert.ok(ch.rpc.every((u) => u.startsWith('https://')), `${ch.key}: https RPCs`);
  const has = (chain, a, kind) => {
    const w = c.chains[chain].watch.find((x) => x.address === getAddress(a));
    assert.ok(w, `${chain}: ${a} watched`);
    if (kind) assert.equal(w.kind, kind, `${chain}: ${a} kind`);
  };
  const launch = read('../../zetaphy-launch/state/3659.contracts.json');
  for (const [k, a] of Object.entries(launch.contracts)) if (k !== 'timelockBlock') has('zetaphy', a);
  has('zetaphy', launch.contracts.timelock, 'timelock');
  has('zetaphy', launch.contracts.guardianMultisig, 'multisig');
  for (const a of [...Object.values(launch.dex), ...Object.values(launch.nft)]) has('zetaphy', a);
  const st = read('../../zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json').steps;
  has('zetaphy', st['zetaphy-vault'].vault, 'bridge');
  has('zetaphy', st['zetaphy-vault-bsc'].vault, 'bridge');
  for (const [chain, roles, syn] of [['bsc', 'bsc-roles', 'bsc-synthetic'], ['base', 'base-roles', 'base-synthetic']]) {
    has(chain, st[syn].synthetic, 'bridge');
    has(chain, st[roles].multisig, 'multisig');
    has(chain, st[roles].timelock, 'timelock');
    has(chain, st[roles].ism);
  }
  // the guardians and the deployer, on every chain
  for (const chain of Object.keys(c.chains)) {
    for (const a of ['0xE68116AB3C60cdA2012EF87787A591C38BBF4d9b', '0x0FC3cb4B939a61be39BD93Ef41ED45f482c533E6', '0x53256381b51232AF2B22e68883Ea9Cd84294fCbD', st['bsc-roles'].deployer]) has(chain, a, 'eoa');
  }
  // the Saphan checks cover every deployed route
  assert.deepEqual(saphanRoutes(c, c.base).map((r) => [r.name, r.chain]), [['base', 'base'], ['bsc', 'bsc']]);
  assert.ok(c.saphan.relayer && c.saphan.relayerFloor.bsc && c.saphan.relayerFloor.base && c.saphan.relayerFloor.zetaphy);
});

test('key-watch.yml watches mainnet with key-watch-mainnet.json', () => {
  const wf = readFileSync(new URL('../../.github/workflows/key-watch.yml', import.meta.url), 'utf8');
  assert.match(wf, /scripts\/key-watch\.js --config zetaphy-network\/key-watch-mainnet\.json/);
  assert.match(wf, /cron: /);
});

// ---------------------------------------------------------------- the Saphan checks on mocked chains

const VAULT = getAddress('0x' + 'a1'.repeat(20)), SYN = getAddress('0x' + 'b2'.repeat(20)), RELAYER = getAddress('0x' + 'c3'.repeat(20));
const ALICE = getAddress('0x' + '0a'.repeat(20)), BOB = getAddress('0x' + '0b'.repeat(20)), EVE = getAddress('0x' + 'ee'.repeat(20));
const NOW = Date.parse('2026-11-19T12:00:00Z');
const E = (n) => parseEther(String(n));

function chain({ head, views, logs = [], balance = {}, headTime = NOW / 1000 - 5 }) {
  const c = { head, views, logs, balance, headTime };
  c.rpc = {
    getBlockNumber: async () => c.head,
    getBlock: async () => ({ timestamp: c.headTime }),
    getBalance: async (a) => c.balance[getAddress(a)] ?? E(1),
    call: async ({ to, data }) => {
      const fn = EP.parseTransaction({ data }).name;
      const v = c.views[getAddress(to)]?.[fn];
      if (v === undefined) throw new Error(`no ${fn} on ${to}`);
      return EP.encodeFunctionResult(fn, [v]);
    },
    getLogs: async ({ address, topics, fromBlock, toBlock }) => c.logs.filter((l) => getAddress(l.address) === getAddress(address) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock
      && topics.every((t, i) => t == null || l.topics[i] === t)),
  };
  return c;
}
const sent = (address, block, nonce, sender, to, amount) => {
  const e = EP.encodeEventLog('Sent', [nonce, sender, to, amount, keccakId(`m${nonce}`)]);
  return { address, blockNumber: block, transactionHash: keccakId(`tx-sent-${address}-${nonce}`), ...e };
};
const queued = (address, block, id, srcNonce, sender, to, amount) => {
  const e = EP.encodeEventLog('Queued', [id, srcNonce, sender, to, amount, Math.floor(NOW / 1000) + 3600]);
  return { address, blockNumber: block, transactionHash: keccakId(`tx-q-${id}`), ...e };
};

function setup({ locked = E(500000), supply = E(0), sPaid = E(0), vPaid = E(0), relayerBsc = E(1), headTime } = {}) {
  const z = chain({ head: 1000, headTime, views: { [VAULT]: { locked, dailyLimit: E(250000), paidToday: vPaid } }, balance: { [RELAYER]: E(5) } });
  const d = chain({ head: 5000, views: { [SYN]: { totalSupply: supply, dailyLimit: E(1000000), paidToday: sPaid, nonce: 2n } }, balance: { [RELAYER]: relayerBsc } });
  const watch = {
    defaults: { confirmations: 0, logChunk: 100 },
    chains: { zetaphy: { key: 'zetaphy', name: 'ZETAPHY mainnet', explorer: '' }, bsc: { key: 'bsc', name: 'BNB Smart Chain', explorer: 'https://bscscan.com', logChunk: 500 } },
    saphan: { relayer: RELAYER, relayerFloor: { zetaphy: '0.5', bsc: '0.005' }, headMaxAgeMinutes: 15, largePct: 25, nearLimitPct: 80, sourceSearchBlocks: 4000 },
  };
  const routes = [{ name: 'bsc', chain: 'bsc', vault: VAULT, synthetic: SYN, vaultBlock: 10, displayName: 'BNB Smart Chain' }];
  const rpcFor = (c) => (c.key === 'zetaphy' ? z.rpc : d.rpc);
  const run = (state) => checkSaphan({ watch, routes, rpcFor, state, now: NOW });
  return { z, d, run };
}

test('saphan checks: first run is a baseline; a queued mint matching its source is quiet, a large one is a warning', async () => {
  const { z, d, run } = setup();
  let r = await run({});
  assert.deepEqual(r.alerts, []);
  assert.deepEqual(r.state.cursors, { 'bsc:mint': 5000, 'bsc:release': 1000 });
  z.logs.push(sent(VAULT, 990, 0n, ALICE, BOB, E(100)), sent(VAULT, 995, 1n, ALICE, BOB, E(500000)));
  d.logs.push(queued(SYN, 5010, keccakId('q0'), 0n, ALICE, BOB, E(100)), queued(SYN, 5020, keccakId('q1'), 1n, ALICE, BOB, E(500000)));
  d.head = 5100; z.head = 1010;
  r = await run(r.state);
  assert.deepEqual(r.alerts.map((a) => [a.severity, a.key]), [['warning', `saphan:large:bsc:mint:${keccakId('q1')}`]]);
  assert.match(r.alerts[0].lines.join('\n'), /50 % of the daily limit; it matches its source Sent/);
  assert.equal(r.state.cursors['bsc:mint'], 5100);
  // nothing new: quiet
  r = await run(r.state);
  assert.deepEqual(r.alerts, []);
});

test('saphan checks: a forged mint (no source Sent, or a different amount) is CRITICAL with the veto to send', async () => {
  const { z, d, run } = setup();
  let r = await run({});
  z.logs.push(sent(VAULT, 990, 0n, ALICE, BOB, E(100)));
  d.logs.push(queued(SYN, 5010, keccakId('f0'), 0n, ALICE, EVE, E(900000)), queued(SYN, 5011, keccakId('f1'), 7n, EVE, EVE, E(1)));
  d.head = 5050;
  r = await run(r.state);
  const crit = r.alerts.filter((a) => a.severity === 'critical');
  assert.deepEqual(crit.map((a) => a.key).sort(), [`saphan:forged:bsc:mint:${keccakId('f0')}`, `saphan:forged:bsc:mint:${keccakId('f1')}`].sort());
  const t = crit.map((a) => a.lines.join('\n')).join('\n');
  assert.match(t, /The source Sent with that nonce says otherwise: 100\.0 ZTPHY/);
  assert.match(t, /No Sent with nonce 7 on the other end/);
  assert.match(t, new RegExp(`veto\\(${keccakId('f0')}\\)`));
  assert.match(crit[0].title, /FORGED MINT queued on BNB Smart Chain/);
});

test('saphan checks: a forged release on ZETAPHY (no Sent on the synthetic) is CRITICAL; a real one is quiet', async () => {
  const { z, d, run } = setup();
  let r = await run({});
  d.logs.push(sent(SYN, 4990, 0n, BOB, ALICE, E(10)));
  z.logs.push(queued(VAULT, 1005, keccakId('r0'), 0n, BOB, ALICE, E(10)), queued(VAULT, 1006, keccakId('r1'), 1n, EVE, EVE, E(200000)), queued(VAULT, 1007, keccakId('r2'), 9n, EVE, EVE, E(5)));
  z.head = 1010;
  r = await run(r.state);
  assert.deepEqual(r.alerts.filter((a) => a.severity === 'critical').map((a) => a.key).sort(),
    [`saphan:forged:bsc:release:${keccakId('r1')}`, `saphan:forged:bsc:release:${keccakId('r2')}`].sort());
  assert.match(r.alerts.find((a) => a.key.endsWith(keccakId('r1'))).lines.join('\n'), /searched the last 4000 blocks of BNB Smart Chain/);
});

test('saphan checks: unbacked supply, near the daily limit, a stalled ZETAPHY and a relayer low on gas', async () => {
  const { run } = setup({ locked: E(400000), supply: E(400001), sPaid: E(850000), relayerBsc: E('0.001'), headTime: NOW / 1000 - 3600 });
  const r = await run({});
  const by = Object.fromEntries(r.alerts.map((a) => [a.key.split(':')[1], a]));
  assert.equal(by.backing.severity, 'critical');
  assert.match(by.backing.title, /UNBACKED ZTPHY on BNB Smart Chain/);
  assert.match(by.backing.lines.join('\n'), /400001\.0\*\* ZTPHY > 400000\.0 locked/);
  assert.equal(by.stalled.severity, 'critical');
  assert.match(by.stalled.lines[0], /60 minutes old/);
  assert.equal(by['near-limit'].severity, 'warning');
  assert.match(by['near-limit'].lines[0], /850000\.0 of 1000000\.0 ZTPHY \(85 %\)/);
  assert.equal(by['relayer-gas'].chain, 'bsc');
  assert.ok(!r.alerts.some((a) => a.key.includes('relayer-gas:zetaphy')), 'the ZETAPHY relayer balance is above its floor');
});

test('saphan checks: a destination that cannot be read is skipped (logged), the others still run', async () => {
  const { d, run } = setup();
  d.rpc.getBlockNumber = async () => { throw new Error('down'); };
  const log = [];
  const r = await checkSaphan({ watch: { defaults: {}, chains: { zetaphy: { key: 'zetaphy', name: 'Z' }, bsc: { key: 'bsc', name: 'B' } }, saphan: {} },
    routes: [{ name: 'bsc', chain: 'bsc', vault: VAULT, synthetic: SYN, vaultBlock: 10 }], rpcFor: (c) => (c.key === 'zetaphy' ? setup().z.rpc : d.rpc), now: NOW, log: (m) => log.push(m) });
  assert.deepEqual(r.alerts, []);
  assert.match(log.join('\n'), /bsc: B unreachable/);
  void run; void zeroPadValue; void toBeHex;
});

// ---------------------------------------------------------------- the guardians' emergency tool (scripts/saphan-guard.js)

test('saphan-guard: only a pause or a veto of the route\'s own contract, on each chain, can be proposed or confirmed', async () => {
  const { guardCalls, isGuardCall } = await import('../scripts/saphan-guard.js');
  const M = await import('../src/saphanmainnet.js');
  const cfg = M.loadMainnet(), st = M.loadState();
  const id = keccakId('a queued payout');
  for (const route of ['bsc', 'base']) {
    const d = M.deployedRoute(cfg, st, route);
    const dest = guardCalls(cfg, st, { route, chain: 'dest', veto: id });
    assert.equal(dest.multisig, getAddress(d.multisig));
    assert.deepEqual(dest.allowed.map((c) => [c.what, c.to]), [['pause', getAddress(d.synthetic)], [`veto ${id}`, getAddress(d.synthetic)]]);
    const zet = guardCalls(cfg, st, { route, chain: 'zetaphy' });
    assert.equal(zet.multisig, getAddress(cfg.zetaphy.guardian));
    assert.deepEqual(zet.allowed.map((c) => [c.what, c.to]), [['pause', getAddress(d.vault)]]);
    assert.equal(isGuardCall(cfg, st, { route, chain: 'dest' }, d.synthetic, dest.allowed[0].data), 'pause');
    assert.equal(isGuardCall(cfg, st, { route, chain: 'dest' }, d.synthetic, dest.allowed[1].data), `veto ${id}`);
    assert.equal(isGuardCall(cfg, st, { route, chain: 'zetaphy' }, d.vault, zet.allowed[0].data), 'pause');
    // anything else is refused: unpause, another target, the other chain's contract
    assert.equal(isGuardCall(cfg, st, { route, chain: 'dest' }, d.synthetic, M.ENDPOINT.encodeFunctionData('unpause')), null);
    assert.equal(isGuardCall(cfg, st, { route, chain: 'dest' }, d.vault, dest.allowed[0].data), null);
    assert.equal(isGuardCall(cfg, st, { route, chain: 'zetaphy' }, d.synthetic, zet.allowed[0].data), null);
  }
});

// ---------------------------------------------------------------- guardian steps and the learned checks

test('every CRITICAL Saphan alert carries the guardian commands: veto (on the right chain), then pause both ends', async () => {
  const { guardSteps } = await import('../src/saphanwatch.js');
  const id = keccakId('forged');
  const t = guardSteps('bsc', { vetoId: id, vetoChain: 'zetaphy' }).join('\n');
  assert.match(t, new RegExp(`saphan-guard\\.js veto ${id} --route bsc --chain zetaphy; unset M`));
  assert.match(t, /saphan-guard\.js pause --route bsc --chain dest; unset M[\s\S]*saphan-guard\.js pause --route bsc --chain zetaphy; unset M/);
  assert.match(t, /read -rs M; export M;/);
  assert.doesNotMatch(guardSteps('base').join('\n'), /veto/);
  // in the alerts themselves
  const { z, d, run } = setup({ locked: E(1), supply: E(2) });
  let r = await run({});
  assert.match(r.alerts.find((a) => a.key.startsWith('saphan:backing')).lines.join('\n'), /pause --route bsc --chain dest/);
  d.logs.push(queued(SYN, 5010, keccakId('ff'), 0n, EVE, EVE, E(1)));
  d.head = 5050;
  r = await run(r.state);
  const f = r.alerts.find((a) => a.key.startsWith('saphan:forged'));
  assert.match(f.lines.join('\n'), new RegExp(`veto ${keccakId('ff')} --route bsc --chain dest`));
  void z;
});

test('learned checks: after 20 ordinary transfers a much bigger one is "unusual"; after 20 quiet runs a burst is too', async () => {
  const { z, d, run } = setup();
  let r = await run({});
  let n = 0;
  // 20 runs of one ordinary mint each (100 ZTPHY), all with their source Sent
  for (let i = 0; i < 20; i++) {
    z.logs.push(sent(VAULT, 990, BigInt(n), ALICE, BOB, E(100)));
    d.logs.push(queued(SYN, 5001 + i * 10, keccakId(`m${n}`), BigInt(n), ALICE, BOB, E(100)));
    n++;
    d.head = 5001 + i * 10 + 5;
    r = await run(r.state);
    assert.deepEqual(r.alerts, [], `run ${i}: ordinary`);
  }
  assert.equal(r.state.learn['bsc:mint'].amounts.length, 20);
  assert.equal(r.state.learn['bsc:mint'].runs, 20);
  // one mint 50x the median (5,000 ZTPHY: under the 25 % "large" rule, over 1 % of the limit)
  z.logs.push(sent(VAULT, 990, BigInt(n), ALICE, BOB, E(15000)));
  d.logs.push(queued(SYN, 5300, keccakId(`m${n}`), BigInt(n), ALICE, BOB, E(15000)));
  n++;
  d.head = 5305;
  r = await run(r.state);
  const u = r.alerts.find((a) => a.key.startsWith('saphan:unusual-size'));
  assert.ok(u, 'unusual size');
  assert.match(u.lines.join('\n'), /150 x the median of the last 20 mints \(100\.0 ZTPHY\)/);
  // a burst: 8 ordinary mints in one run, after 21 runs of about one
  for (let i = 0; i < 8; i++) {
    z.logs.push(sent(VAULT, 990, BigInt(n), ALICE, BOB, E(100)));
    d.logs.push(queued(SYN, 5310 + i, keccakId(`m${n}`), BigInt(n), ALICE, BOB, E(100)));
    n++;
  }
  d.head = 5330;
  r = await run(r.state);
  const b = r.alerts.find((a) => a.key.startsWith('saphan:unusual-rate'));
  assert.ok(b, 'burst');
  assert.match(b.lines[0], /^8 mints queued since the last run; usually 1\.0/);
});
