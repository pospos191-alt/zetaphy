// Neuro Guard service worker (Chrome) / background script (Firefox): the only part that uses the network.
// It answers { type: "check", href } from the content script with the page's token result, or { missing } when
// Neuro has no report for it yet. Calls: neuro.sawasdeecoin.com (summary.json, static), and for a pool page the
// public DEX Screener / GeckoTerminal API that names the pool's token. Nothing else is sent anywhere.
/* global NG, importScripts, chrome */
if (typeof NG === "undefined" && typeof importScripts === "function") importScripts("detect.js");

const cache = new Map(); // key -> { at, value }, 10 minutes
const TTL = 10 * 60 * 1000;

async function getJson(url) {
  const r = await fetch(url, { credentials: "omit", cache: "no-cache", headers: { accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function tokenOf(t) {
  if (t.kind === "token") return t;
  const q = NG.poolLookup(t);
  for (const url of [q.dexscreener, q.gecko]) {
    try {
      const got = NG.tokenOfPool(t.chain, await getJson(url));
      if (got) return got;
    } catch { /* try the other API */ }
  }
  return null;
}

async function check(href) {
  const t = NG.detect(href);
  if (!t) return { none: true };
  const key = `${t.chain}:${t.address}:${t.kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value;
  const tok = await tokenOf(t);
  if (!tok) value = { none: true };
  else {
    const s = NG.cleanSummary(tok, await getJson(NG.summaryUrl(tok)).catch(() => null));
    value = s ? { result: s } : { missing: true, chain: tok.chain, address: tok.address, live: NG.liveUrl(tok) };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // only our own content scripts on the listed sites
  if (!msg || msg.type !== "check" || sender.id !== chrome.runtime.id || typeof msg.href !== "string") return false;
  check(msg.href).then(reply, () => reply({ error: true }));
  return true;
});

// The toolbar button opens the checker.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: `${NG.NEURO}/web/` }));
