// network.js: the one network definition every app reads (mainnet by default, the testnet selectable), its
// feature gating ("testnet only for now"), the remembered switch, and its words in the 8 languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NETWORKS, DEFAULT_NETWORK, NETWORK_KEY, FEATURES, NATIVE_ERC20, readNetworkId, hasFeature, contractsOf, netKey, addChainParams,
  noticeUrl, NET_TEXT, FEATURE_NAME, netText, wrongChainText, networkBadge, testnetOnlyBox, networkSelect, isNetworkId, linkExplorer,
} from '../network.js';
import { MAINNET, addChainParams as cardParams } from '../mainnet.js';
import { MAINNET_TEXT } from '../mainnet-i18n.js';
import { LANG_CODES } from '../i18n.js';

const repo = (p) => new URL(`../../${p}`, import.meta.url);
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('mainnet is the default network; the two networks\' ids, RPCs and explorer', () => {
  assert.equal(DEFAULT_NETWORK, 'mainnet');
  const { mainnet: m, testnet: t } = NETWORKS;
  assert.deepEqual([m.chainId, m.chainIdHex, m.cosmosChainId, m.symbol, m.denom, m.decimals, m.minGasPrice, m.bech32],
    [3659, '0xe4b', 'zetaphy_3659-1', 'ZTPHY', 'azetaphy', 18, 1_000_000_000, 'zetaphy']);
  assert.deepEqual([m.rpc, m.comet, m.rest, m.explorer], ['https://129-221-199-191.sslip.io', 'https://129-221-199-191.sslip.io/rpc', 'https://129-221-199-191.sslip.io/rest', null]);
  assert.deepEqual([t.chainId, t.chainIdHex, t.cosmosChainId, t.rpc, t.explorer], [77390, '0x12e4e', 'zetaphy_77390-1', 'https://rpc.sawasdeecoin.com', 'https://explorer.sawasdeecoin.com']);
  for (const n of [m, t]) {
    assert.equal(`0x${n.chainId.toString(16)}`, n.chainIdHex);
    assert.ok(Object.isFrozen(n) && Object.isFrozen(n.features));
  }
  assert.ok(Object.isFrozen(m.contracts));
  assert.equal(m.genesisSha256, readFileSync(repo('zetaphy-chain/mainnet/zetaphy_3659-1/genesis.sha256'), 'utf8').trim().split(/\s+/)[0]);
  // the hub's mainnet card reads the same facts
  for (const k of ['chainId', 'cosmosChainId', 'symbol', 'decimals', 'genesisSha256', 'genesisTime', 'rpc', 'explorer', 'notice', 'noticeTh', 'files']) assert.equal(MAINNET[k], m[k], k);
  assert.deepEqual(addChainParams(m), cardParams());
  assert.deepEqual(addChainParams(m), { chainId: '0xe4b', chainName: 'ZETAPHY', nativeCurrency: { name: 'ZETAPHY', symbol: 'ZTPHY', decimals: 18 }, rpcUrls: ['https://129-221-199-191.sslip.io'] });
  assert.deepEqual(addChainParams(t).blockExplorerUrls, ['https://explorer.sawasdeecoin.com']);
});

test('mainnet\'s contracts are the deployed ones (zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json)', () => {
  const d = JSON.parse(readFileSync(repo('zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json'), 'utf8'));
  const c = NETWORKS.mainnet.contracts;
  assert.equal(d.chainId, 3659);
  assert.deepEqual({ neuroControl: c.neuroControl, neuroJobs: c.neuroJobs, threatRegistry: c.threatRegistry, threatReports: c.threatReports, factory: c.factory, router: c.router, bugBounty: c.bugBounty },
    { neuroControl: d.contracts.NeuroControl, neuroJobs: d.contracts.NeuroJobs, threatRegistry: d.contracts.ThreatRegistry, threatReports: d.contracts.ThreatReports,
      factory: d.contracts.ZetaphyFactory, router: d.contracts.ZetaphyRouter, bugBounty: d.contracts.ZetaphyBounty });
  assert.equal(c.timelock, d.timelock.address);
  assert.equal(c.guardian, d.guardianMultisig.address);
  assert.equal(c.wnative, NATIVE_ERC20);
  // never one of the first run's unused addresses, never a testnet address
  const testnet = [JSON.parse(readFileSync(repo('zetaphy-dex/web/deployments.json'), 'utf8')).contracts, JSON.parse(readFileSync(repo('zetaphy-explorer/config.json'), 'utf8'))]
    .flatMap((o) => Object.values(o)).filter((v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && v !== NATIVE_ERC20).map((v) => v.toLowerCase());
  for (const [k, a] of Object.entries(c)) {
    assert.match(a, /^0x[0-9a-fA-F]{40}$/, k);
    assert.ok(!Object.values(d.notUsed).map((x) => String(x).toLowerCase()).includes(a.toLowerCase()), `${k} is an unused first-run address`);
    if (a !== NATIVE_ERC20) assert.ok(!testnet.includes(a.toLowerCase()), `${k} is a testnet address`);
  }
  // the testnet's addresses stay in the apps' deployment files
  assert.equal(NETWORKS.testnet.contracts, null);
  assert.deepEqual(contractsOf(NETWORKS.testnet, { factory: '0x1' }), { factory: '0x1' });
  assert.deepEqual(contractsOf(NETWORKS.mainnet, { factory: '0x1' }).factory, c.factory, 'mainnet never takes the testnet\'s');
});

test('features: mainnet has the wallet, staking, governance, explorer, Neuro and the DEX; the rest is testnet only for now', () => {
  const on = ['wallet', 'staking', 'governance', 'explorer', 'neuro', 'dex'];
  const off = ['nft', 'dlmm', 'bridge', 'faucet', 'mining', 'usefulWork', 'testTokens', 'stableGateway', 'rewardVault', 'computeMarket', 'identity', 'quantumWallet', 'airdrop'];
  for (const f of on) assert.equal(hasFeature(NETWORKS.mainnet, f), true, f);
  for (const f of off) assert.equal(hasFeature(NETWORKS.mainnet, f), false, f);
  for (const f of FEATURES) assert.equal(hasFeature(NETWORKS.testnet, f), true, f);
  assert.equal(hasFeature(NETWORKS.mainnet, 'nope'), false);
  assert.equal(hasFeature(NETWORKS.testnet, 'nope'), false, 'an unknown feature is never on');
});

test('the switch: ?network= wins and is remembered, then the saved choice, else mainnet; storage errors fall back', () => {
  assert.equal(readNetworkId({}), 'mainnet');
  assert.equal(readNetworkId({ storage: mem() }), 'mainnet');
  assert.equal(readNetworkId({ storage: mem({ [NETWORK_KEY]: 'testnet' }) }), 'testnet');
  assert.equal(readNetworkId({ storage: mem({ [NETWORK_KEY]: 'devnet' }) }), 'mainnet', 'unknown values are ignored');
  const s = mem({ [NETWORK_KEY]: 'testnet' });
  assert.equal(readNetworkId({ storage: s, search: '?tab=swap&network=mainnet' }), 'mainnet');
  assert.equal(s.m.get(NETWORK_KEY), 'mainnet', 'a link\'s choice is remembered');
  assert.equal(readNetworkId({ storage: s, search: '?network=<script>' }), 'mainnet');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readNetworkId({ storage: broken }), 'mainnet');
  assert.equal(readNetworkId({ storage: broken, search: '?network=testnet' }), 'testnet');
  assert.ok(isNetworkId('mainnet') && isNetworkId('testnet') && !isNetworkId('x'));
  // per-network storage keys: the testnet keeps the keys it always had
  assert.equal(netKey(NETWORKS.testnet, 'zetaphy-wallet:rpc'), 'zetaphy-wallet:rpc');
  assert.equal(netKey(NETWORKS.mainnet, 'zetaphy-wallet:rpc'), 'zetaphy-wallet:rpc:mainnet');
});

test('words: 8 languages, the same keys, the notice\'s own risk sentence, and wrong-chain text that names the page\'s network', () => {
  assert.deepEqual(Object.keys(NET_TEXT).sort(), [...LANG_CODES].sort());
  assert.deepEqual(Object.keys(FEATURE_NAME).sort(), [...LANG_CODES].sort());
  const keys = Object.keys(NET_TEXT.en).sort(), fkeys = Object.keys(FEATURE_NAME.en).sort();
  for (const l of LANG_CODES) {
    assert.deepEqual(Object.keys(NET_TEXT[l]).sort(), keys, l);
    assert.deepEqual(Object.keys(FEATURE_NAME[l]).sort(), fkeys, l);
    for (const [k, v] of Object.entries(NET_TEXT[l])) assert.ok(typeof v === 'string' && v.trim(), `${l}.${k}`);
    assert.equal(NET_TEXT[l].risk, MAINNET_TEXT[l].risk, `${l}: the same risk sentence as the mainnet card`);
    assert.ok(NET_TEXT[l].gateBody.includes('{feature}'), l);
    const w = wrongChainText(NETWORKS.mainnet, l);
    assert.ok(w.includes('3659') && !w.includes('77390') && !/testnet/i.test(w), `${l}: ${w}`);
    assert.ok(wrongChainText(NETWORKS.testnet, l).includes('77390'), l);
  }
  assert.match(NET_TEXT.en.risk, /^ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not yet completed an independent external audit\. Use it only with amounts you can afford to lose\.$/);
  assert.equal(netText('xx').gateTitle, 'Testnet only for now');
  assert.equal(netText('th').feature('nft'), 'ตลาด NFT');
  assert.equal(netText('en').feature('unknown'), 'This feature');
  assert.equal(noticeUrl(NETWORKS.mainnet, 'th'), 'https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.th.md');
  assert.equal(noticeUrl(NETWORKS.mainnet, 'ja'), 'https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md');
  assert.equal(noticeUrl(NETWORKS.testnet, 'en'), null);
});

// a tiny DOM, enough for the badge, the select and the box
function fakeDoc() {
  const node = (tag) => {
    const n = { tag, attrs: {}, kids: [], style: {}, on: {}, text: '', value: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
      addEventListener(e, f) { this.on[e] = f; }, append(...k) { this.kids.push(...k); },
      get textContent() { return this.text + this.kids.map((k) => k.textContent).join(' '); }, set textContent(v) { this.text = v; } };
    return n;
  };
  return { createElement: node };
}
const all = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const k of n.kids ?? []) all(k, pred, out); return out; };

test('the badge: mainnet shows its name, the risk sentence and the notice link; the testnet keeps the app\'s own words', () => {
  const doc = fakeDoc();
  const m = networkBadge(doc, { lang: 'th', net: NETWORKS.mainnet });
  assert.match(m.textContent, /ZETAPHY mainnet/);
  assert.ok(m.textContent.includes(NET_TEXT.th.risk));
  assert.equal(all(m, (n) => n.tag === 'a')[0].attrs.href, NETWORKS.mainnet.noticeTh);
  const sel = all(m, (n) => n.tag === 'select')[0];
  assert.equal(sel.value, 'mainnet');
  const t = networkBadge(doc, { lang: 'en', net: NETWORKS.testnet, testnetText: 'ZETAPHY testnet is not real money.' });
  assert.match(t.textContent, /ZETAPHY testnet.*not real money/s);
  assert.equal(all(t, (n) => n.tag === 'a').length, 0, 'no mainnet notice on the testnet');
  assert.ok(!t.textContent.includes(NET_TEXT.en.risk));
  assert.equal(all(networkBadge(doc, { net: NETWORKS.mainnet, select: false }), (n) => n.tag === 'select').length, 0);
});

test('links to the explorer site (mainnet by default) name the page\'s network', () => {
  const a = (href) => ({ attrs: { href }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const links = [a('https://explorer.sawasdeecoin.com/'), a('https://explorer.sawasdeecoin.com/?x=1#/tx/0xab')];
  const doc = { querySelectorAll: (sel) => { assert.equal(sel, 'a[href^="https://explorer.sawasdeecoin.com/"]'); return links; } };
  linkExplorer(doc, NETWORKS.testnet);
  assert.deepEqual(links.map((l) => l.attrs.href), ['https://explorer.sawasdeecoin.com/?network=testnet', 'https://explorer.sawasdeecoin.com/?x=1&network=testnet#/tx/0xab']);
  linkExplorer(doc, NETWORKS.mainnet);
  assert.equal(links[0].attrs.href, 'https://explorer.sawasdeecoin.com/?network=mainnet', 'switched, not appended twice');
});

test('the switch and the "testnet only" box call back with the chosen network', () => {
  const doc = fakeDoc();
  const picked = [];
  const sel = networkSelect(doc, { net: NETWORKS.mainnet, onSwitch: (id) => picked.push(id) });
  sel.on.change(); // unchanged: nothing
  sel.value = 'testnet'; sel.on.change();
  assert.deepEqual(picked, ['testnet']);
  const box = testnetOnlyBox(doc, { lang: 'en', feature: 'nft', onSwitch: (id) => picked.push(id) });
  assert.match(box.textContent, /Testnet only for now.*The NFT marketplace is not on ZETAPHY mainnet yet/s);
  assert.equal(box.attrs['data-feature'], 'nft');
  all(box, (n) => n.tag === 'button')[0].on.click();
  assert.deepEqual(picked, ['testnet', 'testnet']);
  assert.match(testnetOnlyBox(doc, { lang: 'th', feature: 'faucet' }).textContent, /ตอนนี้ใช้ได้เฉพาะบน testnet.*Faucet แจกเหรียญทดลอง ยังไม่มีบน ZETAPHY mainnet/s);
});
