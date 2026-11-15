// Browser test of #/holders (src/richlist.js), on mainnet as visitors see it, with the real CSP (scripts/serve.js) and
// the mock node of test/mock-chain.js behind Playwright routes (no network). /holders.json is the daily snapshot
// (scripts/holders-snapshot.js), built here from a stub bank module and served by a Playwright route; without the route
// serve.js answers 404, as a site with no snapshot yet would.
//   node --test test/holders.e2e.js     (HOLDERS_E2E_PORT: another free port)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { hexToBytes, toBech32 } from '../vendor/zetaphy-lib.js';
import { buildChain, ME, ME_HEX, HOLDERS_LIVE } from './mock-chain.js';
import { buildSnapshot } from '../src/holders-core.js';
import { projectLabels, moduleAccounts, repoReader, snapshotJson } from '../scripts/holders-snapshot.js';
import { moduleAddress } from '../scripts/known.js';

const MODS = await moduleAccounts();
const MAINNET_HOST = '129-221-199-191.sslip.io';
const PORT = Number(process.env.HOLDERS_E2E_PORT) || await new Promise((r) => { const sv = createServer().listen(0, '127.0.0.1', () => { const { port } = sv.address(); sv.close(() => r(port)); }); });
const ORIGIN = `http://localhost:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'zetaphy-holders-'));
const chain = buildChain();
let server; let browser;

const Z = 10n ** 18n;
const FAUCET = '0x766690Cc27485dedC4d01Eb10AC66dbAb4FD0160';
const REWARDS = '0x3B87f248a644aA66Bf35a33c26AbefF3326b3dD7';
const AIRDROP_KEY = '0x8072ea3cc08c57b2280d78c46eec925b46316318'; // zetaphy1spew50xq33tmy2qd0rzxamyjtdrrzcccc0r7xq (scripts/project-wallets.json)
const bech = (hex) => toBech32(hexToBytes(hex.replace(/^0x/, '')), 'zetaphy');
const addrN = (n) => '0x' + n.toString(16).padStart(40, '0');

/** A snapshot like the daily job writes: the allocations, the bonded pool, the faucet, 150 airdropped 10 ZTPHY, dust. */
function snapshot({ time = new Date(Date.now() - 2 * 3600_000).toISOString(), labels = projectLabels(repoReader(), MODS) } = {}) {
  const owners = [
    [REWARDS, 500_000_000n * Z], ['0xaE842c15Ad4A6D6027597C3c3d44A4ada8FB0318', 200_000_000n * Z], ['0x53E762B680b28a378cE33eafc6b6384D9DF4B989', 150_000_000n * Z],
    [moduleAddress('bonded_tokens_pool'), 1_000_000n * Z], [FAUCET, 50_000n * Z], [AIRDROP_KEY, 97n * Z],
    ...Array.from({ length: 150 }, (_, i) => [addrN(0x1000 + i), 10n * Z]),
    [addrN(0x9999), Z / 2n],
  ].map(([a, amount]) => ({ address: bech(a), amount }));
  const supply = owners.reduce((s, o) => s + o.amount, 0n);
  return snapshotJson(buildSnapshot({ owners, supply, labels, meta: { height: '4242', time, chainId: 'zetaphy_3659-1', evmChainId: 3659, holdersReported: 100123, pages: 101, pageLimit: 1000 } }));
}

before(async () => {
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ scanBlocks: 100 }));
  server = spawn(process.execPath, ['scripts/serve.js', String(PORT)], { stdio: 'pipe', cwd: new URL('..', import.meta.url), env: { ...process.env, EXPLORER_CONFIG: cfg, EXPLORER_HOLDERS: join(dir, 'none.json') } });
  await new Promise((r, j) => { server.stdout.once('data', r); server.once('exit', (c) => j(new Error(`serve.js exited (${c}): port ${PORT} in use? Set HOLDERS_E2E_PORT.`))); });
  try { browser = await chromium.launch({ headless: true }); } catch {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
  }
});
after(async () => { server?.kill(); await browser?.close(); rmSync(dir, { recursive: true, force: true }); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

/** holders: the /holders.json body (text), or null for none (serve.js answers 404). */
async function openPage({ holders = null, lang = 'en', viewport } = {}) {
  const ctx = await browser.newContext({ viewport: viewport ?? { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const problems = []; const calls = []; let snapshotRequests = 0;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await ctx.routeWebSocket(/^wss:\/\//, (sock) => sock.close());
  if (holders != null) {
    await ctx.route(`${ORIGIN}/holders.json`, (route) => { snapshotRequests++; return route.fulfill({ status: 200, contentType: 'application/json', body: holders }); });
  } else {
    await ctx.route(`${ORIGIN}/holders.json`, (route) => { snapshotRequests++; return route.continue(); });
  }
  await ctx.route((url) => url.host !== `localhost:${PORT}` && url.host !== MAINNET_HOST, (route) => route.fulfill({ status: 503, headers: CORS, body: 'offline in tests' }));
  await ctx.route((url) => url.host === MAINNET_HOST, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (url.pathname.startsWith('/rest/')) {
      const body = chain.rest(url.pathname.slice(5) + url.search);
      return body ? json(200, body) : json(501, { code: 12, message: 'Not Implemented' });
    }
    const body = JSON.parse(req.postData() ?? '{}');
    const handler = url.pathname.startsWith('/rpc/') ? chain.comet : url.pathname === '/' ? chain.evmRpc : null;
    if (!handler) return json(404, { error: 'not found' });
    const answer = ({ id, method, params }) => {
      calls.push({ side: url.pathname.startsWith('/rpc/') ? 'comet' : 'evm', method, params });
      try { return { jsonrpc: '2.0', id, result: handler(method, params) }; } catch (e) { return { jsonrpc: '2.0', id, error: { code: e.code ?? -32603, message: e.message } }; }
    };
    return json(200, Array.isArray(body) ? body.map(answer) : answer(body));
  });
  await page.addInitScript((l) => { try { localStorage.setItem('zetaphy-explorer:lang', l); } catch { /* none */ } }, lang);
  return { page, ctx, problems, calls, snapshotRequests: () => snapshotRequests };
}

const text = (page) => page.locator('main').innerText();
const go = (page, hash) => page.goto(`${ORIGIN}/${hash}`);
async function waitText(page, s, timeout = 20000) {
  try { await page.waitForFunction((x) => document.querySelector('main')?.innerText.includes(x), s, { timeout }); } catch {
    throw new Error(`"${s}" never appeared on ${page.url()}; the page shows:\n${(await text(page).catch(() => '?')).slice(0, 3000)}`);
  }
}

test('holders: count, snapshot block and time, live count, project wallets vs everyone else, top 100 with labels, bands', async () => {
  const { page, ctx, problems, calls, snapshotRequests } = await openPage({ holders: snapshot() });
  await go(page, '#/holders');
  await waitText(page, 'Top 100 holders');
  await waitText(page, '100,234'); // the live count (DenomOwners count_total through abci_query)
  const t = await text(page);
  assert.match(t, /ZTPHY holders/);
  assert.match(t, /Holders\s+100,123/i); // stat labels are upper case (CSS)
  assert.match(t, /Holders now \(live\): 100,234/);
  assert.match(t, /Snapshot block\s+4,242/i);
  assert.match(t, /updated daily/);
  assert.ok(!/This snapshot is old|No holders snapshot/.test(t));
  assert.equal(await page.getAttribute('a[href="#/block/4242"]', 'class'), 'mono');
  // project wallets / modules / everyone else
  const groups = await page.locator('table.nh-groups').innerText();
  assert.match(groups, /Project wallets\s+5\s+850,050,097 ZTPHY\s+99\.8\d%/); // 3 allocations, the faucet, the airdrop hot key
  assert.match(groups, /Chain modules \(staking pool, fees, …\)\s+1\s+1,000,000 ZTPHY\s+0\.1\d+%/);
  assert.match(groups, /Everyone else\s+151\s+1,500 ZTPHY/);
  assert.equal(await page.locator('.dist-bar .dist-seg').count(), 3);
  // labelled wallets (closed by default), the airdrop hot key among them
  await page.click('details.nh-wallets summary');
  const wallets = await page.locator('table.nh-wallet-table').innerText();
  assert.match(wallets, /Rewards\s+multisig/);
  assert.match(wallets, /Faucet\s+faucet/);
  assert.match(wallets, /ZetaphyTimelock\s+timelock/);
  assert.match(wallets, /Airdrop hot key\s+airdrop/);
  // top list: 100 rows, largest first, the snapshot's labels as chips, both address forms in the link title
  const rows = page.locator('table.nh-top tbody tr');
  assert.equal(await rows.count(), 100);
  assert.match(await rows.nth(0).innerText(), /^1\s+0x3B87f2…/);
  assert.match(await rows.nth(0).innerText(), /Rewards\s+500,000,000 ZTPHY\s+58\.\d+%/);
  assert.match(await rows.nth(3).innerText(), /Bonded tokens pool \(module\)/);
  assert.match(await rows.nth(4).innerText(), /Faucet\s+50,000 ZTPHY/);
  assert.match(await rows.nth(5).innerText(), /Airdrop hot key\s+97 ZTPHY\s+<0\.0001%/);
  assert.match(await rows.nth(6).innerText(), /10 ZTPHY\s+<0\.0001%/);
  assert.equal(await page.locator('table.nh-top .label-project').first().innerText(), 'Rewards');
  assert.match(await page.locator(`table.nh-top a[href="#/address/${REWARDS}"]`).getAttribute('title'), new RegExp(bech(REWARDS)));
  // bands
  const bands = await page.locator('table.nh-bands').innerText();
  assert.match(bands, /0 to 1\s+1\s+0\.6\d+%/);
  assert.match(bands, /10 to 100\s+151\s+96\.\d+%\s+1,597 ZTPHY/); // the 150 airdropped and the hot key's 97
  assert.match(bands, /10,000,000 or more\s+3\s+/);
  assert.match(t, /all at block 4,242/);
  // the page asked only what rpc-guard lets through, and the snapshot once
  assert.ok(calls.every((c) => (c.side === 'comet' ? ['status', 'abci_query', 'block', 'blockchain', 'block_results', 'tx_search', 'validators'].includes(c.method) : /^(eth|net|web3|zetaphy)_/.test(c.method))), JSON.stringify(calls.map((c) => c.method)));
  const q = calls.find((c) => c.method === 'abci_query' && c.params.path === '/cosmos.bank.v1beta1.Query/DenomOwners');
  assert.equal(q.params.data, '0a08617a65746170687912041801' + '2001');
  assert.equal(snapshotRequests(), 1);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('holders: the search box gives any address its live balance (eth_getBalance), share, rank and band', async () => {
  const { page, ctx, problems, calls } = await openPage({ holders: snapshot() });
  await go(page, '#/holders');
  await waitText(page, 'Look up an address');
  await page.fill('input.nh-search', 'not an address');
  await page.click('form.nh-form button');
  await waitText(page, 'Not an address.');
  await page.fill('input.nh-search', ME); // zetaphy1…
  await page.press('input.nh-search', 'Enter');
  await waitText(page, 'Balance now (live)');
  let r = await page.locator('.nh-result').innerText();
  assert.match(r, /Balance now \(live\)\s+1,234\.5 ZTPHY/);
  assert.match(r, new RegExp(ME_HEX));
  assert.match(r, /Rank\s+not in the top 100 at the snapshot/);
  assert.match(r, /Balance band \(ZTPHY\)\s+1,000 to 10,000/);
  assert.ok(calls.some((c) => c.method === 'eth_getBalance' && c.params[0].toLowerCase() === ME_HEX.toLowerCase()));
  // a project wallet: its name and its rank at the snapshot
  await page.fill('input.nh-search', FAUCET);
  await page.press('input.nh-search', 'Enter');
  await page.waitForFunction(() => /Faucet \(faucet\)/.test(document.querySelector('.nh-result')?.innerText ?? ''));
  r = await page.locator('.nh-result').innerText();
  assert.match(r, /Name\s+Faucet \(faucet\)/);
  assert.match(r, /Rank\s+#5 at the snapshot/);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('holders: no snapshot published yet: says so and shows the addresses seen in recent blocks', async () => {
  const { page, ctx, problems } = await openPage({ holders: null });
  await go(page, '#/holders');
  await waitText(page, 'No holders snapshot has been published yet');
  await waitText(page, 'Only the');
  const t = await text(page);
  assert.match(t, /Seen in recent blocks \(live balances\)/);
  assert.match(t, /addresses seen in these blocks are compared \(live balances\); this is not a full rich list/);
  assert.match(t, /Look up an address/);
  await waitText(page, '100,234');
  assert.ok(!/Top 100 holders/.test(t));
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('holders: an old or unreadable snapshot is called so; hostile labels stay plain text', async () => {
  let { page, ctx, problems } = await openPage({ holders: snapshot({ time: new Date(Date.now() - 3 * 86400_000).toISOString() }) });
  await go(page, '#/holders');
  await waitText(page, 'This snapshot is old (block 4,242, 3 d ago)');
  await waitText(page, 'Seen in recent blocks (live balances)');
  await waitText(page, 'Top 100 holders'); // still shown, under the warning
  assert.deepEqual(problems, []);
  await ctx.close();

  ({ page, ctx, problems } = await openPage({ holders: '{"version": 1, "height": "x"' }));
  await go(page, '#/holders');
  await waitText(page, 'The holders snapshot could not be read');
  await waitText(page, 'Seen in recent blocks (live balances)');
  await ctx.close();

  const labels = new Map([[REWARDS.toLowerCase(), { name: '<img src=x onerror="window.__pwned=1">Rewards‮', kind: 'multisig', group: 'project' }]]);
  ({ page, ctx, problems } = await openPage({ holders: snapshot({ labels }) }));
  await go(page, '#/holders');
  await waitText(page, 'Top 100 holders');
  assert.equal(await page.locator('table.nh-top .label-project').first().innerText(), '<img src=x onerror="window.__pwned=1">Rewards');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('main img').count(), 0);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('holders: linked from the Overview supply card and from #/ask/holders; Thai; phone width', async () => {
  let { page, ctx, problems } = await openPage({ holders: snapshot() });
  await go(page, '#/');
  await page.waitForSelector('a.nh-link');
  assert.equal(await page.getAttribute('a.nh-link', 'href'), '#/holders');
  await page.click('a.nh-link');
  await waitText(page, 'Top 100 holders');
  await go(page, '#/ask/holders');
  await waitText(page, 'The full list of ZTPHY holders (updated daily)');
  await page.click('a[href="#/holders"]');
  await waitText(page, 'Top 100 holders');
  assert.deepEqual(problems, []);
  await ctx.close();

  ({ page, ctx, problems } = await openPage({ holders: snapshot(), lang: 'th', viewport: { width: 390, height: 844 } }));
  await go(page, '#/holders');
  await waitText(page, 'ผู้ถือ 100 อันดับแรก');
  const t = await text(page);
  assert.match(t, /ผู้ถือ ZTPHY/);
  assert.match(t, /อัปเดตทุกวัน/);
  assert.match(t, /กระเป๋าของโปรเจกต์/);
  assert.match(t, /10 ถึง 100/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at phone width');
  assert.deepEqual(problems, []);
  await ctx.close();
});
