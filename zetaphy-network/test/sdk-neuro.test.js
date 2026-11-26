// zetaphy-sdk/neuro.js (@zetaphy/sdk): the way any app uses ZETAPHY's Neuro. Everything goes through ZETAPHY mainnet:
// selectors and encodings against the real contract ABIs, addresses against the published mainnet file, reads answered
// by a mock ZETAPHY RPC, and a check requested through a wallet that must be on chain 3659.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface, getAddress, encodeBytes32String } from 'ethers';
import * as N from '../../zetaphy-sdk/index.js';

const art = (n) => new Interface(JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), 'utf8')).abi);
const TR = art('ThreatRegistry'), JOBS = art('NeuroJobs'), ATTEST = art('NeuroAttest'), CTRL = art('NeuroControl');
const MAIN = JSON.parse(readFileSync(new URL('../../zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json', import.meta.url), 'utf8'));
const T = '0x' + '42'.repeat(20);

test('the SDK talks only to ZETAPHY mainnet\'s published contracts, with the real selectors', () => {
  assert.equal(N.ZETAPHY.chainId, MAIN.chainId);
  assert.equal(N.ZETAPHY.contracts.neuroJobs, getAddress(MAIN.contracts.NeuroJobs));
  assert.equal(N.ZETAPHY.contracts.neuroControl, getAddress(MAIN.contracts.NeuroControl));
  assert.equal(N.ZETAPHY.contracts.threatRegistry, getAddress(MAIN.contracts.ThreatRegistry));
  assert.equal(N.ZETAPHY.contracts.neuroAttest, getAddress(MAIN.addedOnResume.contracts.neuroAttest));
  const pairs = [[TR, 'isAddressFlagged'], [TR, 'isCodeFlagged'], [JOBS, 'minFee'], [JOBS, 'request'], [JOBS, 'getJob'], [JOBS, 'jobCount'], [ATTEST, 'badge'], [CTRL, 'chainAllowed'], [CTRL, 'paused'], [CTRL, 'activeSkill']];
  for (const [i, f] of pairs) assert.equal(N.SEL[f], i.getFunction(f).selector, f);
  assert.equal(N.JOB_REQUESTED, JOBS.getEvent('JobRequested').topicHash);
  assert.equal(N.REASONS.length, 8);
});

test('request calldata and chain keys are what the contracts decode', () => {
  assert.equal(N.chainKey('bsc'), encodeBytes32String('bsc'));
  const d = N.requestData('bsc', T);
  const p = JOBS.parseTransaction({ data: d });
  assert.equal(p.name, 'request');
  assert.equal(p.args[0], encodeBytes32String('bsc'));
  assert.equal(p.args[1], T);
  // a long target (a non-EVM address) still encodes over several words
  const sol = 'So11111111111111111111111111111111111111112';
  assert.equal(JOBS.parseTransaction({ data: N.requestData('solana', sol) }).args[1], sol);
  assert.throws(() => N.chainKey('BSC'), /chain/);
  assert.throws(() => N.requestData('bsc', ''), /address/);
});

test('decodeJob reads getJob exactly as the contract returns it', () => {
  const verdict = '0x' + 'ab'.repeat(32);
  const enc = JOBS.encodeFunctionResult('getJob', [T, 1700000000n, 2, encodeBytes32String('base'), T, 10n ** 18n, verdict, 3, 2, [T, T, T]]);
  assert.deepEqual(N.decodeJob(enc), { requester: T, created: 1700000000, status: 'done', chain: 'base', target: T, fee: 10n ** 18n, verdict, commits: 3, reveals: 2 });
  const open = JOBS.encodeFunctionResult('getJob', [T, 1n, 1, encodeBytes32String('bsc'), 'x', 1n, '0x' + '00'.repeat(32), 0, 0, [T, T, T]]);
  assert.equal(N.decodeJob(open).verdict, null, 'no verdict until done');
  assert.equal(N.decodeJob(open).status, 'open');
});

function mockRpc(answers) {
  const seen = [];
  return { seen, fetch: async (url, init) => {
    assert.equal(url, N.ZETAPHY.rpc, 'only ZETAPHY\'s RPC');
    const { method, params, id } = JSON.parse(init.body);
    seen.push({ method, params });
    const result = answers(method, params);
    return { json: async () => ({ jsonrpc: '2.0', id, result }) };
  } };
}

test('reads: flagged + reason, badge, fee, canCheck, through ZETAPHY only', async () => {
  const m = mockRpc((method, [tx]) => {
    if (method !== 'eth_call') return null;
    const sel = tx.data.slice(0, 10);
    if (sel === N.SEL.isAddressFlagged) { const [chainId, who] = TR.decodeFunctionData('isAddressFlagged', tx.data); assert.equal(chainId, 56n); assert.equal(who, T); return TR.encodeFunctionResult('isAddressFlagged', [true, 4]); }
    if (sel === N.SEL.badge) return ATTEST.encodeFunctionResult('badge', [true, 7n, '0x' + '01'.repeat(32), '0x' + '02'.repeat(32), '0x' + '03'.repeat(32), T, 123n]);
    if (sel === N.SEL.minFee) return JOBS.encodeFunctionResult('minFee', [5n * 10n ** 17n]);
    if (sel === N.SEL.chainAllowed) return CTRL.encodeFunctionResult('chainAllowed', [CTRL.decodeFunctionData('chainAllowed', tx.data)[0] === encodeBytes32String('bsc')]);
    if (sel === N.SEL.paused) return CTRL.encodeFunctionResult('paused', [false]);
    throw new Error(sel);
  });
  const neuro = N.createNeuro({ fetch: m.fetch });
  assert.deepEqual(await neuro.isFlagged({ chainId: 56, address: T }), { flagged: true, reason: 'owner-can-move-holder-funds' });
  assert.deepEqual(await neuro.badge(T), { uid: 7n, reportHash: '0x' + '01'.repeat(32), skill: '0x' + '02'.repeat(32), model: '0x' + '03'.repeat(32), by: T, time: 123 });
  assert.equal(await neuro.fee(), 5n * 10n ** 17n);
  assert.equal(await neuro.canCheck('bsc'), true);
  assert.equal(await neuro.canCheck('dogechain'), false);
  assert.ok(m.seen.every((s) => [N.ZETAPHY.contracts.threatRegistry, N.ZETAPHY.contracts.neuroAttest, N.ZETAPHY.contracts.neuroJobs, N.ZETAPHY.contracts.neuroControl].includes(s.params[0].to)));
  await assert.rejects(neuro.isFlagged({ chainId: 0, address: T }), /chainId/);
});

test('requestCheck: switches the wallet to ZETAPHY, refuses another chain, pays the fee, returns the job id from the log', async () => {
  const HASH = '0x' + 'cd'.repeat(32);
  const m = mockRpc((method, params) => {
    if (method === 'eth_getTransactionReceipt') return { status: '0x1', logs: [{ address: N.ZETAPHY.contracts.neuroJobs, topics: [N.JOB_REQUESTED, '0x' + (41).toString(16).padStart(64, '0'), encodeBytes32String('bsc')] }] };
    const sel = params[0].data.slice(0, 10);
    if (sel === N.SEL.chainAllowed) return CTRL.encodeFunctionResult('chainAllowed', [true]);
    if (sel === N.SEL.paused) return CTRL.encodeFunctionResult('paused', [false]);
    if (sel === N.SEL.minFee) return JOBS.encodeFunctionResult('minFee', [10n ** 18n]);
    throw new Error(sel);
  });
  const neuro = N.createNeuro({ fetch: m.fetch, pollMs: 1 });
  const sent = [];
  let chain = '0x38';
  const wallet = { request: async ({ method, params }) => {
    if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; return null; }
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_requestAccounts') return [T];
    if (method === 'eth_sendTransaction') { sent.push(params[0]); return HASH; }
    throw new Error(method);
  } };
  assert.deepEqual(await neuro.requestCheck(wallet, { chain: 'bsc', address: T }), { id: 41, hash: HASH });
  assert.equal(sent[0].to, N.ZETAPHY.contracts.neuroJobs);
  assert.equal(sent[0].chainId, '0xe4b');
  assert.equal(BigInt(sent[0].value), 10n ** 18n);
  assert.equal(JOBS.parseTransaction({ data: sent[0].data }).args[1], T);
  // a wallet that stays on another chain: nothing is sent
  const stuck = { request: async ({ method }) => (method === 'eth_chainId' ? '0x38' : method === 'wallet_switchEthereumChain' ? null : (() => { throw new Error('should not send'); })()) };
  await assert.rejects(neuro.requestCheck(stuck, { chain: 'bsc', address: T }), /not on ZETAPHY/);
});
