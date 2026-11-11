// ZetaphyBounty (docs/ANTI-ROLLBACK-OFFCHAIN.md, item U): a funded bounty for ZETAPHY itself. Reports are committed
// by hash and revealed (the content stays private), a committee approves a payout to the reporter only, through a
// timelock, under a per-report and a per-period cap; any member pauses, the threshold unpauses; no admin can move the
// pool anywhere else; the proof-of-exploit verifier hook (a mock verifier here; none exists yet).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, AbiCoder, toUtf8Bytes } from 'ethers';
import { Address } from '@ethereumjs/util';
import { createChain } from './helpers/evm.js';
import { compileHelper } from './helpers/starkbridge.js';

const E = 10n ** 18n;
const DAY = 86400;
const TL = 2 * DAY;
const BOND = E / 10n;
const abi = AbiCoder.defaultAbiCoder();
let c, b;
const a = (n) => c.acct[n].toString();
const REPORT = keccak256(toUtf8Bytes('ZETAPHY-2026-001: the bridge lets anyone mint (encrypted to the committee)'));
const SALT = '0x' + '5a'.repeat(32);

beforeEach(async () => {
  c = await createChain(['m1', 'm2', 'm3', 'alice', 'bob', 'mallory', 'funder', 'anyone']);
  b = await c.deploy('ZetaphyBounty', [[a('m1'), a('m2'), a('m3')], 2, 10n * E, 15n * E, TL, BOND], 'anyone');
  await b.send('funder', 'fund', [], 30n * E);
});

/** A committed and revealed report of `who`; returns its id. */
async function report(who = 'alice', hash = REPORT, salt = SALT) {
  const cm = await b.call('commitmentOf', [hash, a(who), salt]);
  const ev = await b.send(who, 'commit', [cm], BOND);
  const id = ev.find((e) => e?.name === 'Committed').args.id;
  c.mine();
  await b.send(who, 'reveal', [id, hash, salt]);
  return id;
}

async function invariant() {
  const held = await c.balance(Address.fromString(b.address));
  const tied = (await b.call('reserved')) + (await b.call('owedTotal')) + (await b.call('bondsHeld'));
  assert.ok(held >= tied, `pool ${held} covers what it promised ${tied}`);
}

test('config: a majority committee of distinct members, a timelock of at least 2 days, cap per period >= cap per report', async () => {
  const bad = [
    [[a('m1'), a('m2')], 1, 10n * E, 15n * E, TL, BOND],          // 1 of 2 is no majority
    [[a('m1'), a('m1'), a('m2')], 2, 10n * E, 15n * E, TL, BOND], // a member twice
    [[], 1, 10n * E, 15n * E, TL, BOND],
    [[a('m1'), a('m2'), a('m3')], 4, 10n * E, 15n * E, TL, BOND],
    [[a('m1'), a('m2'), a('m3')], 2, 10n * E, 15n * E, DAY, BOND], // timelock too short
    [[a('m1'), a('m2'), a('m3')], 2, 10n * E, 5n * E, TL, BOND],   // period cap below the per-report cap
    [[a('m1'), a('m2'), a('m3')], 2, 0n, 5n * E, TL, BOND],
  ];
  for (const args of bad) await assert.rejects(c.deploy('ZetaphyBounty', args, 'anyone'), /deploy failed/);
  assert.deepEqual([...(await b.call('members'))].map((x) => x.toLowerCase()), [a('m1'), a('m2'), a('m3')].map((x) => x.toLowerCase()));
  assert.equal(await b.call('threshold'), 2n);
  assert.equal(await b.call('available'), 30n * E);
});

test('commit-reveal: the commitment hides the report and binds the reporter; reveal needs the right hash and salt, a later block, within 90 days', async () => {
  const cm = await b.call('commitmentOf', [REPORT, a('alice'), SALT]);
  await assert.rejects(b.send('alice', 'commit', [cm], 0n), /BadValue/, 'the bond');
  await assert.rejects(b.send('m1', 'commit', [cm], BOND), /MemberCannotReport/);
  await assert.rejects(b.send('alice', 'commit', ['0x' + '00'.repeat(32)], BOND), /BadValue/);
  await b.send('alice', 'commit', [cm], BOND);
  // mallory copies alice's commitment: it is bound to alice, so mallory can never reveal it
  await b.send('mallory', 'commit', [cm], BOND);
  await assert.rejects(b.send('mallory', 'reveal', [1n, REPORT, SALT]), /BadReveal/);
  await assert.rejects(b.send('mallory', 'reveal', [0n, REPORT, SALT]), /BadReport/, 'only the reporter reveals');
  await assert.rejects(b.send('alice', 'reveal', [0n, REPORT, '0x' + '00'.repeat(32)]), /BadReveal/);
  await b.send('alice', 'reveal', [0n, REPORT, SALT]);
  await assert.rejects(b.send('alice', 'reveal', [0n, REPORT, SALT]), /BadState/);
  const r = await b.call('getReport', [0n]);
  assert.equal(r.reportHash, REPORT);
  assert.equal(r.state, 2n);
  // an unrevealed commitment expires after 90 days; its bond stays in the pool
  await assert.rejects(b.send('anyone', 'expire', [1n]), /TooEarly/);
  c.advance(90 * DAY + 1);
  await assert.rejects(b.send('mallory', 'reveal', [1n, REPORT, SALT]), /TooLate|BadReveal/);
  await b.send('anyone', 'expire', [1n]);
  assert.equal(await b.call('available'), 30n * E + BOND, 'the forfeited bond funds bounties');
  await invariant();
});

test('payout: threshold approvals of the same amount schedule it to the reporter; it waits the timelock; the reporter withdraws amount + bond', async () => {
  const id = await report();
  await assert.rejects(b.send('alice', 'approvePay', [id, 5n * E]), /NotMember/);
  await assert.rejects(b.send('m1', 'approvePay', [id, 11n * E]), /OverCap/, 'more than maxPayout');
  await b.send('m1', 'approvePay', [id, 5n * E]);
  await assert.rejects(b.send('m1', 'approvePay', [id, 5n * E]), /AlreadyApproved/);
  await b.send('m2', 'approvePay', [id, 4n * E]);              // a different amount is a different decision
  assert.equal((await b.call('getReport', [id])).state, 2n, 'not scheduled: no two members agreed on an amount');
  const ev = await b.send('m3', 'approvePay', [id, 5n * E]);
  const s = ev.find((e) => e?.name === 'Scheduled');
  assert.equal(s.args.reporter, a('alice'));
  assert.equal(s.args.eta, BigInt(c.now()) + BigInt(TL));
  assert.equal(await b.call('reserved'), 5n * E);
  assert.equal(await b.call('available'), 25n * E);
  await assert.rejects(b.send('anyone', 'execute', [id]), /TooEarly/);
  c.advance(TL - 10);
  await assert.rejects(b.send('anyone', 'execute', [id]), /TooEarly/, 'no instant payout');
  c.advance(10);
  await b.send('anyone', 'execute', [id]);
  await assert.rejects(b.send('anyone', 'execute', [id]), /BadState/);
  assert.equal(await b.call('owed', [a('alice')]), 5n * E + BOND);
  await assert.rejects(b.send('m1', 'withdraw', []), /Nothing/, 'the committee is owed nothing');
  const before = await c.balance('alice');
  await b.send('alice', 'withdraw', []);
  assert.equal((await c.balance('alice')) - before, 5n * E + BOND);
  assert.equal(await b.call('paidTotal'), 5n * E);
  await invariant();
});

test('reject: the threshold rejects (even a scheduled payout, during its timelock); the bond stays in the pool; nothing is paid', async () => {
  const id = await report();
  await b.send('m1', 'approvePay', [id, 5n * E]);
  await b.send('m2', 'approvePay', [id, 5n * E]);
  await b.send('m1', 'approveReject', [id]);
  assert.equal((await b.call('getReport', [id])).state, 3n, 'one rejection is not enough');
  await b.send('m3', 'approveReject', [id]);
  assert.equal((await b.call('getReport', [id])).state, 5n);
  assert.equal(await b.call('reserved'), 0n);
  assert.equal(await b.call('periodLeft'), 15n * E, 'the period budget is given back');
  c.advance(TL);
  await assert.rejects(b.send('anyone', 'execute', [id]), /BadState/);
  assert.equal(await b.call('available'), 30n * E + BOND);
  await invariant();
});

test('caps: per report and per period; the pool never promises more than it holds', async () => {
  const ids = [await report('alice'), await report('bob', keccak256(toUtf8Bytes('second')))];
  await b.send('m1', 'approvePay', [ids[0], 10n * E]);
  await b.send('m2', 'approvePay', [ids[0], 10n * E]);
  assert.equal(await b.call('periodLeft'), 5n * E);
  await b.send('m1', 'approvePay', [ids[1], 6n * E]);
  await assert.rejects(b.send('m2', 'approvePay', [ids[1], 6n * E]), /OverCap/, 'over the period cap');
  // next period: the budget is back
  c.advance(30 * DAY);
  await b.send('m1', 'approvePay', [ids[1], 10n * E]);
  await b.send('m2', 'approvePay', [ids[1], 10n * E]);
  // a third report, the pool now holds 30 + 2 bonds and has 20 reserved: 10 more is fine, 11 is over maxPayout anyway
  const third = await report('mallory', keccak256(toUtf8Bytes('third')));
  c.advance(30 * DAY);
  const small = await c.deploy('ZetaphyBounty', [[a('m1'), a('m2'), a('m3')], 2, 10n * E, 15n * E, TL, 0n], 'anyone');
  await small.send('funder', 'fund', [], 3n * E);
  const cm = await small.call('commitmentOf', [REPORT, a('alice'), SALT]);
  await small.send('alice', 'commit', [cm], 0n);
  c.mine();
  await small.send('alice', 'reveal', [0n, REPORT, SALT]);
  await small.send('m1', 'approvePay', [0n, 4n * E]);
  await assert.rejects(small.send('m2', 'approvePay', [0n, 4n * E]), /Underfunded/, 'more than the pool holds');
  assert.ok(third >= 0n);
  await invariant();
});

test('pause: any member pauses at once; nothing is approved or executed; unpausing takes the threshold and another timelock', async () => {
  const id = await report();
  await b.send('m1', 'approvePay', [id, 5n * E]);
  await b.send('m2', 'approvePay', [id, 5n * E]);
  await assert.rejects(b.send('alice', 'pause', []), /NotMember/, 'only the committee pauses');
  await b.send('m3', 'pause', []);
  c.advance(TL);
  await assert.rejects(b.send('anyone', 'execute', [id]), /IsPaused/);
  const id2 = await report('bob', keccak256(toUtf8Bytes('b')));  // reports still come in while paused
  await assert.rejects(b.send('m1', 'approvePay', [id2, E]), /IsPaused/);
  await b.send('m1', 'approveUnpause', []);
  assert.equal(await b.call('paused'), true, 'one member cannot unpause');
  await b.send('m2', 'approveUnpause', []);
  assert.equal(await b.call('paused'), false);
  await assert.rejects(b.send('anyone', 'execute', [id]), /TooEarly/, 'an unpause adds a timelock');
  c.advance(TL);
  await b.send('anyone', 'execute', [id]);
  // a second pause needs fresh unpause approvals (the first ones were for the first pause)
  await b.send('m1', 'pause', []);
  await b.send('m1', 'approveUnpause', []);
  assert.equal(await b.call('paused'), true);
});

test('no admin drain: no function moves pool money except to a reporter\'s credit; a committee change takes the timelock and voids old approvals', async () => {
  const fns = b.iface.fragments.filter((f) => f.type === 'function' && f.stateMutability !== 'view' && f.stateMutability !== 'pure').map((f) => f.name).sort();
  assert.deepEqual(fns, ['abandon', 'applyBond', 'applyCommittee', 'applyVerifier', 'approveBond', 'approveCommittee', 'approvePay', 'approveReject',
    'approveUnpause', 'approveVerifier', 'commit', 'execute', 'expire', 'fund', 'pause', 'proveExploit', 'reveal', 'withdraw'].sort(),
  'the whole write surface: no sweep, no rescue, no owner');
  const id = await report();
  await b.send('m1', 'approvePay', [id, 5n * E]);
  // the committee is replaced (m1, m2 and a newcomer): old approvals are void after it applies
  const next = [a('m1'), a('m2'), a('mallory')];
  await b.send('m1', 'approveCommittee', [next, 2]);
  await b.send('m2', 'approveCommittee', [next, 2]);
  await assert.rejects(b.send('anyone', 'applyCommittee', [next, 2]), /TooEarly/);
  c.advance(TL);
  await assert.rejects(b.send('anyone', 'applyCommittee', [[a('m1'), a('mallory')], 2]), /NotQueued/, 'only what the threshold approved');
  await b.send('anyone', 'applyCommittee', [next, 2]);
  assert.equal(await b.call('isMember', [a('m3')]), false);
  assert.equal(await b.call('epoch'), 2n);
  await b.send('m2', 'approvePay', [id, 5n * E]);
  assert.equal((await b.call('getReport', [id])).state, 2n, "m1's approval was for the old committee");
  await assert.rejects(b.send('m3', 'approvePay', [id, 5n * E]), /NotMember/);
  // the bond: threshold + timelock as well
  await b.send('m1', 'approveBond', [E]);
  await b.send('m2', 'approveBond', [E]);
  c.advance(TL);
  await b.send('anyone', 'applyBond', [E]);
  assert.equal(await b.call('reportBond'), E);
});

test('proof-of-exploit hook: no verifier, no proof path; a committee-set (timelocked) verifier schedules a capped payout the committee can still reject', async () => {
  const { MockExploitVerifier } = compileHelper('BountyKit.sol');
  const v = await c.deployRaw(MockExploitVerifier, [], 'anyone');
  const id = await report();
  await assert.rejects(b.send('alice', 'proveExploit', [id, '0x01']), /NoVerifier/);
  await b.send('m1', 'approveVerifier', [v.address]);
  await b.send('m2', 'approveVerifier', [v.address]);
  c.advance(TL);
  await b.send('anyone', 'applyVerifier', [v.address]);
  await assert.rejects(b.send('alice', 'proveExploit', [id, '0x00']), /NotProven/);
  // the mock accepts proof 0x01 and supports 50 ETH: capped at maxPayout
  const ev = await b.send('alice', 'proveExploit', [id, '0x01']);
  const s = ev.find((e) => e?.name === 'Scheduled');
  assert.equal(s.args.amount, 10n * E);
  assert.equal(s.args.verified, true);
  await assert.rejects(b.send('anyone', 'execute', [id]), /TooEarly/, 'the same timelock');
  c.advance(TL);
  await b.send('anyone', 'execute', [id]);
  assert.equal(await b.call('owed', [a('alice')]), 10n * E + BOND);
  // a second verified report (next period: the first used 10 of its 15) the committee rejects during the timelock
  c.advance(30 * DAY);
  const id2 = await report('bob', keccak256(toUtf8Bytes('x')));
  await b.send('bob', 'proveExploit', [id2, '0x01']);
  await b.send('m1', 'approveReject', [id2]);
  await b.send('m3', 'approveReject', [id2]);
  c.advance(TL);
  await assert.rejects(b.send('anyone', 'execute', [id2]), /BadState/);
  await invariant();
});

test('abandon: a revealed report the committee never decides returns its bond to the reporter after 180 days', async () => {
  const id = await report();
  await assert.rejects(b.send('alice', 'abandon', [id]), /TooEarly/);
  c.advance(180 * DAY + 1);
  await assert.rejects(b.send('mallory', 'abandon', [id]), /BadReport/);
  await b.send('alice', 'abandon', [id]);
  assert.equal(await b.call('owed', [a('alice')]), BOND);
  await invariant();
});

test('random operation sequences keep the accounting invariant (held >= reserved + owed + bonds; paid <= periods x cap)', async () => {
  let seed = 7n;
  const rnd = (n) => { seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n); return Number(seed % BigInt(n)); };
  const ms = ['m1', 'm2', 'm3'];
  const rs = ['alice', 'bob', 'mallory'];
  let count = 0n;
  const start = c.now();
  for (let i = 0; i < 160; i++) {
    const op = rnd(9);
    const id = count ? BigInt(rnd(Number(count))) : 0n;
    try {
      if (op === 0) { const who = rs[rnd(3)]; const h = keccak256(toUtf8Bytes(`r${i}`)); const cm = await b.call('commitmentOf', [h, a(who), SALT]); await b.send(who, 'commit', [cm], BOND); count++; c.mine(); await b.send(who, 'reveal', [count - 1n, h, SALT]); }
      else if (op <= 2) await b.send(ms[rnd(3)], 'approvePay', [id, (id % 5n + 1n) * E]); // members agree on an amount per report
      else if (op === 3) await b.send(ms[rnd(3)], 'approveReject', [id]);
      else if (op === 4) await b.send('anyone', 'execute', [id]);
      else if (op === 5) await b.send(rs[rnd(3)], 'withdraw', []);
      else if (op === 6) c.advance(rnd(5) * DAY);
      else if (op === 7) await b.send('funder', 'fund', [], BigInt(1 + rnd(5)) * E);
      else if (rnd(4) === 0) await b.send(ms[rnd(3)], rnd(2) ? 'pause' : 'approveUnpause', []);
    } catch { /* reverts are fine; the invariant is what matters */ }
    await invariant();
  }
  const periods = (c.now() - start) / BigInt(30 * DAY) + 2n;
  assert.ok((await b.call('paidTotal')) <= periods * 15n * E, 'at most periodCap per period');
  assert.ok(count >= 5n && (await b.call('paidTotal')) > 0n, `the sequence did real work (${count} reports, ${await b.call('paidTotal')} paid)`);
});
