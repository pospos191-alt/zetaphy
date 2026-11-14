// Browser test: the Offline, Audit, Quantum and Immunity tabs on mainnet (chain 3659) once their contracts are in the
// mainnet config (hub-config.json `mainnet`, from zetaphy-launch/state/3659.contracts.json; network.js
// FEATURE_CONTRACTS), under the site's real CSP and with every request mocked:
//   - the tabs open (no "soon", no "not on mainnet yet"); cheques and orders are signed and checked for chain 3659, the
//     rescue kit is made for chain 3659 and its commit is sent for chain 0xe4b to mainnet's QuantumRescue, the audit
//     tab looks up chain 3659, the Immunity tab reads mainnet's ImmuneRegistry; nothing is asked of the testnet;
//   - no testnet words in any of the four tabs, in all 8 languages (the mainnet risk sentence instead);
//   - with one offline contract missing the Offline tab stays "not on mainnet yet" (test/network.e2e.mjs checks the
//     repo's own 3659.contracts.json, which has none of them yet).
//   npm run build && node --test test/mainnet-tabs.e2e.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { AbiCoder } from 'ethers';
import { serve } from './serve.mjs';
import { answer } from './mocknode.mjs';
import { SEL, decodeCheque, decodeOrder } from '../offline-core.js';
import { LANG_CODES } from '../i18n.js';
import { NET_TEXT } from '../network.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const CSP = JSON.parse(readFileSync(join(HERE, '..', 'vercel.json'), 'utf8')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
const exe = process.env.CHROMIUM_PATH || undefined;
const MAINNET = 'https://129-221-199-191.sslip.io';
const TESTNET_HOSTS = ['rpc.sawasdeecoin.com', 'explorer.sawasdeecoin.com'];
const TESTNET_WORDS = /testnet|77390|test ZETAPHY|test coins|ZETAPHY ทดลอง|เหรียญทดลอง|เทสต์เน็ต|测试网|测试币|테스트넷|테스트 코인|テストネット|テスト用コイン|тестнет|тестовые монеты|тестовых ZETAPHY|coin thử nghiệm|monedas de prueba/i;
const abi = AbiCoder.defaultAbiCoder();
const A = (b) => '0x' + b.repeat(20);
const TABS = { zetaphyCheques: A('5c'), offlineOrders: A('0d'), offlineCash: A('ca'), auditNetwork: A('a1'), auditRunners: A('a2'), auditJudges: A('a3'), auditCertificate: A('a4'),
  quantumRescue: A('9e'), immuneRegistry: A('1e') };
const PAYER = A('0a'), PAYEE = A('0b');
const ACC = '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245';

function mainnetConfig(contracts) {
  const cfg = JSON.parse(readFileSync(join(DIST, 'hub-config.json'), 'utf8'));
  cfg.mainnet = { ...cfg.mainnet, contracts: { ...cfg.mainnet.contracts, ...contracts },
    immuneNet: contracts.immuneRegistry ? { registry: contracts.immuneRegistry, mirrors: [], feedUrl: null, chains: 12, simMedian: 40 } : null };
  return JSON.stringify(cfg);
}

async function open(browser, site, { asked, signerRef, errors }) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const now = Math.floor(Date.now() / 1000);
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === new URL(site.url).origin) return route.continue();
    asked.push(u.host);
    const body = route.request().postData() ?? '';
    const req = (() => { try { return JSON.parse(body); } catch { return null; } })();
    let a = null;
    if (u.origin === MAINNET && req?.method === 'eth_call' && req.params[0]?.to?.toLowerCase() === TABS.zetaphyCheques && req.params[0].data.startsWith(SEL.channels)) {
      a = { jsonrpc: '2.0', id: req.id, result: abi.encode(['address', 'uint64', 'uint64', 'address', 'address', 'address', 'uint256', 'uint256', 'bool'],
        [PAYER, now + 7 * 86400, 0, PAYEE, '0x' + '00'.repeat(20), signerRef.v, 10n * 10n ** 18n, 0n, false]) };
    } else if (u.origin === MAINNET && req?.method === 'eth_call' && req.params[0]?.to?.toLowerCase() === TABS.immuneRegistry) {
      a = { jsonrpc: '2.0', id: req.id, result: '0x' + '0'.repeat(256) }; // isFlagged: not flagged
    } else if (u.origin === MAINNET) {
      a = answer(u.href.replace(u.origin, 'https://rpc.sawasdeecoin.com'), body);
      if (a && a.result === '0x12e4e') a = { ...a, result: '0xe4b' }; // the mainnet node says it is chain 3659
    }
    if (a) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a) });
    return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  // a stand-in wallet already on mainnet
  await context.addInitScript((acc) => {
    window.__sent = [];
    window.ethereum = { isMetaMask: true, on: () => {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acc];
      if (method === 'eth_chainId') return '0xe4b';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction') { window.__sent.push(params[0]); return `0x${'cd'.repeat(32)}`; }
      throw new Error(`not mocked: ${method}`);
    } };
  }, ACC);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  return { context, page };
}

test('mainnet: the Offline, Audit, Quantum and Immunity tabs open once their contracts are in the mainnet config, for chain 3659 only', { timeout: 300_000 }, async () => {
  const site = await serve(DIST, { headers: { 'content-security-policy': CSP }, files: { '/hub-config.json': mainnetConfig(TABS) } });
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const asked = [], errors = [], signerRef = { v: '0x' + '00'.repeat(20) };
  try {
    const { context, page } = await open(browser, site, { asked, signerRef, errors });
    await page.goto(site.url);
    await page.waitForFunction(() => document.getElementById('net-badge')?.textContent === 'ZETAPHY mainnet');
    const gatedTabs = await page.$$eval('.tab[data-gated]', (as) => as.map((a) => a.dataset.tab).sort());
    for (const t of ['offline', 'audit', 'quantum', 'immune']) assert.ok(!gatedTabs.includes(t), `${t}: open on mainnet (${gatedTabs})`);
    assert.ok(gatedTabs.includes('nft'), 'the NFT app waits for its code keys');

    // ---- Offline: a key, a channel, a cheque and an order, all for chain 3659
    await page.click('.tab[data-tab="offline"]');
    await page.waitForSelector('#off-create-form');
    assert.ok(await page.isHidden('#panel-gate'));
    assert.equal(await page.locator('.page-offline [data-state="not-deployed"]').count(), 0, 'every offline card has its contract');
    assert.equal(await page.textContent('#off-risk-net'), NET_TEXT.en.risk);
    await page.fill('#off-pass', 'correct horse battery');
    await page.fill('#off-pass2', 'correct horse battery');
    await page.click('#off-create');
    await page.waitForSelector('#off-key-addr', { timeout: 30_000 });
    signerRef.v = (await page.textContent('#off-key-addr')).trim();
    await page.fill('#off-sync-id', '1');
    await page.click('#off-sync');
    await page.waitForSelector('tr[data-ch="1"][data-role="payer"]');
    if (await page.locator('#off-unlock-pass').count()) { await page.fill('#off-unlock-pass', 'correct horse battery'); await page.click('#off-unlock'); }
    await page.waitForSelector('#off-key-state[data-state="unlocked"]', { timeout: 30_000 });
    await page.fill('#off-write-amt', '2.5');
    await page.click('#off-write');
    await page.waitForFunction(() => (document.querySelector('#off-write-ok')?.textContent ?? '').includes('2.5 ZTPHY now'));
    const cheque = await page.inputValue('#off-write-out #off-out-text');
    const c = decodeCheque(cheque);
    assert.equal(c.chainId, 3659, 'the cheque is for mainnet');
    assert.equal(c.contract, TABS.zetaphyCheques);
    await page.fill('#off-recv-text', cheque);
    await page.click('#off-recv-check');
    await page.waitForSelector('#off-recv-out [data-ok]');
    assert.equal(await page.getAttribute('#off-recv-out [data-ok]', 'data-ok'), '1', await page.textContent('#off-recv-out'));
    await page.selectOption('#off-o-out', 'other');
    await page.fill('#off-o-out-addr', A('22'));
    await page.fill('#off-o-amt', '10');
    await page.fill('#off-o-min', '9.5');
    await page.fill('#off-o-fee', '0.1');
    await page.selectOption('#off-o-with', 'key');
    await page.click('#off-o-sign');
    await page.waitForSelector('#off-o-ok');
    const order = await page.inputValue('#off-o-out #off-out-text');
    const o = decodeOrder(order);
    assert.equal(o.chainId, 3659, 'the order is for mainnet');
    assert.equal(o.contract, TABS.offlineOrders);
    await page.fill('#off-relay-text', order);
    await page.click('#off-relay-check');
    await page.waitForSelector('#off-relay-out [data-ok]');
    assert.equal(await page.getAttribute('#off-relay-out [data-ok]', 'data-ok'), '1', await page.textContent('#off-relay-out'));

    // ---- Audit: mainnet's audit network, certificates looked up on chain 3659
    await page.click('.tab[data-tab="audit"]');
    await page.waitForSelector('.panel[data-page="audit"]:not([hidden]) #au-cert-chain');
    assert.ok(await page.isHidden('#panel-gate'));
    assert.equal(await page.inputValue('#au-cert-chain'), '3659');
    assert.match(await page.textContent('#au-meaning'), new RegExp(NET_TEXT.en.risk.slice(0, 40).replace(/[.()]/g, '\\$&')));

    // ---- Quantum: the rescue kit for chain 3659, its commit sent to mainnet's QuantumRescue for chain 0xe4b
    await page.click('.tab[data-tab="quantum"]');
    await page.waitForSelector('.panel[data-page="quantum"]:not([hidden]) #qs-make-kit');
    assert.ok(await page.isHidden('#panel-gate'));
    assert.equal(await page.locator('#qs-not-deployed').count(), 0);
    assert.equal(await page.textContent('#qs-risk'), NET_TEXT.en.risk);
    await page.click('#qs-make-kit');
    const dlg = await page.waitForSelector('#wb-dialog[open] .wb-wallet', { timeout: 5000 }).catch(() => null);
    if (dlg) await dlg.click(); // the wallet connects, then the kit is made
    await page.waitForSelector('#qs-kit', { timeout: 20_000 }).catch(async () => { await page.keyboard.press('Escape'); await page.click('#qs-make-kit'); await page.waitForSelector('#qs-kit'); });
    const kit = await page.inputValue('#qs-kit');
    assert.match(kit, /3659/);
    assert.doesNotMatch(kit, /77390/);
    assert.ok(kit.toLowerCase().includes(TABS.quantumRescue), 'the kit names mainnet\'s QuantumRescue');
    // the wallet dialog stays on its "connected" view: close it
    if (await page.evaluate(() => document.getElementById('wb-dialog')?.open)) await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('wb-dialog')?.open);
    await page.click('#qs-commit');
    await page.waitForSelector('#ws-confirm[open]', { timeout: 10_000 });
    assert.match(await page.textContent('#ws-confirm'), /ZETAPHY \(3659\)/);
    await page.click('#ws-confirm [data-ws="go"]');
    await page.waitForFunction(() => window.__sent.length === 1);
    const [tx] = await page.evaluate(() => window.__sent);
    assert.equal(tx.chainId, '0xe4b');
    assert.equal(tx.to.toLowerCase(), TABS.quantumRescue);

    // ---- Immunity: mainnet's ImmuneRegistry, no mirror on another chain yet (said plainly, not the testnet's words)
    await page.click('.tab[data-tab="immune"]');
    await page.waitForSelector('.panel[data-page="immune"]:not([hidden]) #im-net [data-immune="live"]', { timeout: 20_000 });
    assert.ok(await page.isHidden('#panel-gate'));
    await page.waitForSelector('#im-cov [data-immune-cov="none"]');

    // ---- 8 languages: none of the four tabs talks about the testnet
    for (const l of LANG_CODES) {
      await page.selectOption('#lang', l);
      for (const t of ['offline', 'audit', 'quantum', 'immune']) {
        await page.click(`.tab[data-tab="${t}"]`);
        await page.waitForSelector(`.panel[data-page="${t}"]:not([hidden])`);
        await page.waitForFunction(([id, lang]) => document.querySelector(`.panel[data-page="${id}"]`)?.dataset.lang === lang, [t, l]);
        const seen = await page.textContent(`.panel[data-page="${t}"]`);
        const left = seen.split(/(?<=[.!?。])\s*/).filter((x) => TESTNET_WORDS.test(x));
        assert.deepEqual(left, [], `${l} ${t}: no testnet words`);
      }
    }
    assert.ok(!asked.some((h) => TESTNET_HOSTS.includes(h)), `nothing asked of the testnet: ${[...new Set(asked)]}`);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); site.close(); }
});

test('mainnet: with one offline contract missing the Offline tab stays "not on mainnet yet"; the others open', { timeout: 120_000 }, async () => {
  const { offlineCash: _gone, ...fewer } = TABS;
  const site = await serve(DIST, { headers: { 'content-security-policy': CSP }, files: { '/hub-config.json': mainnetConfig(fewer) } });
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const asked = [], errors = [];
  try {
    const { context, page } = await open(browser, site, { asked, signerRef: { v: A('00') }, errors });
    await page.goto(site.url);
    await page.waitForFunction(() => document.getElementById('net-badge')?.textContent === 'ZETAPHY mainnet');
    const gatedTabs = await page.$$eval('.tab[data-gated]', (as) => as.map((a) => a.dataset.tab).sort());
    assert.ok(gatedTabs.includes('offline'), `${gatedTabs}`);
    for (const t of ['audit', 'quantum', 'immune']) assert.ok(!gatedTabs.includes(t), t);
    await page.click('.tab[data-tab="offline"]');
    await page.waitForSelector('#panel-gate:not([hidden])');
    assert.match(await page.textContent('#panel-gate'), /^Not on mainnet yetOffline trading is not on ZETAPHY mainnet yet\./);
    assert.equal(await page.locator('.panel[data-page="offline"]').count(), 0, 'its page is not drawn');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); site.close(); }
});
