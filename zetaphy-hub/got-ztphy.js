// got-ztphy.html, "Did you get ZTPHY?": the page the push airdrop's announcement links to (docs/AIRDROP.md section 7,
// docs/OUTREACH.md). Anyone types a 0x… or zetaphy1… address, with no wallet: the page reads its balance on ZETAPHY
// mainnet (eth_getBalance on the public RPC, rpc.js) and, once the owner has published the recipient list
// (airdrop-push/manifest.json + shards, tools/push-manifest.mjs), whether the address is on it. It shows the safety
// rules in large text, offers "Add ZETAPHY to your wallet" (wallet_addEthereumChain with network.js addChainParams,
// wallets found as the hub finds them: wallet/wallets.js discoverWallets) and a share button (Web Share API, else the
// clipboard). It never asks a wallet to sign anything or send anything; everything shown is set with textContent.
// Stored: only the chosen language (the hub's own key).
import { keccak256 } from './neuro/src/keccak.js';
import { formatZeta } from './chainlib.js';
import { NETWORKS, addChainParams, netText, noticeUrl } from './network.js';
import { getJson, rpcCall } from './rpc.js';
import { discoverWallets, openInAppLinks } from './wallet/wallets.js';
import { MANIFEST, readAddress, balanceOf, cleanManifest, shardFile, inShard, BSC_ZTPHY, BSC_CHAIN, bscWatchParams } from './got-ztphy-core.js';
import { GOT } from './got-ztphy-i18n.js';

const NET = NETWORKS.mainnet; // the only network
const LANGS = Object.keys(GOT);
const LANG_KEY = 'zetaphy-hub:lang';
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
};
const params = new URLSearchParams(location.search);

function startLang() {
  const q = params.get('lang');
  if (LANGS.includes(q)) return q;
  const s = store.get(LANG_KEY);
  if (LANGS.includes(s)) return s;
  const n = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGS.includes(n) ? n : 'en';
}
let L = startLang();
const t = (k, vars = {}) => (GOT[L][k] ?? GOT.en[k]).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const say = (el, text, cls = '') => { el.textContent = text; el.className = `state ${cls}`.trim(); };

// ------------------------------------------------------------------ the published list (optional)
const listBase = new URL('airdrop-push/', location.href).href;
const shards = new Map();
const missing = (e) => /^HTTP 404$/.test(String(e?.message));
/** manifest.json, clean, or null when there is none yet (or it is malformed: the page then shows balances only). */
const manifest = getJson(new URL(MANIFEST, location.href).href).then(cleanManifest, () => null);
/** true / false, or throws when the list cannot be read. A shard that does not exist holds no address. */
async function onList(evm, m) {
  const f = shardFile(evm, m);
  if (!shards.has(f)) shards.set(f, getJson(listBase + f).catch((e) => { if (missing(e)) return { addresses: [] }; shards.delete(f); throw e; }));
  return inShard(await shards.get(f), evm);
}

// ------------------------------------------------------------------ check an address
const st = { last: null, error: null, busy: false };
let seq = 0;

async function check() {
  const r = readAddress($('addr').value, keccak256);
  const my = ++seq;
  st.last = null;
  st.error = r.error ?? null;
  if (r.error) { render(); return; }
  st.busy = true;
  render();
  let bal = null;
  try { bal = balanceOf(await rpcCall(NET.rpc, 'eth_getBalance', [r.evm, 'latest'])); } catch { /* shown below */ }
  if (my !== seq) return;
  if (bal == null) { st.busy = false; st.error = 'rpcErr'; render(); return; }
  const m = await manifest;
  let on = null, listBad = false;
  if (m) { try { on = await onList(r.evm, m); } catch { listBad = true; } }
  if (my !== seq) return;
  st.busy = false;
  st.last = { ...r, bal, on, listBad, each: m?.each ?? '10' };
  render();
}

function renderResult() {
  const state = $('state');
  const found = $('found');
  found.hidden = !st.last;
  if (st.busy) { say(state, t('checking')); return; }
  if (st.error) { say(state, t(st.error), 'bad'); return; }
  say(state, '');
  const x = st.last;
  if (!x) return;
  $('balanceOf').textContent = t('balanceOf', { addr: x.evm });
  $('balance').textContent = `${formatZeta(x.bal, 6)} ${NET.symbol}`;
  $('same').textContent = t('same', { b32: x.bech32 });
  const list = $('list');
  if (x.listBad) say(list, t('listErr'), 'bad');
  else if (x.on === true) say(list, x.bal === 0n ? `${t('onList', { each: x.each })} ${t('zeroOnList')}` : t('onList', { each: x.each }), 'ok');
  else if (x.on === false) say(list, t('notOnList'));
  else say(list, '');
}

async function renderListInfo() {
  const m = await manifest;
  const box = $('listInfo');
  if (!m) { box.hidden = true; return; }
  const kids = [document.createTextNode(`${t('listInfo', { count: m.count.toLocaleString('en-US'), sha: m.sha256 })} `)];
  if (m.list) {
    const a = document.createElement('a');
    a.href = listBase + m.list;
    a.textContent = t('listFile');
    kids.push(a);
  }
  box.replaceChildren(...kids);
  box.hidden = false;
}

// ------------------------------------------------------------------ wallets: add the network, read the address
const wallets = discoverWallets(window, () => renderWallets());

function renderWallets() {
  const list = wallets.list();
  $('wallets').replaceChildren(...list.map((w) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t('addBtn', { w: w.name });
    b.addEventListener('click', () => addChain(w.provider));
    return b;
  }));
  $('inapp').hidden = list.length > 0;
  $('inappLinks').replaceChildren(...openInAppLinks(location.href).map(({ name, href }) => {
    const a = document.createElement('a');
    a.className = 'btn ghost';
    a.href = href;
    a.rel = 'noopener noreferrer';
    a.textContent = name;
    return a;
  }));
  $('bscWallets').replaceChildren(...list.map((w) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t('bscBtn', { w: w.name });
    b.addEventListener('click', () => addBsc(w.provider));
    return b;
  }));
  if (!list.length && !$('addState').textContent) say($('addState'), t('noWallet'));
  else if (list.length && $('addState').textContent === t('noWallet')) say($('addState'), '');
}

async function addChain(provider) {
  const p = addChainParams(NET);
  try {
    await provider.request({ method: 'wallet_addEthereumChain', params: [p] });
    say($('addState'), t('added'), 'ok');
  } catch {
    say($('addState'), t('refused'), 'bad');
  }
}

/** ZTPHY on BNB Smart Chain into the wallet's token list: switch to chain 56 (add it if the wallet lacks it), then
 *  wallet_watchAsset with the logo. Wallets add a token to the chain they are on, hence the switch first. */
async function addBsc(provider) {
  try {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_CHAIN.chainId }] });
    } catch (e) {
      if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
      await provider.request({ method: 'wallet_addEthereumChain', params: [BSC_CHAIN] });
    }
    const ok = await provider.request({ method: 'wallet_watchAsset', params: bscWatchParams() });
    if (ok === false) throw new Error('declined');
    say($('bscState'), t('bscAdded'), 'ok');
  } catch {
    say($('bscState'), t('refused'), 'bad');
  }
}

async function useMine() {
  const w = wallets.list()[0];
  if (!w) { st.last = null; st.error = 'noWallet'; render(); return; }
  try {
    const accts = await w.provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accts) || !/^0x[0-9a-fA-F]{40}$/.test(String(accts[0]))) throw new Error('none');
    $('addr').value = String(accts[0]);
  } catch {
    st.last = null; st.error = 'refused'; render();
    return;
  }
  await check();
}

// ------------------------------------------------------------------ share
/** The official address of this page (its canonical link), never the copy it was opened from. */
const pageUrl = () => document.querySelector('link[rel="canonical"]')?.href ?? `${location.origin}${location.pathname}`;

async function share() {
  const url = pageUrl();
  const text = t('shareText');
  const box = $('shareBox');
  box.hidden = true;
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title: t('title'), text, url }); say($('shareState'), ''); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const full = `${text} ${url}`;
  try {
    await navigator.clipboard.writeText(full);
    say($('shareState'), t('copied'), 'ok');
  } catch {
    say($('shareState'), t('copyFail'));
    box.value = full;
    box.hidden = false;
    box.select();
  }
}

// ------------------------------------------------------------------ words
function render() {
  document.documentElement.lang = L;
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('addr').placeholder = t('addrPh');
  const nt = netText(L);
  $('risk').textContent = nt.risk;
  $('notice').textContent = nt.notice;
  $('notice').href = noticeUrl(NET, L);
  $('lang').value = L;
  $('bscAddr').textContent = BSC_ZTPHY.address;
  $('bscScan').href = BSC_ZTPHY.scan;
  $('check').disabled = st.busy;
  renderResult();
  renderWallets();
  renderListInfo();
}

$('lang').addEventListener('change', (e) => {
  L = e.target.value;
  store.set(LANG_KEY, L);
  say($('addState'), ''); // a wallet answer in the old language is cleared rather than left untranslated
  say($('shareState'), '');
  say($('bscState'), '');
  $('shareBox').hidden = true;
  render();
});
$('check').addEventListener('click', check);
$('addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
$('mine').addEventListener('click', useMine);
$('share').addEventListener('click', share);
const pre = params.get('a');
if (pre) $('addr').value = pre.slice(0, 64);
render();
if (pre) check();
