// Browser test: got-ztphy.html ("Did you get ZTPHY?") on a built dist/, served with the site's CSP (vercel.json), the
// public RPC answered by this test (eth_getBalance only). With a published list (airdrop-push/manifest.json + shards,
// served here): an address on the list with 10 ZTPHY, one on the list with 0, one not on it, one whose shard does not
// exist; typed as 0x, as zetaphy1, with Enter, from ?a=; a bad checksum is refused. A stand-in wallet: "Add ZETAPHY"
// sends exactly network.js addChainParams, "Use my wallet's address" asks eth_requestAccounts, nothing else is ever
// asked. Share: Web Share API when there is one, else the clipboard. Without a list: the balance only. RPC down: says
// so. 8 languages with the safety rules in large text, the notice's risk sentence, a phone, no sideways scroll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { getAddress, hexlify } from 'ethers';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { build } from '../build.mjs';
import { NETWORKS, addChainParams, NET_TEXT } from '../network.js';
import { toBech32 } from '../chainlib.js';
import { buildPushFiles } from '../got-ztphy-core.js';
import { GOT } from '../got-ztphy-i18n.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.CHROMIUM_PATH || undefined;
const vercel = JSON.parse(readFileSync(join(HERE, 'vercel.json'), 'utf8'));
const CSP = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
const RPC = NETWORKS.mainnet.rpc;
const TEN = 10n * 10n ** 18n;

/** An address whose first two hex characters are `p`. */
const withPrefix = (p) => getAddress(`0x${p}${hexlify(randomBytes(19)).slice(2)}`);

/** The stand-in wallet (window.ethereum, MetaMask-like), installed before the page's scripts run. */
const stub = ({ account, wallet, share }) => {
  window.__calls = [];
  window.__copied = null;
  window.__shared = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { window.__copied = s; } } });
  if (share) Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d; } });
  else Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  if (!wallet) return;
  window.ethereum = { isMetaMask: true, request: async ({ method, params }) => {
    window.__calls.push({ method, params });
    if (method === 'eth_requestAccounts') return [account.toLowerCase()];
    if (method === 'wallet_addEthereumChain') return null;
    throw new Error(`${method} must never be called`);
  } };
};

test('got-ztphy.html: balance of any address, the airdrop list, add the network, share (8 languages, phone width)', { timeout: 120_000 }, async () => {
  // the build ships the published list (airdrop-push/); this test serves its own small list, or none, over a copy without it
  const dist = mkdtempSync(join(tmpdir(), 'got-ztphy-'));
  cpSync(build(), dist, { recursive: true, filter: (src) => !/[\\/]airdrop-push([\\/]|$)/.test(src) });
  const on10 = withPrefix('ab'), on0 = withPrefix('ab'), off = withPrefix('ab'), noShard = withPrefix('cd'), mine = withPrefix('ef');
  const listText = `${[on10, on0, mine, withPrefix('12')].join('\n')}\n`;
  const sha256 = createHash('sha256').update(listText).digest('hex');
  const { manifest, shards } = buildPushFiles(listText, { sha256 });
  const files = { '/airdrop-push/manifest.json': JSON.stringify(manifest), '/airdrop-push/list.txt': listText };
  for (const [p, addresses] of Object.entries(shards)) files[`/airdrop-push/shards/${p}.json`] = JSON.stringify({ addresses });
  const withList = await serve(dist, { headers: { 'Content-Security-Policy': CSP }, files });
  const noList = await serve(dist, { headers: { 'Content-Security-Policy': CSP } });
  const balances = { [on10.toLowerCase()]: TEN, [on0.toLowerCase()]: 0n, [off.toLowerCase()]: 1234567n * 10n ** 12n, [noShard.toLowerCase()]: 0n, [mine.toLowerCase()]: TEN + 5n * 10n ** 17n };
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const open = async (site, { path = 'got-ztphy.html?lang=en', wallet = true, share = false, rpcDown = false } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const outside = [];
      page.on('request', (r) => { if (!r.url().startsWith(site.url)) outside.push(r.url()); });
      const rpc = [];
      await page.route((u) => u.href.startsWith(RPC), async (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
        const body = JSON.parse(req.postData());
        rpc.push(body.method);
        if (rpcDown) return route.fulfill({ status: 503, body: 'down', headers: { 'access-control-allow-origin': '*' } });
        const bal = balances[String(body.params?.[0]).toLowerCase()] ?? 0n;
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: `0x${bal.toString(16)}` }) });
      });
      await page.addInitScript(stub, { account: mine, wallet, share });
      await page.goto(`${site.url}${path}`);
      await page.waitForFunction(() => document.getElementById('risk').textContent.length > 0);
      return { page, ctx, errors, outside, rpc };
    };
    const checkAddr = async (page, typed, how = 'click') => {
      await page.fill('#addr', typed);
      if (how === 'enter') await page.press('#addr', 'Enter'); else await page.click('#check');
      await page.waitForFunction(() => !document.getElementById('found').hidden || /bad/.test(document.getElementById('state').className));
    };

    // ---- with the published list
    const { page, ctx, errors, outside, rpc } = await open(withList);
    assert.equal(await page.textContent('h1'), 'Did you get ZTPHY?');
    const safety = await page.textContent('#safety');
    for (const k of ['safe1', 'safe2', 'safe3', 'safe4']) assert.ok(safety.includes(GOT.en[k]), k);
    const px = await page.$eval('#safety p', (p) => parseFloat(getComputedStyle(p).fontSize));
    assert.ok(px >= 20, `the safety rules are large (${px}px)`);
    assert.equal(await page.textContent('#risk'), NET_TEXT.en.risk);
    assert.equal(await page.getAttribute('#notice', 'href'), 'https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md');
    await page.waitForFunction(() => !document.getElementById('listInfo').hidden);
    assert.match(await page.textContent('#listInfo'), new RegExp(`4 addresses, sha256 ${sha256}`));
    assert.equal(await page.getAttribute('#listInfo a', 'href'), `${withList.url}airdrop-push/list.txt`);

    await checkAddr(page, on10.toLowerCase());
    assert.equal(await page.textContent('#balance'), '10 ZTPHY');
    assert.match(await page.textContent('#balanceOf'), new RegExp(on10)); // shown in its EIP-55 form
    assert.match(await page.textContent('#same'), new RegExp(toBech32(on10)));
    assert.equal(await page.textContent('#list'), 'On the airdrop list: 10 ZTPHY was sent to this address.');
    await checkAddr(page, toBech32(on0), 'enter');
    assert.equal(await page.textContent('#balance'), '0 ZTPHY');
    assert.match(await page.textContent('#list'), /On the airdrop list.*may still be on their way/);
    await checkAddr(page, off);
    assert.equal(await page.textContent('#balance'), '1.234567 ZTPHY');
    assert.equal(await page.textContent('#list'), 'This address is not on the airdrop list.');
    await checkAddr(page, noShard);
    assert.equal(await page.textContent('#list'), 'This address is not on the airdrop list.', 'no shard file: not on the list');
    // a typo in the checksum, garbage: refused, the chain is not asked
    const n = rpc.length;
    const j = [...on10].findIndex((c, i) => i > 1 && /[a-fA-F]/.test(c));
    const flipped = on10.slice(0, j) + (on10[j] === on10[j].toUpperCase() ? on10[j].toLowerCase() : on10[j].toUpperCase()) + on10.slice(j + 1);
    await checkAddr(page, flipped);
    assert.match(await page.textContent('#state'), /checksum/);
    assert.equal(await page.isHidden('#found'), true);
    await checkAddr(page, 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
    assert.equal(await page.textContent('#state'), GOT.en.bad);
    assert.equal(rpc.length, n);

    // the wallet: add the network (network.js parameters), then its own address
    assert.equal(await page.textContent('#wallets button'), 'Add ZETAPHY to MetaMask');
    assert.equal(await page.isHidden('#inapp'), true);
    await page.click('#wallets button');
    await page.waitForFunction(() => /ZETAPHY is in your wallet/.test(document.getElementById('addState').textContent));
    await page.click('#mine');
    await page.waitForFunction((a) => document.getElementById('balanceOf').textContent.includes(a), mine);
    assert.equal(await page.textContent('#balance'), '10.5 ZTPHY');
    assert.match(await page.textContent('#list'), /On the airdrop list/);
    const calls = await page.evaluate(() => window.__calls);
    assert.deepEqual(calls.map((c) => c.method), ['wallet_addEthereumChain', 'eth_requestAccounts'], 'never a signature, a transaction or an approval');
    assert.deepEqual(calls[0].params, [addChainParams(NETWORKS.mainnet)]);
    assert.deepEqual([...new Set(rpc)], ['eth_getBalance']);

    await page.screenshot({ path: join(HERE, 'dist', 'got-ztphy-en.png'), fullPage: true });
    // share without the Web Share API: the clipboard gets the text and the official page URL
    await page.click('#share');
    await page.waitForFunction(() => window.__copied);
    assert.equal(await page.evaluate(() => window.__copied), `${GOT.en.shareText} https://app.sawasdeecoin.com/got-ztphy.html`);
    assert.equal(await page.textContent('#shareState'), GOT.en.copied);

    // every language; Thai; the hub's language is remembered
    for (const l of ['zh', 'es', 'ko', 'ja', 'ru', 'vi', 'th']) {
      await page.selectOption('#lang', l);
      for (const el of await page.$$('[data-t]')) assert.ok((await el.textContent()).trim().length > 0, `${l}: empty text`);
      assert.equal(await page.textContent('#risk'), NET_TEXT[l].risk, `${l}: risk sentence`);
      assert.equal(await page.textContent('#list'), GOT[l].onList.replace('{each}', '10'), `${l}: the result is translated too`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${l}: no sideways scroll at phone width`);
    }
    assert.equal(await page.textContent('h1'), 'ได้รับ ZTPHY ไหม?');
    assert.equal(await page.textContent('#safety .scam'), 'ใครที่ขอ คือมิจฉาชีพ');
    assert.equal(await page.getAttribute('#notice', 'href'), 'https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.th.md');
    assert.equal(await page.evaluate(() => localStorage.getItem('zetaphy-hub:lang')), 'th');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'th');
    assert.deepEqual([...new Set(outside.map((u) => new URL(u).origin))], [RPC], 'nothing leaves the site but the RPC');
    assert.deepEqual(errors.filter((e) => !/Failed to load resource|favicon/.test(e)), []);
    await page.screenshot({ path: join(HERE, 'dist', 'got-ztphy-th.png'), fullPage: true });
    await ctx.close();

    // ---- an address in the link (?a=), the Web Share API
    const b = await open(withList, { path: `got-ztphy.html?lang=en&a=${on10}`, share: true });
    await b.page.waitForFunction(() => !document.getElementById('found').hidden);
    assert.equal(await b.page.textContent('#balance'), '10 ZTPHY');
    await b.page.click('#share');
    await b.page.waitForFunction(() => window.__shared);
    assert.deepEqual(await b.page.evaluate(() => window.__shared), { title: GOT.en.title, text: GOT.en.shareText, url: 'https://app.sawasdeecoin.com/got-ztphy.html' });
    assert.equal(await b.page.evaluate(() => window.__copied), null);
    await b.ctx.close();

    // ---- no list published yet, no wallet in this browser: the balance only, the in-app links
    const c = await open(noList, { wallet: false });
    await checkAddr(c.page, on10);
    assert.equal(await c.page.textContent('#balance'), '10 ZTPHY');
    assert.equal(await c.page.textContent('#list'), '');
    assert.equal(await c.page.isHidden('#listInfo'), true);
    assert.equal(await c.page.$$eval('#wallets button', (x) => x.length), 0);
    assert.equal(await c.page.textContent('#addState'), GOT.en.noWallet);
    assert.equal(await c.page.isVisible('#inapp'), true);
    assert.match(await c.page.getAttribute('#inappLinks a', 'href'), /^https:\/\/metamask\.app\.link\/dapp\//);
    await c.page.click('#mine');
    assert.equal(await c.page.textContent('#state'), GOT.en.noWallet);
    assert.deepEqual(c.errors.filter((e) => !/Failed to load resource|favicon/.test(e)), []);
    await c.ctx.close();

    // ---- the RPC is down
    const d = await open(noList, { rpcDown: true });
    await checkAddr(d.page, on10);
    assert.equal(await d.page.textContent('#state'), GOT.en.rpcErr);
    assert.equal(await d.page.isHidden('#found'), true);
    await d.ctx.close();
  } finally {
    await browser.close();
    await withList.close();
    await noList.close();
    rmSync(dist, { recursive: true, force: true });
  }
});
