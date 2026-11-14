// network.js: the one network definition every app reads (mainnet only: the testnet was shut down on 2026-11-14),
// its feature gating ("not on mainnet yet"), no switch (a saved or linked testnet opens mainnet), and its words in
// the 8 languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NETWORKS, DEFAULT_NETWORK, NETWORK_KEY, FEATURES, NATIVE_ERC20, readNetworkId, hasFeature, contractsOf, netKey, addChainParams,
  noticeUrl, NET_TEXT, FEATURE_NAME, netText, wrongChainText, networkBadge, notOnMainnetBox, isNetworkId, linkExplorer,
  FEATURE_CONTRACTS, deployedFeatures, withDeployed, activeNetwork,
} from '../network.js';
import * as NETWORK_EXPORTS from '../network.js';
import { MAINNET, addChainParams as cardParams } from '../mainnet.js';
import { MAINNET_TEXT } from '../mainnet-i18n.js';
import { LANG_CODES } from '../i18n.js';

const repo = (p) => new URL(`../../${p}`, import.meta.url);
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('mainnet is the network; its ids, RPCs and explorer; the retired testnet\'s record is kept, marked retired', () => {
  assert.equal(DEFAULT_NETWORK, 'mainnet');
  const { mainnet: m, testnet: t } = NETWORKS;
  assert.deepEqual([m.chainId, m.chainIdHex, m.cosmosChainId, m.symbol, m.denom, m.decimals, m.minGasPrice, m.bech32],
    [3659, '0xe4b', 'zetaphy_3659-1', 'ZTPHY', 'azetaphy', 18, 1_000_000_000, 'zetaphy']);
  assert.deepEqual([m.rpc, m.comet, m.rest, m.explorer], ['https://129-221-199-191.sslip.io', 'https://129-221-199-191.sslip.io/rpc', 'https://129-221-199-191.sslip.io/rest', null]);
  assert.deepEqual([t.chainId, t.chainIdHex, t.cosmosChainId, t.rpc, t.explorer], [77390, '0x12e4e', 'zetaphy_77390-1', 'https://rpc.sawasdeecoin.com', 'https://explorer.sawasdeecoin.com']);
  assert.equal(t.retired, '2026-11-14');
  assert.equal(m.retired, undefined);
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

test('features: mainnet has the wallet, staking, governance, explorer, Neuro, the DEX and the sentry\'s faucet (and its browser mining); the rest is not on mainnet yet', () => {
  const on = ['wallet', 'staking', 'governance', 'explorer', 'neuro', 'dex', 'faucet', 'mining'];
  const off = ['nft', 'dlmm', 'bridge', 'usefulWork', 'testTokens', 'stableGateway', 'rewardVault', 'computeMarket', 'identity', 'quantumWallet', 'airdrop'];
  for (const f of on) assert.equal(hasFeature(NETWORKS.mainnet, f), true, f);
  for (const f of off) assert.equal(hasFeature(NETWORKS.mainnet, f), false, f);
  for (const f of FEATURES) assert.equal(hasFeature(NETWORKS.testnet, f), true, f);
  assert.equal(hasFeature(NETWORKS.mainnet, 'nope'), false);
  assert.equal(hasFeature(NETWORKS.testnet, 'nope'), false, 'an unknown feature is never on');
});

test('no switch: always mainnet; a ?network=testnet link or a saved testnet falls back to mainnet and the saved value is cleared', () => {
  assert.equal(readNetworkId({}), 'mainnet');
  assert.equal(readNetworkId({ storage: mem() }), 'mainnet');
  const saved = mem({ [NETWORK_KEY]: 'testnet', other: 'kept' });
  assert.equal(readNetworkId({ storage: saved }), 'mainnet', 'a testnet choice saved before 2026-11-14 opens mainnet');
  assert.equal(saved.m.has(NETWORK_KEY), false, 'and is cleared');
  assert.equal(saved.m.get('other'), 'kept', 'nothing else is touched');
  const dev = mem({ [NETWORK_KEY]: 'devnet' });
  assert.equal(readNetworkId({ storage: dev }), 'mainnet', 'unknown values are ignored');
  assert.equal(dev.m.has(NETWORK_KEY), false);
  const main = mem({ [NETWORK_KEY]: 'mainnet' });
  assert.equal(readNetworkId({ storage: main }), 'mainnet');
  assert.equal(main.m.get(NETWORK_KEY), 'mainnet', 'a saved mainnet stays');
  const s = mem();
  for (const search of ['?network=testnet', '?tab=swap&network=testnet', '?network=mainnet', '?network=<script>']) {
    assert.equal(readNetworkId({ storage: s, search }), 'mainnet', search);
  }
  assert.equal(s.m.size, 0, 'a link saves nothing');
  const linkAndSaved = mem({ [NETWORK_KEY]: 'testnet' });
  assert.equal(readNetworkId({ storage: linkAndSaved, search: '?network=testnet' }), 'mainnet');
  assert.equal(linkAndSaved.m.has(NETWORK_KEY), false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readNetworkId({ storage: broken }), 'mainnet');
  assert.equal(readNetworkId({ storage: broken, search: '?network=testnet' }), 'mainnet');
  assert.ok(isNetworkId('mainnet') && !isNetworkId('testnet') && !isNetworkId('x'));
  // in Node (no test flag) the page's network is mainnet; no switch or "switch to testnet" is offered at all
  assert.equal(activeNetwork(), NETWORKS.mainnet);
  for (const gone of ['networkSelect', 'setNetwork', 'testnetOnlyBox']) assert.equal(NETWORK_EXPORTS[gone], undefined, `${gone} is gone`);
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
    assert.ok(NET_TEXT[l].gateBody.includes('2026-11-14'), `${l}: says when the testnet was shut down`);
    for (const k of ['gateSwitch', 'switchTip', 'mainnet', 'testnet', 'network']) assert.equal(NET_TEXT[l][k], undefined, `${l}.${k}: no switch words left`);
    const w = wrongChainText(NETWORKS.mainnet, l);
    assert.ok(w.includes('3659') && !w.includes('77390') && !/testnet/i.test(w), `${l}: ${w}`);
    assert.ok(wrongChainText(NETWORKS.testnet, l).includes('77390'), l);
  }
  assert.match(NET_TEXT.en.risk, /^ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not yet completed an independent external audit\. Use it only with amounts you can afford to lose\.$/);
  assert.equal(netText('xx').gateTitle, 'Not on mainnet yet');
  assert.deepEqual(LANG_CODES.map((l) => NET_TEXT[l].gateTitle), LANG_CODES.map((l) => ({ en: 'Not on mainnet yet', th: 'ยังไม่มีบน mainnet', zh: '尚未上线主网',
    es: 'Aún no está en la mainnet', ko: '아직 메인넷에 없음', ja: 'まだメインネットにありません', ru: 'Пока нет в мейннете', vi: 'Chưa có trên mainnet' })[l]));
  for (const l of LANG_CODES) assert.doesNotMatch(NET_TEXT[l].gateTitle, /testnet|테스트넷|テストネット|测试网|тестнет/i, l);
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

test('the badge: mainnet shows its name, the risk sentence and the notice link, and no switch; the retired testnet\'s record keeps the app\'s own words', () => {
  const doc = fakeDoc();
  const m = networkBadge(doc, { lang: 'th', net: NETWORKS.mainnet });
  assert.match(m.textContent, /ZETAPHY mainnet/);
  assert.ok(m.textContent.includes(NET_TEXT.th.risk));
  assert.equal(all(m, (n) => n.tag === 'a')[0].attrs.href, NETWORKS.mainnet.noticeTh);
  assert.equal(all(m, (n) => n.tag === 'select' || n.tag === 'option' || n.tag === 'button').length, 0, 'no network switch');
  const t = networkBadge(doc, { lang: 'en', net: NETWORKS.testnet, testnetText: 'ZETAPHY testnet is not real money.' });
  assert.match(t.textContent, /ZETAPHY testnet.*not real money/s);
  assert.equal(all(t, (n) => n.tag === 'a').length, 0, 'no mainnet notice on the testnet');
  assert.ok(!t.textContent.includes(NET_TEXT.en.risk));
  assert.equal(all(t, (n) => n.tag === 'select').length, 0, 'no switch there either');
});

test('links to the explorer site open it on mainnet (?network=mainnet), whatever they said before', () => {
  const a = (href) => ({ attrs: { href }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const links = [a('https://explorer.sawasdeecoin.com/'), a('https://explorer.sawasdeecoin.com/?x=1#/tx/0xab'), a('https://explorer.sawasdeecoin.com/?network=testnet')];
  const doc = { querySelectorAll: (sel) => { assert.equal(sel, 'a[href^="https://explorer.sawasdeecoin.com/"]'); return links; } };
  linkExplorer(doc, NETWORKS.mainnet);
  assert.deepEqual(links.map((l) => l.attrs.href), ['https://explorer.sawasdeecoin.com/?network=mainnet', 'https://explorer.sawasdeecoin.com/?x=1&network=mainnet#/tx/0xab',
    'https://explorer.sawasdeecoin.com/?network=mainnet']);
  linkExplorer(doc, NETWORKS.testnet);
  assert.deepEqual(links.map((l) => l.attrs.href), ['https://explorer.sawasdeecoin.com/?network=mainnet', 'https://explorer.sawasdeecoin.com/?x=1&network=mainnet#/tx/0xab',
    'https://explorer.sawasdeecoin.com/?network=mainnet'], 'never a testnet link, not appended twice');
});

test('the "not on mainnet yet" box: plain words in the reader\'s language, nothing to click, no switch to the testnet', () => {
  const doc = fakeDoc();
  const box = notOnMainnetBox(doc, { lang: 'en', feature: 'nft' });
  assert.equal(box.textContent.replace(/\s+/g, ' ').trim(),
    'Not on mainnet yet The NFT marketplace is not on ZETAPHY mainnet yet. It appears here once its contracts are deployed on mainnet. (The testnet was shut down on 2026-11-14.)');
  assert.equal(box.attrs['data-feature'], 'nft');
  assert.equal(box.attrs.role, 'status');
  assert.equal(all(box, (n) => n.tag === 'button' || n.tag === 'select' || n.tag === 'a').length, 0, 'nothing to click');
  assert.deepEqual(Object.keys(box.on), [], 'no handlers');
  assert.doesNotMatch(box.textContent, /switch to|try it/i);
  assert.match(notOnMainnetBox(doc, { lang: 'th', feature: 'nft' }).textContent, /ยังไม่มีบน mainnet.*ตลาด NFT ยังไม่มีบน ZETAPHY mainnet.*testnet ปิดถาวรเมื่อ 2026-11-14/s);
  for (const l of LANG_CODES) {
    const b = notOnMainnetBox(doc, { lang: l, feature: 'forecasts' });
    assert.ok(b.textContent.includes(NET_TEXT[l].gateTitle) && b.textContent.includes(FEATURE_NAME[l].forecasts), l);
    assert.equal(all(b, (n) => n.tag === 'button').length, 0, l);
  }
  assert.match(notOnMainnetBox(doc, {}).textContent, /This feature is not on ZETAPHY mainnet yet/);
});

test('withDeployed: a mainnet feature turns on once ALL its contracts are deployed there, never off, never on the testnet', () => {
  const A = (n) => `0x${String(n).padStart(40, '0')}`;
  const m = NETWORKS.mainnet;
  assert.equal(withDeployed(m, {}), m, 'nothing deployed: the same object');
  assert.equal(withDeployed(m, null), m);
  assert.deepEqual(deployedFeatures({ airdropDistributor: A(1), auditNetwork: A(2) }), ['airdrop'], 'the audit network needs both contracts');
  assert.deepEqual(deployedFeatures({ airdropDistributor: 'nope', neuroIdentity: A(3) }), ['identity'], 'malformed addresses do not count');
  const d = withDeployed(m, { airdropDistributor: A(1), auditNetwork: A(2), auditCertificate: A(3) });
  assert.equal(hasFeature(d, 'airdrop'), true);
  assert.equal(hasFeature(d, 'audit'), true);
  assert.equal(hasFeature(d, 'agents'), false);
  for (const f of ['wallet', 'dex', 'faucet', 'mining']) assert.equal(hasFeature(d, f), true, `${f} stays on`);
  assert.equal(hasFeature(m, 'airdrop'), false, 'network.js itself is not changed');
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.features));
  assert.equal(d.chainId, 3659);
  assert.equal(withDeployed(NETWORKS.testnet, { airdropDistributor: A(1) }), NETWORKS.testnet);
  // every listed feature is a known one; pages that still sign for chain 77390 only are never switched on by a file
  for (const [f, keys] of Object.entries(FEATURE_CONTRACTS)) { assert.ok(FEATURES.includes(f), f); assert.ok(keys.length > 0, f); }
  for (const f of ['offline', 'immune', 'forecasts', 'nft', 'bridge', 'validators']) assert.ok(!(f in FEATURE_CONTRACTS), `${f}: changes only with network.js`);
});
