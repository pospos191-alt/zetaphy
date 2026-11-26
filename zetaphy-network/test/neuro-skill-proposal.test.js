// scripts/neuro-skill-proposal.js: the vote that moves the network's Neuro runners to this repo's Neuro code. Calldata
// against the real contract ABIs, only the calls still needed, the same operation id as the timelock computes, a gov
// proposal from the gov module to the timelock, and a refusal when NeuroControl is not governed by the timelock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface, ZeroHash, getAddress, AbiCoder, keccak256 } from 'ethers';
import * as S from '../scripts/neuro-skill-proposal.js';

const art = (n) => new Interface(JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), 'utf8')).abi);
const CTRL = art('NeuroControl'), TL = art('ZetaphyTimelock');
const ID = '0x' + 'ab'.repeat(32), OLD = '0x' + 'cd'.repeat(32);
const CONTROL = S.MAINNET.contracts.NeuroControl, TIMELOCK = S.MAINNET.timelock.address;

test('calldata matches NeuroControl\'s and the timelock\'s real ABIs', () => {
  for (const f of ['approveSkill', 'setActiveSkill', 'governance', 'activeSkill', 'skillApproved']) assert.equal(S.CONTROL.getFunction(f).selector, CTRL.getFunction(f).selector, f);
  for (const f of ['scheduleBatch', 'executeBatch', 'hashOperationBatch', 'getMinDelay', 'getOperationState']) assert.equal(S.TIMELOCK.getFunction(f).selector, TL.getFunction(f).selector, f);
});

test('skillCalls: approve then activate; only activate when already approved; nothing when already active', () => {
  assert.deepEqual(S.skillCalls(CONTROL, ID, { active: OLD, approved: false }).map((c) => CTRL.parseTransaction({ data: c.data }).name), ['approveSkill', 'setActiveSkill']);
  assert.deepEqual(S.skillCalls(CONTROL, ID, { active: OLD, approved: true }).map((c) => CTRL.parseTransaction({ data: c.data }).name), ['setActiveSkill']);
  assert.deepEqual(S.skillCalls(CONTROL, ID, { active: ID.toUpperCase().replace('0X', '0x'), approved: true }), []);
  for (const c of S.skillCalls(CONTROL, ID, { active: OLD, approved: false })) assert.equal(CTRL.parseTransaction({ data: c.data }).args[0], ID);
});

test('batchFiles: the gov module schedules exactly these calls; the executeBatch is the same operation; deposit and gas set', () => {
  const calls = S.skillCalls(CONTROL, ID, { active: OLD, approved: false });
  const salt = S.saltOf(ID);
  const op = keccak256(AbiCoder.defaultAbiCoder().encode(['address[]', 'uint256[]', 'bytes[]', 'bytes32', 'bytes32'], [calls.map((c) => c.to), [0n, 0n], calls.map((c) => c.data), ZeroHash, salt]));
  const f = S.batchFiles({ timelock: TIMELOCK, calls, delay: 172800n, salt, operationId: op, state: 'Unset', id: ID, previous: OLD, depositWei: '10000000000000000000000' });
  const m = f.gov.messages[0];
  assert.equal(m['@type'], '/zetaphy.pq.v1.MsgEVMCall');
  assert.equal(m.Sender, 'zetaphy10d07y265gmmuvt4z0w9aw880jnsr700jvr86lj');
  assert.equal(m.To, getAddress(TIMELOCK));
  const sched = TL.parseTransaction({ data: '0x' + Buffer.from(m.Data, 'base64').toString('hex') });
  assert.equal(sched.name, 'scheduleBatch');
  assert.deepEqual([...sched.args[0]], calls.map((c) => getAddress(c.to)));
  assert.deepEqual([...sched.args[2]], calls.map((c) => c.data));
  assert.equal(sched.args[4], salt);
  assert.equal(sched.args[5], 172800n);
  const exec = TL.parseTransaction({ data: f.batch.execute.data });
  assert.equal(exec.name, 'executeBatch');
  assert.deepEqual([...exec.args[2]], calls.map((c) => c.data));
  assert.equal(f.batch.operationId, op);
  assert.equal(f.gov.deposit, '10000000000000000000000azetaphy');
  assert.ok(Number(m.GasLimit) >= 1_000_000);
  assert.match(f.gov.summary, /Steers Neuro only, never coin transfers/);
  assert.notEqual(S.saltOf(ID), S.saltOf(OLD), 'one salt per skill');
});

function mockProvider({ governance = TIMELOCK, active = OLD, approved = false, state = 0, revert = null } = {}) {
  const sent = [];
  const enc = (i, f, v) => i.encodeFunctionResult(f, v);
  return { sent, call: async (tx) => {
    const to = getAddress(tx.to), sel = tx.data.slice(0, 10);
    if (tx.from) { sent.push(tx); if (revert && sel === revert) throw Object.assign(new Error('reverted'), { shortMessage: 'execution reverted' }); return '0x'; }
    if (to === getAddress(CONTROL)) {
      if (sel === S.CONTROL.getFunction('governance').selector) return enc(S.CONTROL, 'governance', [governance]);
      if (sel === S.CONTROL.getFunction('activeSkill').selector) return enc(S.CONTROL, 'activeSkill', [active]);
      if (sel === S.CONTROL.getFunction('skillApproved').selector) return enc(S.CONTROL, 'skillApproved', [approved]);
    }
    if (to === getAddress(TIMELOCK)) {
      if (sel === S.TIMELOCK.getFunction('getMinDelay').selector) return enc(S.TIMELOCK, 'getMinDelay', [172800n]);
      if (sel === S.TIMELOCK.getFunction('hashOperationBatch').selector) return enc(S.TIMELOCK, 'hashOperationBatch', ['0x' + '11'.repeat(32)]);
      if (sel === S.TIMELOCK.getFunction('getOperationState').selector) return enc(S.TIMELOCK, 'getOperationState', [state]);
    }
    throw new Error(`unexpected call ${to} ${sel}`);
  }, getNetwork: async () => ({ chainId: 3659n }), resolveName: async (n) => n };
}

test('plan: reads NeuroControl and the timelock, simulates as the timelock, refuses another governance', async () => {
  const p = mockProvider();
  const r = await S.plan(p, { id: ID });
  assert.equal(r.timelock, getAddress(TIMELOCK));
  assert.equal(r.calls.length, 2);
  assert.equal(r.state, 'Unset');
  assert.ok(p.sent.every((t) => getAddress(t.from) === getAddress(TIMELOCK)), 'simulated from the timelock');
  assert.deepEqual(p.sent.map((t) => CTRL.parseTransaction({ data: t.data }).name), ['approveSkill'], 'setActiveSkill is not simulated before the skill is approved');
  // already approved: setActiveSkill is simulated
  const p2 = mockProvider({ approved: true });
  assert.deepEqual((await S.plan(p2, { id: ID })).calls.map((c) => c.what.split('(')[0]), ['NeuroControl.setActiveSkill']);
  assert.equal(p2.sent.length, 1);
  // already active: nothing
  assert.equal((await S.plan(mockProvider({ active: ID, approved: true }), { id: ID })).calls.length, 0);
  // not the timelock, or a call the timelock cannot make: refused
  await assert.rejects(S.plan(mockProvider({ governance: '0x' + '22'.repeat(20) }), { id: ID }), /not the timelock/);
  await assert.rejects(S.plan(mockProvider({ revert: S.CONTROL.getFunction('approveSkill').selector }), { id: ID }), /fails when the timelock sends it/);
});
