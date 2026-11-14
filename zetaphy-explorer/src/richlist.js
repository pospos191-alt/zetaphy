// #/holders: every holder of the native coin ZTPHY, from the daily snapshot (holders.json, published with the
// site by .github/workflows/holders-snapshot.yml; pure parts in src/holders-core.js):
//   - the holder count and the snapshot's block and time ("updated daily"), plus the live count from the bank
//     module (abci_query DenomOwners with count_total)
//   - the project wallets (allocation multisigs, validator, faucet, timelock, guardian, deployer, contracts), the
//     chain modules and everyone else, with their share of the supply
//   - the top 100 with labels, and the distribution by balance bands
//   - a search box: any address's live balance (eth_getBalance)
// When the file is missing, unreadable or old, the page says so plainly and shows the addresses seen in recent
// blocks with live balances (ask.js), as #/ask/holders does.
import { TTL } from './rpc.js';
import { parseSnapshot, snapshotState, bandIndex, denomOwnersRequest, decodeDenomOwners, DENOM_OWNERS_PATH, TOP_N } from './holders-core.js';
import { formatZtphy, formatUnits, groupDigits, toAddress, ago, utcTime, safeText, fromBase64 } from './format.js';
import { bytesToHex } from '../vendor/zetaphy-lib.js';
import { labelOf } from './labels.js';
import { seenHoldersCard } from './ask.js';

export const SNAPSHOT_URL = 'holders.json';

/** The published snapshot: { snap } or { error: 'missing' | message }. */
export async function loadSnapshot(fetchFn = (...a) => fetch(...a)) {
  let res;
  try { res = await fetchFn(SNAPSHOT_URL, { credentials: 'omit', cache: 'no-cache' }); } catch (e) { return { error: 'missing' }; }
  if (res.status === 404) return { error: 'missing' };
  if (!res.ok) return { error: `HTTP ${res.status}` };
  try { return { snap: parseSnapshot(await res.json()) }; } catch (e) { return { error: safeText(e.message, 200) }; }
}

const pct = (x) => (x > 0 && x < 0.0001 ? '<0.0001%' : `${Number(x).toFixed(Number(x) >= 1 ? 2 : 4)}%`);
const shareOf = (part, total) => (BigInt(total) > 0n ? Number((BigInt(part) * 100_000_000n) / BigInt(total)) / 1_000_000 : 0);
const ztphy = (v) => formatUnits(v, 18, { maxFrac: 0 });

export async function pageNativeHolders(view, _param, ui) {
  const { t, h, card, note, table, kv, slot, addrLink, routeLink, api, lang } = ui;
  view.append(h('h1', null, t('nhTitle')), h('p', null, t('nhIntro')));
  const body = h('div', null, ui.loading());
  view.append(body);
  const { snap, error } = await loadSnapshot();
  const parts = [];
  const seen = () => card(t('nhSeenTitle'), slot(seenScan(ui), (x) => x));

  // a label chip from the snapshot (labels.json already shows its own chip next to an address it knows)
  const chip = (addr, l) => (l && !labelOf(addr) ? h('span', { class: ['addr-label', `label-${l.group === 'module' ? 'module' : 'project'}`], title: [t(`nhKind_${l.kind}`), l.note].filter(Boolean).join(' · ') }, l.name) : null);
  const who = (x) => (x.address ? h('span', null, addrLink(x.address), ' ', chip(x.address, x.label)) : h('span', { class: 'mono' }, safeText(x.bech32, 90)));

  const live = slot(api.comet('abci_query', { path: DENOM_OWNERS_PATH, data: bytesToHex(denomOwnersRequest({ limit: 1, countTotal: true })), prove: false }, TTL.minute)
    .then((r) => { if (r?.response?.code) throw new Error(r.response.log); return decodeDenomOwners(fromBase64(r?.response?.value ?? '')).total; }),
  (n) => (n == null ? '—' : groupDigits(n.toString())), { inline: true });

  if (!snap) {
    parts.push(note(error === 'missing' ? t('nhMissing') : t('nhBad', { e: error }), 'warn'),
      card(null, kv([[t('nhHoldersLive'), live]])), searchCard(ui, null), seen());
    body.replaceChildren(...parts);
    return;
  }
  const old = snapshotState(snap) === 'old';
  const when = `${utcTime(snap.time)} (${ago(snap.time, Date.now(), lang)})`;
  if (old) parts.push(note(t('nhOld', { h: groupDigits(snap.height), ago: ago(snap.time, Date.now(), lang) }), 'warn'), seen());
  parts.push(card(null, h('div', { class: 'stats' },
    stat(h, t('nhHolders'), h('span', { class: 'nh-count' }, groupDigits(String(snap.holders))), h('span', null, t('nhHoldersLive'), ': ', live)),
    stat(h, t('nhSnapshot'), routeLink(`block/${snap.height}`, groupDigits(snap.height), { class: 'mono' }), h('span', null, when, ' · ', t('nhDaily'))),
    stat(h, t('nhSupply'), formatZtphy(snap.supply, { maxFrac: 0 }), null))));
  parts.push(searchCard(ui, snap));

  // project wallets / modules / everyone else
  const bar = h('div', { class: 'dist-bar', role: 'img', 'aria-label': ['project', 'module', 'others'].map((g) => `${t(`nhGroup_${g}`)} ${pct(shareOf(snap.groups[g].balance, snap.supply))}`).join(', ') });
  ['project', 'module', 'others'].forEach((g, i) => {
    const d = h('div', { class: `dist-seg dist-${i}`, title: `${t(`nhGroup_${g}`)} · ${pct(shareOf(snap.groups[g].balance, snap.supply))}` });
    d.style.width = `${Math.min(100, shareOf(snap.groups[g].balance, snap.supply))}%`;
    bar.append(d);
  });
  parts.push(card(t('nhGroupsTitle'), bar,
    table([t('nhGroup'), t('nhAddresses'), t('nhBalance'), t('nhShare')], ['project', 'module', 'others'].map((g, i) => [
      h('span', null, h('span', { class: `nh-key dist-${i}`, 'aria-hidden': 'true' }), ' ', t(`nhGroup_${g}`)), groupDigits(String(snap.groups[g].count)),
      `${ztphy(snap.groups[g].balance)} ZTPHY`, pct(shareOf(snap.groups[g].balance, snap.supply))]), { cls: 'nh-groups' }),
    note(t('nhGroupsNote')),
    h('details', { class: 'nh-wallets' }, h('summary', null, t('nhWalletsTitle', { n: groupDigits(String(snap.wallets.length)) })),
      table([t('nhName'), t('address'), t('nhBalance'), t('nhShare'), t('nhRank')], snap.wallets.map((w) => [
        h('span', { title: w.note || null }, w.name, ' ', h('span', { class: 'badge' }, t(`nhKind_${w.kind}`))),
        w.address ? addrLink(w.address) : safeText(w.bech32, 90), `${ztphy(w.balance)} ZTPHY`, pct(shareOf(w.balance, snap.supply)), w.rank ? `#${groupDigits(String(w.rank))}` : '—']), { cls: 'nh-wallet-table' }))));

  // top holders
  parts.push(card(t('nhTopTitle', { n: groupDigits(String(snap.top.length)) }),
    table(['#', t('address'), t('nhBalance'), t('nhShare')], snap.top.map((x) => [String(x.rank), who(x), `${formatUnits(x.balance, 18, { maxFrac: 2 })} ZTPHY`, pct(shareOf(x.balance, snap.supply))]),
      { cls: 'nh-top', empty: t('none') })));

  // bands
  const totalHolders = snap.bands.reduce((s, b) => s + b.count, 0) || 1;
  parts.push(card(t('nhBandsTitle'),
    table([t('nhBand'), t('nhHolders'), t('nhHoldersPct'), t('nhBalance'), t('nhShare')], snap.bands.map((b) => {
      const meter = h('span', { class: 'gasbar' }, (() => { const f = h('span', { class: 'gasbar-fill' }); f.style.width = `${Math.min(100, (100 * b.count) / totalHolders)}%`; return f; })());
      return [bandText(t, b), groupDigits(String(b.count)), h('span', null, pct((100 * b.count) / totalHolders), meter), `${ztphy(b.balance)} ZTPHY`, pct(shareOf(b.balance, snap.supply))];
    }), { cls: 'nh-bands' })));
  parts.push(note(t('nhHow', { h: groupDigits(snap.height) }), 'info'));
  body.replaceChildren(...parts);
}

const stat = (h, label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);

/** "1 to 10", "10,000,000 or more" (whole ZTPHY). */
export function bandText(t, b) {
  const a = groupDigits((BigInt(b.min) / 10n ** 18n).toString());
  return b.max == null ? t('nhBandOpen', { a }) : t('nhBandRange', { a, b: groupDigits((BigInt(b.max) / 10n ** 18n).toString()) });
}

/** The addresses seen in recent blocks, with live balances (ask.js), as a node list. */
async function seenScan(ui) {
  const st = await ui.chain.status();
  const r = await ui.chain.recentTxs(st.height, ui.cfg.scanBlocks);
  return seenHoldersCard(ui, r);
}

/** The search box: any address's live balance, its share of the snapshot's supply, its rank and band there. */
function searchCard(ui, snap) {
  const { t, h, card, note, kv, chain, addrLink } = ui;
  const input = h('input', { type: 'search', class: 'nh-search', placeholder: t('nhSearchPlaceholder'), 'aria-label': t('nhSearchTitle'), autocomplete: 'off', spellcheck: 'false' });
  const out = h('div', { class: 'nh-result', 'aria-live': 'polite' });
  let token = 0;
  async function go(e) {
    e.preventDefault();
    const my = ++token;
    const a = toAddress(input.value);
    if (!a) { out.replaceChildren(note(t('nhSearchBad'), 'warn')); return; }
    out.replaceChildren(ui.loading());
    try {
      const bal = BigInt(await chain.evmCall('eth_getBalance', [a.hex, 'latest']));
      if (my !== token) return;
      const inTop = snap?.top.find((x) => x.address && x.address.toLowerCase() === a.lower);
      const wallet = snap?.wallets.find((w) => w.address && w.address.toLowerCase() === a.lower);
      const rows = [
        [t('address'), addrLink(a.hex, { full: true })],
        [t('nhLiveBalance'), h('strong', null, formatZtphy(bal, { maxFrac: 6 }))],
        wallet ? [t('nhName'), `${wallet.name} (${t(`nhKind_${wallet.kind}`)})`] : null,
      ];
      if (snap) {
        rows.push([t('nhShare'), pct(shareOf(bal, snap.supply))]);
        rows.push([t('nhRank'), inTop ? t('nhInTop', { r: groupDigits(String(inTop.rank)) }) : wallet?.rank ? t('nhInTop', { r: groupDigits(String(wallet.rank)) }) : t('nhNotInTop', { n: groupDigits(String(snap.top.length || TOP_N)) })]);
        rows.push([t('nhBand'), bal > 0n ? bandText(t, snap.bands[bandIndex(bal)] ?? snap.bands[snap.bands.length - 1]) : '—']);
      }
      out.replaceChildren(kv(rows));
    } catch (err) { if (my === token) out.replaceChildren(ui.errorBox(err)); }
  }
  const form = h('form', { class: 'row nh-form', on: { submit: go } }, input, h('button', { type: 'submit' }, t('nhSearchButton')));
  return card(t('nhSearchTitle'), form, out);
}
