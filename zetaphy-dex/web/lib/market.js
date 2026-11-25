// Market data for the "BNB Chain" tab (bsc.js): the ZTPHY/USDT pool's candles, recent trades and 24 h stats, read from
// GeckoTerminal's public API (free, no key; data only, no code is loaded from it). Pure: parsing and number formatting;
// the page does the fetching. Everything that moves funds (quotes, minimums, the swap) is read from BNB Chain itself,
// never from here: a wrong or missing answer here only changes what the chart shows.

export const GT = Object.freeze({ api: 'https://api.geckoterminal.com/api/v2', network: 'bsc', site: 'https://www.geckoterminal.com/bsc/pools/' });

/** The chart's time frames: GeckoTerminal's timeframe + aggregate, and the seconds per candle. */
export const FRAMES = Object.freeze({
  '5m': { timeframe: 'minute', aggregate: 5, sec: 300 },
  '15m': { timeframe: 'minute', aggregate: 15, sec: 900 },
  '1H': { timeframe: 'hour', aggregate: 1, sec: 3600 },
  '4H': { timeframe: 'hour', aggregate: 4, sec: 14400 },
  '1D': { timeframe: 'day', aggregate: 1, sec: 86400 },
});

const lc = (a) => String(a ?? '').toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const addrFromId = (id) => { const m = /0x[0-9a-fA-F]{40}/.exec(String(id ?? '')); return m ? m[0].toLowerCase() : ''; };

export const poolUrl = (pool) => `${GT.api}/networks/${GT.network}/pools/${pool}`;
export function ohlcvUrl(pool, frame, token, limit = 200) {
  const f = FRAMES[frame];
  if (!f) throw new Error(`unknown frame ${frame}`);
  return `${poolUrl(pool)}/ohlcv/${f.timeframe}?aggregate=${f.aggregate}&limit=${limit}&currency=usd&token=${token}`;
}
export const tradesUrl = (pool) => `${poolUrl(pool)}/trades`;

/** Candles oldest first: { t (unix s), o, h, l, c, v (USD) }; bad rows dropped. */
export function parseOhlcv(json) {
  const list = json?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const [t, o, h, l, c, v] = r.map(num);
    if (!t || [o, h, l, c].some((x) => x === null || x < 0)) continue;
    out.push({ t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: v ?? 0 });
  }
  return out.sort((a, b) => a.t - b.t).filter((x, i, a) => i === 0 || x.t !== a[i - 1].t);
}

/** Trades newest first, from ZTPHY's side: { time (ms), side 'buy'|'sell', price (USD per ZTPHY), amount (ZTPHY), usd, tx, from }. */
export function parseTrades(json, ztphy) {
  const z = lc(ztphy), out = [];
  for (const d of Array.isArray(json?.data) ? json.data : []) {
    const a = d?.attributes ?? {};
    const to = lc(a.to_token_address), from = lc(a.from_token_address);
    let side;
    if (to === z) side = 'buy'; else if (from === z) side = 'sell'; else continue;
    const price = num(side === 'buy' ? a.price_to_in_usd : a.price_from_in_usd);
    const amount = num(side === 'buy' ? a.to_token_amount : a.from_token_amount);
    const time = Date.parse(a.block_timestamp);
    if (price === null || amount === null || !Number.isFinite(time)) continue;
    out.push({ time, side, price, amount, usd: num(a.volume_in_usd) ?? price * amount, tx: /^0x[0-9a-fA-F]{64}$/.test(a.tx_hash ?? '') ? a.tx_hash : null, from: a.tx_from_address ?? '' });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** 24 h stats from ZTPHY's side, whichever token GeckoTerminal calls the base: { price, change24, volume24, liquidity, buys24, sells24, fdv } (null when absent). */
export function parsePool(json, ztphy) {
  const a = json?.data?.attributes;
  if (!a) return null;
  const base = addrFromId(json.data?.relationships?.base_token?.data?.id);
  const zIsBase = !base || base === lc(ztphy);
  const price = num(zIsBase ? a.base_token_price_usd : a.quote_token_price_usd);
  // the % change is the base token's; for the quote token it is the inverse move
  let change = num(a.price_change_percentage?.h24);
  if (change !== null && !zIsBase) change = change <= -100 ? null : (100 / (1 + change / 100) - 100);
  const tx = a.transactions?.h24 ?? {};
  return { price, change24: change, volume24: num(a.volume_usd?.h24), liquidity: num(a.reserve_in_usd), buys24: num(zIsBase ? tx.buys : tx.sells), sells24: num(zIsBase ? tx.sells : tx.buys), fdv: num(a.fdv_usd) };
}

/** Candles from trades (oldest first), one per `sec` window; for when the candle endpoint has nothing yet. */
export function candlesFromTrades(trades, sec) {
  const m = new Map();
  for (const tr of [...trades].sort((a, b) => a.time - b.time)) {
    const t = Math.floor(tr.time / 1000 / sec) * sec, c = m.get(t);
    if (!c) m.set(t, { t, o: tr.price, h: tr.price, l: tr.price, c: tr.price, v: tr.usd });
    else { c.h = Math.max(c.h, tr.price); c.l = Math.min(c.l, tr.price); c.c = tr.price; c.v += tr.usd; }
  }
  return [...m.values()];
}

/** Price change over the candles shown: { abs, pct } or null. */
export function rangeChange(candles) {
  if (candles.length < 1) return null;
  const a = candles[0].o, b = candles[candles.length - 1].c;
  return a > 0 ? { abs: b - a, pct: ((b - a) / a) * 100 } : null;
}

/** Round axis ticks between lo and hi (about n of them). */
export function ticks(lo, hi, n = 5) {
  if (!(hi > lo)) { const d = Math.abs(lo) * 0.05 || 1e-12; lo -= d; hi += d; }
  const raw = (hi - lo) / Math.max(1, n), mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
/** A price for people: 4 significant digits; tiny prices with many zeros as 0.0₅123 (as trading sites show them). */
export function fmtPrice(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '–';
  if (p === 0) return '0';
  const a = Math.abs(p);
  if (a >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return p.toFixed(4).replace(/\.?0+$/, '');
  const zeros = -Math.floor(Math.log10(a)) - 1;
  const digits = Math.round(a * 10 ** (zeros + 4)).toString().replace(/0+$/, '') || '0';
  const sign = p < 0 ? '-' : '';
  if (zeros >= 5) return `${sign}0.0${String(zeros).split('').map((d) => SUB[d]).join('')}${digits}`;
  return `${sign}0.${'0'.repeat(zeros)}${digits}`;
}

/** USD amounts: $1.23K, $4.5M; small amounts with cents. */
export function fmtUsd(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1)}K`;
  if (a >= 1) return `${s}$${a.toFixed(2)}`;
  if (a === 0) return '$0';
  return `${s}$${fmtPrice(a)}`;
}

/** Token amounts: 1,234.56, 12.3K, 4.5M. */
export function fmtAmount(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return fmtPrice(v);
}

export function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** "5s", "3m", "2h", "4d" since `ms`. */
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The price-impact level the swap box colours: low < 1%, medium < 3%, high < 10%, severe. */
export const impactLevel = (bps) => (bps < 100 ? 'low' : bps < 300 ? 'medium' : bps < 1000 ? 'high' : 'severe');

/** A part of a balance (25/50/75/100 %), never more than the balance. */
export const portion = (balance, pct) => (balance * BigInt(pct)) / 100n;
