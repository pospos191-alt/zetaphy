// The "ZETAPHY mainnet" card (mainnet.js): the facts, rpc null (coming soon, button disabled) and rpc set
// (the button adds chain 0xe4b), and its words in all 8 languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAINNET, addChainParams, renderMainnet } from '../mainnet.js';
import { MAINNET_TEXT } from '../mainnet-i18n.js';
import { LANG_CODES } from '../i18n.js';

// a tiny stand-in for hub.js el(): plain objects, enough to read the card back
const el = (tag, attrs = {}, ...kids) => {
  const n = { tag, attrs: {}, kids: kids.flat().filter((k) => k != null), text: '', className: attrs.class ?? '', on: {} };
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') n.text = v; else if (k.startsWith('on')) n.on[k.slice(2)] = v; else n.attrs[k] = v === true ? '' : v;
  }
  Object.defineProperty(n, 'textContent', { get: () => n.text + n.kids.map((k) => k.textContent).join(' '), set: (v) => { n.text = v; } });
  return n;
};
const card = (lang, m, provider = () => null) => {
  const root = { replaceChildren(...k) { this.kids = k; }, get textContent() { return this.kids.map((k) => k.textContent).join(' '); } };
  const r = renderMainnet(root, { el, lang, copyBtn: (text) => el('button', { class: 'copy', 'data-copy': text }), provider }, m);
  return { root, ...r };
};
const find = (n, pred) => (pred(n) ? n : (n.kids ?? []).map((k) => find(k, pred)).find(Boolean));

test('the mainnet facts', () => {
  assert.deepEqual([MAINNET.chainId, MAINNET.cosmosChainId, MAINNET.symbol, MAINNET.decimals], [3659, 'zetaphy_3659-1', 'ZTPHY', 18]);
  assert.match(MAINNET.genesisSha256, /^[0-9a-f]{64}$/);
  assert.equal(MAINNET.genesisSha256, 'ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667');
  assert.equal(MAINNET.genesisTime, '2026-11-13T14:00:00Z');
  assert.ok(Object.isFrozen(MAINNET));
  for (const k of ['notice', 'noticeTh', 'files']) assert.match(MAINNET[k], /^https:\/\/github\.com\/pospos191-alt\/zetaphy\/(blob|tree)\/main\//, k);
});

test('the published public RPC is the sentry', () => {
  assert.equal(MAINNET.rpc, 'https://129-221-199-191.sslip.io');
});

test('rpc null: "coming soon", the Add to MetaMask button is disabled and asks nothing', async () => {
  const m0 = { ...MAINNET, rpc: null };
  assert.equal(addChainParams(m0), null);
  let asked = 0;
  const c = card('en', m0, () => ({ request: async () => { asked++; } }));
  assert.equal(c.params, null);
  assert.ok('disabled' in c.add.attrs, 'disabled');
  assert.equal(c.add.attrs['data-tip'], MAINNET_TEXT.en.addSoon);
  const text = c.root.textContent;
  for (const s of ['Public RPC', 'coming soon', '3659 · zetaphy_3659-1', 'ZTPHY', 'ca0efb15…0a94667', '2026-11-13 14:00 UTC', MAINNET_TEXT.en.risk]) assert.ok(text.includes(s), s);
  assert.ok(find(c.root.kids[1], (n) => n.attrs?.['data-copy'] === MAINNET.genesisSha256), 'the full genesis hash is copied');
  assert.ok(find(c.root.kids[3], (n) => n.attrs?.href === MAINNET.notice), 'notice link');
  assert.ok(find(c.root.kids[3], (n) => n.attrs?.href === MAINNET.files), 'genesis folder link');
  await c.add.on.click();
  assert.equal(asked, 0);
});

test('rpc set: the button adds chain 0xe4b (ZETAPHY, ZTPHY, 18) with that RPC', async () => {
  const rpc = 'https://203-0-113-7.sslip.io';
  const m = { ...MAINNET, rpc };
  const want = { chainId: '0xe4b', chainName: 'ZETAPHY', nativeCurrency: { name: 'ZETAPHY', symbol: 'ZTPHY', decimals: 18 }, rpcUrls: [rpc] };
  assert.deepEqual(addChainParams(m), want);
  assert.deepEqual(addChainParams({ ...m, explorer: 'https://x.example' }).blockExplorerUrls, ['https://x.example']);
  const calls = [];
  const c = card('th', m, () => ({ request: async (a) => { calls.push(a); return null; } }));
  assert.ok(!('disabled' in c.add.attrs));
  assert.ok(c.root.textContent.includes(rpc));
  assert.ok(!c.root.textContent.includes(MAINNET_TEXT.th.rpcSoon));
  assert.ok(find(c.root.kids[3], (n) => n.attrs?.href === MAINNET.noticeTh), 'Thai notice for Thai');
  await c.add.on.click();
  assert.deepEqual(calls, [{ method: 'wallet_addEthereumChain', params: [want] }]);
  const out = c.root.kids.at(-1);
  assert.equal(out.text, MAINNET_TEXT.th.added);
  // no wallet: says so, asks nothing
  const none = card('en', m);
  await none.add.on.click();
  assert.equal(none.root.kids.at(-1).text, MAINNET_TEXT.en.noWallet);
});

test('every language has every text; the risk sentence is translated and keeps the facts', () => {
  assert.deepEqual(Object.keys(MAINNET_TEXT).sort(), [...LANG_CODES].sort());
  const keys = Object.keys(MAINNET_TEXT.en).sort();
  for (const l of LANG_CODES) {
    assert.deepEqual(Object.keys(MAINNET_TEXT[l]).sort(), keys, l);
    for (const [k, v] of Object.entries(MAINNET_TEXT[l])) assert.ok(typeof v === 'string' && v.trim(), `${l}.${k}`);
    if (l !== 'en') for (const k of ['risk', 'tip', 'apps', 'addSoon']) assert.notEqual(MAINNET_TEXT[l][k], MAINNET_TEXT.en[k], `${l}.${k}: translated`);
    assert.match(MAINNET_TEXT[l].risk, /ZETAPHY/);
    assert.match(MAINNET_TEXT[l].apps, /77390/);
    assert.match(MAINNET_TEXT[l].add, /MetaMask/);
  }
});
