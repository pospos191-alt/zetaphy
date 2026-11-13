// Round 1 (docs/AIRDROP-ROUND1.md): links submitted as GitHub issues with .github/ISSUE_TEMPLATE/airdrop-link.yml ->
// links.json (airdrop/issues.js, `cli.js links-from-issues`), then link-solana; and `allocate --pool --cap` for the
// round's 20,000,000 ZTPHY with a 5,000 ZTPHY cap. Bodies are written the way GitHub renders an issue form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAddress, hexlify, randomBytes, encodeBase58, parseUnits } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519.js';
import { linkMessage } from '../airdrop/link.js';
import { parseIssue, issuesOf, linksFromIssues, FIELDS } from '../airdrop/issues.js';
import { run } from '../airdrop/cli.js';

const CHAIN = 3659;
const Z = (n) => parseUnits(String(n), 18);
const addr = () => getAddress(hexlify(randomBytes(20)));
const quiet = () => {};
const TMP = process.env.AIRDROP_TMP ?? tmpdir();
const withDir = async (f) => { const d = mkdtempSync(join(TMP, 'airdrop-issues-')); try { return await f(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const wallet = () => { const sk = ed25519.utils.randomSecretKey(); return { sk, owner: encodeBase58(ed25519.getPublicKey(sk)) }; };
const sign = (w, evm, chainId = CHAIN) => encodeBase58(ed25519.sign(new TextEncoder().encode(linkMessage(w.owner, evm, chainId)), w.sk));

/** An issue body as GitHub renders the form (### label, blank line, value; an unticked box; "_No response_"). */
function body({ solana, evm, chain = '3659', signature, ticked = true, crlf = false, fence = false }) {
  const v = (x) => (fence ? `\`\`\`text\n${x}\n\`\`\`` : x);
  const b = [`### ${FIELDS.solana[0]}`, '', v(solana), '', `### ${FIELDS.evm[0]}`, '', v(evm), '', `### ${FIELDS.chain[0]}`, '', chain, '',
    `### ${FIELDS.signature[0]}`, '', v(signature), '', `### ${FIELDS.safety[0]}`, '', `- [${ticked ? 'X' : ' '}] I did not share my recovery phrase or private key, and I paid nothing`].join('\n');
  return crlf ? b.replace(/\n/g, '\r\n') : b;
}
let n = 0;
const issue = (fields, extra = {}) => ({ number: ++n, html_url: `https://github.com/pospos191-alt/zetaphy/issues/${n}`, user: { login: `u${n}` },
  state: 'open', state_reason: null, created_at: '2026-11-15T00:00:00Z', body: body(fields), ...extra });

test('parseIssue: the rendered form, CRLF, code fences, stray spaces and "No response"', () => {
  const w = wallet(), e = addr(), s = sign(w, e);
  assert.deepEqual(parseIssue(body({ solana: w.owner, evm: e, signature: s })), { solana: w.owner, evm: e, chainId: '3659', signature: s, confirmed: true });
  assert.deepEqual(parseIssue(body({ solana: ` ${w.owner} `, evm: `\`${e}\``, signature: `${s.slice(0, 40)}\n${s.slice(40)}`, crlf: true })),
    { solana: w.owner, evm: e, chainId: '3659', signature: s, confirmed: true });
  assert.equal(parseIssue(body({ solana: w.owner, evm: e, signature: s, fence: true })).signature, s);
  assert.equal(parseIssue(body({ solana: w.owner, evm: e, signature: s, ticked: false })).confirmed, false);
  assert.equal(parseIssue(body({ solana: w.owner, evm: '_No response_', signature: s })).evm, '');
  assert.equal(parseIssue('Hello, when moon?'), null);
  assert.equal(parseIssue(null), null);
});

test('issuesOf: one page, gh --paginate (pages one after another), --slurp (array of arrays), a search result', () => {
  const a = { number: 1, body: 'x' }, b = { number: 2, body: 'y [brackets] {braces} "quotes\\" ]' }, c = { number: 3, body: '' };
  assert.deepEqual(issuesOf(JSON.stringify([a, b])).map((i) => i.number), [1, 2]);
  assert.deepEqual(issuesOf(`${JSON.stringify([a, b], null, 2)}\n${JSON.stringify([c])}`).map((i) => i.number), [1, 2, 3]);
  assert.deepEqual(issuesOf(JSON.stringify([[a], [b, c]])).map((i) => i.number), [1, 2, 3]);
  assert.deepEqual(issuesOf(JSON.stringify({ total_count: 1, items: [c] })).map((i) => i.number), [3]);
  assert.throws(() => issuesOf('not json'), /GitHub issues API/);
});

test('linksFromIssues: verified links kept; bad, wrong-chain, unticked, late, duplicate, conflicting and withdrawn ones reported', () => {
  n = 0;
  const [w1, w2, w3, w4, w5] = [wallet(), wallet(), wallet(), wallet(), wallet()];
  const e1 = addr(), e2 = addr(), e3a = addr(), e3b = addr(), e5a = addr(), e5b = addr();
  const issues = [
    issue({ solana: w1.owner, evm: e1, signature: sign(w1, e1) }),                         // 1 ok
    issue({ solana: w2.owner, evm: e2.toLowerCase(), signature: sign(w2, e2) }),           // 2 ok (lower case is fine)
    issue({ solana: w1.owner, evm: e1, signature: sign(w1, e1) }),                         // 3 duplicate of 1
    issue({ solana: w3.owner, evm: e3a, signature: sign(w3, e3a) }),                       // 4 conflict
    issue({ solana: w3.owner, evm: e3b, signature: sign(w3, e3b) }),                       // 5 conflict
    issue({ solana: w4.owner, evm: e1, signature: sign(w1, e1) }),                         // 6 someone else's signature
    issue({ solana: w4.owner, evm: e1, signature: sign(w4, e1, 77390) }),                  // 7 testnet signature
    issue({ solana: w4.owner, evm: e1, chain: '77390', signature: sign(w4, e1, 77390) }),  // 8 wrong chain id field
    issue({ solana: w4.owner, evm: e1, signature: sign(w4, e1), ticked: false }),          // 9 box not ticked
    issue({ solana: w4.owner, evm: e1, signature: sign(w4, e1) }, { created_at: '2026-12-04T14:00:01Z' }), // 10 after the deadline
    issue({ solana: w5.owner, evm: e5a, signature: sign(w5, e5a) }, { state: 'closed', state_reason: 'not_planned' }), // 11 withdrawn
    issue({ solana: w5.owner, evm: e5b, signature: sign(w5, e5b) }, { state: 'closed', state_reason: 'completed' }),   // 12 ok (processed)
    issue({ solana: 'not-base58!', evm: e1, signature: 'x' }),                              // 13 bad address
    issue({ solana: w4.owner, evm: '0x0000000000000000000000000000000000000000', signature: sign(w4, e1) }), // 14 zero address
    { number: 15, body: 'feature request', user: { login: 'x' } },                          // 15 not the form
    { number: 16, body: body({ solana: w4.owner, evm: e1, signature: sign(w4, e1) }), pull_request: {} }, // 16 a PR: ignored
  ];
  const r = linksFromIssues([...issues, issues[0]], { chainId: CHAIN, deadline: Date.parse('2026-12-04T14:00:00Z') });
  assert.deepEqual(r.links.map((l) => [l.issue, l.solana, l.evm]), [[1, w1.owner, e1], [2, w2.owner, e2], [12, w5.owner, e5b]]);
  assert.deepEqual(r.links[0].alsoIn, [3]);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.conflicts.map((c) => [c.solana, c.issues]), [[w3.owner, [4, 5]]]);
  assert.deepEqual(Object.fromEntries(r.rejected.map((x) => [x.issue, x.reason])), {
    6: 'bad-signature', 7: 'bad-signature', 8: 'wrong-chain-id', 9: 'safety-box-not-ticked', 10: 'after-deadline',
    13: 'bad-solana-address', 14: 'bad-evm-address:zero-address' });
  assert.deepEqual(r.skipped.map((s) => [s.issue, s.reason]), [[11, 'closed-not-planned'], [15, 'not-the-link-form']]);
  assert.equal(r.count, 3);
  assert.equal(r.chainId, 3659);
});

test('CLI: links-from-issues -> link-solana; allocate --pool 20000000 --cap 5000 for round 1', async () => withDir(async (dir) => {
  n = 100;
  const holders = Array.from({ length: 6 }, wallet);
  // SWD has 5 decimals: one whale, four normal holders, one dust holder (below --min 1000000 = 10 SWD)
  const amounts = [10n ** 15n, 4n * 10n ** 9n, 3n * 10n ** 9n, 2n * 10n ** 9n, 10n ** 9n, 999_999n];
  writeFileSync(join(dir, 'snap.json'), JSON.stringify({ mint: 'Cmh2tu6bt5z2a8NKsx6G5WfVmaeQ9f2fcX5VnQbVaGLL', holders: holders.map((h, i) => ({ owner: h.owner, amount: String(amounts[i]) })) }));
  const alloc = await run(['allocate', join(dir, 'snap.json'), '--min', '1000000', '--pool', '20000000', '--cap', '5000'], { log: quiet });
  assert.equal(alloc.pool, Z(20_000_000).toString());
  assert.equal(alloc.holders, 5);
  for (const a of alloc.allocations) assert.equal(a.zetaphy, Z(5000).toString()); // the pool is far larger than 5 x 5,000: everyone capped
  writeFileSync(join(dir, 'alloc.json'), JSON.stringify(alloc));
  const evms = holders.map(() => addr());
  const iss = holders.slice(0, 3).map((h, i) => issue({ solana: h.owner, evm: evms[i], signature: sign(h, evms[i]) }));
  iss.push(issue({ solana: holders[5].owner, evm: evms[5], signature: sign(holders[5], evms[5]) })); // dust holder: not in the allocation
  writeFileSync(join(dir, 'issues.json'), `${JSON.stringify(iss.slice(0, 2))}\n${JSON.stringify(iss.slice(2))}`); // gh --paginate output
  const logs = [];
  const links = await run(['links-from-issues', join(dir, 'issues.json'), '--deadline', '2026-12-04T14:00:00Z'], { log: (s) => logs.push(s) });
  assert.equal(links.count, 4);
  assert.match(logs[0], /^links-from-issues: 4 links from 4 issues; 0 rejected/);
  writeFileSync(join(dir, 'links.json'), JSON.stringify(links));
  const linked = await run(['link-solana', join(dir, 'alloc.json'), join(dir, 'links.json'), '--chain-id', String(CHAIN)], { log: quiet });
  assert.deepEqual(linked.allocations.map((a) => a.address).sort(), evms.slice(0, 3).sort());
  assert.equal(linked.total, Z(15_000).toString());
  assert.deepEqual(linked.rejected.map((x) => x.reason), ['not-in-snapshot']);
  assert.equal(linked.unlinked.count, 2);
  await assert.rejects(run(['links-from-issues', join(dir, 'issues.json'), '--deadline', 'soon'], { log: quiet }), /--deadline/);
  await assert.rejects(run(['links-from-issues'], { log: quiet }), /links-from-issues <issues.json>/);
  const usage = await run(['nope'], { log: quiet }).catch((e) => e);
  assert.match(usage.message, /links-from-issues/);
  assert.match(usage.message, /prints the distributor's init code/);
  // unchanged default: no --pool / --cap is the old behaviour (200,000,000 pool, cap-bps)
  const old = await run(['allocate', join(dir, 'snap.json')], { log: quiet });
  assert.equal(old.pool, Z(200_000_000).toString());
  assert.ok(JSON.parse(readFileSync(join(dir, 'links.json'), 'utf8')).links.every((l) => l.chainId === 3659));
}));
