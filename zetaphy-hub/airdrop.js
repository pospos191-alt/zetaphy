// "Claim airdrop" card of the Agents page (agents.js), for a ZtphyMerkleDistributor round (docs/AIRDROP.md).
//   check   anyone's address (or the connected wallet's): read the published list's summary.json and the one shard
//           of that address (shards/<prefix>.json), check the shard's Merkle proof HERE against the root the
//           distributor holds on chain (a list that does not match the contract is refused), then read the window
//           and whether the index is already claimed. Works without a wallet: a public eligibility checker.
//   claim   ZtphyMerkleDistributor.claim(index, account, amount, proof) from the connected wallet. The coins go to
//           the list's account whoever sends it, so the call data is also shown for a relayer / sponsor (people with
//           no ZTPHY for gas yet).
// The list base URL and distributor come from hub-config.json (contracts.airdropDistributor, airdrop.list) or are
// typed in. Nothing is signed except the claim transaction; everything shown is set with textContent.
import { isEvmAddress, short, formatZeta } from './chainlib.js';
import { withFallback } from './i18n.js';
import { AIRDROP } from './airdrop-i18n.js';
import { SEL, shardPath, findClaim, rootOf, encodeClaim, encodeIsClaimed } from './airdrop-core.js';

const L = (ctx) => withFallback(AIRDROP, ctx.lang);
const say = (node, text, cls = '') => { if (node) { node.textContent = text; node.className = `msg ${cls}`; } };
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const val = (id) => document.querySelector(`#${id}`)?.value.trim() ?? '';
const call = (ctx, to, data) => ctx.evmCall('eth_call', [{ to, data }, 'latest']);
const uint = (hex) => BigInt(`0x${String(hex ?? '').replace(/^0x/, '').slice(0, 64) || '0'}`);
const word32 = (hex) => `0x${String(hex ?? '').replace(/^0x/, '').slice(0, 64).padStart(64, '0').toLowerCase()}`;
const errText = (e) => String(e?.message ?? e).slice(0, 200);
const when = (sec) => new Date(Number(sec) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
let keccakFn = null;
const keccak = async () => (keccakFn ??= (await import('./neuro/src/keccak.js')).keccak256);

/** The list's base URL: relative to the site, or https only. */
export function listBase(raw) {
  const s = String(raw || './airdrop/').trim();
  const u = new URL(s.endsWith('/') ? s : `${s}/`, location.href);
  if (u.origin !== location.origin && u.protocol !== 'https:') throw new Error('bad-list-url');
  return u.href;
}
async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let ready = null; // { drop, data, account } of the last check

async function check(ctx) {
  const t = L(ctx);
  const msg = document.querySelector('#ad-msg');
  const out = document.querySelector('#ad-out');
  out.replaceChildren();
  ready = null;
  const drop = val('ad-drop');
  if (!isEvmAddress(drop)) { say(msg, t.badAddr, 'bad'); return; }
  try {
    let who = val('ad-addr');
    if (!who) who = ctx.account() ?? await ctx.connect();
    if (!isEvmAddress(who)) { say(msg, t.badAddr, 'bad'); return; }
    say(msg, t.checking);
    const base = listBase(val('ad-list'));
    const [summary, onRoot] = await Promise.all([getJson(`${base}summary.json`), call(ctx, drop, SEL.merkleRoot)]);
    if (!summary?.root) { say(msg, t.noList, 'bad'); return; }
    if (word32(onRoot) !== String(summary.root).toLowerCase()) { say(msg, t.mismatch, 'bad'); return; }
    const shard = await getJson(`${base}${shardPath(who, summary)}`);
    if (shard && String(shard.root).toLowerCase() !== word32(onRoot)) { say(msg, t.mismatch, 'bad'); return; }
    const c = shard ? findClaim(shard, who) : null;
    if (!c) { say(msg, fill(t.notEligible, { a: short(who, 8, 6) }), 'bad'); return; }
    if (rootOf(await keccak(), c.index, who, c.amount, c.proof) !== word32(onRoot)) { say(msg, t.badProof, 'bad'); return; }
    const [start, deadline, aborted, claimed] = (await Promise.all([SEL.claimStart, SEL.claimDeadline, SEL.aborted, encodeIsClaimed(c.index)].map((d) => call(ctx, drop, d)))).map(uint);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const el = ctx.el;
    out.append(
      el('p', { class: 'ad-amount', id: 'ad-amount', text: fill(t.amount, { z: formatZeta(c.amount, 4) }) }),
      el('p', { class: 'dim small', text: fill(t.window, { from: when(start), to: when(deadline) }) }));
    if (claimed) { say(msg, t.already, 'ok'); return; }
    if (aborted) { say(msg, t.aborted, 'bad'); return; }
    if (now >= deadline) { say(msg, t.ended, 'bad'); return; }
    const data = encodeClaim(c.index, who, c.amount, c.proof);
    ready = { drop, data, account: who };
    const relay = JSON.stringify({ to: drop, data, account: who, amount: `${formatZeta(c.amount, 4)} ZTPHY` }, null, 1);
    out.append(...[
      now < start ? el('p', { class: 'warnline small', text: fill(t.notYet, { from: when(start) }) }) : null,
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', id: 'ad-claim', text: t.claim, disabled: now < start, onclick: () => claim(ctx) })),
      el('p', { class: 'dim small', text: t.gas }),
      el('details', {}, el('summary', { text: t.relayer }), el('div', { class: 'code' }, el('pre', { class: 'mono', text: relay }), ctx.copyBtn(relay)))].filter(Boolean));
    say(msg, fill(t.eligible, { a: short(who, 8, 6) }), 'ok');
  } catch (e) {
    say(msg, e?.message === 'bad-list' || e?.message === 'bad-list-url' ? t.noList : errText(e), 'bad');
  }
}

async function claim(ctx) {
  const t = L(ctx);
  const msg = document.querySelector('#ad-msg');
  if (!ready) return;
  try {
    await ctx.send(ready.drop, ready.data, fill(t.claimAction, { a: short(ready.account, 8, 6) }));
    say(msg, t.claimed, 'ok');
    const b = document.querySelector('#ad-claim');
    if (b) b.disabled = true;
  } catch (e) { say(msg, errText(e), 'bad'); }
}

/** The card (agents.js puts it in the right-hand column). */
export function airdropCard(ctx) {
  const t = L(ctx);
  const el = ctx.el;
  ready = null;
  const input = (id, attrs) => el('input', { id, spellcheck: 'false', autocomplete: 'off', ...attrs });
  return el('div', { class: 'card ag-card', id: 'ad-card' },
    el('div', { class: 'card-head' }, el('h2', { text: t.title }), el('span', { class: 'info', tabindex: 0, 'data-tip': t.tip, text: 'i' })),
    el('p', { class: 'dim small', text: t.intro }),
    el('div', { class: 'sp-form' },
      el('label', { for: 'ad-addr', text: t.address, 'data-tip': t.tipAddress }), input('ad-addr', { class: 'mono', placeholder: t.addressPh }),
      el('label', { for: 'ad-drop', text: t.distributor }), input('ad-drop', { class: 'mono', value: ctx.cfg?.contracts?.airdropDistributor ?? '', placeholder: '0x…' }),
      el('label', { for: 'ad-list', text: t.list, 'data-tip': t.tipList }), input('ad-list', { class: 'mono', value: ctx.cfg?.airdrop?.list ?? './airdrop/' })),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', id: 'ad-check', text: t.check, onclick: () => check(ctx) })),
    el('div', { id: 'ad-out' }),
    el('p', { class: 'msg', id: 'ad-msg', role: 'status', 'aria-live': 'polite' }),
    el('p', { class: 'warnline small', text: t.safety }));
}
