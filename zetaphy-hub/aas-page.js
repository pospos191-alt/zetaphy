// Shared by the Audit-as-a-Service pages (audit.html: aas-verify.js, audits.html: aas-directory.js): language,
// the network (network.js: mainnet by default, the testnet with the switch), hub-config.json, DOM helpers.
// Everything goes in with textContent; no inline styles (CSP style-src 'self'; network.js sets element.style only).
import { pickLang, locale, withFallback } from './i18n.js';
import { AAS } from './aas-i18n.js';
import { activeNetwork, hasFeature, networkBadge, testnetOnlyBox, watchNetwork, withDeployed } from './network.js';

const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
export const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, x) => (x in vars ? String(vars[x]) : m));
export const page = {
  lang: pickLang(new URLSearchParams(globalThis.location?.search ?? '').get('lang') ?? store.get('zetaphy-hub:lang')),
  get L() { return withFallback(AAS, this.lang); },
};
export const T = (k, vars) => fmt(page.L[k] ?? k, vars);
export const when = (t) => (t && BigInt(t) !== 0n ? new Date(Number(t) * 1000).toLocaleString(locale(page.lang)) : '–');

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

/**
 * The page's network, its node and the addresses this page needs from hub-config.json (public data); anything
 * malformed is ignored. The testnet: the top level (the testnet's deployment records), as before. Mainnet: only
 * hub-config.json `mainnet` (build.mjs mainnetHub), never a testnet address; `gated` while the audit network has no
 * contracts there (network.js FEATURE_CONTRACTS: then "testnet only for now", and no contract is called).
 * `fetchImpl` / `net` are passed by tests.
 */
export async function loadConfig({ fetchImpl = globalThis.fetch, net = activeNetwork() } = {}) {
  const ok = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
  const out = { net, node: net.testnet ? 'https://rpc.sawasdeecoin.com' : net.rpc, certificate: null, network: null, mirrors: [], gated: false };
  let cfg = null;
  try { cfg = await (await fetchImpl('./hub-config.json', { cache: 'no-store', credentials: 'omit' })).json(); } catch { /* defaults: nothing deployed */ }
  const m = !net.testnet && cfg?.mainnet?.chainId === net.chainId ? cfg.mainnet : null;
  const c = net.testnet ? cfg?.contracts : m?.contracts;
  if (!net.testnet) out.net = withDeployed(net, c);
  if (net.testnet && /^https:\/\/[^/\s"<>]+$/.test(cfg?.node ?? '')) out.node = cfg.node;
  if (ok(c?.auditCertificate)) out.certificate = c.auditCertificate.toLowerCase();
  if (ok(c?.auditNetwork)) out.network = c.auditNetwork.toLowerCase();
  // the Neuro oracle's mirrors are the testnet's (hub-config.json `immune`)
  if (net.testnet) out.mirrors = (cfg?.immune?.mirrors ?? []).filter((x) => ok(x?.oracle) && Number.isInteger(x.chainId)).map((x) => ({ chainId: x.chainId, oracle: x.oracle.toLowerCase() }));
  out.gated = !hasFeature(out.net, 'audit');
  if (out.gated) { out.certificate = null; out.network = null; }
  return out;
}

/**
 * #net: the network badge with the switch and, where the audit network is not on this network, "testnet only for
 * now" with a one-click switch; while gated the page's own parts ([data-needs-net]) are hidden and nothing is read.
 * On mainnet the testnet note is hidden (the badge says what mainnet is).
 */
export function showNetwork(cfg) {
  const box = document.getElementById('net');
  if (!box) return;
  box.replaceChildren(networkBadge(document, { lang: page.lang, net: cfg.net }), ...(cfg.gated ? [testnetOnlyBox(document, { lang: page.lang, feature: 'audit' })] : []));
  for (const n of document.querySelectorAll('[data-needs-net]')) n.hidden = cfg.gated;
  for (const n of document.querySelectorAll('[data-t="testnet"]')) n.hidden = !cfg.net.testnet;
}
/** Another tab switched the network: reload (network.js), so this page never mixes the two. */
export const followNetwork = () => watchNetwork(globalThis);

/** Fills [data-t] texts and wires the language menu; onChange re-renders the page's dynamic parts. */
export function setupLang(onChange) {
  const apply = () => {
    document.documentElement.lang = page.lang;
    for (const n of document.querySelectorAll('[data-t]')) n.textContent = T(n.dataset.t);
    document.getElementById('lang').value = page.lang;
  };
  apply();
  document.getElementById('lang').addEventListener('change', (e) => { page.lang = pickLang(e.target.value); store.set('zetaphy-hub:lang', page.lang); apply(); onChange(); });
}

export const short = (a) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
