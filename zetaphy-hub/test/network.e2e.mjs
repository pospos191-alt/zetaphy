// Browser test: the hub on mainnet (network.js; the only network since the testnet was shut down on 2026-11-14), on a
// built dist/. Mainnet: its own node, badge and risk line, no network switch, chain 3659 everywhere, staking and votes
// signed for chain 0xe4b only, the public sentry's faucet with the node's own amounts and budget (and plain words once
// today's budget is used up), the tabs whose contracts are in zetaphy-launch/state/3659.contracts.json open (AI agents,
// the AI map), "not on mainnet yet" (never a testnet contract) for what is not deployed there. A saved testnet choice
// from before and a ?network=testnet link open mainnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { answer } from './mocknode.mjs';
import { NET_TEXT } from '../network.js';
import { MAINNET_TEXT } from '../mainnet-i18n.js';
import { TEXT, LANG_CODES } from '../i18n.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const exe = process.env.CHROMIUM_PATH || undefined;
const MAINNET = 'https://129-221-199-191.sslip.io';
const TESTNET_HOSTS = ['rpc.sawasdeecoin.com', 'explorer.sawasdeecoin.com'];
const MAIN = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'zetaphy-launch', 'state', '3659.contracts.json'), 'utf8'));

test('the hub on mainnet: badge, no switch, chain 3659, tabs gated only where mainnet has no contracts, votes for chain 0xe4b; a saved or linked testnet opens mainnet', { timeout: 120_000 }, async () => {
  const site = await serve(DIST);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const asked = []; // every outside origin the page reached
    // mainnet's faucet as the sentry reports it (setup-node.sh MAINNET_FAUCET=1: 1 / 5 / 200 ZTPHY)
    const E = (n) => `0x${(BigInt(n) * 10n ** 18n).toString(16)}`;
    let mainFaucet = { enabled: true, bits: 8, chainId: 3659, reward: E(5), faucetReward: E(1), dayBudget: E(200), remainingBudget: E(194), remainingToday: 38, perDay: 200, maxAgeBlocks: 100 };
    let faucetGrants = 0; // zetaphy_faucet calls on mainnet
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === new URL(site.url).origin) return route.continue();
      asked.push(u.host);
      const body = route.request().postData() ?? '';
      if (u.origin === MAINNET && /"zetaphy_faucetPowInfo"/.test(body)) {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: mainFaucet }) });
      }
      if (u.origin === MAINNET && /"zetaphy_faucet"/.test(body)) faucetGrants++;
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
    assert.equal(await page.locator('#net-switch, header select:not(#lang), .zn-net-select, .zn-gate-switch').count(), 0, 'no network switch anywhere');
    assert.match(await page.textContent('#endpoints'), /3659 · zetaphy_3659-1.*129-221-199-191\.sslip\.io/s);
    assert.doesNotMatch(await page.textContent('#endpoints'), /77390|sawasdeecoin/);
    // the mainnet faucet (the public sentry's): the form, the node's own amounts and today's budget, a grant
    assert.ok(await page.isVisible('#faucet-form'));
    assert.ok(await page.isHidden('#faucet-gate'));
    await page.waitForSelector('#faucet-state:not([hidden])');
    assert.equal(await page.textContent('#faucet-state'), 'Faucet now: 1 ZTPHY per address a day; 5 ZTPHY per browser-mining proof. 194 of 200 ZTPHY left today (UTC).');
    assert.equal(await page.textContent('[data-i18n="step2"]'), 'Get ZTPHY for fees (free)');
    await page.fill('#faucet-addr', '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245');
    await page.click('#faucet-form button');
    await page.waitForFunction(() => document.getElementById('faucet-msg').classList.contains('ok'));
    assert.match(await page.textContent('#faucet-msg'), /^ZTPHY sent/);
    assert.equal(faucetGrants, 1);
    // tabs whose contracts are not on mainnet yet: marked, and opened they show the plain box (nothing to click),
    // never their page or app. Exactly these, as the build found 3659.contracts.json (no bridge, NFT app, offline
    // trading, audit network, quantum rescue or immune network contracts there).
    const gatedTabs = await page.$$eval('.tab[data-gated]', (as) => as.map((a) => a.dataset.tab).sort());
    assert.deepEqual(gatedTabs, ['audit', 'immune', 'nft', 'offline', 'quantum', 'saphan']);
    assert.equal(await page.textContent('.tab[data-tab="nft"] .new'), 'soon');
    assert.doesNotMatch(await page.textContent('#tabs'), /testnet/i);
    for (const tab of ['earn', 'mine', 'agents', 'ai', 'aichain']) assert.equal(await page.locator(`.tab[data-tab="${tab}"][data-gated]`).count(), 0, `${tab}: open on mainnet`);
    for (const [tab, words] of [['nft', /^Not on mainnet yetThe NFT marketplace is not on ZETAPHY mainnet yet\. It appears here once its contracts are deployed on mainnet\. \(The testnet was shut down on 2026-11-14\.\)$/],
      ['saphan', /^Not on mainnet yetZETAPHY Saphan \(the bridge\) is not on ZETAPHY mainnet yet\./], ['offline', /^Not on mainnet yetOffline trading is not on ZETAPHY mainnet yet\./],
      ['immune', /^Not on mainnet yetThe immune network is not on ZETAPHY mainnet yet\./]]) {
      await page.click(`.tab[data-tab="${tab}"]`);
      await page.waitForSelector('#panel-gate:not([hidden])');
      assert.match(await page.textContent('#panel-gate'), words, tab);
      assert.equal(await page.locator('#panel-gate button, #panel-gate select, #panel-gate a').count(), 0, `${tab}: nothing to click in the box`);
      assert.equal(await page.locator(`.panel[data-page="${tab}"]`).count(), 0, `${tab}: its page is not drawn`);
    }
    assert.equal(await page.locator('#frames iframe[src^="nft/"]').count(), 0, 'the NFT app is not loaded');
    // AI agents: its contracts (intent executor, label and agent registries) are on mainnet, so the tab is open with them
    await page.click('.tab[data-tab="agents"]');
    await page.waitForSelector('.panel[data-page="agents"]:not([hidden]) #ag-ag-c');
    assert.ok(await page.isHidden('#panel-gate'));
    assert.equal(await page.locator('.panel[data-page="agents"] .zn-gate').count(), 0, 'no "not on mainnet yet" box in it');
    assert.equal(await page.inputValue('#ag-lab-c'), MAIN.contracts.labelRegistry, 'mainnet\'s label registry');
    assert.equal(await page.inputValue('#ag-ag-c'), MAIN.contracts.agentRegistry, 'mainnet\'s agent registry');
    // Earn and Mine on mainnet: the faucet's own words, its amounts from the node
    await page.click('.tab[data-tab="earn"]');
    await page.waitForSelector('.panel[data-page="earn"]:not([hidden]) #ef-form');
    assert.ok(await page.isHidden('#panel-gate'));
    await page.waitForSelector('#ef-state:not([hidden])');
    assert.match(await page.textContent('#ef-state'), /1 ZTPHY per address a day.*194 of 200 ZTPHY left today/);
    assert.match(await page.textContent('.panel[data-page="earn"]'), /a little ZTPHY for fees/);
    assert.doesNotMatch(await page.textContent('.panel[data-page="earn"]'), /10 test ZETAPHY/);
    await page.click('.tab[data-tab="mine"]');
    await page.waitForSelector('#mn-faucet:not([hidden])');
    assert.match(await page.textContent('#mn-faucet'), /5 ZTPHY per browser-mining proof.*194 of 200 ZTPHY left today/);
    assert.equal(await page.textContent('#mn-reward'), '5 ZTPHY');
    assert.match(await page.textContent('.panel[data-page="mine"]'), /real mainnet ZTPHY/);
    // today's budget used up: said plainly, nothing asked of the faucet, no mining started
    mainFaucet = { ...mainFaucet, remainingBudget: '0x0', remainingToday: 0 };
    await page.fill('#mn-addr', '0x6af57fC3633dD0F7907f7900dbd4A2822F43f00d');
    await page.click('#mn-start');
    await page.waitForFunction(() => /budget is used up/.test(document.getElementById('mn-msg').textContent));
    assert.equal(await page.getAttribute('#mn-status', 'data-s'), 'error');
    await page.click('.tab[data-tab="home"]');
    await page.click('#faucet-form button');
    await page.waitForFunction(() => /budget is used up/.test(document.getElementById('faucet-msg').textContent));
    assert.equal(await page.textContent('#faucet-state'), "Today's faucet budget is used up. Try again tomorrow (UTC).");
    assert.equal(faucetGrants, 1, 'no grant asked once the budget is used up');
    // the faucet off on the sentry: said plainly too
    mainFaucet = { ...mainFaucet, enabled: false, remainingBudget: E(200) };
    await page.click('#faucet-form button');
    await page.waitForFunction(() => /faucet is off/.test(document.getElementById('faucet-msg').textContent));
    assert.equal(faucetGrants, 1);

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

    // a testnet choice saved in this browser before the shutdown: mainnet, and the saved value is cleared
    await page.evaluate(() => localStorage.setItem('zetaphy:network', 'testnet'));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('s-height').textContent === '123,456');
    assert.equal(await page.textContent('#net-badge'), 'ZETAPHY mainnet');
    assert.equal(await page.evaluate(() => localStorage.getItem('zetaphy:network')), null, 'the saved testnet is cleared');
    assert.match(await page.textContent('#endpoints'), /3659 · zetaphy_3659-1/);
    assert.doesNotMatch(await page.textContent('#endpoints'), /77390|sawasdeecoin/);
    // a ?network=testnet link: mainnet too, nothing saved; a testnet-only tab still shows the box
    await page.goto(`${site.url}?network=testnet&tab=nft`);
    await page.waitForSelector('#panel-gate:not([hidden])');
    assert.match(await page.textContent('#panel-gate'), /^Not on mainnet yet/);
    assert.equal(await page.textContent('#net-badge'), 'ZETAPHY mainnet');
    assert.match(await page.textContent('#endpoints'), /3659 · zetaphy_3659-1/);
    assert.equal(await page.evaluate(() => localStorage.getItem('zetaphy:network')), null);
    assert.ok(!asked.some((h) => TESTNET_HOSTS.includes(h)), `still nothing asked of the testnet: ${[...new Set(asked)]}`);
    // the risk-forecasts page (its contracts are not on mainnet)
    await page.goto(`${site.url}forecasts.html`);
    await page.waitForSelector('#net-gate .zn-gate');
    assert.match(await page.textContent('#net-gate'), /ZETAPHY mainnet.*Not on mainnet yet.*Risk forecasts is not on ZETAPHY mainnet yet/s);
    assert.equal(await page.locator('#net-gate button, #net-gate select').count(), 0, 'no switch on the forecasts page');
    assert.ok(await page.isHidden('#ftabs'));
    // the certificate check and the Audit Directory: the audit network has no mainnet contracts yet
    asked.length = 0;
    for (const f of ['audit.html', 'audits.html']) {
      await page.goto(`${site.url}${f}`);
      await page.waitForSelector('#net .zn-gate');
      assert.match(await page.textContent('#net'), /ZETAPHY mainnet.*Not on mainnet yet.*The audit network is not on ZETAPHY mainnet yet/s, f);
      assert.equal(await page.locator('#net button, #net select').count(), 0, `${f}: no switch`);
      assert.ok(await page.isHidden(f === 'audit.html' ? '#form' : '.filters'), `${f}: nothing to look up`);
      assert.ok(await page.isHidden('[data-t="testnet"]'), `${f}: no testnet note under the mainnet badge`);
    }
    assert.ok(!asked.some((h) => TESTNET_HOSTS.includes(h)), `the audit pages asked nothing of the testnet: ${[...new Set(asked)]}`);
    // the zkML ceremony touches no chain: its header and badge name the page's network
    await page.goto(`${site.url}ceremony.html`);
    await page.waitForSelector('#net .zn-net-mainnet');
    assert.equal(await page.textContent('#eyebrow'), 'ZETAPHY · zetaphy_3659-1');
    // the validator guide is about joining the testnet (its faucet and auto-stake): "not on mainnet yet" too
    await page.goto(`${site.url}validators.html`);
    await page.waitForSelector('#net-gate .zn-gate');
    assert.match(await page.textContent('#net-gate'), /Joining as a validator is not on ZETAPHY mainnet yet/);
    assert.ok(await page.isHidden('#vf-form'), 'no faucet form');
    // the developers page: mainnet's endpoints, contracts and faucet command
    await page.goto(`${site.url}?tab=dev`);
    await page.waitForSelector('.panel[data-page="dev"]:not([hidden]) .tbl');
    const dev = await page.textContent('.panel[data-page="dev"]');
    assert.match(dev, /129-221-199-191\.sslip\.io/);
    assert.match(dev, /zetaphy_faucet/, 'the mainnet faucet\'s command');
    assert.doesNotMatch(dev, /rpc\.sawasdeecoin\.com/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await site.close();
  }
});

// The Overview as the owner saw it (Thai, a wide desktop and a phone): step 3's app buttons wrap inside their card and
// never draw over the mainnet card below; the sidebar marks only the tabs not on mainnet yet, with "soon" in the page's
// language (never "testnet"); one risk notice; and no open tab still talks about the testnet, test coins or chain 77390.
test('the Overview and every open tab on mainnet: no overlap (1900x900, short desktops, 360 wide), "soon" badges only where gated, no testnet words (8 languages)', { timeout: 240_000 }, async () => {
  const site = await serve(DIST);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1900, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === new URL(site.url).origin) return route.continue();
      let a = u.origin === MAINNET ? answer(u.href.replace(u.origin, 'https://rpc.sawasdeecoin.com'), route.request().postData()) : null;
      if (a && a.result === '0x12e4e') a = { ...a, result: '0xe4b' };
      if (a) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a) });
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    });
    await page.goto(site.url);
    await page.waitForFunction(() => document.getElementById('s-height').textContent === '123,456');
    await page.selectOption('#lang', 'th');
    await page.waitForFunction(() => document.documentElement.lang === 'th');
    const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    // the owner's 1900x900, shorter desktop windows (where the old fixed-height grid let step 3 spill over), a phone
    for (const [w, h] of [[1900, 900], [1900, 650], [1280, 720], [1024, 700], [360, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      const start = await page.locator('.card.start').boundingBox();
      const card = await page.locator('#mainnet').boundingBox();
      const chips = await page.$$eval('#quick .chip', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, text: c.textContent }; }));
      assert.ok(chips.length >= 10, `${w}: the app buttons are there (${chips.length})`);
      for (const c of chips) {
        assert.ok(!overlap(c, card), `${w}px: "${c.text}" draws over the mainnet card (${JSON.stringify(c)} vs ${JSON.stringify(card)})`);
        assert.ok(c.y + c.height <= start.y + start.height + 0.5 && c.x + c.width <= start.x + start.width + 0.5, `${w}px: "${c.text}" stays inside its card`);
      }
      assert.ok(start.y + start.height <= card.y + 0.5, `${w}px: the mainnet card starts below the steps`);
    }
    await page.setViewportSize({ width: 1900, height: 900 });
    // one risk notice (the network bar); the card keeps its links and has no testnet line
    assert.equal(await page.locator(`text=${NET_TEXT.th.risk}`).count(), 1, 'the risk sentence once');
    assert.ok(await page.isVisible('#net-note .zn-net-risk'));
    assert.deepEqual(await page.$$eval('#mainnet .mainnet-links > *', (l) => l.map((x) => x.textContent)), [MAINNET_TEXT.th.add, MAINNET_TEXT.th.notice, MAINNET_TEXT.th.files]);
    assert.doesNotMatch(await page.textContent('#mainnet'), /testnet|77390|สลับ/);
    // step 2 on mainnet: the faucet form, no gate
    assert.ok(await page.isVisible('#faucet-form'));
    assert.ok(await page.isHidden('#faucet-gate'));

    const GATED = ['audit', 'immune', 'nft', 'offline', 'quantum', 'saphan'];
    const OPEN = ['home', 'stake', 'earn', 'mine', 'agents', 'ai', 'analytics', 'defi', 'leaderboard', 'gov', 'aichain', 'dev'];
    const TESTNET_WORDS = /testnet|77390|test ZETAPHY|test coins|ZETAPHY ทดลอง|เหรียญทดลอง|เทสต์เน็ต|测试网|测试币|테스트넷|테스트 코인|テストネット|テスト用コイン|тестнет|тестовые монеты|тестовых ZETAPHY|coin thử nghiệm|monedas de prueba/i;
    for (const l of LANG_CODES) {
      await page.selectOption('#lang', l);
      await page.waitForFunction((x) => document.documentElement.lang === x, l);
      const badges = await page.$$eval('.tab', (ts) => ts.filter((t) => t.querySelector('.new')).map((t) => [t.dataset.tab, t.querySelector('.new').textContent]));
      assert.deepEqual(badges.map(([t]) => t).sort(), GATED, `${l}: badges only on the tabs not on mainnet yet`);
      for (const [t, b] of badges) assert.equal(b, TEXT[l].tabSoon, `${l} ${t}`);
      assert.doesNotMatch(badges.map(([, b]) => b).join(' '), TESTNET_WORDS, l);
      for (const tab of OPEN) {
        await page.click(`.tab[data-tab="${tab}"]`);
        await page.waitForSelector(tab === 'home' ? '#panel-home:not([hidden])' : tab === 'stake' ? '#panel-stake:not([hidden])' : `.panel[data-page="${tab}"]:not([hidden])`);
        await page.waitForTimeout(150);
        const seen = await page.evaluate(() => [...document.querySelectorAll('.panel:not([hidden]), #how:not([hidden]), #net-note, header, #tabs')].map((e) => e.innerText)
          .concat([...document.querySelectorAll('[data-tip]')].filter((e) => e.offsetParent).map((e) => e.dataset.tip)).join('\n'));
        // the mainnet card's hover text says when the testnet was shut down; nothing else may mention it
        const left = seen.split('\n').filter((x) => TESTNET_WORDS.test(x) && !x.includes('2026-11-14'));
        assert.deepEqual(left, [], `${l} ${tab}: testnet words left`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await site.close();
  }
});
