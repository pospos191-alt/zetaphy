// Neuro Guard: pure helpers shared by the service worker, the content script and the tests.
// No network, no DOM, no chrome.* here. A classic script (sets globalThis.NG) and a CommonJS module for Node tests.
(function (root) {
  "use strict";

  const NEURO = "https://neuro.sawasdeecoin.com";
  const CHAINS = ["eth", "bsc", "base", "arbitrum"];
  const LEVELS = ["high", "medium", "low", "info"];
  const EVM = /^0x[0-9a-fA-F]{40}$/;

  /** chain names used by explorers and DEX sites -> Neuro chain keys */
  const ALIASES = {
    eth: "eth", ethereum: "eth", mainnet: "eth",
    bsc: "bsc", bnb: "bsc", binance: "bsc", "bnb-chain": "bsc",
    base: "base",
    arbitrum: "arbitrum", arb: "arbitrum", "arbitrum-one": "arbitrum", arbitrum_one: "arbitrum",
  };
  const chainOf = (name) => ALIASES[String(name || "").toLowerCase()] || null;
  const EXPLORERS = { "etherscan.io": "eth", "bscscan.com": "bsc", "basescan.org": "base", "arbiscan.io": "arbitrum" };
  /** GeckoTerminal network ids (the same as Neuro's keys for these four) */
  const GECKO = { eth: "eth", bsc: "bsc", base: "base", arbitrum: "arbitrum" };
  /** DEX Screener chain slugs */
  const DEXSCREENER = { eth: "ethereum", bsc: "bsc", base: "base", arbitrum: "arbitrum" };

  const token = (chain, address) => (CHAINS.includes(chain) && EVM.test(String(address || "")) ? { chain, address: address.toLowerCase(), kind: "token" } : null);
  const pool = (chain, address) => (CHAINS.includes(chain) && EVM.test(String(address || "")) ? { chain, address: address.toLowerCase(), kind: "pool" } : null);

  /**
   * What a page is about, from its URL only: { chain, address, kind: "token" | "pool" } or null.
   * A pool is turned into its token by the service worker (DEX Screener / GeckoTerminal public APIs).
   *   etherscan.io|bscscan.com|basescan.org|arbiscan.io/token/<addr>
   *   dexscreener.com/<chain>/<pair or token>
   *   www.geckoterminal.com/<network>/pools/<pool>, /<network>/tokens/<token>
   *   pancakeswap.finance/swap?outputCurrency=<addr>&chain=bsc|eth|base|arb (also inputCurrency)
   *   app.uniswap.org/swap?chain=<chain>&outputCurrency=<addr>, app.uniswap.org/explore/tokens/<chain>/<addr>
   */
  function detect(href) {
    let u;
    try { u = new URL(href); } catch { return null; }
    if (u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./, "");
    const seg = u.pathname.split("/").filter(Boolean);
    const q = u.searchParams;
    if (EXPLORERS[host]) return seg[0] === "token" ? token(EXPLORERS[host], seg[1]) : null;
    if (host === "dexscreener.com") return seg.length >= 2 ? pool(chainOf(seg[0]), seg[1]) : null;
    if (host === "geckoterminal.com") {
      if (seg[1] === "pools") return pool(chainOf(seg[0]), seg[2]);
      if (seg[1] === "tokens") return token(chainOf(seg[0]), seg[2]);
      return null;
    }
    if (host === "pancakeswap.finance") {
      const chain = chainOf(q.get("chain") || "bsc");
      for (const k of ["outputCurrency", "inputCurrency"]) { const t = token(chain, q.get(k)); if (t) return t; }
      return null;
    }
    if (host === "app.uniswap.org") {
      if (seg[0] === "explore" && seg[1] === "tokens") return token(chainOf(seg[2]), seg[3]);
      const chain = chainOf(q.get("chain") || "ethereum");
      for (const k of ["outputCurrency", "inputCurrency"]) { const t = token(chain, q.get(k)); if (t) return t; }
      return null;
    }
    return null;
  }

  /** The public API call that names a pool's token (null for a token). */
  function poolLookup(t) {
    if (!t || t.kind !== "pool") return null;
    return {
      dexscreener: `https://api.dexscreener.com/latest/dex/pairs/${DEXSCREENER[t.chain]}/${t.address}`,
      gecko: `https://api.geckoterminal.com/api/v2/networks/${GECKO[t.chain]}/pools/${t.address}`,
    };
  }

  /** The token of a pool, from either API's answer; the side that is not WETH/WBNB/a stablecoin when one side is. */
  const QUOTES = new Set([
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0xdac17f958d2ee523a2206206994597c13d831ec7", // eth WETH USDC USDT
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "0xe9e7cea3dedca5984780bafc599bd69add087d56", // bsc WBNB USDT USDC BUSD
    "0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // base WETH USDC
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // arbitrum WETH USDC USDT
  ]);
  function tokenOfPool(chain, json) {
    const pick = (a, b) => {
      const [x, y] = [a, b].map((v) => (EVM.test(String(v || "")) ? v.toLowerCase() : null));
      if (x && !QUOTES.has(x)) return token(chain, x);
      if (y && !QUOTES.has(y)) return token(chain, y);
      return null;
    };
    const p = json && Array.isArray(json.pairs) ? json.pairs[0] : null;
    if (p) return pick(p.baseToken && p.baseToken.address, p.quoteToken && p.quoteToken.address);
    const rel = json && json.data && json.data.relationships;
    if (rel) {
      const id = (k) => String((rel[k] && rel[k].data && rel[k].data.id) || "").split("_").pop();
      return pick(id("base_token"), id("quote_token"));
    }
    return null;
  }

  const summaryUrl = (t) => `${NEURO}/reports/${t.chain}/${t.address}/summary.json`;
  const liveUrl = (t) => `${NEURO}/web/?chain=${t.chain}&address=${t.address}`;

  /** A summary.json answer, kept only if it is the one asked for and well formed (the card shows nothing else). */
  function cleanSummary(t, j) {
    if (!j || j.version !== 1 || j.chain !== t.chain || String(j.address).toLowerCase() !== t.address || !LEVELS.includes(j.level)) return null;
    const words = (w) => (w && typeof w.title === "string" ? { title: w.title.slice(0, 80), lines: (Array.isArray(w.lines) ? w.lines : []).slice(0, 5).filter((l) => l && typeof l.text === "string").map((l) => ({ severity: String(l.severity || "").slice(0, 10), text: l.text.slice(0, 400) })) } : null);
    const day = /^\d{4}-\d{2}-\d{2}/.exec(String(j.checkedAt || ""));
    return { chain: t.chain, address: t.address, symbol: String(j.symbol || "").slice(0, 24), level: j.level, checkedAt: day ? day[0] : "", en: words(j.en), th: words(j.th),
      page: `${NEURO}/reports/${t.chain}/${t.address}/`, live: liveUrl(t) };
  }

  /** The card's own words (the result's lines come from summary.json: English or Thai). */
  const UI = {
    en: { title: "Neuro token check", missing: "Not in Neuro's reports yet.", check: "Check now", details: "Details", checked: "Checked", close: "Close", by: "by ZETAPHY" },
    th: { title: "ผลตรวจเหรียญ Neuro", missing: "ยังไม่มีในรายงานของ Neuro", check: "ตรวจตอนนี้", details: "รายละเอียด", checked: "ตรวจเมื่อ", close: "ปิด", by: "โดย ZETAPHY" },
    zh: { title: "Neuro 代币检查", missing: "尚未收录在 Neuro 报告中。", check: "立即检查", details: "详情", checked: "检查于", close: "关闭", by: "ZETAPHY 出品" },
    es: { title: "Revisión de token Neuro", missing: "Aún no está en los informes de Neuro.", check: "Revisar ahora", details: "Detalles", checked: "Revisado", close: "Cerrar", by: "de ZETAPHY" },
    ko: { title: "Neuro 토큰 검사", missing: "아직 Neuro 보고서에 없습니다.", check: "지금 검사", details: "자세히", checked: "검사일", close: "닫기", by: "ZETAPHY 제공" },
    ja: { title: "Neuro トークンチェック", missing: "まだ Neuro のレポートにありません。", check: "今すぐチェック", details: "詳細", checked: "チェック日", close: "閉じる", by: "ZETAPHY 提供" },
    ru: { title: "Проверка токена Neuro", missing: "Пока нет в отчётах Neuro.", check: "Проверить", details: "Подробнее", checked: "Проверено", close: "Закрыть", by: "от ZETAPHY" },
    vi: { title: "Kiểm tra token Neuro", missing: "Chưa có trong báo cáo của Neuro.", check: "Kiểm tra ngay", details: "Chi tiết", checked: "Kiểm tra", close: "Đóng", by: "bởi ZETAPHY" },
    id: { title: "Pemeriksaan token Neuro", missing: "Belum ada di laporan Neuro.", check: "Periksa sekarang", details: "Detail", checked: "Diperiksa", close: "Tutup", by: "oleh ZETAPHY" },
  };
  const langOf = (l) => { const k = String(l || "en").toLowerCase().split(/[-_]/)[0]; return UI[k] ? k : "en"; };

  const api = { NEURO, CHAINS, LEVELS, chainOf, detect, poolLookup, tokenOfPool, summaryUrl, liveUrl, cleanSummary, UI, langOf };
  root.NG = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
