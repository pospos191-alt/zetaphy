// Neuro Guard: URL detection, pool -> token, summary.json validation, the service worker's answers (in a VM with a
// fake chrome and fetch), and the content script's card (in a VM with a tiny DOM). node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const NG = require("../src/detect.js");
const root = new URL("..", import.meta.url).pathname;
const A = "0x" + "ab".repeat(20), P = "0x" + "cd".repeat(20);
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

test("detect: explorers, DEX Screener, GeckoTerminal, PancakeSwap, Uniswap; anything else is null", () => {
  const T = (chain, address = A) => ({ chain, address, kind: "token" });
  const Pl = (chain, address = P) => ({ chain, address, kind: "pool" });
  assert.deepEqual(NG.detect(`https://bscscan.com/token/${A.toUpperCase().replace("0X", "0x")}`), T("bsc"));
  assert.deepEqual(NG.detect(`https://basescan.org/token/${A}#balances`), T("base"));
  assert.deepEqual(NG.detect(`https://etherscan.io/token/${A}`), T("eth"));
  assert.deepEqual(NG.detect(`https://arbiscan.io/token/${A}`), T("arbitrum"));
  assert.equal(NG.detect(`https://bscscan.com/address/${A}`), null, "an address page is not a token page");
  assert.deepEqual(NG.detect(`https://dexscreener.com/bsc/${P}`), Pl("bsc"));
  assert.deepEqual(NG.detect(`https://dexscreener.com/ethereum/${P}`), Pl("eth"));
  assert.equal(NG.detect("https://dexscreener.com/solana/abc"), null, "only the four EVM chains");
  assert.deepEqual(NG.detect(`https://www.geckoterminal.com/base/pools/${P}`), Pl("base"));
  assert.deepEqual(NG.detect(`https://www.geckoterminal.com/arbitrum/tokens/${A}`), T("arbitrum"));
  assert.deepEqual(NG.detect(`https://pancakeswap.finance/swap?outputCurrency=${A}`), T("bsc"));
  assert.deepEqual(NG.detect(`https://pancakeswap.finance/swap?chain=base&inputCurrency=BNB&outputCurrency=${A}`), T("base"));
  assert.deepEqual(NG.detect(`https://pancakeswap.finance/swap?inputCurrency=${A}&outputCurrency=BNB`), T("bsc"));
  assert.deepEqual(NG.detect(`https://app.uniswap.org/swap?chain=base&outputCurrency=${A}`), T("base"));
  assert.deepEqual(NG.detect(`https://app.uniswap.org/explore/tokens/arbitrum/${A}`), T("arbitrum"));
  assert.deepEqual(NG.detect(`https://app.uniswap.org/swap?outputCurrency=${A}`), T("eth"));
  for (const u of ["http://bscscan.com/token/" + A, "https://evil.com/token/" + A, "https://bscscan.com/token/0x12", "not a url", `https://bscscan.com.evil.io/token/${A}`]) assert.equal(NG.detect(u), null, u);
});

test("tokenOfPool: the non-quote side from DEX Screener or GeckoTerminal answers", () => {
  assert.deepEqual(NG.tokenOfPool("bsc", { pairs: [{ baseToken: { address: A }, quoteToken: { address: WBNB } }] }), { chain: "bsc", address: A, kind: "token" });
  assert.deepEqual(NG.tokenOfPool("bsc", { pairs: [{ baseToken: { address: WBNB }, quoteToken: { address: A } }] }), { chain: "bsc", address: A, kind: "token" });
  assert.deepEqual(NG.tokenOfPool("base", { data: { relationships: { base_token: { data: { id: `base_${A}` } }, quote_token: { data: { id: "base_0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" } } } } }), { chain: "base", address: A, kind: "token" });
  assert.equal(NG.tokenOfPool("bsc", { pairs: [{ baseToken: { address: WBNB }, quoteToken: { address: WBNB } }] }), null);
  assert.equal(NG.tokenOfPool("bsc", null), null);
  const q = NG.poolLookup({ chain: "eth", address: P, kind: "pool" });
  assert.equal(q.dexscreener, `https://api.dexscreener.com/latest/dex/pairs/ethereum/${P}`);
  assert.equal(q.gecko, `https://api.geckoterminal.com/api/v2/networks/eth/pools/${P}`);
});

const summary = (over = {}) => ({ version: 1, chain: "bsc", address: A, symbol: "GOOD", name: "Good", level: "high", checkedAt: "2026-11-28T05:00:00.000Z",
  en: { title: "High risk", lines: [{ severity: "high", text: "Can mint" }] }, th: { title: "เสี่ยงสูง", lines: [{ severity: "high", text: "สร้างเหรียญเพิ่มได้" }] }, ...over });

test("cleanSummary: only the token asked for, a known level, bounded text; links are rebuilt, never taken from the file", () => {
  const t = { chain: "bsc", address: A, kind: "token" };
  const s = NG.cleanSummary(t, summary({ page: "https://evil.example/", live: "javascript:alert(1)" }));
  assert.equal(s.level, "high");
  assert.equal(s.checkedAt, "2026-11-28");
  assert.equal(s.page, `https://neuro.sawasdeecoin.com/reports/bsc/${A}/`);
  assert.equal(s.live, `https://neuro.sawasdeecoin.com/web/?chain=bsc&address=${A}`);
  assert.equal(NG.cleanSummary(t, summary({ address: P })), null);
  assert.equal(NG.cleanSummary(t, summary({ chain: "eth" })), null);
  assert.equal(NG.cleanSummary(t, summary({ level: "pwned" })), null);
  assert.equal(NG.cleanSummary(t, summary({ version: 2 })), null);
  assert.equal(NG.cleanSummary(t, summary({ en: { title: "x", lines: [{ text: "y".repeat(1000) }] } })).en.lines[0].text.length, 400);
});

function loadBackground(responses) {
  const listeners = {}, calls = [];
  const chrome = { runtime: { id: "me", onMessage: { addListener: (f) => (listeners.msg = f) } }, action: { onClicked: { addListener: (f) => (listeners.click = f) } }, tabs: { create: (o) => calls.push(["tab", o.url]) } };
  const fetch = async (url) => { calls.push(["fetch", url]); const r = responses[url]; return r === undefined ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => r }; };
  const ctx = vm.createContext({ chrome, fetch, URL, Map, Date, Promise, Error, console, NG });
  vm.runInContext(readFileSync(root + "src/background.js", "utf8"), ctx);
  const ask = (href, sender = { id: "me" }) => new Promise((res) => { const kept = listeners.msg({ type: "check", href }, sender, res); if (!kept) res("ignored"); });
  return { ask, calls, listeners };
}

test("background: token page -> summary.json; pool page -> token via DEX Screener; no report -> missing + live link; strangers ignored", async () => {
  const sumUrl = `https://neuro.sawasdeecoin.com/reports/bsc/${A}/summary.json`;
  const { ask, calls, listeners } = loadBackground({ [sumUrl]: summary(), [`https://api.dexscreener.com/latest/dex/pairs/bsc/${P}`]: { pairs: [{ baseToken: { address: A }, quoteToken: { address: WBNB } }] } });
  const r1 = await ask(`https://bscscan.com/token/${A}`);
  assert.equal(r1.result.level, "high");
  const r2 = await ask(`https://dexscreener.com/bsc/${P}`);
  assert.equal(r2.result.address, A);
  const r3 = await ask(`https://basescan.org/token/${A}`);
  assert.deepEqual({ ...r3 }, { missing: true, chain: "base", address: A, live: `https://neuro.sawasdeecoin.com/web/?chain=base&address=${A}` });
  assert.equal((await ask("https://example.com/")).none, true);
  assert.equal(await ask(`https://bscscan.com/token/${A}`, { id: "someone-else" }), "ignored");
  // cached: the token page was fetched once
  await ask(`https://bscscan.com/token/${A}`);
  assert.equal(calls.filter(([k, u]) => k === "fetch" && u === sumUrl).length, 2, "once for the token page, once after the pool lookup (different cache key)");
  assert.ok(calls.every(([k, u]) => k !== "fetch" || /^https:\/\/(neuro\.sawasdeecoin\.com|api\.dexscreener\.com|api\.geckoterminal\.com)\//.test(u)), "only the three hosts");
  listeners.click();
  assert.deepEqual(calls.at(-1), ["tab", "https://neuro.sawasdeecoin.com/web/"]);
});
