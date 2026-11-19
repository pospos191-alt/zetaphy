// The gov proposal explainer (src/govexplain.js) on real proposal shapes: the Saphan opening (unpause through the
// timelock), the audit reporters batch (setReporter x2), and hostile ones (a new ISM, a role, a direct call with no
// timelock, an unknown function, a chain upgrade). key-watch's "new gov proposal" alert carries what it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface, getAddress, ZeroHash, id as keccakId } from 'ethers';
import { loadSelectors, explainProposal, explainCall } from '../src/govexplain.js';
import * as M from '../src/saphanmainnet.js';
import { runWatch, buildConfig } from '../scripts/key-watch.js';

const SEL = loadSelectors();
const TL = getAddress('0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA');
const REP = getAddress('0x3B7E5AA0417d445dd0c584CBA6A0Fb5D62b1dbe2');
const A1 = getAddress('0x211d88F5B06773854A47d13569cdF9997FBF1A92'), A2 = getAddress('0xe9dF4062b12a2a50B6318Ba2C891AA40B3198A55');
const VAULT = getAddress('0xFA8F7a89A1f870bDFC03740FbF687e931B0b384A');
const EVIL = getAddress('0x' + 'ee'.repeat(20));
const T = new Interface(['function schedule(address,uint256,bytes,bytes32,bytes32,uint256)', 'function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)']);
const X = new Interface(['function setReporter(address,bool)', 'function setInterchainSecurityModule(address)', 'function grantRole(bytes32,address)', 'function setGuardian(address,bool)']);
const LABELS = { [TL.toLowerCase()]: 'ZetaphyTimelock', [REP.toLowerCase()]: 'workerReputation', [VAULT.toLowerCase()]: 'Saphan vault ZTPHY -> BSC' };
const b64 = (hex) => Buffer.from(hex.slice(2), 'hex').toString('base64');
const evmCall = (to, data) => ({ '@type': '/zetaphy.pq.v1.MsgEVMCall', Sender: 'zetaphy10d07y265gmmuvt4z0w9aw880jnsr700jvr86lj', To: to, Value: '0', Data: b64(data), GasLimit: '1000000' });
const batch = (calls) => T.encodeFunctionData('scheduleBatch', [calls.map((c) => c[0]), calls.map(() => 0n), calls.map((c) => c[1]), ZeroHash, keccakId('s'), 172800n]);
const ex = (p) => explainProposal(p, { selectors: SEL, labels: LABELS, timelock: TL });

test('the Saphan BSC opening proposal: one unpause on the vault, through the timelock, HIGH (opens a paused contract)', () => {
  const cfg = M.loadMainnet(), st = M.loadState();
  const p = M.openPlan(cfg, st, { route: 'bsc' }).zetaphy.proposal;
  const r = ex(p);
  assert.equal(r.severity, 'high');
  const t = r.lines.join('\n');
  assert.match(t, /\*\*schedules 1 call\(s\) in the timelock\*\* \(they run 48 h after/);
  assert.match(t, /\[HIGH\] \*\*unpause\*\*\(\) on Saphan vault ZTPHY -> BSC `0xFA8F7a89A1f870bDFC03740FbF687e931B0b384A` — opens \(or closes\) a paused contract/);
});

test('the audit reporters batch: two setReporter calls on WorkerReputation, named with their arguments', () => {
  const data = batch([[REP, X.encodeFunctionData('setReporter', [A1, true])], [REP, X.encodeFunctionData('setReporter', [A2, true])]]);
  const r = ex({ messages: [evmCall(TL, data)] });
  assert.equal(r.severity, 'high');
  const t = r.lines.join('\n');
  assert.match(t, /schedules 2 call\(s\)/);
  assert.match(t, new RegExp(`\\*\\*setReporter\\*\\*\\(reporter=${A1}, on=true\\) on workerReputation`));
  assert.match(t, /gives \(or takes\) a role that writes scores/);
});

test('hostile proposals: a new ISM, a timelock role, a direct call with no delay, an unknown function, a chain upgrade', () => {
  let r = ex({ messages: [evmCall(TL, T.encodeFunctionData('schedule', [VAULT, 0n, X.encodeFunctionData('setInterchainSecurityModule', [EVIL]), ZeroHash, keccakId('x'), 172800n]))] });
  assert.equal(r.severity, 'critical');
  assert.match(r.lines.join('\n'), /\[CRITICAL\] \*\*setInterchainSecurityModule\*\*\(ism=0xEeEe.*— changes who may sign bridge messages/i);

  r = ex({ messages: [evmCall(TL, batch([[TL, X.encodeFunctionData('grantRole', [keccakId('PROPOSER_ROLE'), EVIL])]]))] });
  assert.equal(r.severity, 'critical');
  assert.match(r.lines.join('\n'), /\*\*grantRole\*\*.*on ZetaphyTimelock.*changes a role/);

  r = ex({ messages: [evmCall(VAULT, X.encodeFunctionData('setGuardian', [EVIL, true]))] });
  assert.equal(r.severity, 'critical');
  assert.match(r.lines.join('\n'), /the gov module calls \*\*setGuardian\*\*.*\*\*directly, with no timelock delay\*\* — changes who can pause and veto/);

  r = ex({ messages: [evmCall(TL, batch([[EVIL, '0xdeadbeef']]))] });
  assert.equal(r.severity, 'high');
  assert.match(r.lines.join('\n'), /unknown function 0xdeadbeef on `0xEeEe.*no contract in this repository has this function/i);

  r = ex({ messages: [{ '@type': '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade', authority: 'x', plan: { name: 'v2', height: '99000' } }] });
  assert.equal(r.severity, 'critical');
  assert.match(r.lines.join('\n'), /\*\*chain software upgrade\*\* "v2" at height 99000/);

  r = ex({ messages: [] });
  assert.equal(r.severity, 'info');
  assert.match(r.lines[0], /text-only/);
});

test('explainCall: hex or base64 data alike; a plain coin transfer is HIGH', () => {
  assert.equal(explainCall(REP, '0x', { selectors: SEL }).severity, 'high');
  const e = explainCall(REP, X.encodeFunctionData('setReporter', [A1, false]), { selectors: SEL, labels: LABELS });
  assert.equal(e.name, 'setReporter');
});

test('key-watch: a new gov proposal alert says what it does, and is CRITICAL when it changes who controls funds or rules', async () => {
  const cfg = buildConfig({ defaults: { confirmations: 0 }, chains: { zetaphy: { chainId: 3659, rpc: ['http://mock'], rest: 'http://rest', displayName: 'ZETAPHY mainnet',
    watch: [{ address: TL, label: 'ZetaphyTimelock', kind: 'timelock' }, { address: VAULT, label: 'Saphan vault', kind: 'bridge' }] } } });
  const rpc = { getBlockNumber: async () => 10, getBalance: async () => 0n, getLogs: async () => [], destroy() {} };
  const proposals = [{ id: '4', title: 'reporters', status: 'PROPOSAL_STATUS_VOTING_PERIOD', messages: [] }];
  const fetchJson = async (u) => (u.includes('/gov/') ? { proposals } : {});
  let r = await runWatch({ config: cfg, rpcFor: () => rpc, fetchJson });
  proposals.unshift({ id: '5', title: 'routine update', status: 'PROPOSAL_STATUS_VOTING_PERIOD',
    messages: [evmCall(TL, T.encodeFunctionData('schedule', [VAULT, 0n, X.encodeFunctionData('setInterchainSecurityModule', [EVIL]), ZeroHash, keccakId('y'), 172800n]))] });
  r = await runWatch({ config: cfg, state: r.state, rpcFor: () => rpc, fetchJson });
  assert.equal(r.alerts.length, 1);
  const a = r.alerts[0];
  assert.equal(a.severity, 'critical');
  assert.match(a.title, /new gov proposal #5 — CHANGES WHO CONTROLS FUNDS OR RULES/);
  assert.match(a.lines.join('\n'), /\*\*What it does:\*\*[\s\S]*setInterchainSecurityModule[\s\S]*on Saphan vault/);
});

test('a MsgEVMCall whose REST form is an Any with protobuf bytes (dynamicpb: 1 sender, 2 to, 3 value, 4 data) is read too', async () => {
  const { evmCallFields } = await import('../src/govexplain.js');
  const data = T.encodeFunctionData('scheduleBatch', [[REP], [0n], [X.encodeFunctionData('setReporter', [A1, true])], ZeroHash, keccakId('p'), 172800n]);
  const s = (n, str) => Buffer.concat([Buffer.from([(n << 3) | 2, Buffer.byteLength(str)]), Buffer.from(str)]);
  const d = Buffer.from(data.slice(2), 'hex');
  const len = []; let l = d.length; while (l > 127) { len.push((l & 0x7f) | 0x80); l >>= 7; } len.push(l);
  const proto = Buffer.concat([s(1, 'zetaphy10d07y265gmmuvt4z0w9aw880jnsr700jvr86lj'), s(2, TL), s(3, '0'), Buffer.from([(4 << 3) | 2, ...len]), d, Buffer.from([5 << 3, 0xc0, 0x84, 0x3d])]);
  const m = { '@type': '/zetaphy.pq.v1.MsgEVMCall', value: proto.toString('base64') };
  const f = evmCallFields(m);
  assert.equal(f.to, TL);
  assert.equal(f.data, data.toLowerCase());
  const r = ex({ messages: [m] });
  assert.match(r.lines.join('\n'), /setReporter.*on workerReputation/);
  // a shape it cannot read says so, with the field names, at HIGH
  const bad = ex({ messages: [{ '@type': '/zetaphy.pq.v1.MsgEVMCall', foo: 1 }] });
  assert.equal(bad.severity, 'high');
  assert.match(bad.lines[0], /could not read \(fields: @type, foo\)/);
});

// protobuf helpers for the transaction test: a length-delimited field and a varint field
const vint = (n) => { const o = []; let v = BigInt(n); while (v > 127n) { o.push(Number(v & 0x7fn) | 0x80); v >>= 7n; } o.push(Number(v)); return Buffer.from(o); };
const ld = (f, b) => Buffer.concat([vint((f << 3) | 2), vint(b.length), Buffer.from(b)]);
const vf = (f, n) => Buffer.concat([vint(f << 3), vint(n)]);

test('key-watch reads a MsgEVMCall the REST API shows as @type only from the submitting transaction (CometBFT tx_search)', async () => {
  const { messagesFromTx } = await import('../src/govexplain.js');
  const sched = T.encodeFunctionData('schedule', [VAULT, 0n, X.encodeFunctionData('setInterchainSecurityModule', [EVIL]), ZeroHash, keccakId('z'), 172800n]);
  const evm = Buffer.concat([ld(1, 'zetaphy10d07y265gmmuvt4z0w9aw880jnsr700jvr86lj'), ld(2, TL), ld(3, '0'), ld(4, Buffer.from(sched.slice(2), 'hex')), vf(5, 1200000)]);
  const any = (t, v) => Buffer.concat([ld(1, t), ld(2, v)]);
  const submit = Buffer.concat([ld(1, any('/zetaphy.pq.v1.MsgEVMCall', evm)), ld(3, 'zetaphy1proposer'), ld(5, 'title')]);
  const body = Buffer.concat([ld(1, any('/cosmos.gov.v1.MsgSubmitProposal', submit)), ld(2, 'memo')]);
  const tx = Buffer.concat([ld(1, body), ld(2, Buffer.from([1, 2])), ld(3, Buffer.from([9]))]).toString('base64');
  const msgs = messagesFromTx(tx);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]['@type'], '/zetaphy.pq.v1.MsgEVMCall');
  assert.equal(messagesFromTx(Buffer.from('nope').toString('base64')), null);

  const cfg = buildConfig({ defaults: { confirmations: 0 }, chains: { zetaphy: { chainId: 3659, rpc: ['http://mock'], rest: 'http://rest', comet: 'http://comet', displayName: 'ZETAPHY mainnet',
    watch: [{ address: TL, label: 'ZetaphyTimelock', kind: 'timelock' }, { address: VAULT, label: 'Saphan vault', kind: 'bridge' }] } } });
  const rpc = { getBlockNumber: async () => 10, getBalance: async () => 0n, getLogs: async () => [], destroy() {} };
  const proposals = [{ id: '4', messages: [] }];
  const asked = [];
  const fetchJson = async (u) => {
    asked.push(u);
    if (u.startsWith('http://comet/tx_search')) return { result: { txs: [{ tx }] } };
    return u.includes('/gov/') ? { proposals } : {};
  };
  let r = await runWatch({ config: cfg, rpcFor: () => rpc, fetchJson });
  proposals.unshift({ id: '5', title: 'innocent', status: 'PROPOSAL_STATUS_VOTING_PERIOD', messages: [{ '@type': '/zetaphy.pq.v1.MsgEVMCall' }] });
  r = await runWatch({ config: cfg, state: r.state, rpcFor: () => rpc, fetchJson });
  assert.ok(asked.some((u) => u === `http://comet/tx_search?query=${encodeURIComponent(`"submit_proposal.proposal_id='5'"`)}&per_page=1`), 'asked CometBFT for the transaction');
  assert.equal(r.alerts[0].severity, 'critical');
  assert.match(r.alerts[0].lines.join('\n'), /setInterchainSecurityModule[\s\S]*on Saphan vault/);
});
