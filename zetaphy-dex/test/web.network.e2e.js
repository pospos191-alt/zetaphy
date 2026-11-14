// Browser test: the Swap page on ZETAPHY mainnet (web/lib/network.js; the only network since the testnet was shut down on
// 2026-11-14). Mainnet: its own RPC, factory and router (no pools yet), no testnet token or deployment file, DLMM "not
// on mainnet yet", no network switch, the wallet asked for chain 0xe4b only; a saved testnet choice or a
// ?network=testnet link opens mainnet. A mock node and a mock wallet that starts on the old testnet chain.
//   npm run test:web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { servePage, injectWallet, chromiumOptions } from './helpers/web.js';

const MAINNET_RPC = 'https://129-221-199-191.sslip.io';
const USER = '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245';
const FACTORY = '0x93463B001483970f8CAE63cd8B60D28F17a1C1AA';
const ROUTER = '0xa5221A7F25cf10d99446Fde3e95c15b1f696e783';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

test('Swap on mainnet: badge and risk line, mainnet factory/router, no test tokens, DLMM gated, no switch, wallet asked for 0xe4b; a saved or linked testnet opens mainnet', { timeout: 120_000 }, async () => {
  const server = await servePage();
  const browser = await chromium.launch(chromiumOptions());
  const problems = [];
  const files = [];
  const calls = []; // eth_call targets on the mainnet node
  const walletLog = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('request', (r) => { if (r.url().startsWith(server.origin)) files.push(new URL(r.url()).pathname); });
    await page.route(`${MAINNET_RPC}/**`, async (route) => {
      const req = JSON.parse(route.request().postData());
      if (req.method === 'eth_call') calls.push(req.params[0].to.toLowerCase());
      const result = { eth_chainId: '0xe4b', eth_getBalance: `0x${(5n * 10n ** 18n).toString(16)}`, eth_blockNumber: '0x10', eth_gasPrice: '0x3b9aca00',
        eth_call: `0x${word(0)}`, eth_getCode: '0x6080' }[req.method] ?? null;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) });
    });
    await page.route((url) => url.origin !== new URL(server.origin).origin && url.origin !== new URL(MAINNET_RPC).origin, (route) => { problems.push(`request to ${route.request().url()}`); return route.abort(); });
    let chain = '0x12e4e';
    await injectWallet(page, async (method, params) => {
      walletLog.push({ method, params });
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [USER];
        case 'eth_chainId': return chain;
        case 'wallet_switchEthereumChain': chain = params[0].chainId; return null;
        case 'wallet_addEthereumChain': return null;
        default: throw Object.assign(new Error(`not mocked: ${method}`), { code: 4200 });
      }
    });
    await page.goto(`${server.origin}/`);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, { timeout: 30_000 });
    const badge = await page.textContent('#net-badge');
    assert.match(badge, /ZETAPHY mainnet.*single validator operated by the ZETAPHY project/s);
    assert.equal(await page.getAttribute('#net-badge a', 'href'), 'https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md');
    assert.match(await page.textContent('.app-header .badge'), /^ZETAPHY mainnet · /);
    assert.equal(await page.textContent('#footer-contracts'), `Router ${ROUTER} · Factory ${FACTORY}`);
    assert.ok(!files.includes('/deployments.json') && !files.includes('/tokenlist.json'), 'the testnet\'s files are not read');
    assert.deepEqual(await page.$$eval('#swap-from option', (o) => o.map((x) => x.textContent.trim())).then((l) => l.filter((x) => /tUSD|tSWD/.test(x))), [], 'no test tokens');
    // DLMM: not on mainnet yet
    await page.click('.tab[data-tab="dlmm"]');
    assert.match(await page.textContent('#tab-dlmm'), /Not on mainnet yet.*DLMM pools is not on ZETAPHY mainnet yet\. It appears here once its contracts are deployed on mainnet\. \(The testnet was shut down on 2026-11-14\.\)/s);
    assert.equal(await page.locator('#tab-dlmm .zn-gate button, #tab-dlmm .zn-gate select').count(), 0, 'nothing to click in the box');
    assert.equal(await page.locator('select.zn-net-select, #net-badge select, .zn-gate-switch').count(), 0, 'no network switch');
    await page.click('.tab[data-tab="swap"]');
    // the wallet starts on the testnet: it is asked to move to mainnet (0xe4b), never the other way
    await page.click('#connect-btn');
    await page.click('#wallet-list button:has-text("Mock Wallet")');
    await page.waitForFunction(() => document.getElementById('connect-btn').textContent.startsWith('0x6af5'));
    const asked = walletLog.filter((c) => /^wallet_(switch|add)EthereumChain$/.test(c.method)).map((c) => c.params[0].chainId);
    assert.ok(asked.length && asked.every((c) => c === '0xe4b'), `asked for ${asked}`);
    const added = walletLog.find((c) => c.method === 'wallet_addEthereumChain');
    if (added) assert.deepEqual(added.params[0].rpcUrls, [MAINNET_RPC]);
    assert.ok(calls.every((to) => [FACTORY.toLowerCase(), ROUTER.toLowerCase(), '0xaacfc7cf7148b7ae530c2ab891d4220e648a2139', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'].includes(to)),
      `only mainnet contracts are called (${[...new Set(calls)]})`);
    assert.deepEqual(problems, [], 'on mainnet: no request to the testnet or anywhere else, no page error');
    // a testnet choice saved before the shutdown, then a ?network=testnet link: mainnet both times, the saved value cleared
    await page.evaluate(() => localStorage.setItem('zetaphy:network', 'testnet'));
    for (const url of [`${server.origin}/`, `${server.origin}/?network=testnet`]) {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, { timeout: 30_000 });
      assert.match(await page.textContent('#net-badge'), /ZETAPHY mainnet/, url);
      assert.doesNotMatch(await page.textContent('#net-badge'), /testnet/i, url);
      assert.equal(await page.evaluate(() => localStorage.getItem('zetaphy:network')), null, `${url}: nothing saved`);
      assert.equal(await page.textContent('#footer-contracts'), `Router ${ROUTER} · Factory ${FACTORY}`, url);
    }
    assert.ok(!files.includes('/deployments.json') && !files.includes('/tokenlist.json'), 'the testnet\'s files are never read');
    assert.deepEqual(problems, [], 'no request to the testnet or anywhere else, no page error');
  } finally {
    await browser.close();
    await server.close();
  }
});
