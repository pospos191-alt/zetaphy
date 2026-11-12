// ZtphyMerkleDistributor (contracts/ZtphyMerkleDistributor.sol, docs/AIRDROP.md) against the list tooling
// (airdrop/distributor.js): claims, double claims, wrong proofs, the window, sweep, abort, reentrancy by a contract
// recipient, a 100,000-leaf tree (timed) with random and edge indices proven and claimed on chain, gas per claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getAddress, ZeroAddress, AbiCoder, keccak256, hexlify, randomBytes } from 'ethers';
import solc from 'solc';
import { Address } from '@ethereumjs/util';
import { createChain, ZETA } from './helpers/evm.js';
import { buildRound, leafHash, verifyClaim } from '../airdrop/distributor.js';

const DAY = 86_400n;
let kitCache = null;
function kit() {
  if (kitCache) return kitCache;
  const input = { language: 'Solidity', sources: { 'DistributorKit.sol': { content: readFileSync(new URL('./helpers/DistributorKit.sol', import.meta.url), 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  kitCache = Object.fromEntries(Object.entries(out.contracts['DistributorKit.sol']).map(([n, c]) => [n, { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }]));
  return kitCache;
}

const rand = () => getAddress(hexlify(randomBytes(20)));
/** calldata gas (EIP-2028): 16 per non-zero byte, 4 per zero byte. */
const calldataGas = (hex) => [...Buffer.from(hex.slice(2), 'hex')].reduce((s, b) => s + (b ? 16 : 4), 0);

async function setup({ allocations, guardian = true, startIn = 0n, fund = true, total, count, returnTo } = {}) {
  const c = await createChain(['gov', 'fund', 'guard', 'relayer', 'alice', 'bob', 'carol', 'anyone']);
  const a = (n) => c.acct[n].toString();
  allocations ??= [
    { address: getAddress(a('alice')), amount: (100n * ZETA).toString() },
    { address: getAddress(a('bob')), amount: (250n * ZETA).toString() },
    { address: getAddress(a('carol')), amount: (7n * ZETA).toString() },
  ];
  const round = buildRound(allocations, { chainId: 1 });
  const start = c.now() + startIn;
  const deadline = c.now() + 90n * DAY;
  const d = await c.deploy('ZtphyMerkleDistributor', [round.summary.root, total ?? BigInt(round.summary.total), count ?? round.summary.count,
    start, deadline, returnTo ?? a('fund'), guardian ? a('guard') : ZeroAddress], 'gov');
  if (fund) await d.sendValue('gov', BigInt(round.summary.total));
  const claimOf = (addr) => {
    const s = round.shards[addr.toLowerCase().slice(2, 2 + round.summary.shardPrefixLength)];
    const x = s.claims[addr.toLowerCase()];
    return { index: x.index, amount: BigInt(x.amount), proof: x.proof };
  };
  return { c, a, d, round, start, deadline, claimOf };
}
const args = (x, account) => [x.index, account, x.amount, x.proof];

test('leaf and proofs: the JS tree is the contract\'s (leafOf, verifyProof)', async () => {
  const { d, a, round, claimOf } = await setup();
  for (const n of ['alice', 'bob', 'carol']) {
    const x = claimOf(a(n));
    assert.equal(await d.call('leafOf', [x.index, a(n), x.amount]), leafHash(x.index, a(n), x.amount));
    assert.equal(await d.call('verifyProof', args(x, a(n))), true);
  }
  // the documented encoding, independently: keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
  const x = claimOf(a('bob'));
  const inner = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256'], [x.index, a('bob'), x.amount]));
  assert.equal(leafHash(x.index, a('bob'), x.amount), keccak256(inner));
  assert.equal(await d.call('merkleRoot'), round.summary.root);
});

test('a valid claim pays the leaf account, whoever submits it; once per index', async () => {
  const { c, d, a, claimOf } = await setup();
  const x = claimOf(a('alice'));
  const before = await c.balance('alice');
  const ev = (await d.send('relayer', 'claim', args(x, a('alice')))).filter(Boolean);
  assert.equal(await c.balance('alice') - before, 100n * ZETA);
  const claimed = ev.find((e) => e.name === 'Claimed');
  assert.equal(claimed.args.index, BigInt(x.index));
  assert.equal(claimed.args.account, getAddress(a('alice')));
  assert.equal(claimed.args.submitter, getAddress(a('relayer')));
  assert.equal(await d.call('isClaimed', [x.index]), true);
  assert.equal(await d.call('totalClaimed'), 100n * ZETA);
  assert.equal(await d.call('claimCount'), 1n);
  await assert.rejects(d.send('alice', 'claim', args(x, a('alice'))), /AlreadyClaimed/);
  await assert.rejects(d.send('relayer', 'claim', args(x, a('alice'))), /AlreadyClaimed/);
});

test('wrong proof, amount, account or index: BadProof, nothing paid', async () => {
  const { c, d, a, claimOf } = await setup();
  const x = claimOf(a('bob'));
  const y = claimOf(a('alice'));
  const bal = await c.balance(Address.fromString(d.address));
  await assert.rejects(d.send('bob', 'claim', [x.index, a('bob'), x.amount + 1n, x.proof]), /BadProof/);
  await assert.rejects(d.send('bob', 'claim', [x.index, a('anyone'), x.amount, x.proof]), /BadProof/); // someone else's address
  await assert.rejects(d.send('bob', 'claim', [x.index, a('bob'), x.amount, y.proof]), /BadProof/);
  await assert.rejects(d.send('bob', 'claim', [y.index, a('bob'), x.amount, x.proof]), /BadProof/);
  await assert.rejects(d.send('bob', 'claim', [x.index, a('bob'), x.amount, []]), /BadProof/);
  await assert.rejects(d.send('bob', 'claim', [3, a('bob'), x.amount, x.proof]), /BadProof/); // index >= leafCount
  await assert.rejects(d.send('bob', 'claim', [x.index + 256, a('bob'), x.amount, x.proof]), /BadProof/);
  assert.equal(await c.balance(Address.fromString(d.address)), bal);
  assert.equal(await d.call('isClaimed', [x.index]), false);
});

test('the window: not before claimStart, not after claimDeadline', async () => {
  const { c, d, a, claimOf } = await setup({ startIn: 3n * DAY });
  const x = claimOf(a('carol'));
  await assert.rejects(d.send('carol', 'claim', args(x, a('carol'))), /NotOpen/);
  c.advance(3n * DAY);
  await d.send('carol', 'claim', args(x, a('carol')));
  c.advance(90n * DAY);
  const y = claimOf(a('bob'));
  await assert.rejects(d.send('bob', 'claim', args(y, a('bob'))), /Closed/);
  await assert.rejects(d.send('bob', 'claimMany', [[args(y, a('bob'))]]), /Closed/);
});

test('sweep: refused before the deadline, after it everything left goes to returnTo (anyone may call)', async () => {
  const { c, d, a, claimOf } = await setup();
  await d.send('alice', 'claim', args(claimOf(a('alice')), a('alice')));
  await assert.rejects(d.send('anyone', 'sweep'), /StillOpen/);
  await assert.rejects(d.send('fund', 'sweep'), /StillOpen/);
  c.advance(90n * DAY);
  const before = await c.balance('fund');
  const ev = (await d.send('anyone', 'sweep')).filter(Boolean);
  assert.equal(await c.balance('fund') - before, 257n * ZETA);
  assert.equal(await c.balance(Address.fromString(d.address)), 0n);
  assert.equal(ev.find((e) => e.name === 'Swept').args.amount, 257n * ZETA);
  // coins sent later can still only go to returnTo
  await d.sendValue('gov', 5n);
  await d.send('anyone', 'sweep');
  assert.equal(await c.balance('fund') - before, 257n * ZETA + 5n);
});

test('abort: guardian only, only before the first claim; then claims close and sweep works at once', async () => {
  const { c, d, a, claimOf } = await setup();
  await assert.rejects(d.send('anyone', 'abort'), /NotGuardian/);
  await assert.rejects(d.send('gov', 'abort'), /NotGuardian/);
  await d.send('guard', 'abort');
  assert.equal(await d.call('aborted'), true);
  await assert.rejects(d.send('guard', 'abort'), /Closed/);
  await assert.rejects(d.send('alice', 'claim', args(claimOf(a('alice')), a('alice'))), /Closed/);
  const before = await c.balance('fund');
  await d.send('anyone', 'sweep');
  assert.equal(await c.balance('fund') - before, 357n * ZETA);

  const s2 = await setup();
  await s2.d.send('alice', 'claim', args(s2.claimOf(s2.a('alice')), s2.a('alice')));
  await assert.rejects(s2.d.send('guard', 'abort'), /ClaimsStarted/);
  const s3 = await setup({ guardian: false });
  await assert.rejects(s3.d.send('guard', 'abort'), /NotGuardian/);
});

test('claimMany: a relayer pays the gas; claimed indices are skipped, a bad proof reverts the batch', async () => {
  const { c, d, a, claimOf } = await setup();
  const [x, y, z] = ['alice', 'bob', 'carol'].map((n) => claimOf(a(n)));
  await d.send('bob', 'claim', args(y, a('bob')));
  const before = [await c.balance('alice'), await c.balance('carol')];
  await assert.rejects(d.send('relayer', 'claimMany', [[args(x, a('alice')), [z.index, a('carol'), z.amount + 1n, z.proof]]]), /BadProof/);
  assert.equal(await d.call('isClaimed', [x.index]), false);
  const ev = (await d.send('relayer', 'claimMany', [[args(x, a('alice')), args(y, a('bob')), args(z, a('carol'))]])).filter(Boolean);
  assert.equal(ev.filter((e) => e.name === 'Claimed').length, 2);
  assert.equal(await c.balance('alice') - before[0], 100n * ZETA);
  assert.equal(await c.balance('carol') - before[1], 7n * ZETA);
  assert.equal(await d.call('claimCount'), 3n);
  assert.equal(await d.call('totalClaimed'), 357n * ZETA);
});

test('underfunded or over-allocated roots cannot pay more than funded / declared', async () => {
  const s = await setup({ fund: false });
  await s.d.sendValue('gov', 50n * ZETA);
  await assert.rejects(s.d.send('alice', 'claim', args(s.claimOf(s.a('alice')), s.a('alice'))), /NotFunded/);
  await s.d.send('carol', 'claim', args(s.claimOf(s.a('carol')), s.a('carol')));
  // a list whose declared total is smaller than its leaves: the contract stops at the declared total
  const t = await setup({ total: 120n * ZETA });
  await t.d.send('alice', 'claim', args(t.claimOf(t.a('alice')), t.a('alice')));
  await assert.rejects(t.d.send('bob', 'claim', args(t.claimOf(t.a('bob')), t.a('bob'))), /OverAllocated/);
  await t.d.send('carol', 'claim', args(t.claimOf(t.a('carol')), t.a('carol'))); // 107 <= 120
});

test('constructor refuses a bad configuration', async () => {
  const c = await createChain(['gov', 'fund']);
  const root = '0x' + '11'.repeat(32);
  const now = c.now();
  const f = c.acct.fund.toString();
  for (const bad of [
    ['0x' + '00'.repeat(32), 1n, 1, now, now + DAY, f, ZeroAddress],
    [root, 1n, 1, now, now + DAY, ZeroAddress, ZeroAddress],
    [root, 0n, 1, now, now + DAY, f, ZeroAddress],
    [root, 1n, 0, now, now + DAY, f, ZeroAddress],
    [root, 1n, 1, now + DAY, now + DAY, f, ZeroAddress],
    [root, 1n, 1, now - 2n * DAY, now - DAY, f, ZeroAddress],
    [root, 2n ** 128n, 1, now, now + DAY, f, ZeroAddress],
  ]) await assert.rejects(c.deploy('ZtphyMerkleDistributor', bad, 'gov'), /deploy failed/);
});

test('reentrancy: a contract recipient that calls back finds its leaf claimed and cannot sweep; a refusing one is not marked', async () => {
  const k = kit();
  const c0 = await createChain(['gov']);
  const re = await c0.deployRaw(k.ReenteringClaimer, [], 'gov');
  // a fresh setup on another chain cannot see re; build the round around fixed addresses on one chain instead
  const c = c0;
  const refuse = await c.deployRaw(k.RefusingClaimer, [], 'gov');
  const allocations = [{ address: getAddress(re.address), amount: (10n * ZETA).toString() }, { address: getAddress(refuse.address), amount: (5n * ZETA).toString() },
    { address: getAddress(c.acct.gov.toString()), amount: '1' }];
  const round = buildRound(allocations, { chainId: 1 });
  const d = await c.deploy('ZtphyMerkleDistributor', [round.summary.root, BigInt(round.summary.total), round.summary.count, c.now(), c.now() + 30n * DAY, c.acct.gov.toString(), ZeroAddress], 'gov');
  await d.sendValue('gov', BigInt(round.summary.total) + 1000n * ZETA); // extra coins a reentrant sweep would like to take
  const get = (addr) => round.list.find((r) => r.address === getAddress(addr));
  const r = get(re.address);
  const proof = round.tree.proofOf(r.index);
  await re.send('gov', 'arm', [d.address, r.index, r.amount, proof]);
  await d.send('gov', 'claim', [r.index, re.address, r.amount, proof]);
  assert.equal(await re.call('received'), 10n * ZETA);
  assert.equal(await re.call('reentryPaid'), false);
  assert.equal(await re.call('sweepWorked'), false);
  assert.equal(d.iface.parseError(await re.call('reentryError')).name, 'AlreadyClaimed');
  const f = get(refuse.address);
  await assert.rejects(d.send('gov', 'claim', [f.index, refuse.address, f.amount, round.tree.proofOf(f.index)]), /PayFailed/);
  assert.equal(await d.call('isClaimed', [f.index]), false);
  assert.equal(await d.call('claimCount'), 1n);
  // a returnTo that refuses: sweep fails and keeps the coins (they are not lost)
  const rr = await c.deployRaw(k.RefusingReturn, [], 'gov');
  const d2 = await c.deploy('ZtphyMerkleDistributor', [round.summary.root, 1n, 1, c.now(), c.now() + DAY, rr.address, ZeroAddress], 'gov');
  await d2.sendValue('gov', 9n);
  c.advance(DAY);
  await assert.rejects(d2.send('gov', 'sweep'), /PayFailed/);
  assert.equal(await c.balance(Address.fromString(d2.address)), 9n);
});

test('100,000 leaves: build time, random and edge indices prove and claim on chain; gas per claim', { timeout: 600_000 }, async () => {
  const N = 100_000;
  const t0 = Date.now();
  const allocations = Array.from({ length: N }, (_, i) => ({ address: rand(), amount: ((BigInt(i % 997) + 1n) * 10n ** 15n).toString() })); // total ~50,000 ZTPHY: the test chain funds 1M
  const tGen = Date.now() - t0;
  const t1 = Date.now();
  const round = buildRound(allocations, { chainId: 1 });
  const tBuild = Date.now() - t1;
  assert.equal(round.summary.count, N);
  assert.equal(round.summary.depth, 17);
  assert.equal(round.summary.shardPrefixLength, 3);
  const sizes = Object.values(round.shards).map((s) => JSON.stringify(s).length);
  console.log(`100k tree: ${tGen} ms to make addresses, ${tBuild} ms to index + hash + prove + shard; ${round.summary.shards} shards, largest ${(Math.max(...sizes) / 1024).toFixed(1)} KB, mean ${(sizes.reduce((s, x) => s + x, 0) / sizes.length / 1024).toFixed(1)} KB`);
  assert.ok(Math.max(...sizes) < 120 * 1024, 'every shard is small enough to host statically');

  const c = await createChain(['gov', 'fund', 'relayer']);
  const d = await c.deploy('ZtphyMerkleDistributor', [round.summary.root, BigInt(round.summary.total), N, c.now(), c.now() + 90n * DAY, c.acct.fund.toString(), ZeroAddress], 'gov');
  await d.sendValue('gov', BigInt(round.summary.total));
  const edges = [0, 1, 2, 255, 256, 511, 65_535, 65_536, 98_303, 98_304, N - 2, N - 1]; // word / subtree boundaries and the odd tail
  const randoms = Array.from({ length: 200 }, () => Math.floor(Math.random() * N));
  for (const i of [...edges, ...randoms]) {
    const r = round.list[i];
    const p = round.tree.proofOf(i);
    assert.ok(verifyClaim(round.summary.root, { index: i, address: r.address, amount: r.amount, proof: p }), `JS proof ${i}`);
    assert.equal(await d.call('verifyProof', [i, r.address, r.amount, p]), true, `on-chain proof ${i}`);
  }
  // claim the edges (+ a few randoms) for real, measuring gas: new recipient account, first/second claim in a bitmap word
  const gas = [];
  for (const i of [...edges, ...randoms.slice(0, 8)]) {
    const r = round.list[i];
    if (await d.call('isClaimed', [i])) continue;
    const g = await d.gas('relayer', 'claim', [i, r.address, r.amount, round.tree.proofOf(i)]);
    gas.push({ i, proof: round.tree.proofOf(i).length, total: 21_000 + calldataGas(g.data) + g.exec, exec: g.exec });
    assert.equal(await c.balance(Address.fromString(r.address)), r.amount);
  }
  // one batch of 20 by a relayer
  const batch = Array.from({ length: 20 }, (_, j) => 40_000 + j * 37).map((i) => [i, round.list[i].address, round.list[i].amount, round.tree.proofOf(i)]);
  const gb = await d.gas('relayer', 'claimMany', [batch]);
  const perBatched = (21_000 + calldataGas(gb.data) + gb.exec) / 20;
  const tot = gas.map((g) => g.total);
  const mean = tot.reduce((s, x) => s + x, 0) / tot.length;
  console.log(`gas per claim (tx total incl. 21000 + calldata, new recipient account): min ${Math.min(...tot)}, mean ${Math.round(mean)}, max ${Math.max(...tot)}; claimMany x20: ${Math.round(perBatched)} per claim; each: ${gas.map((g) => `${g.i}:${g.total}`).join(" ")}`);
  // over a whole round 255 of 256 claims land in a bitmap word already touched (indices 1, 2, 255, 511 here)
  const steady = gas.filter((g) => [1, 2, 255, 511].includes(g.i)).reduce((s, g) => s + g.total, 0) / 4;
  const opening = gas.filter((g) => [256, 65_535, 65_536].includes(g.i)).reduce((s, g) => s + g.total, 0) / 3;
  const amortized = steady + (opening - steady) / 256;
  console.log(`cost at 1 gwei: steady ${Math.round(steady)} gas, opening a bitmap word ${Math.round(opening)}, amortized ${Math.round(amortized)} = ${(amortized * 1e-9).toFixed(6)} ZTPHY per claim, ${(amortized * 1e-9 * N).toFixed(2)} ZTPHY for ${N} claims`);
  assert.ok(Math.max(...tot) < 120_000, 'a claim stays under 120k gas');
  assert.equal(await d.call('claimCount'), BigInt(gas.length + 20));
});
