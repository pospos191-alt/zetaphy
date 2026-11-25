// The "BNB Chain" tab of the DEX page: a trading view for ZTPHY/USDT on BNB Smart Chain, swapped through the project's
// own PancakeSwap v3 pool (lib/bscswap.js).
//  - left: the pair's price, 24 h stats, a candle / line chart and the recent trades (GeckoTerminal's public API,
//    lib/market.js; display only);
//  - right: the swap box (buy / sell, 25-50-75-Max, flip, slippage and deadline settings, rate, price impact, minimum
//    received, fee, route) and the token's links (contract, pool, add to wallet, explorers).
// What moves funds is read from BNB Chain only: the router, the quoter and the pool are checked on-chain (same factory,
// the factory's pool for the pair is ours), then a fresh quote, a minimum out from the slippage, a dry run and the
// wallet-safety summary; exact approvals only. Every text goes in with textContent.
import * as B from './lib/bscswap.js';
import * as K from './lib/market.js';
import { createChart } from './lib/chart.js';
import { parseUnits, formatUnits } from './lib/abi.js';
import { TEXT } from './bsc-i18n.js';

export { TEXT };

/** A decimal string without trailing zeros after the point ("500.000" -> "500", "0.250" -> "0.25"). */
export const trimDec = (x) => (x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x);
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const SLIPS = [10, 50, 100, 300]; // bps presets
const PREFS = 'zetaphy-dex:bsc';
const QUOTE_EVERY = 15_000, MARKET_EVERY = 60_000;

function loadPrefs(win) {
  try {
    const p = JSON.parse(win.localStorage.getItem(PREFS) ?? '{}');
    const slip = Number.isInteger(p.slip) && p.slip >= 1 && p.slip <= B.MAX_SLIPPAGE_BPS ? p.slip : 100;
    const deadline = Number.isInteger(p.deadline) && p.deadline >= 1 && p.deadline <= 180 ? p.deadline : 20;
    const frame = Object.hasOwn(K.FRAMES, p.frame) ? p.frame : '1H';
    const kind = p.kind === 'line' ? 'line' : 'candle';
    return { slip, deadline, frame, kind };
  } catch { return { slip: 100, deadline: 20, frame: '1H', kind: 'candle' }; }
}

/** The tab. ctx: { state, $, el, setStatus, errorText, openWallets, confirm(o) -> data|null, fetchFn, win } */
export function createBscTab(ctx) {
  const { state, $, el } = ctx;
  const win = ctx.win ?? window;
  const fetchFn = ctx.fetchFn ?? ((...a) => fetch(...a));
  const tt = (k, v = {}) => (TEXT[state.lang]?.[k] ?? TEXT.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));
  const prefs = loadPrefs(win);
  const savePrefs = () => { try { win.localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private window: kept for this visit */ } };
  let built = null, verified = null, seq = 0, last = null, side = 'sell', inverted = false, busy = false;
  let chart = null, market = { stats: null, candles: [], trades: [], err: false }, spot = null, timers = [];
  const bal = { [B.ZTPHY.address]: null, [B.USDT.address]: null };

  // ------------------------------------------------------------------ BNB Chain RPC
  async function rpc(method, params) {
    let err;
    for (const url of B.BSC.rpc) {
      try {
        const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message ?? 'rpc error'), { data: j.error.data });
        return j.result;
      } catch (e) { err = e; if (e.data !== undefined) throw e; }
    }
    throw err;
  }
  const call = (to, data, from) => rpc('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']);

  /** The router and quoter name PancakeSwap's factory, and the factory's pool for the pair is ours. */
  async function verify() {
    if (verified) return verified;
    const why = [];
    for (const [k, a] of [['router', B.PANCAKE.swapRouter], ['quoter', B.PANCAKE.quoterV2], ['pool', B.PANCAKE.pool], ['ZTPHY', B.ZTPHY.address]]) {
      const code = await rpc('eth_getCode', [a, 'latest']);
      if (!code || code === '0x') why.push(`${k}: no code`);
    }
    for (const [k, a] of [['router', B.PANCAKE.swapRouter], ['quoter', B.PANCAKE.quoterV2]]) {
      const f = B.addressOf(await call(a, B.SELECTORS.factory).catch(() => '0x'));
      if (f.toLowerCase() !== B.PANCAKE.factory.toLowerCase()) why.push(`${k}.factory() = ${f}`);
    }
    const pool = B.addressOf(await call(B.PANCAKE.factory, B.getPoolCall()).catch(() => '0x'));
    if (pool.toLowerCase() !== B.PANCAKE.pool.toLowerCase()) why.push(`factory pool = ${pool}`);
    const r = { ok: why.length === 0, why: why.join('; ') };
    if (r.ok) verified = r; // only a pass is remembered; a failure is checked again next time
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
    const pool = B.PANCAKE.pool, z = B.ZTPHY.address;
    const [p, o, tr] = await Promise.allSettled([getJson(K.poolUrl(pool)), getJson(K.ohlcvUrl(pool, prefs.frame, z)), getJson(K.tradesUrl(pool))]);
    const trades = tr.status === 'fulfilled' ? K.parseTrades(tr.value, z) : [];
    let candles = o.status === 'fulfilled' ? K.parseOhlcv(o.value) : [];
    if (!candles.length && trades.length) candles = K.candlesFromTrades(trades, K.FRAMES[prefs.frame].sec);
    market = { stats: p.status === 'fulfilled' ? K.parsePool(p.value, z) : null, candles, trades, err: [p, o, tr].every((x) => x.status === 'rejected') };
    if (built) renderMarket();
  }

  async function loadSpot() {
    try { spot = B.usdtPerZtphy(B.word(await call(B.PANCAKE.pool, '0x3850c7bd'))); } catch { /* the chart's last price is used */ }
    if (built) renderHead();
  }

  const price = () => spot ?? market.stats?.price ?? (market.candles.length ? market.candles[market.candles.length - 1].c : null);

  // ------------------------------------------------------------------ building the page
  const tokenChip = (t) => el('span', { class: 'tok-chip' }, t === B.ZTPHY ? el('img', { src: './logo.svg', alt: '', width: '20', height: '20' }) : el('span', { class: 'tok-ic usdt', text: '₮' }), el('b', { text: t.symbol }));
  const stat = (id, label) => el('div', { class: 'mk-stat' }, el('span', { text: label }), el('b', { id, text: '–' }));
  const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

  function build() {
    const root = $('bsc-root');
    const frames = el('div', { class: 'seg', role: 'group' }, ...Object.keys(K.FRAMES).map((f) => el('button', { type: 'button', class: 'seg-btn', 'data-frame': f, 'aria-pressed': String(f === prefs.frame), text: f })));
    const kinds = el('div', { class: 'seg', role: 'group' }, el('button', { type: 'button', class: 'seg-btn', 'data-kind': 'candle', 'aria-pressed': String(prefs.kind === 'candle'), text: tt('candles') }),
      el('button', { type: 'button', class: 'seg-btn', 'data-kind': 'line', 'aria-pressed': String(prefs.kind === 'line'), text: tt('line') }));
    const head = el('div', { class: 'card mk-head' },
      el('div', { class: 'mk-pair' },
        el('span', { class: 'mk-logos' }, el('img', { src: './logo.svg', alt: '', width: '34', height: '34' }), el('span', { class: 'tok-ic usdt big', text: '₮' })),
        el('div', {}, el('h2', { text: tt('pair') }), el('p', { class: 'hint mk-venue', text: tt('venue') })),
        el('div', { class: 'mk-price' }, el('b', { id: 'bsc-last', text: '–' }), el('span', { id: 'bsc-change', class: 'mk-chg', text: '' }))),
      el('div', { class: 'mk-stats' }, stat('bsc-s-volume', tt('sVolume')), stat('bsc-s-liq', tt('sLiquidity')), stat('bsc-s-trades', tt('sTrades')), stat('bsc-s-change', tt('sChange'))));
    const chartCard = el('div', { class: 'card mk-chart-card' },
      el('div', { class: 'mk-toolbar' }, frames, kinds),
      el('div', { class: 'mk-chart', id: 'bsc-chart' }),
      el('p', { class: 'hint mk-note', id: 'bsc-chart-note', text: tt('dataBy') }));
    const tradesCard = el('div', { class: 'card' }, el('h3', { class: 'mk-h3', text: tt('trades') }),
      el('div', { class: 'mk-table-wrap' }, el('table', { class: 'mk-trades' },
        el('thead', {}, el('tr', {}, ...['tTime', 'tType', 'tPrice', 'tAmount', 'tValue'].map((k) => el('th', { text: tt(k) })), el('th', { text: '' }))),
        el('tbody', { id: 'bsc-trades' }))));

    const slipChips = el('div', { class: 'seg slip-seg' }, ...SLIPS.map((b) => el('button', { type: 'button', class: 'seg-btn', 'data-slip': String(b), text: `${b / 100}%` })),
      el('input', { id: 'bsc-slip-custom', class: 'slip-custom', inputmode: 'decimal', autocomplete: 'off', placeholder: tt('slipCustom'), 'aria-label': tt('slipCustom') }));
    const settings = el('div', { class: 'swap-settings', id: 'bsc-settings', hidden: true },
      el('div', { class: 'set-row' }, el('span', { text: tt('slippage') }), slipChips),
      el('p', { class: 'hint', text: tt('slipHint') }),
      el('label', { class: 'set-row' }, el('span', { text: tt('deadline') }), el('input', { id: 'bsc-deadline', class: 'slip-custom', inputmode: 'numeric', autocomplete: 'off' })),
      el('p', { class: 'status', id: 'bsc-set-status', role: 'status' }),
      el('button', { type: 'button', class: 'ghost small', id: 'bsc-set-done', text: tt('done2') }));
    const pcts = el('div', { class: 'pct-row' }, ...[25, 50, 75, 100].map((p) => el('button', { type: 'button', class: 'ghost small', 'data-pct': String(p), text: p === 100 ? tt('max') : `${p}%` })));
    const swapCard = el('div', { class: 'card swap-card' },
      el('div', { class: 'swap-top' },
        el('div', { class: 'seg side-seg', role: 'group' }, el('button', { type: 'button', class: 'seg-btn buy', id: 'bsc-side-buy', 'aria-pressed': 'false', text: tt('buy') }),
          el('button', { type: 'button', class: 'seg-btn sell', id: 'bsc-side-sell', 'aria-pressed': 'true', text: tt('sell') })),
        el('button', { type: 'button', class: 'ghost icon', id: 'bsc-gear', title: tt('settings'), 'aria-label': tt('settings'), 'aria-expanded': 'false', text: '⚙' })),
      settings,
      el('div', { class: 'field' },
        el('div', { class: 'field-top' }, el('label', { for: 'bsc-amount', text: tt('pay') }), el('button', { type: 'button', class: 'link-btn', id: 'bsc-balance' })),
        el('div', { class: 'row' }, el('input', { id: 'bsc-amount', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0.0' }), el('span', { id: 'bsc-pay-tok' })),
        el('div', { class: 'field-foot' }, el('span', { class: 'hint usd', id: 'bsc-pay-usd' }), pcts)),
      el('div', { class: 'flip-row' }, el('button', { type: 'button', class: 'ghost icon flip-btn', id: 'bsc-flip', title: tt('flip'), 'aria-label': tt('flip'), text: '⇅' })),
      el('div', { class: 'field' },
        el('div', { class: 'field-top' }, el('span', { text: tt('receive') }), el('span', { class: 'hint', id: 'bsc-get-bal' })),
        el('div', { class: 'row' }, el('output', { id: 'bsc-out', class: 'amount-out', text: '0.0' }), el('span', { id: 'bsc-get-tok' })),
        el('div', { class: 'field-foot' }, el('span', { class: 'hint usd', id: 'bsc-get-usd' }))),
      el('div', { class: 'nozt', id: 'bsc-nozt', hidden: true }, el('p', { text: tt('noZtphy') }), el('button', { type: 'button', class: 'ghost small', id: 'bsc-buy-instead', text: tt('buyInstead') })),
      el('p', { class: 'hint', id: 'bsc-quote', 'aria-live': 'polite' }),
      el('dl', { class: 'details', id: 'bsc-details', hidden: true },
        el('dt', { text: tt('rate') }), el('dd', {}, el('button', { type: 'button', class: 'link-btn', id: 'bsc-rate', title: tt('invert') })),
        el('dt', { text: tt('impact') }), el('dd', { id: 'bsc-impact-v' }),
        el('dt', { text: tt('minReceived') }), el('dd', { id: 'bsc-min' }),
        el('dt', { text: tt('fee') }), el('dd', { id: 'bsc-fee' }),
        el('dt', { text: tt('slipShown') }), el('dd', { id: 'bsc-slip-v' }),
        el('dt', { text: tt('route') }), el('dd', { id: 'bsc-route' })),
      el('p', { class: 'hint', id: 'bsc-price' }),
      el('p', { class: 'warn', id: 'bsc-impact', role: 'alert', hidden: true, text: tt('bigImpact') }),
      el('button', { type: 'button', class: 'primary', id: 'bsc-btn', disabled: true, text: tt('swap') }),
      el('p', { class: 'status', id: 'bsc-status', role: 'status' }),
      el('p', { class: 'warn small', role: 'note', text: tt('thin') }),
      el('p', { class: 'hint', text: tt('gas') }));
    const addrRow = (label, a, id) => el('div', { class: 'addr-row' }, el('span', { class: 'hint', text: label }),
      el('a', { href: `${B.BSC.explorer}/${id === 'pool' ? 'address' : 'token'}/${a}`, target: '_blank', rel: 'noopener noreferrer', class: 'mono', text: shortAddr(a) }),
      el('button', { type: 'button', class: 'ghost small', 'data-copy': a, text: tt('copy') }));
    const linksCard = el('div', { class: 'card mk-links' },
      el('h3', { class: 'mk-h3', text: tt('links') }),
      el('p', { class: 'hint', text: tt('lede', { addr: B.ZTPHY.address }) }),
      addrRow(tt('contract'), B.ZTPHY.address, 'token'), addrRow(tt('poolAddr'), B.PANCAKE.pool, 'pool'),
      el('button', { type: 'button', class: 'ghost small', id: 'bsc-add-token', text: tt('addToken') }),
      el('p', { class: 'status', id: 'bsc-link-status', role: 'status' }),
      el('div', { class: 'ext-links' },
        link(`${B.BSC.explorer}/token/${B.ZTPHY.address}`, tt('onBscscan')),
        link(`https://pancakeswap.finance/swap?chain=bsc&inputCurrency=${B.USDT.address}&outputCurrency=${B.ZTPHY.address}`, tt('onPancake')),
        link(`${K.GT.site}${B.PANCAKE.pool.toLowerCase()}`, tt('onGecko')),
        link(`https://dexscreener.com/bsc/${B.PANCAKE.pool.toLowerCase()}`, tt('onDexscreener'))));

    root.replaceChildren(el('div', { class: 'mk-wrap' }, el('div', { class: 'mk-main' }, head, chartCard, tradesCard), el('div', { class: 'mk-side' }, swapCard, linksCard)));
    chart = createChart($('bsc-chart'), { fmtPrice: K.fmtPrice, fmtUsd: K.fmtUsd, label: (c) => tt('chartLabel', { n: c.length }) });

    // events
    for (const b of root.querySelectorAll('[data-frame]')) b.addEventListener('click', () => { prefs.frame = b.dataset.frame; savePrefs(); pressed('[data-frame]', b); loadMarket(); });
    for (const b of root.querySelectorAll('[data-kind]')) b.addEventListener('click', () => { prefs.kind = b.dataset.kind; savePrefs(); pressed('[data-kind]', b); renderMarket(); });
    $('bsc-side-buy').addEventListener('click', () => setSide('buy'));
    $('bsc-side-sell').addEventListener('click', () => setSide('sell'));
    $('bsc-flip').addEventListener('click', () => {
      // the amount you were going to get becomes the amount you pay
      const out = $('bsc-out').dataset.raw;
      setSide(side === 'buy' ? 'sell' : 'buy', out && Number(out) > 0 ? out : null);
    });
    $('bsc-buy-instead').addEventListener('click', () => setSide('buy'));
    $('bsc-amount').addEventListener('input', () => update());
    $('bsc-balance').addEventListener('click', () => usePct(100));
    for (const b of root.querySelectorAll('[data-pct]')) b.addEventListener('click', () => usePct(Number(b.dataset.pct)));
    $('bsc-gear').addEventListener('click', () => toggleSettings());
    $('bsc-set-done').addEventListener('click', () => toggleSettings(false));
    for (const b of root.querySelectorAll('[data-slip]')) b.addEventListener('click', () => { prefs.slip = Number(b.dataset.slip); $('bsc-slip-custom').value = ''; savePrefs(); renderSettings(); update(); });
    $('bsc-slip-custom').addEventListener('input', (e) => {
      const v = Number(String(e.target.value).replace(',', '.'));
      const bps = Math.round(v * 100);
      if (!e.target.value) { ctx.setStatus('bsc-set-status', ''); return; }
      if (!(bps >= 1 && bps <= B.MAX_SLIPPAGE_BPS)) { ctx.setStatus('bsc-set-status', tt('slipBad'), 'err'); return; }
      ctx.setStatus('bsc-set-status', ''); prefs.slip = bps; savePrefs(); renderSettings(true); update();
    });
    $('bsc-deadline').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (!(Number.isInteger(v) && v >= 1 && v <= 180)) { ctx.setStatus('bsc-set-status', tt('deadlineBad'), 'err'); return; }
      ctx.setStatus('bsc-set-status', ''); prefs.deadline = v; savePrefs();
    });
    $('bsc-rate').addEventListener('click', () => { inverted = !inverted; if (last?.view) renderRate(last.view); });
    $('bsc-btn').addEventListener('click', () => onClick().catch((e) => ctx.setStatus('bsc-status', tt('failed', { msg: ctx.errorText(e) }), 'err')));
    for (const b of root.querySelectorAll('[data-copy]')) b.addEventListener('click', async () => {
      try { await win.navigator.clipboard.writeText(b.dataset.copy); b.textContent = tt('copied'); setTimeout(() => { b.textContent = tt('copy'); }, 1500); } catch { /* no clipboard: the address is in the link */ }
    });
    $('bsc-add-token').addEventListener('click', () => addToken().catch((e) => ctx.setStatus('bsc-link-status', tt('failed', { msg: ctx.errorText(e) }), 'err')));
    built = state.lang;
    renderSide();
    renderSettings();
    renderMarket();
    renderHead();
  }

  function pressed(sel, on) { for (const b of $('bsc-root').querySelectorAll(sel)) b.setAttribute('aria-pressed', String(b === on)); }

  function toggleSettings(open) {
    const s = $('bsc-settings'), next = open ?? s.hidden;
    s.hidden = !next;
    $('bsc-gear').setAttribute('aria-expanded', String(next));
  }

  function renderSettings(custom = false) {
    for (const b of $('bsc-root').querySelectorAll('[data-slip]')) b.setAttribute('aria-pressed', String(!custom && Number(b.dataset.slip) === prefs.slip));
    if (!custom && !SLIPS.includes(prefs.slip)) $('bsc-slip-custom').value = String(prefs.slip / 100);
    $('bsc-deadline').value = String(prefs.deadline);
  }

  const tin = () => (side === 'buy' ? B.USDT : B.ZTPHY);

  function setSide(next, amount = null) {
    side = next;
    if (amount !== null) $('bsc-amount').value = amount;
    renderSide();
    update();
  }

  function renderSide() {
    $('bsc-side-buy').setAttribute('aria-pressed', String(side === 'buy'));
    $('bsc-side-sell').setAttribute('aria-pressed', String(side === 'sell'));
    $('bsc-pay-tok').replaceChildren(tokenChip(tin()));
    $('bsc-get-tok').replaceChildren(tokenChip(B.other(tin())));
    $('bsc-btn').classList.toggle('sell', side === 'sell');
  }

  async function usePct(pct) {
    if (!state.account) return;
    const t = tin(), b = bal[t.address] ?? B.word(await call(t.address, B.balanceCall(state.account)).catch(() => '0x0'));
    $('bsc-amount').value = trimDec(formatUnits(K.portion(b, pct), 18, 18).replace(/,/g, '')) || '0';
    update();
  }

  // ------------------------------------------------------------------ rendering the market
  function renderHead() {
    if (!built) return;
    const p = price(), s = market.stats;
    $('bsc-last').textContent = p === null ? '–' : `$${K.fmtPrice(p)}`;
    const ch = s?.change24 ?? null, chg = $('bsc-change');
    chg.textContent = ch === null ? '' : K.fmtPct(ch);
    chg.className = `mk-chg ${ch === null ? '' : ch >= 0 ? 'up' : 'down'}`;
    $('bsc-s-volume').textContent = K.fmtUsd(s?.volume24 ?? null);
    $('bsc-s-liq').textContent = K.fmtUsd(s?.liquidity ?? null);
    $('bsc-s-trades').textContent = s && s.buys24 !== null ? tt('sTradesVal', { b: s.buys24, s: s.sells24 ?? 0 }) : '–';
    const c2 = $('bsc-s-change');
    c2.textContent = K.fmtPct(ch);
    c2.className = ch === null ? '' : ch >= 0 ? 'up' : 'down';
  }

  function renderMarket() {
    if (!built) return;
    renderHead();
    chart.draw(market.candles, { kind: prefs.kind, last: price(), empty: market.err ? tt('chartErr') : tt('noTrades') });
    const body = $('bsc-trades');
    if (!market.trades.length) { body.replaceChildren(el('tr', {}, el('td', { colspan: '6', class: 'hint', text: market.err ? tt('chartErr') : tt('noTradeRows') }))); return; }
    const now = Date.now();
    body.replaceChildren(...market.trades.slice(0, 25).map((r) => el('tr', { class: r.side },
      el('td', { class: 'hint', text: K.ago(r.time, now) }),
      el('td', { class: `side ${r.side}`, text: tt(r.side) }),
      el('td', { class: 'mono', text: `$${K.fmtPrice(r.price)}` }),
      el('td', { class: 'mono', text: K.fmtAmount(r.amount) }),
      el('td', { class: 'mono', text: K.fmtUsd(r.usd) }),
      el('td', {}, r.tx ? link(`${B.BSC.explorer}/tx/${r.tx}`, '↗') : ''))));
  }

  // ------------------------------------------------------------------ the swap box
  const fmt = (v) => formatUnits(v, 18, 6);
  const toNum = (v) => Number(formatUnits(v, 18, 18).replace(/,/g, ''));
  const usdOf = (t, v) => { const n = toNum(v), p = price(); return t === B.USDT ? n : p === null ? null : n * p; };

  function renderRate(view) {
    const { t, out, amount, amountOut } = view;
    const a = toNum(amount), b = toNum(amountOut);
    if (!(a > 0 && b > 0)) return;
    const [x, y, r] = inverted ? [out, t, a / b] : [t, out, b / a];
    $('bsc-rate').textContent = `1 ${x.symbol} = ${K.fmtPrice(r)} ${y.symbol}`;
  }

  async function update() {
    const my = ++seq, t = tin(), out = B.other(t), btn = $('bsc-btn');
    last = null; btn.disabled = true; $('bsc-impact').hidden = true; $('bsc-details').hidden = true; $('bsc-nozt').hidden = true;
    $('bsc-quote').textContent = ''; $('bsc-price').textContent = '';
    $('bsc-out').textContent = '0.0'; delete $('bsc-out').dataset.raw; $('bsc-get-usd').textContent = '';
    let amount;
    try { amount = parseUnits(String($('bsc-amount').value || '').trim(), 18); } catch { amount = 0n; }
    const payUsd = amount > 0n ? usdOf(t, amount) : null;
    $('bsc-pay-usd').textContent = payUsd === null ? '' : `≈ ${K.fmtUsd(payUsd)}`;
    if (state.account) {
      const [bi, bo] = await Promise.all([t, out].map((x) => call(x.address, B.balanceCall(state.account)).then(B.word).catch(() => null)));
      if (my !== seq) return;
      bal[t.address] = bi; bal[out.address] = bo;
      $('bsc-balance').textContent = tt('balance', { b: bi === null ? '–' : `${fmt(bi)} ${t.symbol}` });
      $('bsc-get-bal').textContent = tt('balance', { b: bo === null ? '–' : `${fmt(bo)} ${out.symbol}` });
      // the usual mix-up: ZTPHY on ZETAPHY is not ZTPHY on BNB Chain
      if (side === 'sell' && bi === 0n) $('bsc-nozt').hidden = false;
    } else { $('bsc-balance').textContent = ''; $('bsc-get-bal').textContent = ''; }
    if (!state.account) { btn.textContent = tt('connect'); btn.disabled = false; return; }
    if (amount <= 0n) { btn.textContent = tt('badAmount'); return; }
    const first = !verified; // the on-chain check runs once; a later refresh keeps the last transaction's status
    if (first) ctx.setStatus('bsc-status', tt('checking'));
    const v = await verify();
    if (my !== seq) return;
    if (!v.ok) { ctx.setStatus('bsc-status', tt('unsafe', { why: v.why }), 'err'); return; }
    if (first) ctx.setStatus('bsc-status', '');
    const slip = prefs.slip;
    let q, before;
    try {
      q = B.readQuote(await call(B.PANCAKE.quoterV2, B.quoteCall(t, amount)));
      before = B.word(await call(B.PANCAKE.pool, '0x3850c7bd')); // slot0(): sqrtPriceX96 first
    } catch { if (my === seq) ctx.setStatus('bsc-status', tt('noLiquidity'), 'err'); return; }
    if (my !== seq) return;
    spot = B.usdtPerZtphy(before);
    renderHead();
    const min = B.minOut(q.amountOut, slip), impact = B.impactBps(before, q.sqrtPriceX96After), level = K.impactLevel(impact);
    $('bsc-out').textContent = fmt(q.amountOut);
    $('bsc-out').dataset.raw = trimDec(formatUnits(q.amountOut, 18, 18).replace(/,/g, ''));
    const getUsd = usdOf(out, q.amountOut);
    $('bsc-get-usd').textContent = getUsd === null ? '' : `≈ ${K.fmtUsd(getUsd)}`;
    $('bsc-quote').textContent = tt('get', { out: fmt(q.amountOut), sym: out.symbol, min: fmt(min), slip: slip / 100 });
    $('bsc-price').textContent = tt('price', { p: spot.toFixed(7), i: (impact / 100).toFixed(1) });
    const view = { t, out, amount, amountOut: q.amountOut };
    renderRate(view);
    const iv = $('bsc-impact-v');
    iv.textContent = `${(impact / 100).toFixed(2)}%`;
    iv.className = `impact-${level}`;
    $('bsc-min').textContent = `${fmt(min)} ${out.symbol}`;
    $('bsc-fee').textContent = `${fmt(amount / 100n)} ${t.symbol}`;
    $('bsc-slip-v').textContent = `${slip / 100}%`;
    $('bsc-route').textContent = tt('routeVal', { a: t.symbol, b: out.symbol });
    $('bsc-details').hidden = false;
    $('bsc-impact').hidden = impact <= 1000;
    const have = bal[t.address] ?? B.word(await call(t.address, B.balanceCall(state.account)).catch(() => '0x0'));
    if (my !== seq) return;
    if (have < amount) { btn.textContent = tt('low', { sym: t.symbol }); return; }
    const allowed = B.word(await call(t.address, B.allowanceCall(state.account, B.PANCAKE.swapRouter)).catch(() => '0x0'));
    if (my !== seq) return;
    last = { t, amount, min, approve: allowed < amount, view };
    btn.textContent = last.approve ? tt('approve', { amt: fmt(amount), sym: t.symbol }) : tt('swap');
    btn.disabled = false;
  }

  async function ensureBsc() {
    const p = state.wallet.provider;
    ctx.setStatus('bsc-status', tt('switching'));
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: B.BSC.chainIdHex }] }); } catch (e) {
      if (e?.code === 4001) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: B.BSC.chainIdHex, chainName: B.BSC.name, nativeCurrency: B.BSC.nativeCurrency, rpcUrls: [B.BSC.rpc[0]], blockExplorerUrls: [B.BSC.explorer] }] });
    }
  }

  async function send(to, data, token) {
    const p = state.wallet.provider, from = state.account;
    await ensureBsc();
    await call(to, data, from); // dry run on BSC: a revert is explained before the wallet shows anything
    const cid = Number(BigInt(await p.request({ method: 'eth_chainId' })));
    if (cid !== B.BSC.chainId) throw new Error(tt('chainChanged', { id: String(cid) }));
    const checked = await ctx.confirm({ network: `${B.BSC.name} (${B.BSC.chainId})`, from, to, toLabel: to === B.PANCAKE.swapRouter ? 'PancakeSwap v3 SwapRouter' : token.symbol, value: 0n, symbol: 'BNB', data, token, exact: true });
    if (checked == null) throw new Error('cancelled');
    ctx.setStatus('bsc-status', tt('confirm'));
    const hash = await p.request({ method: 'eth_sendTransaction', params: [{ from, to, data: checked, chainId: B.BSC.chainIdHex }] });
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('wallet returned no transaction hash');
    ctx.setStatus('bsc-status', tt('waiting', { hash: short(hash) }));
    for (let i = 0; i < 120; i++) {
      const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r) { if (r.status !== '0x1') throw new Error(`reverted ${short(hash)}`); ctx.setStatus('bsc-status', tt('done', { hash: short(hash) }), 'ok'); return hash; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    ctx.setStatus('bsc-status', tt('waiting', { hash: short(hash) }));
    return hash;
  }

  async function onClick() {
    if (!state.account) { ctx.openWallets(); return; }
    if (!last) return;
    const { t, amount, min } = last;
    $('bsc-btn').disabled = true;
    busy = true;
    try {
      if (last.approve) await send(t.address, B.approveCall(B.PANCAKE.swapRouter, amount), t);
      else {
        // the minimum is the one shown to the user: a worse price since then makes the swap revert, never fill lower
        const dl = BigInt(Math.floor(Date.now() / 1000) + prefs.deadline * 60);
        await send(B.PANCAKE.swapRouter, B.swapCall(t, amount, min, state.account, dl), t);
        loadMarket().catch(() => {});
      }
    } finally { busy = false; await update(); }
  }

  /** wallet_watchAsset on BNB Chain: the wallet shows ZTPHY (BSC) in its token list. */
  async function addToken() {
    if (!state.account) { ctx.openWallets(); return; }
    await ensureBsc();
    const ok = await state.wallet.provider.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: B.ZTPHY.address, symbol: B.ZTPHY.symbol, decimals: B.ZTPHY.decimals } } });
    ctx.setStatus('bsc-status', '');
    ctx.setStatus('bsc-link-status', ok === false ? '' : tt('added'), 'ok');
  }

  // ------------------------------------------------------------------ refreshing while the tab is open
  const visible = () => !$('tab-bsc')?.hidden && win.document.visibilityState !== 'hidden';
  function startTimers() {
    stopTimers();
    timers.push(setInterval(() => { if (visible() && !busy && $('bsc-amount').value) update(); }, QUOTE_EVERY));
    timers.push(setInterval(() => { if (visible()) { loadMarket().catch(() => {}); loadSpot(); } }, MARKET_EVERY));
  }
  function stopTimers() { for (const id of timers) clearInterval(id); timers = []; }

  return {
    async show() {
      if (built !== state.lang) build();
      startTimers();
      loadMarket().catch(() => {});
      loadSpot();
      await update();
    },
    refresh() { if (built) update(); },
    hide() { stopTimers(); },
  };
}
