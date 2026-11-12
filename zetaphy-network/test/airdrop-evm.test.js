// EVM airdrop lists (docs/AIRDROP.md): from-csv (sign-up exports and the public-chain query's address,score),
// cleaning and amounts, eth_getCode contract filter, Solana -> EVM links (ed25519), merge, merkle shards and
// verify, through the CLI's run() as the owner would use it. A synthetic 100,000-row CSV goes the whole way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAddress, hexlify, randomBytes, encodeBase58, parseUnits } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519.js';
import { parseRecipients, assignAmounts, dropContracts, addressProblem, isDelegatedEoa } from '../airdrop/recipients.js';
import { linkMessage, verifyLink, linkSolana } from '../airdrop/link.js';
import { buildRound, verifyRound, writeRound, autoPrefix } from '../airdrop/distributor.js';
import { run } from '../airdrop/cli.js';

const Z = (n) => parseUnits(String(n), 18);
const addr = () => getAddress(hexlify(randomBytes(20)));
const TMP = process.env.AIRDROP_TMP ?? tmpdir();
const quiet = () => {};
const withDir = async (f) => { const d = mkdtempSync(join(TMP, 'airdrop-')); try { return await f(d); } finally { rmSync(d, { recursive: true, force: true }); } };

test('from-csv cleaning: checksum, duplicates (case-insensitive), zero / precompile / known, exclude list, numbers', () => {
  const a = addr(), b = addr(), c = addr();
  const j = [...a].findIndex((ch, i) => i > 1 && /[a-fA-F]/.test(ch)); // flip the case of one letter: a broken checksum
  const badSum = a.slice(0, j) + (a[j] === a[j].toUpperCase() ? a[j].toLowerCase() : a[j].toUpperCase()) + a.slice(j + 1);
  const csv = ['address,amount', `${a},10`, `${a.toLowerCase()},5`, `${b.toUpperCase().replace('0X', '0x')},1.5`, `${badSum},1`, '0x0000000000000000000000000000000000000000,1',
    '0x0000000000000000000000000000000000000800,1', '0x000000000000000000000000000000000000dEaD,1', 'not-an-address,1', `0x${'ab'.repeat(19)},1`,
    `${c},0`, `${addr()},x`, '', `"${addr()}" , 2`].join('\r\n');
  const { rows, dropped } = parseRecipients(csv, { exclude: [] });
  const why = Object.fromEntries(dropped.map((d) => [d.line, d.reason]));
  assert.deepEqual(rows.slice(0, 2).map((r) => [r.address, r.amount]), [[a, Z(10)], [b, Z('1.5')]]);
  assert.equal(rows.length, 3); // the quoted one at the end is fine
  assert.equal(why[3], 'duplicate');
  assert.equal(why[5], 'bad-checksum');
  assert.equal(why[6], 'zero-address');
  assert.equal(why[7], 'precompile-or-reserved');
  assert.equal(why[8], 'known-non-user');
  assert.equal(why[9], 'bad-address');
  assert.equal(why[10], 'bad-address');
  assert.equal(why[11], 'zero-amount');
  assert.equal(why[12], 'bad-number');
  const ex = parseRecipients(csv, { exclude: [b.toLowerCase()] });
  assert.ok(ex.dropped.some((d) => d.reason === 'excluded'));
  // no header: address[,amount]
  assert.equal(parseRecipients(`${a}\n${b}\n`).rows.length, 2);
  assert.throws(() => parseRecipients('wallet_name,foo\nx,y'), /no address column/);
  assert.equal(addressProblem(a), null);
  assert.equal(addressProblem(a.toLowerCase()), null);
});

test('amounts: given, equal (with cap), each, weight by score with a per-address cap; never more than the pool', () => {
  const rows = [{ address: addr(), score: 1n, amount: Z(10) }, { address: addr(), score: 2n, amount: Z(20) }, { address: addr(), score: 7n, amount: Z(30) }];
  assert.equal(assignAmounts(rows, { mode: 'given', pool: Z(100) }).total, Z(60).toString());
  assert.throws(() => assignAmounts(rows, { mode: 'given', pool: Z(50) }), /more than the pool/);
  const eq = assignAmounts(rows, { mode: 'equal', pool: Z(90) });
  assert.deepEqual(eq.allocations.map((x) => x.amount), [Z(30), Z(30), Z(30)].map(String));
  const eqCap = assignAmounts(rows, { mode: 'equal', pool: Z(90), cap: Z(10) });
  assert.equal(eqCap.total, Z(30).toString());
  assert.equal(eqCap.unallocated, Z(60).toString());
  assert.equal(eqCap.capped, 3);
  assert.equal(assignAmounts(rows, { mode: 'each', pool: Z(90), each: Z(5) }).total, Z(15).toString());
  assert.throws(() => assignAmounts(rows, { mode: 'each', pool: Z(10), each: Z(5) }), /more than the pool/);
  const w = assignAmounts(rows, { mode: 'weight', pool: Z(100) });
  assert.deepEqual(w.allocations.map((x) => x.amount), [Z(10), Z(20), Z(70)].map(String));
  const wc = assignAmounts(rows, { mode: 'weight', pool: Z(100), cap: Z(40) }); // 7/10 = 70 > 40 -> 40, the other 60 split 1:2
  assert.deepEqual(wc.allocations.map((x) => x.amount), [Z(20), Z(40), Z(40)].map(String));
  assert.equal(wc.capped, 2); // 40 and 40: the second is at the cap exactly (20/60 of 60*2/3 = 40)
  assert.throws(() => assignAmounts([{ address: addr() }], { mode: 'weight' }), /score column/);
  assert.throws(() => assignAmounts([{ address: addr() }], { mode: 'given' }), /needs an amount/);
});

test('eth_getCode filter: contracts dropped, EOAs and EIP-7702 delegated EOAs kept, batched, a failed answer stops', async () => {
  const eoa = addr(), contract = addr(), delegated = addr();
  const code = { [contract.toLowerCase()]: '0x6080604052', [delegated.toLowerCase()]: `0xef0100${'12'.repeat(20)}` };
  const batches = [];
  const fetchImpl = async (_u, init) => {
    const reqs = JSON.parse(init.body);
    batches.push(reqs.length);
    return { json: async () => reqs.map((r) => ({ jsonrpc: '2.0', id: r.id, result: code[r.params[0].toLowerCase()] ?? '0x' })) };
  };
  const rows = [eoa, contract, delegated, ...Array.from({ length: 250 }, addr)].map((address, i) => ({ address, line: i + 2 }));
  const r = await dropContracts(rows, { rpcUrl: 'https://eth.example', batch: 100, fetchImpl });
  assert.deepEqual(batches, [100, 100, 53]);
  assert.deepEqual(r.dropped.map((d) => [d.value, d.reason]), [[contract, 'contract']]);
  assert.equal(r.rows.length, 252);
  assert.ok(isDelegatedEoa(code[delegated.toLowerCase()]));
  const failing = async (_u, init) => ({ json: async () => JSON.parse(init.body).map((x) => ({ id: x.id, error: { message: 'rate limited' } })) });
  await assert.rejects(dropContracts(rows.slice(0, 3), { rpcUrl: 'x', fetchImpl: failing }), /rate limited/);
});

// ------------------------------------------------------------------ Solana links
const solWallet = () => { const sk = ed25519.utils.randomPrivateKey(); return { sk, owner: encodeBase58(ed25519.getPublicKey(sk)) }; };
const sign = (w, evm, chainId) => encodeBase58(ed25519.sign(new TextEncoder().encode(linkMessage(w.owner, evm, chainId)), w.sk));
const CHAIN = 77390;

test('link verification: good; wrong message, chain id, EVM address, signer, format all refused', () => {
  const w = solWallet(), evm = addr();
  assert.equal(linkMessage(w.owner, evm.toLowerCase(), CHAIN), `ZETAPHY airdrop: link ${w.owner} to ${evm} on 77390`);
  const sig = sign(w, evm, CHAIN);
  assert.deepEqual(verifyLink({ solana: w.owner, evm, signature: sig }, CHAIN), { ok: true, solana: w.owner, evm });
  // the same signature as hex and base64
  const raw = Buffer.from(ed25519.sign(new TextEncoder().encode(linkMessage(w.owner, evm, CHAIN)), w.sk));
  assert.equal(verifyLink({ solana: w.owner, evm, signature: `0x${raw.toString('hex')}` }, CHAIN).ok, true);
  assert.equal(verifyLink({ solana: w.owner, evm, signature: raw.toString('base64') }, CHAIN).ok, true);
  // signed for the testnet, presented for mainnet
  assert.equal(verifyLink({ solana: w.owner, evm, signature: sig }, 1).reason, 'bad-signature');
  assert.equal(verifyLink({ solana: w.owner, evm, signature: sig, chainId: 1 }, CHAIN).reason, 'wrong-chain-id');
  // a different message (any other text) signed by the right key
  const other = encodeBase58(ed25519.sign(new TextEncoder().encode(`ZETAPHY airdrop: link ${w.owner} to ${evm} on 77390 `), w.sk));
  assert.equal(verifyLink({ solana: w.owner, evm, signature: other }, CHAIN).reason, 'bad-signature');
  assert.equal(verifyLink({ solana: w.owner, evm, signature: sig, message: 'hello' }, CHAIN).reason, 'wrong-message');
  // someone swaps in their own EVM address
  assert.equal(verifyLink({ solana: w.owner, evm: addr(), signature: sig }, CHAIN).reason, 'bad-signature');
  // another key's signature for this owner
  assert.equal(verifyLink({ solana: w.owner, evm, signature: sign(solWallet(), evm, CHAIN) }, CHAIN).reason, 'bad-signature');
  assert.equal(verifyLink({ solana: '0xabc', evm, signature: sig }, CHAIN).reason, 'bad-solana-address');
  assert.match(verifyLink({ solana: w.owner, evm: '0x0000000000000000000000000000000000000000', signature: sig }, CHAIN).reason, /^bad-evm-address/);
  assert.equal(verifyLink({ solana: w.owner, evm, signature: 'zz' }, CHAIN).reason, 'bad-signature-format');
  // a tampered signature byte
  const t = Buffer.from(raw); t[10] ^= 1;
  assert.equal(verifyLink({ solana: w.owner, evm, signature: `0x${t.toString('hex')}` }, CHAIN).reason, 'bad-signature');
});

test('link-solana: snapshot amounts move to linked EVM addresses; duplicates count once, conflicts and strangers rejected, unlinked reported', () => {
  const [w1, w2, w3, w4, w5, stranger] = Array.from({ length: 6 }, solWallet);
  const [e1, e2, e3] = [addr(), addr(), addr()];
  const alloc = { allocations: [w1, w2, w3, w4, w5].map((w, i) => ({ owner: w.owner, swd: '1', zetaphy: String((i + 1) * 1000) })) };
  const recs = [
    { solana: w1.owner, evm: e1, signature: sign(w1, e1, CHAIN) },
    { solana: w1.owner, evm: e1.toLowerCase(), signature: sign(w1, e1, CHAIN) }, // the same link again
    { solana: w2.owner, evm: e2, signature: sign(w2, e2, CHAIN) },
    { solana: w3.owner, evm: e3, signature: sign(w3, e3, CHAIN) }, // w3 links two addresses: conflict
    { solana: w3.owner, evm: e2, signature: sign(w3, e2, CHAIN) },
    { solana: w4.owner, evm: e1, signature: sign(w4, e1, CHAIN) }, // a second wallet of the e1 person: merged
    { solana: stranger.owner, evm: e2, signature: sign(stranger, e2, CHAIN) }, // not in the snapshot
    { solana: w5.owner, evm: e3, signature: sign(w5, e3, 1) }, // signed for another chain
  ];
  const r = linkSolana(alloc, recs, { chainId: CHAIN });
  const by = Object.fromEntries(r.allocations.map((a) => [a.address, a.amount]));
  assert.deepEqual(by, { [e1]: String(1000 + 4000), [e2]: '2000' });
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.merged, [{ address: e1, owners: 2 }]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].solana, w3.owner);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['bad-signature', 'not-in-snapshot']);
  assert.deepEqual(r.unlinked.owners.map((o) => o.owner).sort(), [w3.owner, w5.owner].sort());
  assert.equal(r.unlinked.total, String(3000 + 5000));
  assert.equal(r.total, '7000');
  assert.throws(() => linkSolana(alloc, recs, {}), /chain id/);
});

// ------------------------------------------------------------------ the published round
test('merkle shards + verify: a changed amount, row, root or shard is caught', async () => withDir(async (dir) => {
  const allocations = Array.from({ length: 700 }, (_, i) => ({ address: addr(), amount: String(1000 + i) }));
  const round = buildRound(allocations, { chainId: CHAIN });
  writeRound(dir, round);
  assert.equal(round.summary.shardPrefixLength, autoPrefix(700));
  assert.equal(verifyRound(dir).ok, true);
  const csv = readFileSync(join(dir, 'list.csv'), 'utf8');
  const lines = csv.split('\n');
  // one amount +1 (and the summary's hash "fixed" too): the root and the total no longer match
  lines[5] = lines[5].replace(/,(\d+)$/, (_, n) => `,${BigInt(n) + 1n}`);
  const forged = lines.join('\n');
  writeFileSync(join(dir, 'list.csv'), forged);
  let r = verifyRound(dir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /sha256/.test(e)));
  const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  const { createHash } = await import('node:crypto');
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ ...s, listSha256: createHash('sha256').update(forged).digest('hex') }));
  r = verifyRound(dir);
  assert.ok(r.errors.some((e) => /^root/.test(e)) && r.errors.some((e) => /^total/.test(e)), r.errors.join('; '));
  // back to the real list; then a shard entry with someone else's proof
  writeFileSync(join(dir, 'list.csv'), csv);
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(s));
  const f = readdirSync(join(dir, 'shards'))[0];
  const sh = JSON.parse(readFileSync(join(dir, 'shards', f), 'utf8'));
  const [k1, k2] = Object.keys(sh.claims);
  if (k2) { sh.claims[k1].proof = sh.claims[k2].proof; writeFileSync(join(dir, 'shards', f), JSON.stringify(sh)); assert.ok(verifyRound(dir).errors.some((e) => /proof/.test(e))); }
  assert.throws(() => buildRound([...allocations, { address: allocations[0].address.toLowerCase(), amount: '1' }]), /duplicate/);
  assert.throws(() => buildRound(allocations, { pool: 10n }), /more than the pool/);
}));

test('CLI: the owner\'s path for a synthetic 100,000-row address,score CSV (BigQuery export) to a verified round', { timeout: 600_000 }, async () => withDir(async (dir) => {
  const N = 100_000;
  const rows = Array.from({ length: N }, (_, i) => `${addr().toLowerCase()},${1 + (i * 7919) % 400}`);
  rows.push(rows[17].toUpperCase().replace('0X', '0x')); // a duplicate in other case
  rows.push('0x0000000000000000000000000000000000000001,999'); // a precompile
  const csv = join(dir, 'active.csv');
  writeFileSync(csv, `address,score\n${rows.join('\n')}\n`);
  const t0 = Date.now();
  const rec = await run(['from-csv', csv, '--weight', 'score', '--cap', '5000', '--pool', '200000000'], { log: quiet });
  const tCsv = Date.now() - t0;
  assert.equal(rec.count, N);
  assert.deepEqual(rec.droppedByReason, { duplicate: 1, 'precompile-or-reserved': 1 });
  assert.ok(BigInt(rec.total) <= Z(200_000_000));
  assert.ok(rec.allocations.every((a) => BigInt(a.amount) <= Z(5000)));
  writeFileSync(join(dir, 'rec.json'), JSON.stringify(rec));
  const eq = await run(['from-csv', csv, '--equal', '--pool', '1000000'], { log: quiet });
  assert.ok(eq.allocations.every((a) => a.amount === (Z(1_000_000) / BigInt(N)).toString()));
  const t1 = Date.now();
  const s = await run(['merkle', join(dir, 'rec.json'), '--out', join(dir, 'round'), '--chain-id', String(CHAIN), '--pool', '200000000'], { log: quiet });
  const tMerkle = Date.now() - t1;
  assert.equal(s.count, N);
  assert.equal(s.depth, 17);
  const t2 = Date.now();
  const v = await run(['verify', join(dir, 'round')], { log: quiet });
  console.log(`CLI 100k: from-csv ${tCsv} ms, merkle (+ write ${s.shards} shards) ${tMerkle} ms, verify (every shard proof) ${Date.now() - t2} ms`);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(v.root, s.root);
  // verify against a distributor via eth_call
  const fetchImpl = async (_u, init) => {
    const { params } = JSON.parse(init.body);
    const sel = params[0].data;
    const result = sel === '0x2eb4a7ab' ? s.root : `0x${BigInt(sel === '0x45f7f249' ? s.total : s.count).toString(16).padStart(64, '0')}`;
    return { json: async () => ({ result }) };
  };
  const onChain = await run(['verify', join(dir, 'round'), '--rpc', 'https://zetaphy.example', '--distributor', `0x${'d1'.repeat(20)}`], { log: quiet, fetchImpl });
  assert.equal(onChain.ok, true, onChain.errors.join('; '));
  const wrongRoot = async (u, init) => { const r = await fetchImpl(u, init); const j = await r.json(); return { json: async () => (JSON.parse(init.body).params[0].data === '0x2eb4a7ab' ? { result: `0x${'00'.repeat(32)}` } : j) }; };
  const bad = await run(['verify', join(dir, 'round'), '--rpc', 'x', '--distributor', `0x${'d1'.repeat(20)}`], { log: quiet, fetchImpl: wrongRoot });
  assert.equal(bad.ok, false);
  process.exitCode = 0; // verify sets it on failure, as the owner's shell would see
}));

test('CLI: link-message, link-solana, merge; existing stage-2 commands still work', async () => withDir(async (dir) => {
  const w = solWallet(), evm = addr();
  const m = await run(['link-message', w.owner, evm, '--chain-id', String(CHAIN)], { log: quiet });
  assert.equal(m.message, linkMessage(w.owner, evm, CHAIN));
  const snap = { holders: [{ owner: w.owner, amount: '10' }, { owner: solWallet().owner, amount: '30' }] };
  writeFileSync(join(dir, 'snap.json'), JSON.stringify(snap));
  const alloc = await run(['allocate', join(dir, 'snap.json')], { log: quiet });
  assert.equal(alloc.holders, 2);
  writeFileSync(join(dir, 'alloc.json'), JSON.stringify(alloc));
  const legacy = await run(['merkle', join(dir, 'alloc.json')], { log: quiet });
  assert.match(legacy.root, /^0x[0-9a-f]{64}$/);
  assert.ok(legacy.claims[w.owner]);
  writeFileSync(join(dir, 'links.json'), JSON.stringify([{ solana: w.owner, evm, signature: sign(w, evm, CHAIN) }]));
  const linked = await run(['link-solana', join(dir, 'alloc.json'), join(dir, 'links.json'), '--chain-id', String(CHAIN)], { log: quiet });
  assert.equal(linked.count, 1);
  assert.equal(linked.unlinked.count, 1);
  writeFileSync(join(dir, 'linked.json'), JSON.stringify(linked));
  const signups = join(dir, 'signups.csv');
  writeFileSync(signups, `address\n${evm}\n${addr()}\n`);
  const su = await run(['from-csv', signups, '--each', '100', '--pool', '1000'], { log: quiet });
  writeFileSync(join(dir, 'su.json'), JSON.stringify(su));
  const merged = await run(['merge', join(dir, 'linked.json'), join(dir, 'su.json')], { log: quiet });
  assert.equal(merged.count, 2);
  assert.equal(merged.allocations.find((a) => a.address === evm).amount, (BigInt(linked.allocations[0].amount) + Z(100)).toString());
  await assert.rejects(run(['merge', join(dir, 'linked.json'), join(dir, 'su.json'), '--pool', '1'], { log: quiet }), /more than the pool/);
  await assert.rejects(run(['from-csv', signups, '--equal', '--each', '1'], { log: quiet }), /pick one/);
  await assert.rejects(run(['merkle', join(dir, 'merged.json')], { log: quiet }));
  await assert.rejects(run(['nope'], { log: quiet }), /from-csv/);
}));

test('CLI init-code: the init code deploys a distributor holding the published root, totals, window and returnTo', async () => withDir(async (dir) => {
  const { createChain } = await import('./helpers/evm.js');
  const { Interface } = await import('ethers');
  const c = await createChain(['gov']);
  const allocations = Array.from({ length: 50 }, () => ({ address: addr(), amount: Z(3).toString() }));
  writeRound(join(dir, 'round'), buildRound(allocations, { chainId: CHAIN }));
  const start = Number(c.now()) + 3 * 86400, deadline = start + 90 * 86400;
  const fund = addr(), guard = addr();
  const out = await run(['init-code', join(dir, 'round'), '--start', new Date(start * 1000).toISOString(), '--deadline', String(deadline), '--return-to', fund.toLowerCase(), '--guardian', guard], { log: quiet });
  const r = await c.rawTx('gov', null, out.initCode);
  assert.ok(r.ok);
  const { getCreateAddress } = await import('ethers');
  const at = getCreateAddress({ from: c.acct.gov.toString(), nonce: (await c.nonce('gov')) - 1n });
  const iface = new Interface(JSON.parse(readFileSync(new URL('../artifacts/ZtphyMerkleDistributor.json', import.meta.url), 'utf8')).abi);
  const s = JSON.parse(readFileSync(join(dir, 'round', 'summary.json'), 'utf8'));
  assert.equal(await c.callAt(at, iface, 'merkleRoot'), s.root);
  assert.equal(await c.callAt(at, iface, 'totalAllocated'), Z(150));
  assert.equal(await c.callAt(at, iface, 'leafCount'), 50n);
  assert.equal(await c.callAt(at, iface, 'claimStart'), BigInt(start));
  assert.equal(await c.callAt(at, iface, 'claimDeadline'), BigInt(deadline));
  assert.equal(await c.callAt(at, iface, 'returnTo'), fund);
  assert.equal(await c.callAt(at, iface, 'guardian'), guard);
  await assert.rejects(run(['init-code', join(dir, 'round'), '--start', '100', '--deadline', '50', '--return-to', fund], { log: quiet }), /after --start/);
  await assert.rejects(run(['init-code', join(dir, 'round'), '--start', '100', '--deadline', '500'], { log: quiet }), /return-to/);
}));
