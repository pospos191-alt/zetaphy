// The Swap page: one place for every network where ZTPHY trades. A row of networks on top: each market of
// lib/markets.js whose ZTPHY pool exists (asked from the DEX's factory, so a new pool shows up by itself) and ZETAPHY's
// own AMM when it has pools. Below, the chosen network's trading view:
//  - the pair's price, 24 h stats, a candle / line chart and the recent trades (GeckoTerminal's public API,
//    lib/market.js; display only);
//  - the swap box (buy / sell, 25-50-75-Max, flip, slippage and deadline settings, rate, price impact, minimum received,
//    fee, route) and the token's links (contract, pool, add to wallet, explorers).
// What moves funds is read from the market's chain only: the router, the quoter and the pool are checked on-chain (same
// factory, the factory's pool for the pair is the one shown, and the pinned one where pinned), then a fresh quote, a
// minimum out from the slippage, a dry run and the wallet-safety summary; exact approvals only. ZETAPHY's AMM keeps its
// own swap card (app.js), shown here when its network is picked. Every text goes in with textContent.
import * as M from './lib/markets.js';
import * as K from './lib/market.js';
import { createChart } from './lib/chart.js';
import { parseUnits, formatUnits } from './lib/abi.js';
import { TEXT } from './xswap-i18n.js';

export { TEXT };

/** A decimal string without trailing zeros after the point ("500.000" -> "500", "0.250" -> "0.25"). */
export const trimDec = (x) => (x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x);
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ZERO = '0x0000000000000000000000000000000000000000';
const SLIPS = [10, 50, 100, 300]; // bps presets
const PREFS = 'zetaphy-dex:xswap';
const QUOTE_EVERY = 15_000, MARKET_EVERY = 60_000;
export const NATIVE_ID = 'zetaphy';

function loadPrefs(win) {
  try {
    const p = JSON.parse(win.localStorage.getItem(PREFS) ?? '{}');
    const slip = Number.isInteger(p.slip) && p.slip >= 1 && p.slip <= M.MAX_SLIPPAGE_BPS ? p.slip : 100;
    const deadline = Number.isInteger(p.deadline) && p.deadline >= 1 && p.deadline <= 180 ? p.deadline : 20;
    const frame = Object.hasOwn(K.FRAMES, p.frame) ? p.frame : '1H';
    const kind = p.kind === 'line' ? 'line' : 'candle';
    const net = typeof p.net === 'string' && /^[a-z0-9-]{1,20}$/.test(p.net) ? p.net : null;
    return { slip, deadline, frame, kind, net };
  } catch { return { slip: 100, deadline: 20, frame: '1H', kind: 'candle', net: null }; }
}

/**
 * The page. ctx: { state, $, el, setStatus, errorText, openWallets, confirm(o) -> data|null, fetchFn, win, markets,
 *   native: { available() -> Promise<bool>, show(), hide() } (ZETAPHY's own AMM card), onLayout(wide) }
 */
export function createSwapPage(ctx) {
  const { state, $, el } = ctx;
  const win = ctx.win ?? window;
  const fetchFn = ctx.fetchFn ?? ((...a) => fetch(...a));
  const markets = ctx.markets ?? M.MARKETS;
  const prefs = loadPrefs(win);
  const savePrefs = () => { try { win.localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private window: kept for this visit */ } };
  // per market: { pool, verified, status: 'unknown' | 'open' | 'none' }
  const found = new Map(markets.map((m) => [m.id, { pool: null, verified: null, status: 'unknown' }]));
  let nativeOpen = false, current = null, built = null, seq = 0, last = null, side = 'sell', inverted = false, busy = false, discovering = null;
  let chart = null, market = { stats: null, candles: [], trades: [], err: false }, spot = null, timers = [];
  const bal = new Map();

  const vars = (m) => (m ? { chain: m.chain.name, dex: m.dex, stable: m.stable.symbol, native: m.chain.nativeCurrency.symbol, explorer: m.explorerName } : {});
  const tt = (k, v = {}) => (TEXT[state.lang]?.[k] ?? TEXT.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String({ ...vars(current), ...v }[x] ?? ''));

  // ------------------------------------------------------------------ the market's chain over JSON-RPC
  async function rpcOn(m, method, params) {
    let err;
    for (const url of m.chain.rpc) {
      try {
        const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message ?? 'rpc error'), { data: j.error.data });
        return j.result;
      } catch (e) { err = e; if (e.data !== undefined) throw e; }
    }
    throw err;
  }
  const callOn = (m, to, data, from) => rpcOn(m, 'eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']);
  const rpc = (method, params) => rpcOn(current, method, params);
  const call = (to, data, from) => callOn(current, to, data, from);

  // ------------------------------------------------------------------ which networks have a ZTPHY pool
  async function discover() {
    const jobs = markets.map(async (m) => {
      const f = found.get(m.id);
      try {
        const pool = M.addressOf(await callOn(m, m.factory, M.getPoolCall(m)));
        const exists = pool.toLowerCase() !== ZERO;
        // a pinned pool is the one shown; if the factory names another, the on-chain check refuses before any quote
        f.pool = m.pool ?? (exists ? pool : null);
        f.status = exists ? 'open' : 'none';
      } catch { f.status = m.pool ? 'open' : 'unknown'; f.pool = f.pool ?? m.pool; } // RPC down: a pinned pool is still offered (and checked before any quote)
    });
    const native = (async () => { try { nativeOpen = !!(await ctx.native?.available()); } catch { nativeOpen = false; } })();
    await Promise.all([...jobs, native]);
  }

  const openMarkets = () => markets.filter((m) => found.get(m.id).status === 'open');

  function pick() {
    const open = openMarkets();
    const want = prefs.net;
    if (want === NATIVE_ID && nativeOpen) return NATIVE_ID;
    if (want && open.some((m) => m.id === want)) return want;
    return open[0]?.id ?? (nativeOpen ? NATIVE_ID : markets[0]?.id ?? NATIVE_ID);
  }

  function renderNets(selected) {
    const box = $('mx-nets');
    const chip = (id, name, sub) => el('button', { type: 'button', class: 'net-chip', 'data-net': id, 'aria-pressed': String(id === selected), title: sub },
      el('span', { class: 'net-dot' }), el('b', { text: name }), el('span', { class: 'net-sub', text: sub }));
    const chips = openMarkets().map((m) => chip(m.id, m.chain.name, `ZTPHY/${m.stable.symbol} · ${m.dex}`));
    if (nativeOpen) chips.push(chip(NATIVE_ID, tt('zetaphyNet'), 'ZETAPHY AMM'));
    box.replaceChildren(el('span', { class: 'net-label', text: tt('nets') }), ...chips,
      discovering ? el('span', { class: 'hint net-finding', text: tt('finding') }) : el('span', { class: 'hint net-hint', text: tt('netsHint') }));
    for (const b of box.querySelectorAll('[data-net]')) b.addEventListener('click', () => select(b.dataset.net, true));
  }

  async function select(id, user = false) {
    if (user) { prefs.net = id; savePrefs(); }
    if (id === NATIVE_ID) {
      stopTimers();
      current = null; built = null;
      $('mx-root').replaceChildren();
      $('mx-root').hidden = true;
      ctx.native?.show();
      ctx.onLayout?.(false);
      renderNets(id);
      return;
    }
    const m = markets.find((x) => x.id === id);
    if (!m) return;
    ctx.native?.hide();
    $('mx-root').hidden = false;
    ctx.onLayout?.(true);
    if (current !== m) { current = m; built = null; market = { stats: null, candles: [], trades: [], err: false }; spot = null; last = null; side = 'sell'; inverted = false; bal.clear(); }
    renderNets(id);
    if (built !== state.lang) build();
    startTimers();
    loadMarket().catch(() => {});
    loadSpot();
    await update();
  }

  const pool = () => found.get(current.id)?.pool ?? current.pool;

  /** The router and quoter name the DEX's factory, and the factory's pool for the pair is the one shown (and the pinned one). */
  async function verify() {
    const f = found.get(current.id);
    if (f.verified) return f.verified;
    const m = current, why = [];
    for (const [k, a] of [['router', m.swapRouter], ['quoter', m.quoter], ['ZTPHY', m.ztphy.address], ...(pool() ? [['pool', pool()]] : [])]) {
      const code = await rpc('eth_getCode', [a, 'latest']);
      if (!code || code === '0x') why.push(`${k}: no code`);
    }
    for (const [k, a] of [['router', m.swapRouter], ['quoter', m.quoter]]) {
      const fa = M.addressOf(await call(a, M.SELECTORS.factory).catch(() => '0x'));
      if (fa.toLowerCase() !== m.factory.toLowerCase()) why.push(`${k}.factory() = ${fa}`);
    }
    const fp = M.addressOf(await call(m.factory, M.getPoolCall(m)).catch(() => '0x'));
    if (!pool() || fp.toLowerCase() !== pool().toLowerCase()) why.push(`factory pool = ${fp}`);
    if (m.pool && fp.toLowerCase() !== m.pool.toLowerCase()) why.push(`pinned pool ${m.pool}`);
    const r = { ok: why.length === 0, why: why.join('; ') };
    if (r.ok) f.verified = r; // only a pass is remembered; a failure is checked again next time
    return r;
  }

  // ------------------------------------------------------------------ market data (display only)
  async function getJson(url) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ac?.abort(), 10_000);
    try {
      const r = await fetchFn(url, { headers: { accept: 'application/json' }, signal: ac?.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  async function loadMarket() {
    const m = current, p0 = pool();
    if (!m || !p0) return;
    const z = m.ztphy.address, net = m.gecko;
    const [p, o, tr] = await Promise.allSettled([getJson(K.poolUrl(p0, net)), getJson(K.ohlcvUrl(p0, prefs.frame, z, 200, net)), getJson(K.tradesUrl(p0, net))]);
    if (m !== current) return;
    const trades = tr.status === 'fulfilled' ? K.parseTrades(tr.value, z) : [];
    let candles = o.status === 'fulfilled' ? K.parseOhlcv(o.value) : [];
    if (!candles.length && trades.length) candles = K.candlesFromTrades(trades, K.FRAMES[prefs.frame].sec);
    market = { stats: p.status === 'fulfilled' ? K.parsePool(p.value, z) : null, candles, trades, err: [p, o, tr].every((x) => x.status === 'rejected') };
    if (built) renderMarket();
  }

  async function loadSpot() {
    const m = current;
    if (!m || !pool()) return;
    try { const s = M.priceOf(m, M.word(await call(pool(), M.SELECTORS.slot0))); if (m === current) spot = s; } catch { /* the chart's last price is used */ }
    if (built) renderHead();
  }

  const price = () => spot ?? market.stats?.price ?? (market.candles.length ? market.candles[market.candles.length - 1].c : null);

  // ------------------------------------------------------------------ building the view
  const tokenChip = (t) => el('span', { class: 'tok-chip' }, t === current.ztphy ? el('img', { src: './logo.svg', alt: '', width: '20', height: '20' }) : el('span', { class: `tok-ic ${t.symbol.toLowerCase()}`, text: t.symbol === 'USDT' ? '₮' : '$' }), el('b', { text: t.symbol }));
  const stat = (id, label) => el('div', { class: 'mk-stat' }, el('span', { text: label }), el('b', { id, text: '–' }));
  const link = (href, text) => (href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text }) : null);

  function build() {
    const m = current, root = $('mx-root'), L = M.links(m, pool());
    const frames = el('div', { class: 'seg', role: 'group' }, ...Object.keys(K.FRAMES).map((f) => el('button', { type: 'button', class: 'seg-btn', 'data-frame': f, 'aria-pressed': String(f === prefs.frame), text: f })));
    const kinds = el('div', { class: 'seg', role: 'group' }, el('button', { type: 'button', class: 'seg-btn', 'data-kind': 'candle', 'aria-pressed': String(prefs.kind === 'candle'), text: tt('candles') }),
      el('button', { type: 'button', class: 'seg-btn', 'data-kind': 'line', 'aria-pressed': String(prefs.kind === 'line'), text: tt('line') }));
    const head = el('div', { class: 'card mk-head' },
      el('div', { class: 'mk-pair' },
        el('span', { class: 'mk-logos' }, el('img', { src: './logo.svg', alt: '', width: '34', height: '34' }), el('span', { class: `tok-ic ${m.stable.symbol.toLowerCase()} big`, text: m.stable.symbol === 'USDT' ? '₮' : '$' })),
        el('div', {}, el('h2', { text: tt('pair') }), el('p', { class: 'hint mk-venue', text: tt('venue') })),
        el('div', { class: 'mk-price' }, el('b', { id: 'mx-last', text: '–' }), el('span', { id: 'mx-change', class: 'mk-chg', text: '' }))),
      el('div', { class: 'mk-stats' }, stat('mx-s-volume', tt('sVolume')), stat('mx-s-liq', tt('sLiquidity')), stat('mx-s-trades', tt('sTrades')), stat('mx-s-change', tt('sChange'))));
    const chartCard = el('div', { class: 'card mk-chart-card' },
      el('div', { class: 'mk-toolbar' }, frames, kinds),
      el('div', { class: 'mk-chart', id: 'mx-chart' }),
      el('p', { class: 'hint mk-note', text: tt('dataBy') }));
    const tradesCard = el('div', { class: 'card mk-trades-card' }, el('h3', { class: 'mk-h3', text: tt('trades') }),
      el('div', { class: 'mk-table-wrap' }, el('table', { class: 'mk-trades' },
        el('thead', {}, el('tr', {}, ...['tTime', 'tType', 'tPrice', 'tAmount', 'tValue'].map((k) => el('th', { text: tt(k) })), el('th', { text: '' }))),
        el('tbody', { id: 'mx-trades' }))));

    const slipChips = el('div', { class: 'seg slip-seg' }, ...SLIPS.map((b) => el('button', { type: 'button', class: 'seg-btn', 'data-slip': String(b), text: `${b / 100}%` })),
      el('input', { id: 'mx-slip-custom', class: 'slip-custom', inputmode: 'decimal', autocomplete: 'off', placeholder: tt('slipCustom'), 'aria-label': tt('slipCustom') }));
    const settings = el('div', { class: 'swap-settings', id: 'mx-settings', hidden: true },
      el('div', { class: 'set-row' }, el('span', { text: tt('slippage') }), slipChips),
      el('p', { class: 'hint', text: tt('slipHint') }),
      el('label', { class: 'set-row' }, el('span', { text: tt('deadline') }), el('input', { id: 'mx-deadline', class: 'slip-custom', inputmode: 'numeric', autocomplete: 'off' })),
      el('p', { class: 'status', id: 'mx-set-status', role: 'status' }),
      el('button', { type: 'button', class: 'ghost small', id: 'mx-set-done', text: tt('done2') }));
    const pcts = el('div', { class: 'pct-row' }, ...[25, 50, 75, 100].map((p) => el('button', { type: 'button', class: 'ghost small', 'data-pct': String(p), text: p === 100 ? tt('max') : `${p}%` })));
    const swapCard = el('div', { class: 'card swap-card' },
      el('div', { class: 'swap-top' },
        el('div', { class: 'seg side-seg', role: 'group' }, el('button', { type: 'button', class: 'seg-btn buy', id: 'mx-side-buy', 'aria-pressed': 'false', text: tt('buy') }),
          el('button', { type: 'button', class: 'seg-btn sell', id: 'mx-side-sell', 'aria-pressed': 'true', text: tt('sell') })),
        el('button', { type: 'button', class: 'ghost icon', id: 'mx-gear', title: tt('settings'), 'aria-label': tt('settings'), 'aria-expanded': 'false', text: '⚙' })),
      settings,
      el('div', { class: 'field' },
        el('div', { class: 'field-top' }, el('label', { for: 'mx-amount', text: tt('pay') }), el('button', { type: 'button', class: 'link-btn', id: 'mx-balance' })),
        el('div', { class: 'row' }, el('input', { id: 'mx-amount', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0.0' }), el('span', { id: 'mx-pay-tok' })),
        el('div', { class: 'field-foot' }, el('span', { class: 'hint usd', id: 'mx-pay-usd' }), pcts)),
      el('div', { class: 'flip-row' }, el('button', { type: 'button', class: 'ghost icon flip-btn', id: 'mx-flip', title: tt('flip'), 'aria-label': tt('flip'), text: '⇅' })),
      el('div', { class: 'field' },
        el('div', { class: 'field-top' }, el('span', { text: tt('receive') }), el('span', { class: 'hint', id: 'mx-get-bal' })),
        el('div', { class: 'row' }, el('output', { id: 'mx-out', class: 'amount-out', text: '0.0' }), el('span', { id: 'mx-get-tok' })),
        el('div', { class: 'field-foot' }, el('span', { class: 'hint usd', id: 'mx-get-usd' }))),
      el('div', { class: 'nozt', id: 'mx-nozt', hidden: true }, el('p', { text: tt('noZtphy') }), el('button', { type: 'button', class: 'ghost small', id: 'mx-buy-instead', text: tt('buyInstead') })),
      el('p', { class: 'hint', id: 'mx-quote', 'aria-live': 'polite' }),
      el('dl', { class: 'details', id: 'mx-details', hidden: true },
        el('dt', { text: tt('rate') }), el('dd', {}, el('button', { type: 'button', class: 'link-btn', id: 'mx-rate', title: tt('invert') })),
        el('dt', { text: tt('impact') }), el('dd', { id: 'mx-impact-v' }),
        el('dt', { text: tt('minReceived') }), el('dd', { id: 'mx-min' }),
        el('dt', { text: tt('fee') }), el('dd', { id: 'mx-fee' }),
        el('dt', { text: tt('slipShown') }), el('dd', { id: 'mx-slip-v' }),
        el('dt', { text: tt('route') }), el('dd', { id: 'mx-route' })),
      el('p', { class: 'hint', id: 'mx-price' }),
      el('p', { class: 'warn', id: 'mx-impact', role: 'alert', hidden: true, text: tt('bigImpact') }),
      el('button', { type: 'button', class: 'primary', id: 'mx-btn', disabled: true, text: tt('swap') }),
      el('p', { class: 'status', id: 'mx-status', role: 'status' }),
      el('p', { class: 'warn small', role: 'note', text: tt('thin') }),
      el('p', { class: 'hint', text: tt('gas') }));
    const addrRow = (label, a, kind) => el('div', { class: 'addr-row' }, el('span', { class: 'hint', text: label }),
      el('a', { href: `${m.chain.explorer}/${kind}/${a}`, target: '_blank', rel: 'noopener noreferrer', class: 'mono', text: shortAddr(a) }),
      el('button', { type: 'button', class: 'ghost small', 'data-copy': a, text: tt('copy') }));
    const linksCard = el('div', { class: 'card mk-links' },
      el('h3', { class: 'mk-h3', text: tt('links') }),
      el('p', { class: 'hint', text: tt('lede', { addr: m.ztphy.address }) }),
      addrRow(tt('contract'), m.ztphy.address, 'token'), pool() ? addrRow(tt('poolAddr'), pool(), 'address') : null,
      el('button', { type: 'button', class: 'ghost small', id: 'mx-add-token', text: tt('addToken') }),
      el('p', { class: 'status', id: 'mx-link-status', role: 'status' }),
      el('div', { class: 'ext-links' }, link(L.token, tt('onExplorer')), link(L.trade, tt('onTrade')), link(L.gecko, tt('onGecko')), link(L.dexscreener, tt('onDexscreener'))));

    root.replaceChildren(el('div', { class: 'mk-wrap' }, el('div', { class: 'mk-main' }, head, chartCard, tradesCard), el('div', { class: 'mk-side' }, swapCard, linksCard)));
    chart = createChart($('mx-chart'), { fmtPrice: K.fmtPrice, fmtUsd: K.fmtUsd, label: (c) => tt('chartLabel', { n: c.length }) });

    for (const b of root.querySelectorAll('[data-frame]')) b.addEventListener('click', () => { prefs.frame = b.dataset.frame; savePrefs(); pressed('[data-frame]', b); loadMarket(); });
    for (const b of root.querySelectorAll('[data-kind]')) b.addEventListener('click', () => { prefs.kind = b.dataset.kind; savePrefs(); pressed('[data-kind]', b); renderMarket(); });
    $('mx-side-buy').addEventListener('click', () => setSide('buy'));
    $('mx-side-sell').addEventListener('click', () => setSide('sell'));
    $('mx-flip').addEventListener('click', () => {
      const out = $('mx-out').dataset.raw; // the amount you were going to get becomes the amount you pay
      setSide(side === 'buy' ? 'sell' : 'buy', out && Number(out) > 0 ? out : null);
    });
    $('mx-buy-instead').addEventListener('click', () => setSide('buy'));
    $('mx-amount').addEventListener('input', () => update());
    $('mx-balance').addEventListener('click', () => usePct(100));
    for (const b of root.querySelectorAll('[data-pct]')) b.addEventListener('click', () => usePct(Number(b.dataset.pct)));
    $('mx-gear').addEventListener('click', () => toggleSettings());
    $('mx-set-done').addEventListener('click', () => toggleSettings(false));
    for (const b of root.querySelectorAll('[data-slip]')) b.addEventListener('click', () => { prefs.slip = Number(b.dataset.slip); $('mx-slip-custom').value = ''; savePrefs(); renderSettings(); update(); });
    $('mx-slip-custom').addEventListener('input', (e) => {
      const bps = Math.round(Number(String(e.target.value).replace(',', '.')) * 100);
      if (!e.target.value) { ctx.setStatus('mx-set-status', ''); return; }
      if (!(bps >= 1 && bps <= M.MAX_SLIPPAGE_BPS)) { ctx.setStatus('mx-set-status', tt('slipBad'), 'err'); return; }
      ctx.setStatus('mx-set-status', ''); prefs.slip = bps; savePrefs(); renderSettings(true); update();
    });
    $('mx-deadline').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (!(Number.isInteger(v) && v >= 1 && v <= 180)) { ctx.setStatus('mx-set-status', tt('deadlineBad'), 'err'); return; }
      ctx.setStatus('mx-set-status', ''); prefs.deadline = v; savePrefs();
    });
    $('mx-rate').addEventListener('click', () => { inverted = !inverted; if (last?.view) renderRate(last.view); });
    $('mx-btn').addEventListener('click', () => onClick().catch((e) => ctx.setStatus('mx-status', tt('failed', { msg: ctx.errorText(e) }), 'err')));
    for (const b of root.querySelectorAll('[data-copy]')) b.addEventListener('click', async () => {
      try { await win.navigator.clipboard.writeText(b.dataset.copy); b.textContent = tt('copied'); setTimeout(() => { b.textContent = tt('copy'); }, 1500); } catch { /* no clipboard: the address is in the link */ }
    });
    $('mx-add-token').addEventListener('click', () => addToken().catch((e) => ctx.setStatus('mx-link-status', tt('failed', { msg: ctx.errorText(e) }), 'err')));
    built = state.lang;
    renderSide();
    renderSettings();
    renderMarket();
  }

  function pressed(sel, on) { for (const b of $('mx-root').querySelectorAll(sel)) b.setAttribute('aria-pressed', String(b === on)); }

  function toggleSettings(open) {
    const s = $('mx-settings'), next = open ?? s.hidden;
    s.hidden = !next;
    $('mx-gear').setAttribute('aria-expanded', String(next));
  }

  function renderSettings(custom = false) {
    for (const b of $('mx-root').querySelectorAll('[data-slip]')) b.setAttribute('aria-pressed', String(!custom && Number(b.dataset.slip) === prefs.slip));
    if (!custom && !SLIPS.includes(prefs.slip)) $('mx-slip-custom').value = String(prefs.slip / 100);
    $('mx-deadline').value = String(prefs.deadline);
  }

  const tin = () => (side === 'buy' ? current.stable : current.ztphy);

  function setSide(next, amount = null) {
    side = next;
    if (amount !== null) $('mx-amount').value = amount;
    renderSide();
    update();
  }

  function renderSide() {
    $('mx-side-buy').setAttribute('aria-pressed', String(side === 'buy'));
    $('mx-side-sell').setAttribute('aria-pressed', String(side === 'sell'));
    $('mx-pay-tok').replaceChildren(tokenChip(tin()));
    $('mx-get-tok').replaceChildren(tokenChip(M.other(current, tin())));
    $('mx-btn').classList.toggle('sell', side === 'sell');
  }

  async function usePct(pct) {
    if (!state.account) return;
    const t = tin(), b = bal.get(t.address) ?? M.word(await call(t.address, M.balanceCall(state.account)).catch(() => '0x0'));
    $('mx-amount').value = trimDec(formatUnits(K.portion(b, pct), t.decimals, t.decimals).replace(/,/g, '')) || '0';
    update();
  }

  // ------------------------------------------------------------------ rendering the market
  function renderHead() {
    if (!built) return;
    const p = price(), s = market.stats, ch = s?.change24 ?? null;
    $('mx-last').textContent = p === null ? '–' : `$${K.fmtPrice(p)}`;
    const chg = $('mx-change');
    chg.textContent = ch === null ? '' : K.fmtPct(ch);
    chg.className = `mk-chg ${ch === null ? '' : ch >= 0 ? 'up' : 'down'}`;
    $('mx-s-volume').textContent = K.fmtUsd(s?.volume24 ?? null);
    $('mx-s-liq').textContent = K.fmtUsd(s?.liquidity ?? null);
    $('mx-s-trades').textContent = s && s.buys24 !== null ? tt('sTradesVal', { b: s.buys24, s: s.sells24 ?? 0 }) : '–';
    const c2 = $('mx-s-change');
    c2.textContent = K.fmtPct(ch);
    c2.className = ch === null ? '' : ch >= 0 ? 'up' : 'down';
  }

  function renderMarket() {
    if (!built) return;
    renderHead();
    chart.draw(market.candles, { kind: prefs.kind, last: price(), empty: market.err ? tt('chartErr') : tt('noTrades') });
    const body = $('mx-trades');
    if (!market.trades.length) { body.replaceChildren(el('tr', {}, el('td', { colspan: '6', class: 'hint', text: market.err ? tt('chartErr') : tt('noTradeRows') }))); return; }
    const now = Date.now();
    body.replaceChildren(...market.trades.slice(0, 25).map((r) => el('tr', { class: r.side },
      el('td', { class: 'hint', text: K.ago(r.time, now) }),
      el('td', { class: `side ${r.side}`, text: tt(r.side) }),
      el('td', { class: 'mono', text: `$${K.fmtPrice(r.price)}` }),
      el('td', { class: 'mono', text: K.fmtAmount(r.amount) }),
      el('td', { class: 'mono', text: K.fmtUsd(r.usd) }),
      el('td', {}, r.tx ? link(`${current.chain.explorer}/tx/${r.tx}`, '↗') : ''))));
  }

  // ------------------------------------------------------------------ the swap box
  const fmt = (v, t) => formatUnits(v, t.decimals, 6);
  const toNum = (v, t) => Number(formatUnits(v, t.decimals, t.decimals).replace(/,/g, ''));
  const usdOf = (t, v) => { const n = toNum(v, t), p = price(); return t === current.stable ? n : p === null ? null : n * p; };

  function renderRate(view) {
    const { t, out, amount, amountOut } = view;
    const a = toNum(amount, t), b = toNum(amountOut, out);
    if (!(a > 0 && b > 0)) return;
    const [x, y, r] = inverted ? [out, t, a / b] : [t, out, b / a];
    $('mx-rate').textContent = `1 ${x.symbol} = ${K.fmtPrice(r)} ${y.symbol}`;
  }

  async function update() {
    if (!current || !built) return;
    const my = ++seq, m = current, t = tin(), out = M.other(m, t), btn = $('mx-btn');
    last = null; btn.disabled = true; $('mx-impact').hidden = true; $('mx-details').hidden = true; $('mx-nozt').hidden = true;
    $('mx-quote').textContent = ''; $('mx-price').textContent = '';
    $('mx-out').textContent = '0.0'; delete $('mx-out').dataset.raw; $('mx-get-usd').textContent = '';
    let amount;
    try { amount = parseUnits(String($('mx-amount').value || '').trim(), t.decimals); } catch { amount = 0n; }
    const payUsd = amount > 0n ? usdOf(t, amount) : null;
    $('mx-pay-usd').textContent = payUsd === null ? '' : `≈ ${K.fmtUsd(payUsd)}`;
    if (state.account) {
      const [bi, bo] = await Promise.all([t, out].map((x) => call(x.address, M.balanceCall(state.account)).then(M.word).catch(() => null)));
      if (my !== seq) return;
      bal.set(t.address, bi); bal.set(out.address, bo);
      $('mx-balance').textContent = tt('balance', { b: bi === null ? '–' : `${fmt(bi, t)} ${t.symbol}` });
      $('mx-get-bal').textContent = tt('balance', { b: bo === null ? '–' : `${fmt(bo, out)} ${out.symbol}` });
      // the usual mix-up: ZTPHY on ZETAPHY is not ZTPHY on this chain
      if (side === 'sell' && bi === 0n) $('mx-nozt').hidden = false;
    } else { $('mx-balance').textContent = ''; $('mx-get-bal').textContent = ''; }
    if (!state.account) { btn.textContent = tt('connect'); btn.disabled = false; return; }
    if (amount <= 0n) { btn.textContent = tt('badAmount'); return; }
    const first = !found.get(m.id).verified; // the on-chain check runs once; a later refresh keeps the last transaction's status
    if (first) ctx.setStatus('mx-status', tt('checking'));
    const v = await verify();
    if (my !== seq) return;
    if (!v.ok) { ctx.setStatus('mx-status', tt('unsafe', { why: v.why }), 'err'); return; }
    if (first) ctx.setStatus('mx-status', '');
    const slip = prefs.slip;
    let q, before;
    try {
      q = M.readQuote(await call(m.quoter, M.quoteCall(m, t, amount)));
      before = M.word(await call(pool(), M.SELECTORS.slot0)); // slot0(): sqrtPriceX96 first
    } catch { if (my === seq) ctx.setStatus('mx-status', tt('noLiquidity'), 'err'); return; }
    if (my !== seq) return;
    spot = M.priceOf(m, before);
    renderHead();
    const min = M.minOut(q.amountOut, slip), impact = M.impactBps(m, before, q.sqrtPriceX96After), level = K.impactLevel(impact);
    $('mx-out').textContent = fmt(q.amountOut, out);
    $('mx-out').dataset.raw = trimDec(formatUnits(q.amountOut, out.decimals, out.decimals).replace(/,/g, ''));
    const getUsd = usdOf(out, q.amountOut);
    $('mx-get-usd').textContent = getUsd === null ? '' : `≈ ${K.fmtUsd(getUsd)}`;
    $('mx-quote').textContent = tt('get', { out: fmt(q.amountOut, out), sym: out.symbol, min: fmt(min, out), slip: slip / 100 });
    $('mx-price').textContent = tt('price', { p: spot.toFixed(7), i: (impact / 100).toFixed(1) });
    const view = { t, out, amount, amountOut: q.amountOut };
    renderRate(view);
    const iv = $('mx-impact-v');
    iv.textContent = `${(impact / 100).toFixed(2)}%`;
    iv.className = `impact-${level}`;
    $('mx-min').textContent = `${fmt(min, out)} ${out.symbol}`;
    $('mx-fee').textContent = `${fmt((amount * BigInt(m.fee)) / 1_000_000n, t)} ${t.symbol}`;
    $('mx-slip-v').textContent = `${slip / 100}%`;
    $('mx-route').textContent = tt('routeVal', { a: t.symbol, b: out.symbol });
    $('mx-details').hidden = false;
    $('mx-impact').hidden = impact <= 1000;
    const have = bal.get(t.address) ?? M.word(await call(t.address, M.balanceCall(state.account)).catch(() => '0x0'));
    if (my !== seq) return;
    if (have < amount) { btn.textContent = tt('low', { sym: t.symbol }); return; }
    const allowed = M.word(await call(t.address, M.allowanceCall(state.account, m.swapRouter)).catch(() => '0x0'));
    if (my !== seq) return;
    last = { m, t, amount, min, approve: allowed < amount, view };
    btn.textContent = last.approve ? tt('approve', { amt: fmt(amount, t), sym: t.symbol }) : tt('swap');
    btn.disabled = false;
  }

  async function ensureChain(m) {
    const p = state.wallet.provider;
    ctx.setStatus('mx-status', tt('switching'));
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: m.chain.chainIdHex }] }); } catch (e) {
      if (e?.code === 4001) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: m.chain.chainIdHex, chainName: m.chain.name, nativeCurrency: m.chain.nativeCurrency, rpcUrls: [m.chain.rpc[0]], blockExplorerUrls: [m.chain.explorer] }] });
    }
  }

  async function send(m, to, data, token) {
    const p = state.wallet.provider, from = state.account;
    await ensureChain(m);
    await callOn(m, to, data, from); // dry run on the market's chain: a revert is explained before the wallet shows anything
    const cid = Number(BigInt(await p.request({ method: 'eth_chainId' })));
    if (cid !== m.chain.chainId) throw new Error(tt('chainChanged', { id: String(cid) }));
    const checked = await ctx.confirm({ network: `${m.chain.name} (${m.chain.chainId})`, from, to, toLabel: to === m.swapRouter ? `${m.dex} v3 SwapRouter` : token.symbol, value: 0n, symbol: m.chain.nativeCurrency.symbol, data, token, exact: true });
    if (checked == null) throw new Error('cancelled');
    ctx.setStatus('mx-status', tt('confirm'));
    const hash = await p.request({ method: 'eth_sendTransaction', params: [{ from, to, data: checked, chainId: m.chain.chainIdHex }] });
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('wallet returned no transaction hash');
    ctx.setStatus('mx-status', tt('waiting', { hash: short(hash) }));
    for (let i = 0; i < 120; i++) {
      const r = await rpcOn(m, 'eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r) { if (r.status !== '0x1') throw new Error(`reverted ${short(hash)}`); ctx.setStatus('mx-status', tt('done', { hash: short(hash) }), 'ok'); return hash; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    ctx.setStatus('mx-status', tt('waiting', { hash: short(hash) }));
    return hash;
  }

  async function onClick() {
    if (!state.account) { ctx.openWallets(); return; }
    if (!last) return;
    const { m, t, amount, min } = last;
    $('mx-btn').disabled = true;
    busy = true;
    try {
      if (last.approve) await send(m, t.address, M.approveCall(m.swapRouter, amount), t);
      else {
        // the minimum is the one shown to the user: a worse price since then makes the swap revert, never fill lower
        const dl = BigInt(Math.floor(Date.now() / 1000) + prefs.deadline * 60);
        await send(m, m.swapRouter, M.swapCall(m, t, amount, min, state.account, dl), t);
        loadMarket().catch(() => {});
      }
    } finally { busy = false; await update(); }
  }

  /** wallet_watchAsset on the market's chain: the wallet shows its ZTPHY in its token list. */
  async function addToken() {
    if (!state.account) { ctx.openWallets(); return; }
    const m = current;
    await ensureChain(m);
    const ok = await state.wallet.provider.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: m.ztphy.address, symbol: m.ztphy.symbol, decimals: m.ztphy.decimals } } });
    ctx.setStatus('mx-status', '');
    ctx.setStatus('mx-link-status', ok === false ? '' : tt('added'), 'ok');
  }

  // ------------------------------------------------------------------ refreshing while the page is open
  const visible = () => !$('tab-swap')?.hidden && !$('mx-root').hidden && win.document.visibilityState !== 'hidden';
  function startTimers() {
    stopTimers();
    timers.push(setInterval(() => { if (visible() && !busy && $('mx-amount')?.value) update(); }, QUOTE_EVERY));
    timers.push(setInterval(() => { if (visible()) { loadMarket().catch(() => {}); loadSpot(); } }, MARKET_EVERY));
  }
  function stopTimers() { for (const id of timers) clearInterval(id); timers = []; }

  return {
    /** Shows the page: finds the networks (once), then the chosen one; `net` forces one (a link like #base). */
    async show(net = null) {
      if (net) { prefs.net = net; savePrefs(); }
      if (!discovering && ![...found.values()].some((f) => f.status !== 'unknown') && !nativeOpen) {
        renderNets(null);
        discovering = discover().finally(() => { discovering = null; });
        renderNets(null);
      }
      if (discovering) await discovering;
      const id = pick();
      if (current && id === current.id && built === state.lang) { renderNets(id); startTimers(); await update(); return; }
      await select(id);
    },
    refresh() { if (current && built) update(); },
    relabel() { built = null; if (current) select(current.id); else renderNets(pick()); },
    hide() { stopTimers(); },
    get current() { return current?.id ?? (nativeOpen ? NATIVE_ID : null); },
  };
}
