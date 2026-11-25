// The price chart of the "BNB Chain" tab: candles or a line, volume bars, a price axis, the last price, and a crosshair
// with the candle under the pointer. Hand-drawn SVG (the CSP loads no chart library); colours come from CSS classes so
// both themes work. createChart(host, { fmtPrice, fmtUsd, label }) -> { draw(candles, { kind, last, empty }) }.
import { ticks } from './market.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { l: 8, r: 76, t: 12, b: 26 }, VOL = 0.2; // the bottom 20% holds the volume bars
let W = 720, H = 340; // set from the chart's width before each drawing, so the text stays readable on a phone

function s(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function timeLabel(t, span) {
  const d = new Date(t * 1000), p = (n) => String(n).padStart(2, '0');
  return span > 3 * 86400 ? `${p(d.getDate())}/${p(d.getMonth() + 1)}` : `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function createChart(host, { fmtPrice, fmtUsd, label = () => '' } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mk-svg', role: 'img' });
  const tip = document.createElement('div');
  tip.className = 'mk-tip';
  tip.hidden = true;
  host.replaceChildren(svg, tip);
  let state = null, lastArgs = null;

  function size() {
    const w = Math.round(host.clientWidth || 720);
    W = Math.max(320, Math.min(1000, w));
    H = W < 560 ? Math.round(W * 0.78) : Math.round(W * 0.47);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  }

  function draw(candles, opts = {}) {
    lastArgs = [candles, opts];
    const { kind = 'candle', last = null, empty = '' } = opts;
    size();
    svg.replaceChildren();
    tip.hidden = true;
    state = null;
    svg.setAttribute('aria-label', label(candles));
    const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b, priceH = ch * (1 - VOL - 0.04);
    if (!candles.length) {
      if (last !== null) { // no trades yet: the pool's price, flat
        const y = PAD.t + priceH / 2;
        svg.append(s('line', { x1: PAD.l, x2: PAD.l + cw, y1: y, y2: y, class: 'mk-last' }), s('text', { x: W - PAD.r + 6, y: y + 4, class: 'mk-axis mk-last-label' }, fmtPrice(last)));
      }
      svg.append(s('text', { x: PAD.l + cw / 2, y: PAD.t + priceH / 2 - 14, 'text-anchor': 'middle', class: 'mk-empty' }, empty));
      return;
    }
    let lo = Math.min(...candles.map((c) => c.l)), hi = Math.max(...candles.map((c) => c.h));
    if (last !== null) { lo = Math.min(lo, last); hi = Math.max(hi, last); }
    const tk = ticks(lo, hi, 5);
    lo = Math.min(lo, tk[0]); hi = Math.max(hi, tk[tk.length - 1]);
    const y = (p) => PAD.t + priceH - ((p - lo) / (hi - lo || 1)) * priceH;
    const n = candles.length, step = cw / Math.max(n, 1), bw = Math.max(1, Math.min(14, step * 0.7));
    const x = (i) => PAD.l + step * i + step / 2;
    const vmax = Math.max(...candles.map((c) => c.v), 0) || 1, vBase = PAD.t + ch, vH = ch * VOL;

    // grid + price axis
    for (const v of tk) {
      const yy = y(v);
      if (yy < PAD.t - 1 || yy > PAD.t + priceH + 1) continue;
      svg.append(s('line', { x1: PAD.l, x2: PAD.l + cw, y1: yy, y2: yy, class: 'mk-grid' }), s('text', { x: W - PAD.r + 6, y: yy + 4, class: 'mk-axis' }, fmtPrice(v)));
    }
    // time axis: about 6 labels
    const span = candles[n - 1].t - candles[0].t, every = Math.max(1, Math.ceil(n / 6));
    for (let i = Math.floor(every / 2); i < n; i += every) svg.append(s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'mk-axis' }, timeLabel(candles[i].t, span)));
    // volume
    candles.forEach((c, i) => {
      const h = (c.v / vmax) * vH;
      if (h > 0) svg.append(s('rect', { x: x(i) - bw / 2, y: vBase - h, width: bw, height: h, class: c.c >= c.o ? 'mk-vol up' : 'mk-vol down' }));
    });
    // price
    if (kind === 'line') {
      const pts = candles.map((c, i) => `${x(i).toFixed(1)},${y(c.c).toFixed(1)}`);
      svg.append(s('polygon', { points: `${x(0).toFixed(1)},${(PAD.t + priceH).toFixed(1)} ${pts.join(' ')} ${x(n - 1).toFixed(1)},${(PAD.t + priceH).toFixed(1)}`, class: 'mk-area' }));
      svg.append(s('polyline', { points: pts.join(' '), class: 'mk-line' }));
    } else {
      candles.forEach((c, i) => {
        const up = c.c >= c.o, cls = up ? 'up' : 'down';
        svg.append(s('line', { x1: x(i), x2: x(i), y1: y(c.h), y2: y(c.l), class: `mk-wick ${cls}` }));
        const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
        svg.append(s('rect', { x: x(i) - bw / 2, y: top, width: bw, height: Math.max(1, bot - top), class: `mk-body ${cls}` }));
      });
    }
    // the last price
    const lp = last ?? candles[n - 1].c, ly = y(lp), up = lp >= candles[n - 1].o;
    svg.append(s('line', { x1: PAD.l, x2: PAD.l + cw, y1: ly, y2: ly, class: `mk-last ${up ? 'up' : 'down'}` }));
    svg.append(s('rect', { x: W - PAD.r + 2, y: ly - 9, width: PAD.r - 4, height: 18, rx: 3, class: `mk-last-box ${up ? 'up' : 'down'}` }));
    svg.append(s('text', { x: W - PAD.r + 6, y: ly + 4, class: 'mk-last-text' }, fmtPrice(lp)));
    // crosshair
    const cross = s('g', { class: 'mk-cross', visibility: 'hidden' });
    const vx = s('line', { y1: PAD.t, y2: PAD.t + ch, class: 'mk-cross-line' }), hy = s('line', { x1: PAD.l, x2: PAD.l + cw, class: 'mk-cross-line' });
    cross.append(vx, hy);
    svg.append(cross);
    state = { candles, x, y, step, cross, vx, hy };
  }

  function move(ev) {
    if (!state) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const px = ((ev.clientX - r.left) / r.width) * W, py = ((ev.clientY - r.top) / r.height) * H;
    const i = Math.max(0, Math.min(state.candles.length - 1, Math.floor((px - PAD.l) / state.step)));
    const c = state.candles[i], cx = state.x(i);
    state.vx.setAttribute('x1', cx); state.vx.setAttribute('x2', cx);
    state.hy.setAttribute('y1', py); state.hy.setAttribute('y2', py);
    state.cross.setAttribute('visibility', 'visible');
    const d = new Date(c.t * 1000);
    tip.replaceChildren();
    const line = (k, v, cls) => { const p = document.createElement('div'); const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; if (cls) b.className = cls; p.append(a, b); tip.append(p); };
    const head = document.createElement('div'); head.className = 'mk-tip-head'; head.textContent = d.toLocaleString(); tip.append(head);
    const cls = c.c >= c.o ? 'up' : 'down';
    line('O', fmtPrice(c.o), cls); line('H', fmtPrice(c.h), cls); line('L', fmtPrice(c.l), cls); line('C', fmtPrice(c.c), cls); line('Vol', fmtUsd(c.v));
    tip.hidden = false;
    // keep the box inside the chart, on the side away from the pointer
    const left = (cx / W) * r.width;
    tip.style.left = left > r.width / 2 ? `${Math.max(4, left - tip.offsetWidth - 12)}px` : `${left + 12}px`;
    tip.style.top = '8px';
  }
  function leave() { if (state) state.cross.setAttribute('visibility', 'hidden'); tip.hidden = true; }
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
  // redrawn at the new width when the window or the layout changes
  if (typeof ResizeObserver === 'function') {
    let w = 0;
    new ResizeObserver(() => { const nw = Math.round(host.clientWidth); if (nw && nw !== w && lastArgs) { w = nw; draw(...lastArgs); } }).observe(host);
  }

  return { draw };
}
