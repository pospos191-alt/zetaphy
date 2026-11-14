// The browser proof-of-work faucet: the hash and the search match what the node checks
// (evmd/zetaphy_faucetpow.go: sha256(chainId u64be || blockHash || address || nonce u64be), leading zero bits),
// and the Earn faucet form's request helper tells "node paused" from the node's own refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256, zeroBits, powPrefix, powMessage, powOk, search, nonceHex, expectedTries } from '../mine-core.js';
import { mineAddress, chanceBy, clock, rate, claimVerdict, unreachable } from '../mine.js';
import { askFaucet, earnText } from '../pages.js';
import { mineText } from '../mine.js';
import { faucetInfo, faucetState, faucetLine, readFaucet } from '../faucet-core.js';
import { FAUCET } from '../faucet-i18n.js';
import { EARN, MINE } from '../pages-i18n.js';
import { LANG_CODES } from '../i18n.js';
import { NETWORKS } from '../network.js';
import { formatZeta } from '../chainlib.js';

test('sha256 is SHA-256 (every padding case)', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 68, 119, 120, 128, 300]) {
    const b = randomBytes(n);
    assert.equal(Buffer.from(sha256(b)).toString('hex'), createHash('sha256').update(b).digest('hex'), `${n} bytes`);
  }
});

test('the proof message: chainId (8, big-endian) || block hash || address || nonce (8, big-endian)', () => {
  const p = powPrefix(77390, `0x${'ab'.repeat(32)}`, '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245');
  const m = powMessage(p, 0x01020304, 0x05060708);
  assert.equal(Buffer.from(m).toString('hex'),
    `0000000000012e4e${'ab'.repeat(32)}6af57fc3633dd0f7907f7900dbd4a2822f43a2450102030405060708`);
  assert.equal(nonceHex(0x01020304, 0x05060708), '0x0102030405060708');
  assert.equal(nonceHex(0, 1), '0x0000000000000001');
  assert.throws(() => powPrefix(77390, '0x12', '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245'));
});

test('search finds the first nonce with enough zero bits, the same one node:crypto agrees on', () => {
  const p = powPrefix(77390, `0x${'5c'.repeat(32)}`, `0x${'12'.repeat(20)}`);
  for (const bits of [1, 8, 14]) {
    const lo = search(p, 7, bits, 0, 1 << 24);
    assert.ok(lo >= 0);
    const h = createHash('sha256').update(powMessage(p, 7, lo)).digest();
    assert.ok(zeroBits(h) >= bits, `${bits} bits`);
    assert.ok(powOk(p, 7, lo, bits));
    for (let i = 0; i < lo; i++) assert.ok(!powOk(p, 7, i, bits), `missed ${i}`);
  }
  // more than 32 bits: the second word counts too (no proof in a short range)
  assert.equal(search(p, 7, 40, 0, 1000), -1);
  assert.equal(zeroBits(new Uint8Array([0, 0, 0, 0, 0x10])), 35);
  assert.equal(zeroBits(new Uint8Array(32)), 256);
  assert.equal(expectedTries(30), 2 ** 30);
});

test('page helpers: address forms, chance, times', () => {
  assert.equal(mineAddress(' 0x6af57fC3633dD0F7907f7900dbd4A2822F43a245 '), '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245');
  assert.equal(mineAddress('zetaphy1dt6hlsmr8hg00yrl0yqdh49zsgh58gj9jh7u0d'), '0x6af57fc3633dd0f7907f7900dbd4a2822f43a245');
  for (const bad of ['', '0x12', 'cosmos1dt6hlsmr8nwlmepl0yqdhfp22qhn6gj9x3j6zk', null]) assert.equal(mineAddress(bad), null);
  assert.equal(chanceBy(0, 20), 0);
  assert.ok(Math.abs(chanceBy(2 ** 20, 20) - (1 - Math.exp(-1))) < 1e-12);
  assert.equal(clock(65), '1:05');
  assert.equal(clock(3725), '1:02:05');
  assert.equal(clock(NaN), '–');
  assert.equal(rate(2.38e6), '2.38 MH/s');
  assert.equal(rate(110_000), '110 kH/s');
});

test('askFaucet: the tx hash; the node\'s own reason; "down" when the node cannot be reached', async () => {
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
  assert.deepEqual(await askFaucet('https://n', '0x1', reply(200, { result: { txHash: `0x${'ab'.repeat(32)}` } })), { txHash: `0x${'ab'.repeat(32)}` });
  await assert.rejects(askFaucet('https://n', '0x1', reply(200, { error: { message: 'this address already has ZETAPHY' } })), (e) => !e.down && /already has/.test(e.message));
  // rpc-guard answers 429 with a JSON-RPC error: the reason is shown, not "HTTP 429"
  await assert.rejects(askFaucet('https://n', '0x1', reply(429, { error: { message: 'at most 3 grants a day' } })), (e) => !e.down && /3 grants/.test(e.message));
  await assert.rejects(askFaucet('https://n', '0x1', reply(502, '<html>')), (e) => e.down);
  await assert.rejects(askFaucet('https://n', '0x1', async () => { throw new TypeError('Failed to fetch'); }), (e) => e.down);
});

test('a failed claim: stop only when mining on cannot help, otherwise mine on or ask again', () => {
  // the node's own reasons (zetaphy-chain/setup-node.sh: faucetGrant, FaucetPow)
  assert.equal(claimVerdict('this address got ZETAPHY less than a day ago'), 'cooldown');
  assert.equal(claimVerdict('this address already has ZETAPHY'), 'hasCoins');
  assert.equal(claimVerdict("the faucet has given out today's 200 grants; try again tomorrow (UTC)"), 'noneLeft');
  assert.equal(claimVerdict('the faucet is off on this node'), 'final');
  assert.equal(claimVerdict('the faucet answers only through this node\'s https address'), 'final');
  assert.equal(claimVerdict("the proof's block 5 is too old: use one of the last 100 blocks (latest 200)"), 'again');
  assert.equal(claimVerdict('this proof was used already; mine a new one'), 'again');
  assert.equal(claimVerdict('block 9 is not there yet (latest 8)'), 'again');
  assert.equal(claimVerdict('the proof has 3 leading zero bits; 28 are needed'), 'again');
  // no answer from the node: the same proof again
  for (const m of ['HTTP 502', 'Failed to fetch', 'NetworkError when attempting to fetch resource.', 'signal is aborted without reason', 'Load failed', 'request timed out']) {
    assert.equal(claimVerdict(m), 'unreachable', m);
    assert.ok(unreachable(m));
  }
  assert.equal(unreachable('this address already has ZETAPHY'), false);
});

// ------------------------------------------------------------------ the faucet's live state (faucet-core.js)
const E = (x) => `0x${(BigInt(Math.round(x * 1000)) * 10n ** 15n).toString(16)}`; // ZTPHY -> hex wei, as the node sends it
// zetaphy_faucetPowInfo on mainnet's sentry (setup-node.sh MAINNET_FAUCET=1: 1 / 5 / 200 by default)
const MAIN = { bits: 22, chainId: 3659, enabled: true, reward: E(5), faucetReward: E(1), dayBudget: E(200), remainingBudget: E(194), remainingToday: 38, perDay: 200, address: `0x${'ab'.repeat(20)}` };
const fmt = (w) => formatZeta(w, 4);

test('faucet state from zetaphy_faucetPowInfo: on, off (enabled false), budget used up, unknown', async () => {
  const on = faucetInfo(MAIN);
  assert.deepEqual([on.enabled, on.grant, on.pow, on.budget, on.left, on.remainingToday], [true, 10n ** 18n, 5n * 10n ** 18n, 200n * 10n ** 18n, 194n * 10n ** 18n, 38]);
  assert.equal(faucetState(on), 'on');
  assert.equal(faucetState(on, 'pow'), 'on');
  assert.equal(faucetState(faucetInfo({ ...MAIN, enabled: false })), 'off');
  assert.equal(faucetState(faucetInfo({ ...MAIN, enabled: false, problem: 'faucet-amount: not a number' }), 'pow'), 'off');
  assert.equal(faucetState(faucetInfo({ ...MAIN, remainingBudget: '0x0', remainingToday: 0 })), 'spent');
  assert.equal(faucetState(faucetInfo({ ...MAIN, remainingBudget: '0x0', remainingToday: 0 }), 'pow'), 'spent');
  // 3 ZTPHY left: a 1 ZTPHY grant still fits, a 5 ZTPHY proof does not
  const low = faucetInfo({ ...MAIN, remainingBudget: E(3), remainingToday: 0 });
  assert.deepEqual([faucetState(low), faucetState(low, 'pow')], ['on', 'spent']);
  // the testnet's node: no budget, the grant count only
  const t = faucetInfo({ bits: 22, chainId: 77390, enabled: true, reward: E(10), remainingToday: 0, perDay: 200 });
  assert.deepEqual([t.grant, t.budget, t.left, faucetState(t), faucetState(t, 'pow')], [null, null, null, 'on', 'spent']);
  assert.equal(faucetState(null), 'unknown');
  assert.equal(faucetInfo('nope'), null);
  assert.equal(faucetInfo({ ...MAIN, remainingBudget: 'zz' }).left, null, 'malformed numbers are dropped');
  // readFaucet: one call, null when the node does not answer
  const calls = [];
  assert.equal((await readFaucet(async (m, p) => { calls.push([m, p]); return MAIN; })).pow, 5n * 10n ** 18n);
  assert.deepEqual(calls, [['zetaphy_faucetPowInfo', []]]);
  assert.equal(await readFaucet(async () => { throw new Error('HTTP 502'); }), null);
});

test('the faucet line shows the node\'s amounts (never hard-coded) and says plainly when it is off or used up, in 8 languages', () => {
  assert.deepEqual(Object.keys(FAUCET).sort(), [...LANG_CODES].sort());
  for (const l of LANG_CODES) {
    assert.deepEqual(Object.keys(FAUCET[l]).sort(), Object.keys(FAUCET.en).sort(), `${l}: every key`);
    for (const [k, v] of Object.entries(FAUCET[l])) assert.ok(typeof v === 'string' && v.trim(), `${l}.${k}`);
    if (l !== 'en') for (const k of ['amounts', 'off', 'spent', 'mineWhat']) assert.notEqual(FAUCET[l][k], FAUCET.en[k], `${l}.${k}: translated`);
    for (const k of ['amounts', 'budget', 'sent', 'hasCoins']) for (const p of FAUCET.en[k].match(/\{\w+\}/g)) assert.ok(FAUCET[l][k].includes(p), `${l}.${k}: ${p}`);
    for (const k of Object.keys(FAUCET.en)) assert.doesNotMatch(FAUCET[l][k], /\b10 (ZTPHY|ZETAPHY)\b|\b200 grants\b/, `${l}.${k}: no fixed amount`);
    const on = faucetLine(faucetInfo(MAIN), l, fmt);
    assert.equal(on.state, 'on');
    for (const n of ['1', '5', '194', '200']) assert.ok(on.text.includes(n), `${l}: ${n} in ${on.text}`);
    assert.equal(faucetLine(faucetInfo({ ...MAIN, enabled: false }), l, fmt).text, FAUCET[l].off);
    assert.equal(faucetLine(faucetInfo({ ...MAIN, remainingBudget: '0x0' }), l, fmt).text, FAUCET[l].spent);
    assert.equal(faucetLine(null, l, fmt).text, FAUCET[l].unknown);
  }
  // other amounts the owner may set (decimal ZTPHY, read on every call): shown as the node gives them
  const half = faucetLine(faucetInfo({ ...MAIN, faucetReward: E(0.5), reward: E(2.5), dayBudget: E(10.5), remainingBudget: E(10.5) }), 'en', fmt).text;
  assert.equal(half, 'Faucet now: 0.5 ZTPHY per address a day; 2.5 ZTPHY per browser-mining proof. 10.5 of 10.5 ZTPHY left today (UTC).');
  assert.equal(faucetLine(faucetInfo({ enabled: true, reward: E(10) }), 'en', fmt).text, 'Faucet now: 10 ZTPHY per address a day; 10 ZTPHY per browser-mining proof.', 'no budget: no budget line');
});

test('Earn and Mine on mainnet: the faucet\'s own words (real ZTPHY for fees, a daily budget); the testnet keeps its words', () => {
  for (const l of LANG_CODES) {
    const main = earnText({ lang: l, net: NETWORKS.mainnet });
    const test = earnText({ lang: l, net: NETWORKS.testnet });
    const f = main.m.find((x) => x.id === 'faucet'), m = main.m.find((x) => x.id === 'mine');
    assert.deepEqual([f.getS, f.get, f.steps[2][0], m.getS, m.get, m.steps[1][0], m.steps[2][0], main.warn, main.noPow, main.fOk],
      [FAUCET[l].faucetGetS, FAUCET[l].faucetGet, FAUCET[l].faucetLimit, FAUCET[l].mineGetS, FAUCET[l].mineGet, FAUCET[l].mineStep2, FAUCET[l].mineStep3, FAUCET[l].earnWarn, FAUCET[l].earnNoPow, FAUCET[l].sentAny], l);
    assert.equal(f.steps.length, EARN.en.m.faucet.steps.length);
    assert.equal(f.steps[1][1], test.m.find((x) => x.id === 'faucet').steps[1][1], 'the same terminal command');
    assert.equal(test.warn, EARN[l].warn);
    assert.equal(test.m.find((x) => x.id === 'faucet').getS, EARN[l].m.faucet.getS);
    const mm = mineText({ lang: l, net: NETWORKS.mainnet });
    assert.deepEqual([mm.title, mm.what, mm.notMining, mm.mainnet], [FAUCET[l].mineTitle, FAUCET[l].mineWhat, FAUCET[l].mineNotMining, true]);
    assert.match(mm.notMining, /ZETAPHY/, `${l}: says it is not mining`);
    assert.equal(mineText({ lang: l, net: NETWORKS.testnet }).what, MINE[l].what);
  }
});
