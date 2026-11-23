import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, encodeBase58, randomBytes } from 'ethers';
import { sumHolders, takeSnapshot, snapshotAt } from '../airdrop/snapshot.js';
import { allocate, POOL } from '../airdrop/allocate.js';
import { buildTree, verify } from '../airdrop/merkle.js';

const MINT = 'So11111111111111111111111111111111111111112';
const key = () => encodeBase58(randomBytes(32));
const acct = (owner, amount, mint = MINT) => ({ account: { data: { parsed: { info: { mint, owner, tokenAmount: { amount: String(amount) } } } } } });

test('snapshot sums every token account per owner, across both token programs', () => {
  const [a, b, c, vault] = [key(), key(), key(), key()];
  const holders = sumHolders([[acct(a, 5), acct(b, 7), acct(a, 3), acct(c, 0), acct(b, 99, key())], [acct(c, 2), acct(vault, 1000)]], MINT, new Set([vault]));
  assert.deepEqual(holders.map((h) => [h.owner, h.amount]), [[a, 8n], [b, 7n], [c, 2n]]);
});

test('takeSnapshot asks for finalized data of the given mint only', async () => {
  const calls = [];
  const fetchImpl = async (_u, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push([method, params]);
    return { json: async () => ({ result: method === 'getSlot' ? 123 : [acct('8'.repeat(32), 10)] }) };
  };
  const s = await takeSnapshot({ mint: MINT, rpcUrl: 'https://rpc.example', fetchImpl });
  assert.equal(s.slot, 123);
  assert.deepEqual(s.holders, [{ owner: '8'.repeat(32), amount: '20' }]); // one account per program
  assert.equal(calls[1][1][1].filters[0].memcmp.bytes, MINT);
  assert.equal(calls[1][1][1].commitment, 'finalized');
  await assert.rejects(takeSnapshot({ mint: '0xabc', rpcUrl: 'x', fetchImpl }), /Solana address/);
});

test('allocation is pro-rata, never exceeds the pool, and reports dust', () => {
  const snap = { holders: [{ owner: 'A', amount: '1' }, { owner: 'B', amount: '2' }, { owner: 'C', amount: '3' }] };
  const exact = Object.fromEntries(allocate(snap, { pool: 600n }).allocations.map((a) => [a.owner, a.zetaphy]));
  assert.deepEqual(exact, { A: '100', B: '200', C: '300' });
  const r = allocate(snap); // the real 200M pool: rounding leaves dust, which is reported
  const sum = r.allocations.reduce((t, a) => t + BigInt(a.zetaphy), 0n);
  assert.equal(sum + BigInt(r.dust), POOL);
  assert.ok(BigInt(r.dust) < 3n);
});

test('whale cap: capped holders get the cap, others share the rest', () => {
  const snap = { holders: [{ owner: 'W', amount: '900' }, { owner: 'A', amount: '50' }, { owner: 'B', amount: '50' }] };
  const r = allocate(snap, { pool: 1000n, capBps: 4000 }); // cap 400
  const z = Object.fromEntries(r.allocations.map((a) => [a.owner, BigInt(a.zetaphy)]));
  assert.equal(z.W, 400n);
  assert.equal(z.A, 300n);
  assert.equal(z.B, 300n);
  assert.equal(r.dust, '0');
});

test('dust filter drops tiny holders', () => {
  const r = allocate({ holders: [{ owner: 'A', amount: '5' }, { owner: 'B', amount: '1000' }] }, { pool: 100n, minAmount: 10n });
  assert.deepEqual(r.allocations.map((a) => a.owner), ['B']);
  assert.equal(r.allocations[0].zetaphy, '100');
});

test('every claim proves against the root; a changed amount or owner does not', () => {
  const allocations = Array.from({ length: 7 }, (_, i) => ({ owner: key(), zetaphy: String((i + 1) * 1000) }));
  const { root, claims } = buildTree(allocations);
  for (const a of allocations) assert.ok(verify(root, a.owner, a.zetaphy, claims[a.owner].proof));
  const a0 = allocations[0];
  assert.ok(!verify(root, a0.owner, '999999', claims[a0.owner].proof));
  assert.ok(!verify(root, allocations[1].owner, a0.zetaphy, claims[a0.owner].proof));
  assert.throws(() => buildTree([allocations[0], allocations[0]]), /duplicate/);
  assert.ok(Wallet); // ethers loaded
});

test('snapshotAt rolls today\'s balances back to a past time, closed accounts included', async () => {
  const AT = '2026-11-20T14:00:00Z', T = Date.parse(AT) / 1000;
  const [a, b, c] = ['A'.repeat(32), 'B'.repeat(32), 'C'.repeat(32)];
  const [A1, B1, C1, X] = ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32), '4'.repeat(32)];
  const withKey = (pubkey, owner, amount) => ({ pubkey, ...acct(owner, amount) });
  const tb = (i, owner, amount) => ({ accountIndex: i, mint: MINT, owner, uiTokenAmount: { amount: String(amount) } });
  // after the snapshot: C1 (owner c) sent all its 7 to A1 and was closed; a failed transfer touched B1; B1 had an older transfer
  const txs = {
    s1: { meta: { err: null, preTokenBalances: [tb(0, c, 7), tb(1, a, 3)], postTokenBalances: [tb(1, a, 10)] }, transaction: { message: { accountKeys: [{ pubkey: C1 }, { pubkey: A1 }] } } },
    s2: { meta: { err: { InstructionError: [0, 'x'] }, preTokenBalances: [tb(0, b, 5)], postTokenBalances: [tb(0, b, 0)] }, transaction: { message: { accountKeys: [B1] } } },
  };
  const sigs = { [A1]: [{ signature: 's1', blockTime: T + 60 }], [C1]: [{ signature: 's1', blockTime: T + 60 }, { signature: 's0', blockTime: T - 60 }], [B1]: [{ signature: 's2', blockTime: T + 5 }, { signature: 's0', blockTime: T - 3600 }] };
  const asked = [];
  const fetchImpl = async (_u, init) => {
    const { method, params } = JSON.parse(init.body);
    asked.push(method);
    const result = method === 'getSlot' ? 9 : method === 'getProgramAccounts' ? (params[0].startsWith('Tokenkeg') ? [withKey(A1, a, 10), withKey(B1, b, 5)] : [])
      : method === 'getSignaturesForAddress' ? (sigs[params[0]] ?? []) : method === 'getTransaction' ? txs[params[0]] : null;
    return { json: async () => ({ result }) };
  };
  const s = await snapshotAt({ mint: MINT, rpcUrl: 'x', at: AT, fetchImpl });
  assert.deepEqual(s.holders, [{ owner: c, amount: '7' }, { owner: b, amount: '5' }, { owner: a, amount: '3' }]);
  assert.equal(s.at, '2026-11-20T14:00:00.000Z');
  assert.equal(s.accountsRolledBack, 2); // A1 (+7 undone) and C1 (-7 undone); B1's failed transfer changes nothing
  assert.equal(asked.filter((m) => m === 'getTransaction').length, 2, 'one fetch per transaction');
  await assert.rejects(snapshotAt({ mint: MINT, rpcUrl: 'x', at: 'yesterday', fetchImpl }), /ISO time/);
});
