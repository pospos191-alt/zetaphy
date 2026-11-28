// scripts/build-reports.js: the public static token reports (/reports/). Pure parts only: GeckoTerminal parsing,
// what may be published, the store, the pages (escaping, languages, links) and the directory check cf-pages.yml runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  geckoTokens, publishable, slim, mergeStore, reportPage, indexPage, badgeSvg, sitemap, renderAll, checkDir, clean, esc,
  pagePath, LANG_ORDER, TEXT, GECKO, candidates, atomFeed, summaryJson,
} from '../scripts/build-reports.js';
import { LANGS } from '../src/explain.js';

const A = '0x' + 'ab'.repeat(20), B = '0x' + 'cd'.repeat(20);
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const finding = (id, severity, params) => ({ id, severity, ...(params ? { params } : {}) });
const rep = (over = {}) => ({
  chain: 'bsc', address: A.toUpperCase().replace('0X', '0x'), token: { name: 'Good Token', symbol: 'GOOD' }, reportHash: '0x' + '11'.repeat(32),
  analysis: { level: 'high', findings: [finding('erc20', 'info', { name: 'Good Token', symbol: 'GOOD', totalSupply: 10n ** 24n, decimals: 18 }), finding('owner-active', 'medium', { owner: B }), finding('can-mint', 'high', { functions: ['mint(address,uint256)'] })] },
  ...over,
});
const entry = (over = {}) => ({ ...slim(rep(), '2026-11-28T00:00:00.000Z'), firstSeen: '2026-11-27T00:00:00.000Z', listedAt: '2026-11-28T00:00:00.000Z', ...over });

test('geckoTokens: the side of each pool that is not a known coin, addresses lowercased, other networks ignored', () => {
  const json = {
    data: [
      { attributes: { address: '0xPOOL1', reserve_in_usd: '1234.5' }, relationships: { base_token: { data: { id: `bsc_${A}` } }, quote_token: { data: { id: `bsc_${WBNB}` } } } },
      // the new token is the quote side: still found
      { attributes: { address: '0xpool2' }, relationships: { base_token: { data: { id: `bsc_${WBNB}` } }, quote_token: { data: { id: `bsc_${B}` } } } },
      // both known: nothing
      { attributes: {}, relationships: { base_token: { data: { id: `bsc_${WBNB}` } }, quote_token: { data: { id: `bsc_${WBNB}` } } } },
      // another network's id or junk: nothing
      { attributes: {}, relationships: { base_token: { data: { id: `eth_${A}` } } } },
      { relationships: { base_token: { data: { id: 'bsc_notanaddress' } } } },
    ],
    included: [{ id: `bsc_${A}`, type: 'token', attributes: { name: 'Alpha', symbol: 'ALP' } }],
  };
  const got = geckoTokens(json, 'bsc');
  assert.deepEqual(got.map((t) => t.address), [A, B]);
  assert.equal(got[0].symbol, 'ALP');
  assert.equal(got[0].liquidityUsd, 1234.5);
  assert.deepEqual(geckoTokens(json, 'sol'), [], 'only the EVM chains of GECKO');
  assert.deepEqual(geckoTokens(null, 'bsc'), []);
  assert.deepEqual(Object.keys(GECKO), ['eth', 'bsc', 'base', 'arbitrum']);
});

test('publishable: never a token whose name advertises a link, nor a non-token or empty address', () => {
  assert.equal(publishable(rep()), true);
  assert.equal(publishable(rep({ token: { name: 'Visit claim-now.com', symbol: 'X' } })), false);
  assert.equal(publishable(rep({ token: { name: 'Free AIRDROP', symbol: 'FREE' } })), false);
  assert.equal(publishable(rep({ token: { name: 'T', symbol: 't.me/x' } })), false);
  assert.equal(publishable(rep({ analysis: { level: 'high', findings: [finding('name-has-link', 'high')] } })), false);
  assert.equal(publishable(rep({ analysis: { level: 'info', findings: [finding('not-erc20', 'info')] } })), false);
  assert.equal(publishable(rep({ token: { name: 'NoSymbol' } })), false);
});

test('slim: keeps what the page needs, plain JSON (no BigInt), lowercase address, clean names', () => {
  const s = slim(rep({ token: { name: 'A‮B\u0000C', symbol: 'GOOD' } }), '2026-11-28T00:00:00.000Z');
  assert.equal(s.address, A);
  assert.equal(s.token.name, 'ABC', 'bidi override and NUL removed');
  assert.equal(s.analysis.findings[0].params.totalSupply, (10n ** 24n).toString());
  assert.doesNotThrow(() => JSON.stringify(s));
  assert.equal(clean('x'.repeat(50), 10).length, 10);
});

test('mergeStore: one entry per token (the newest check), earliest firstSeen, capped by the most recently listed', () => {
  const old = { entries: [entry({ checkedAt: '2026-11-01T00:00:00Z', firstSeen: '2026-11-01T00:00:00Z', listedAt: '2026-11-01T00:00:00Z' }), entry({ address: B, listedAt: '2026-11-02T00:00:00Z' })] };
  const fresh = [entry({ checkedAt: '2026-11-28T00:00:00Z', firstSeen: '2026-11-28T00:00:00Z', listedAt: '2026-11-28T00:00:00Z' })];
  const m = mergeStore(old, fresh);
  assert.equal(m.entries.length, 2);
  assert.equal(m.entries[0].address, A);
  assert.equal(m.entries[0].checkedAt, '2026-11-28T00:00:00Z');
  assert.equal(m.entries[0].firstSeen, '2026-11-01T00:00:00Z');
  assert.deepEqual(mergeStore(old, fresh, { cap: 1 }).entries.map((e) => e.address), [A]);
});

test('reportPage: every language, its own canonical and the 9 alternates, findings in that language, contract text escaped', () => {
  const e = entry({ token: { name: '<script>alert(1)</script>', symbol: 'G"O' } });
  for (const l of LANG_ORDER) {
    const html = reportPage(e, l);
    assert.match(html, new RegExp(`<html lang="${l}">`));
    assert.ok(html.includes(`<link rel="canonical" href="https://neuro.sawasdeecoin.com${pagePath('bsc', A, l)}">`));
    assert.equal((html.match(/rel="alternate" hreflang=/g) ?? []).length, LANG_ORDER.length + 1);
    assert.ok(html.includes(LANGS[l].LEVEL.high), `${l}: the level in its language`);
    assert.ok(!html.includes('<script>alert'), 'never raw contract text');
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes(`/web/?chain=bsc&address=${A}`), 'the live check');
    assert.ok(html.includes('/web/legal.html'), 'how to respond or ask for a correction');
    assert.match(html, /<a href="https:\/\/app\.sawasdeecoin\.com\/about\/[a-z]{0,2}(\.html)?">/, 'what ZETAPHY is');
    assert.ok(/<script type="application\/ld\+json">[^<]*<\/script>/.test(html), 'JSON-LD with no raw "<"');
    assert.ok(!/<script(?! type="application\/ld\+json")/.test(html), 'no executable script (CSP script-src self)');
    assert.ok(!/ style=/.test(html), 'no inline style (CSP style-src self)');
  }
  assert.ok(reportPage(e, 'th').includes(TEXT.th.findings));
});

test('indexPage, badge and sitemap', () => {
  const es = [entry(), entry({ chain: 'base', address: B, analysis: { level: 'low', findings: [] } })];
  const html = indexPage(es, 'en');
  assert.ok(html.includes(pagePath('bsc', A)) && html.includes(pagePath('base', B)));
  assert.ok(indexPage(es, 'ja', 'bsc').includes(TEXT.ja.onChain('BNB Chain')));
  const svg = badgeSvg(es[0]);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.ok(!/<script|onload|href=/i.test(svg));
  assert.ok(svg.includes('High risk'));
  const xml = sitemap(es);
  assert.equal((xml.match(/<url>/g) ?? []).length, LANG_ORDER.length * (1 + 2 + 2));
  assert.ok(xml.includes('<lastmod>2026-11-28</lastmod>'));
});

test('renderAll + checkDir: the files it writes pass; anything else is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reports-'));
  try {
    const files = renderAll({ entries: [entry(), entry({ chain: 'nope', address: B })] });
    assert.ok(!Object.keys(files).some((p) => p.includes('/nope/')), 'unknown chains dropped');
    for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c); }
    assert.equal(checkDir(dir), Object.keys(files).length);
    for (const bad of ['reports/evil.js', 'reports/bsc/0xabc/index.html', 'reports/zz/index.html', 'reports/bsc/x.html']) {
      const p = join(dir, bad);
      mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, 'x');
      assert.throws(() => checkDir(dir), /unexpected file|unknown chain/, bad);
      rmSync(p);
    }
    assert.throws(() => checkDir(dir, { maxFiles: 3 }), /more than 3/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('candidates: every chain, trending then new, de-duplicated, one failing call does not stop the rest', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/arbitrum/new_pools')) return { ok: false, status: 404 };
    const net = /networks\/(\w+)\//.exec(url)[1];
    return { ok: true, json: async () => ({ data: [{ attributes: {}, relationships: { base_token: { data: { id: `${net}_${A}` } } } }] }) };
  };
  const got = await candidates({ fetchImpl, pause: 0 });
  assert.equal(calls.length, 8);
  assert.ok(calls.every((u) => u.startsWith('https://api.geckoterminal.com/api/v2/networks/') && u.includes('include=base_token,quote_token')));
  assert.deepEqual(got.map((t) => t.chain), ['eth', 'bsc', 'base', 'arbitrum']);
  assert.equal(esc('<"&'), '&lt;&quot;&amp;');
});

test('the checker links to the reports in every language with the same words (web/app.js keeps its own copy: src/ is the skill)', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const m = /const REPORTS_LABEL = (\{[^\n]*\});/.exec(app);
  assert.ok(m, 'REPORTS_LABEL in web/app.js');
  const labels = Function(`return ${m[1]}`)();
  assert.deepEqual(Object.keys(labels).sort(), [...LANG_ORDER].sort());
  for (const l of LANG_ORDER) assert.equal(labels[l], TEXT[l].latest, l);
  assert.match(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), /<a id="reports-link" href="https:\/\/neuro\.sawasdeecoin\.com\/reports\/">/);
});

test('atomFeed: the latest checks, newest first, escaped, each linking its page; the indexes announce it', () => {
  const es = [entry({ checkedAt: '2026-11-01T00:00:00.000Z' }), entry({ address: B, token: { name: 'x', symbol: '<b>&' }, checkedAt: '2026-11-28T00:00:00.000Z' })];
  const xml = atomFeed(es);
  assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.equal((xml.match(/<entry>/g) ?? []).length, 2);
  assert.ok(xml.indexOf(B) < xml.indexOf(A), 'newest first');
  assert.ok(xml.includes('&lt;b&gt;&amp;') && !xml.includes('<b>&'), 'contract text escaped');
  assert.ok(xml.includes(`<link href="https://neuro.sawasdeecoin.com${pagePath('bsc', A)}"/>`));
  assert.ok(xml.includes('<updated>2026-11-28T00:00:00.000Z</updated>'));
  assert.equal((atomFeed(es, { max: 1 }).match(/<entry>/g) ?? []).length, 1);
  assert.ok(indexPage(es, 'en').includes('type="application/atom+xml"'));
  assert.ok(renderAll({ entries: es })['reports/feed.xml'].startsWith('<?xml'));
});

test('summaryJson: the result as plain data for tools (level, date, links, English and Thai lines), no HTML', () => {
  const j = JSON.parse(summaryJson(entry({ token: { name: '<i>', symbol: 'GOOD' } })));
  assert.equal(j.level, 'high');
  assert.equal(j.address, A);
  assert.equal(j.page, `https://neuro.sawasdeecoin.com${pagePath('bsc', A)}`);
  assert.equal(j.live, `https://neuro.sawasdeecoin.com/web/?chain=bsc&address=${A}`);
  assert.equal(j.en.title, LANGS.en.LEVEL.high);
  assert.equal(j.th.title, LANGS.th.LEVEL.high);
  assert.ok(j.en.lines.length > 0 && j.en.lines.every((l) => l.severity !== 'info'));
  assert.ok(renderAll({ entries: [entry()] })[`reports/bsc/${A}/summary.json`]);
});
