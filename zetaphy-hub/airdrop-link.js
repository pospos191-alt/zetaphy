// airdrop-link.html: an SWD holder links the Solana wallet that holds SWD to a ZETAPHY (0x) address for the ZTPHY
// airdrop round 1 (docs/AIRDROP-ROUND1.md). The page connects a Solana wallet, builds the exact link message for
// chain 3659, asks the wallet to sign that text (signMessage), checks the signature here with the rules of
// zetaphy-network/airdrop/link.js, and opens the GitHub issue form .github/ISSUE_TEMPLATE/airdrop-link.yml filled in.
// It only ever asks a wallet to connect and to sign a plain-text message: it never asks for a recovery phrase or a
// key, and never builds, signs or sends a transaction. Nothing is stored except the chosen language.
import { keccak256 } from './neuro/src/keccak.js';
import { CHAIN_ID, SNAPSHOT, DEADLINE, linkMessage, evmProblem, checksum, verifyLink, signatureOf, encodeBase58, issueUrl } from './airdrop-link-core.js';
import { LINK } from './airdrop-link-i18n.js';

const LANGS = Object.keys(LINK);
const LANG_KEY = 'zetaphy-hub:lang'; // the hub's own choice, so the page opens in the hub's language
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
};

function startLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) return q;
  const s = store.get(LANG_KEY);
  if (LANGS.includes(s)) return s;
  const n = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGS.includes(n) ? n : 'en';
}
let L = startLang();
const t = (k, vars = {}) => (LINK[L][k] ?? LINK.en[k]).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');

// ------------------------------------------------------------------ state
const st = { wallet: null, name: '', owner: '', evm: '', sig: '', solMsg: null, evmMsg: null, signMsg: null };
const say = (el, text, cls = '') => { el.textContent = text; el.className = `state ${cls}`.trim(); };

function when(iso) {
  const d = new Date(iso);
  const loc = L === 'en' ? 'en-GB' : L;
  let local = '';
  try { local = d.toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' }); } catch { /* old browser */ }
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC${local ? ` (${local})` : ''}`;
}

/** Solana wallets this browser has (each provider once). */
function providers() {
  const out = [];
  const add = (name, p) => { if (p && typeof p.signMessage === 'function' && typeof p.connect === 'function' && !out.some((x) => x.p === p)) out.push({ name, p }); };
  add('Phantom', window.phantom?.solana);
  add('Solflare', window.solflare);
  add('Backpack', window.backpack?.solana ?? window.backpack);
  const s = window.solana;
  if (s) add(s.isPhantom ? 'Phantom' : s.isSolflare ? 'Solflare' : s.isBackpack ? 'Backpack' : 'Solana', s);
  return out;
}
const keyOf = (pk) => (pk ? (typeof pk.toBase58 === 'function' ? pk.toBase58() : String(pk)) : '');

function renderWallets() {
  const box = $('wallets');
  const list = providers();
  box.replaceChildren(...list.map(({ name, p }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t('connect', { w: name });
    b.addEventListener('click', () => connect(name, p));
    return b;
  }));
  if (!st.owner) say($('solState'), list.length ? '' : t('noWallet'), list.length ? '' : 'bad');
}

async function connect(name, p) {
  try {
    const r = await p.connect();
    const owner = keyOf(r?.publicKey ?? p.publicKey);
    if (!owner) throw new Error('no key');
    Object.assign(st, { wallet: p, name, owner });
    clearSig();
    say($('solState'), t('connected', { a: owner }), 'ok');
  } catch {
    say($('solState'), t('refused'), 'bad');
  }
  update();
}

/** The typed address -> its EIP-55 form, or a reason. */
function readEvm() {
  const raw = $('evm').value.trim();
  if (!raw) return { evm: '', bad: null };
  const bad = evmProblem(raw, keccak256);
  if (bad) return { evm: '', bad };
  return { evm: checksum(raw, keccak256), bad: null };
}
const EVM_WORDS = { 'bad-address': 'badAddr', 'bad-checksum': 'badChecksum', 'zero-address': 'badTarget', 'known-non-user': 'badTarget', 'precompile-or-reserved': 'badTarget' };

function clearSig() {
  st.sig = '';
  $('submit').hidden = true;
  $('sig').value = '';
  $('open').removeAttribute('href');
  say($('signState'), '');
}

function update() {
  const { evm, bad } = readEvm();
  if (evm !== st.evm) { st.evm = evm; clearSig(); }
  if (bad) say($('evmState'), t(EVM_WORDS[bad] ?? 'badAddr'), 'bad');
  else if (evm && $('evm').value.trim() !== evm) say($('evmState'), evm, 'ok'); // shown in checksum form
  else say($('evmState'), '');
  const ready = Boolean(st.owner && st.evm);
  $('message').textContent = ready ? linkMessage(st.owner, st.evm, keccak256, CHAIN_ID) : `ZETAPHY airdrop: link <${st.owner || 'Solana'}> to <${st.evm || '0x…'}> on ${CHAIN_ID}`;
  $('sign').disabled = !ready;
}

async function useEvm() {
  const eth = window.ethereum;
  if (!eth?.request) { say($('evmState'), t('noEvm'), 'bad'); return; }
  try {
    const accts = await eth.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accts) || !accts[0]) throw new Error('none');
    $('evm').value = checksum(String(accts[0]), keccak256);
  } catch {
    say($('evmState'), t('noEvm'), 'bad');
    return;
  }
  update();
}

async function sign() {
  update();
  if (!st.owner || !st.evm) { say($('signState'), t('needAll'), 'bad'); return; }
  const message = linkMessage(st.owner, st.evm, keccak256, CHAIN_ID);
  const { owner, evm, wallet } = st;
  say($('signState'), t('signing'));
  let res;
  try { res = await wallet.signMessage(new TextEncoder().encode(message), 'utf8'); } catch { say($('signState'), t('refused'), 'bad'); return; }
  if (st.owner !== owner || st.evm !== evm) return; // changed while the wallet was open
  if (res?.publicKey && keyOf(res.publicKey) !== owner) { say($('signState'), t('otherKey'), 'bad'); return; }
  const bytes = signatureOf(res);
  if (!bytes) { say($('signState'), t('refused'), 'bad'); return; }
  const signature = encodeBase58(bytes);
  const v = await verifyLink({ solana: owner, evm, signature }, keccak256, CHAIN_ID);
  if (!v.ok) { say($('signState'), t('badSig'), 'bad'); return; }
  st.sig = signature;
  $('sig').value = signature;
  $('open').href = issueUrl({ solana: owner, evm: v.evm, signature });
  $('submit').hidden = false;
  say($('signState'), t('signed'), 'ok');
}

function render() {
  document.documentElement.lang = L;
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('evm').placeholder = t('evmPh');
  $('dates').textContent = t('dates', { snap: when(SNAPSHOT), deadline: when(DEADLINE) });
  const closed = Date.now() > Date.parse(DEADLINE);
  $('closed').hidden = !closed;
  $('closed').textContent = closed ? t('closed', { deadline: when(DEADLINE) }) : '';
  $('lang').value = L;
  renderWallets();
  if (st.owner) say($('solState'), t('connected', { a: st.owner }), 'ok');
  if (st.sig) say($('signState'), t('signed'), 'ok');
  update();
}

$('lang').addEventListener('change', (e) => { L = e.target.value; store.set(LANG_KEY, L); render(); });
$('evm').addEventListener('input', update);
$('useEvm').addEventListener('click', useEvm);
$('sign').addEventListener('click', sign);
render();
// wallet extensions sometimes inject after the page has loaded
window.addEventListener('load', renderWallets);
setTimeout(renderWallets, 800);
