// Browser test: the hub on mainnet (network.js; the default) and the switch to the testnet, on a built dist/.
// Mainnet: its own node, badge and risk line, chain 3659 everywhere, staking and votes signed for chain 0xe4b only,
// "testnet only for now" (never a testnet contract, never a faucet) for what is not deployed on mainnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { answer } from './mocknode.mjs';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const exe = process.env.CHROMIUM_PATH || undefined;
const MAINNET = 'https://129-221-199-191.sslip.io';
const TESTNET_HOSTS = ['rpc.sawasdeecoin.com', 'explorer.sawasdeecoin.com'];

test('the hub on mainnet: badge, chain 3659, testnet-only tabs gated, votes for chain 0xe4b; the switch picks the testnet', { timeout: 120_000 }, async () => {
  const site = await serve(DIST);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const asked = []; // every outside origin the page reached
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === new URL(site.url).origin) return route.continue();
      asked.push(u.host);
      // the mock node answers on both networks' origins (mocknode.mjs), so the test can see which one the page uses
      let a = u.origin === MAINNET || u.origin === 'https://rpc.sawasdeecoin.com' ? answer(u.href.replace(u.origin, 'https://rpc.sawasdeecoin.com'), route.request().postData()) : null;
      // the mainnet node says it is chain 3659
      if (a && u.origin === MAINNET && a.result === '0x12e4e') a = { ...a, result: '0xe4b' };
      if (a) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a) });
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    });
    // a stand-in MetaMask that starts on the testnet (chain 0x12e4e): the page must ask it to move to 0xe4b
    await page.addInitScript(() => {
      window.__sent = []; window.__asked = [];
      let chain = sessionStorage.getItem('__chain') ?? '0x12e4e';
      const ACC = '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245';
      window.ethereum = { isMetaMask: true, on: () => {}, request: async ({ method, params }) => {
        window.__asked.push({ method, params });
        if (method === 'eth_requestAccounts') { localStorage.setItem('__granted', '1'); return [ACC]; }
        if (method === 'eth_accounts') return localStorage.getItem('__granted') ? [ACC] : [];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; sessionStorage.setItem('__chain', chain); return null; }
        if (method === 'wallet_addEthereumChain') return null;
        if (method === 'eth_sendTransaction') { window.__sent.push(params[0]); return `0x${'cd'.repeat(32)}`; }
        throw new Error(`not mocked: ${method}`);
      } };
    });

    await page.goto(site.url);
    // the mainnet node's numbers
    await page.waitForFunction(() => document.getElementById('s-height').textContent === '123,456');
    assert.equal(await page.textContent('#net-badge'), 'ZETAPHY mainnet');
    assert.match(await page.textContent('#net-note'), /ZETAPHY mainnet.*single validator operated by the ZETAPHY project.*afford to lose/s);
    assert.equal(await page.getAttribute('#net-note a', 'href'), 'https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md');
    assert.equal(await page.inputValue('#net-switch select'), 'mainnet');
    assert.match(await page.textContent('#endpoints'), /3659 · zetaphy_3659-1.*129-221-199-191\.sslip\.io/s);
    assert.doesNotMatch(await page.textContent('#endpoints'), /77390|sawasdeecoin/);
    // no faucet on mainnet: "testnet only for now" with the switch, and nothing to submit
    assert.ok(await page.isHidden('#faucet-form'));
    assert.match(await page.textContent('#faucet-gate'), /Testnet only for now.*The faucet is not on ZETAPHY mainnet yet/s);
    // testnet-only tabs: marked, and opened they show the box, never their page or app
    assert.equal(await page.textContent('.tab[data-tab="nft"] .new'), 'testnet');
    for (const [tab, words] of [['nft', /NFT marketplace/], ['mine', /Browser mining and useful-work payouts/], ['saphan', /ZETAPHY Saphan/], ['earn', /The faucet/]]) {
      await page.click(`.tab[data-tab="${tab}"]`);
      await page.waitForSelector('#panel-gate:not([hidden])');
      assert.match(await page.textContent('#panel-gate'), words, tab);
      assert.equal(await page.locator(`.panel[data-page="${tab}"]`).count(), 0, `${tab}: its page is not drawn`);
    }
    assert.equal(await page.locator('#frames iframe[src^="nft/"]').count(), 0, 'the NFT app is not loaded');

    // stake & vote: native modules over REST, signed by the wallet for chain 0xe4b only
    await page.click('.tab[data-tab="stake"]');
    assert.ok(await page.isHidden('#panel-gate'));
    await page.waitForFunction(() => document.querySelectorAll('#vals tr').length === 2);
    await page.waitForFunction(() => document.querySelectorAll('#props li').length === 3);
    await page.click('#props li:first-child .votes button >> nth=0');
    await page.waitForSelector('#wb-dialog[open] .wb-wallet');
    await page.click('#wb-dialog .wb-wallet');
    await page.waitForFunction(() => /0x6af5…a245/.test(document.getElementById('wb-btn').textContent));
    await page.waitForSelector('#ws-confirm[open]', { timeout: 8000 }).catch(async (e) => { throw new Error(`no summary: "${await page.textContent('#props li:first-child .msg')}" ${JSON.stringify(await page.evaluate(() => window.__asked))}`); });
    assert.match(await page.textContent('#ws-confirm'), /ZETAPHY \(3659\)/);
    assert.doesNotMatch(await page.textContent('#ws-confirm'), /77390/);
    await page.click('#ws-confirm [data-ws="go"]');
    await page.waitForFunction(() => window.__sent.length === 1);
    const [tx] = await page.evaluate(() => window.__sent);
    assert.equal(tx.chainId, '0xe4b');
    assert.equal(tx.to, '0x0000000000000000000000000000000000000805', 'the gov precompile');
    const switched = await page.evaluate(() => window.__asked.filter((a) => a.method === 'wallet_switchEthereumChain' || a.method === 'wallet_addEthereumChain').map((a) => a.params[0].chainId));
    assert.ok(switched.length && switched.every((c) => c === '0xe4b'), `the wallet is only ever asked for mainnet (${switched})`);
    assert.ok(!asked.some((h) => TESTNET_HOSTS.includes(h)), `nothing asked of the testnet: ${[...new Set(asked)]}`);

    // the switch: the testnet, remembered; the faucet and the testnet-only tabs are back
    await Promise.all([page.waitForEvent('load'), page.selectOption('#net-switch select', 'testnet')]);
    assert.equal(await page.evaluate(() => localStorage.getItem('zetaphy:network')), 'testnet');
    await page.waitForFunction(() => document.getElementById('net-badge').textContent === 'Testnet');
    assert.ok(await page.isHidden('#net-note'));
    assert.equal(await page.evaluate(() => [document.getElementById('faucet-form').hidden, document.getElementById('faucet-gate').hidden].join()), 'false,true', 'the faucet is back');
    assert.match(await page.textContent('#endpoints'), /77390 · zetaphy_77390-1.*rpc\.sawasdeecoin\.com/s);
    await page.click('.tab[data-tab="mine"]');
    await page.waitForSelector('.panel[data-page="mine"]:not([hidden])');
    assert.equal(await page.locator('#panel-gate:not([hidden])').count(), 0);
    // a ?network= link picks the network too
    await page.goto(`${site.url}?network=mainnet&tab=nft`);
    await page.waitForSelector('#panel-gate:not([hidden])');
    assert.equal(await page.evaluate(() => localStorage.getItem('zetaphy:network')), 'mainnet');
    // the risk-forecasts page (its contracts are on the testnet only)
    await page.goto(`${site.url}forecasts.html`);
    await page.waitForSelector('#net-gate .zn-gate');
    assert.match(await page.textContent('#net-gate'), /ZETAPHY mainnet.*Testnet only for now.*Risk forecasts is not on ZETAPHY mainnet yet/s);
    assert.ok(await page.isHidden('#ftabs'));
    // the validator guide is about joining the testnet (its faucet and auto-stake): gated too
    await page.goto(`${site.url}validators.html`);
    await page.waitForSelector('#net-gate .zn-gate');
    assert.match(await page.textContent('#net-gate'), /Joining as a validator is not on ZETAPHY mainnet yet/);
    assert.ok(await page.isHidden('#vf-form'), 'no faucet form');
    // the developers page: mainnet's endpoints and contracts, no faucet command
    await page.goto(`${site.url}?tab=dev`);
    await page.waitForSelector('.panel[data-page="dev"]:not([hidden]) .tbl');
    const dev = await page.textContent('.panel[data-page="dev"]');
    assert.match(dev, /129-221-199-191\.sslip\.io/);
    assert.doesNotMatch(dev, /zetaphy_faucet|rpc\.sawasdeecoin\.com/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await site.close();
  }
});
