// The "ZETAPHY mainnet" card of the Overview (hub.js): every mainnet fact the hub shows is in MAINNET, here only.
// The apps on this site (swap, NFT, staking, faucet…) stay on the testnet (77390); this card only informs.
//   rpc null  -> "Public RPC: coming soon", the "Add to MetaMask" button is disabled
//   rpc set   -> the button asks the wallet to add the chain (wallet_addEthereumChain, chain 0xe4b)
// Published files: zetaphy-chain/mainnet/zetaphy_3659-1/ and docs/ZETAPHY-MAINNET-NOTICE.md (+ .th.md).
import { withFallback } from './i18n.js';
import { MAINNET_TEXT } from './mainnet-i18n.js';

const REPO = 'https://github.com/pospos191-alt/zetaphy';
export const MAINNET = Object.freeze({
  name: 'ZETAPHY',
  chainId: 3659,
  cosmosChainId: 'zetaphy_3659-1',
  symbol: 'ZTPHY',
  decimals: 18,
  genesisSha256: 'ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667',
  genesisTime: '2026-11-13T14:00:00Z',
  rpc: null, // https://<ip-with-dashes>.sslip.io once the public sentry is up
  explorer: null,
  notice: `${REPO}/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md`,
  noticeTh: `${REPO}/blob/main/docs/ZETAPHY-MAINNET-NOTICE.th.md`,
  files: `${REPO}/tree/main/zetaphy-chain/mainnet/zetaphy_3659-1`,
});

/** wallet_addEthereumChain parameters, or null while there is no public RPC. */
export function addChainParams(m = MAINNET) {
  if (!m.rpc) return null;
  return {
    chainId: `0x${m.chainId.toString(16)}`,
    chainName: m.name,
    nativeCurrency: { name: m.name, symbol: m.symbol, decimals: m.decimals },
    rpcUrls: [m.rpc],
    ...(m.explorer ? { blockExplorerUrls: [m.explorer] } : {}),
  };
}

const shortHash = (h) => `${h.slice(0, 8)}…${h.slice(-7)}`;
const utc = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/**
 * Fills `root` with the card. ctx: { el, lang, copyBtn(text), provider() } (hub.js pageCtx-style helpers);
 * m: the facts (MAINNET; tests pass a copy with rpc set). Everything is set as text.
 */
export function renderMainnet(root, ctx, m = MAINNET) {
  const { el } = ctx;
  const t = withFallback(MAINNET_TEXT, ctx.lang);
  const out = el('p', { class: 'msg', role: 'status' });
  const params = addChainParams(m);
  const add = el('button', { type: 'button', class: 'btn sm', id: 'mainnet-add', text: t.add, disabled: !params, 'data-tip': params ? null : t.addSoon, onclick: async () => {
    if (!params) return;
    const p = ctx.provider();
    if (!p) { out.textContent = t.noWallet; out.className = 'msg bad'; return; }
    try { await p.request({ method: 'wallet_addEthereumChain', params: [params] }); out.textContent = t.added; out.className = 'msg ok'; }
    catch (e) { out.textContent = String(e?.message ?? e).slice(0, 200); out.className = 'msg bad'; }
  } });
  const rows = [
    [t.network, `${m.name} mainnet`],
    [t.chainId, `${m.chainId} · ${m.cosmosChainId}`],
    [t.coin, m.symbol],
    [t.genesis, shortHash(m.genesisSha256), m.genesisSha256],
    [t.started, utc(m.genesisTime)],
    [t.rpc, m.rpc ?? t.rpcSoon, m.rpc],
  ];
  root.replaceChildren(
    el('div', { class: 'card-head' }, el('h2', { text: t.title }), el('span', { class: 'info', 'data-tip': t.tip, tabindex: '0', text: 'i' })),
    el('dl', { class: 'kv' }, ...rows.flatMap(([k, v, copy]) => [el('dt', { text: k }), el('dd', { text: v, title: copy ?? v }), copy ? ctx.copyBtn(copy) : el('span')])),
    el('p', { class: 'mainnet-risk', text: t.risk }),
    el('div', { class: 'row mainnet-links' }, add,
      el('a', { href: ctx.lang === 'th' ? m.noticeTh : m.notice, target: '_blank', rel: 'noopener', text: t.notice }),
      el('a', { href: m.files, target: '_blank', rel: 'noopener', text: t.files })),
    el('p', { class: 'dim small', text: t.apps }),
    out);
  return { add, params };
}
