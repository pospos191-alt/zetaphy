// Browser test: the "BNB Chain" tab (web/bsc.js): ZTPHY <-> USDT through the project's PancakeSwap v3 pool. A mock BSC
// node and a mock wallet: the contracts are checked on-chain before any quote (a wrong pool is refused), the quote and
// minimum are shown, the approval is exact, the swap goes to PancakeSwap's SwapRouter on chain 56 with the shown
// minimum and the user as recipient, and nothing is sent while the wallet is on another chain.
//   npm run test:web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { Interface } from 'ethers';
import { servePage, injectWallet, chromiumOptions } from './helpers/web.js';
import * as B from '../web/lib/bscswap.js';

const USER = '0x6af57fC3633dD0F7907f7900dbd4A2822F43a245';
const MAINNET_RPC = 'https://129-221-199-191.sslip.io';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addr = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const QUOTER = new Interface(['function quoteExactInputSingle((address,address,uint256,uint24,uint160)) returns (uint256,uint160,uint32,uint256)']);
const ROUTER = new Interface(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const SQRT = 7922816251426433759354395033600n; // 0.0001 USDT per ZTPHY
const E18 = 10n ** 18n;

function bscNode({ pool = B.PANCAKE.pool } = {}) {
  const st = { allowance: 0n, calls: [] };
  const handle = (req) => {
    const p = req.params;
    if (req.method === 'eth_getCode') return '0x6080';
    if (req.method === 'eth_getTransactionReceipt') return { status: '0x1' };
    if (req.method !== 'eth_call') return null;
    const to = p[0].to.toLowerCase(), data = p[0].data, sel = data.slice(0, 10);
    st.calls.push({ to, sel, from: p[0].from });
    if (sel === B.SELECTORS.factory) return '0x' + addr(B.PANCAKE.factory);
    if (sel === B.SELECTORS.getPool) return '0x' + addr(pool);
    if (sel === '0x3850c7bd') return '0x' + word(SQRT) + word(0).repeat(6);
    if (sel === B.SELECTORS.quote) {
      const [[, , amountIn]] = QUOTER.decodeFunctionData('quoteExactInputSingle', data);
      return QUOTER.encodeFunctionResult('quoteExactInputSingle', [amountIn * 9000n, SQRT * 99n / 100n, 1, 90000n]); // 1 USDT -> 9,000 ZTPHY
    }
    if (sel === B.SELECTORS.balanceOf) return '0x' + word(1000n * E18);
    if (sel === B.SELECTORS.allowance) return '0x' + word(st.allowance);
    return '0x';
  };
  return { st, handle };
}

async function open(browser, server, node, walletLog, startChain = '0xe4b') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.route(`${MAINNET_RPC}/**`, (route) => {
    const req = JSON.parse(route.request().postData());
    const result = { eth_chainId: '0xe4b', eth_blockNumber: '0x10', eth_getBalance: '0x0', eth_call: '0x' + word(0), eth_getCode: '0x6080' }[req.method] ?? null;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) });
  });
  for (const url of B.BSC.rpc) await page.route(`${url}/**`, (route) => {
    const req = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result: node.handle(req) }) });
  });
  let chain = startChain;
  await injectWallet(page, async (method, params) => {
    walletLog.push({ method, params });
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return [USER];
      case 'eth_chainId': return chain;
      case 'wallet_switchEthereumChain': chain = params[0].chainId; return null;
      case 'wallet_addEthereumChain': return null;
      case 'eth_sendTransaction': {
        if (params[0].data.startsWith(B.SELECTORS.approve)) node.st.allowance = BigInt('0x' + params[0].data.slice(74));
        return '0x' + 'ab'.repeat(32);
      }
      default: throw Object.assign(new Error(`not mocked: ${method}`), { code: 4200 });
    }
  });
  await page.goto(`${server.origin}/#bsc`);
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, { timeout: 30_000 });
  await page.click('#connect-btn');
  await page.click('#wallet-list button:has-text("Mock Wallet")');
  await page.waitForFunction(() => document.getElementById('connect-btn').textContent.startsWith('0x6af5'));
  await page.click('.tab[data-tab="bsc"]');
  await page.waitForSelector('#bsc-root h2');
  return { page, problems, setChain: (c) => { chain = c; } };
}

test('BNB Chain tab: checked contracts, quote, exact approval, swap to PancakeSwap on chain 56 with the shown minimum', { timeout: 120_000 }, async () => {
  const server = await servePage();
  const browser = await chromium.launch(chromiumOptions());
  try {
    const node = bscNode(), log = [];
    const { page, problems } = await open(browser, server, node, log);
    assert.match(await page.textContent('#bsc-root'), new RegExp(`ZTPHY bridged by Saphan: ${B.ZTPHY.address}`));
    assert.match(await page.textContent('#bsc-root'), /a \$10 buy moves the price/);
    await page.selectOption('#bsc-dir', 'buy'); // USDT -> ZTPHY
    await page.fill('#bsc-amount', '2');
    await page.waitForFunction(() => /You get about 18,000 ZTPHY/.test(document.getElementById('bsc-quote').textContent));
    assert.match(await page.textContent('#bsc-quote'), /at least 17,820 after 1% slippage/);
    assert.match(await page.textContent('#bsc-price'), /1 ZTPHY = 0\.0001000 USDT/);
    // the contracts were checked before the quote: both factories and the pool
    const checked = node.st.calls.filter((c) => c.sel === B.SELECTORS.factory).map((c) => c.to).sort();
    assert.deepEqual(checked, [B.PANCAKE.swapRouter.toLowerCase(), B.PANCAKE.quoterV2.toLowerCase()].sort());
    // approve exactly 2 USDT to the SwapRouter
    await page.waitForFunction(() => document.getElementById('bsc-btn').textContent === 'Approve 2 USDT');
    await page.click('#bsc-btn');
    await page.waitForFunction(() => document.getElementById('bsc-btn').textContent === 'Swap', null, { timeout: 20_000 });
    const sends = () => log.filter((x) => x.method === 'eth_sendTransaction').map((x) => x.params[0]);
    assert.equal(sends()[0].to, B.USDT.address);
    assert.equal(sends()[0].data, B.approveCall(B.PANCAKE.swapRouter, 2n * E18));
    assert.equal(sends()[0].chainId, '0x38');
    assert.ok(log.some((x) => x.method === 'wallet_switchEthereumChain' && x.params[0].chainId === '0x38'));
    // swap: SwapRouter, USDT -> ZTPHY, fee 1%, recipient the user, min = the shown 17,820 ZTPHY
    await page.click('#bsc-btn');
    await page.waitForFunction(() => /Done:/.test(document.getElementById('bsc-status').textContent), null, { timeout: 20_000 });
    const s = sends()[1];
    assert.equal(s.to, B.PANCAKE.swapRouter);
    assert.equal(s.chainId, '0x38');
    const [p] = ROUTER.decodeFunctionData('exactInputSingle', s.data);
    assert.deepEqual([p.tokenIn, p.tokenOut, Number(p.fee), p.recipient, p.amountIn, p.amountOutMinimum, p.sqrtPriceLimitX96],
      [B.USDT.address, B.ZTPHY.address, 10000, USER, 2n * E18, 17820n * E18, 0n]);
    assert.ok(Number(p.deadline) > Date.now() / 1000);
    // every signed call was dry-run on BSC from the user first
    assert.ok(node.st.calls.some((c) => c.to === B.PANCAKE.swapRouter.toLowerCase() && c.sel === B.SELECTORS.swap && c.from?.toLowerCase() === USER.toLowerCase()));
    assert.deepEqual(problems, []);
  } finally { await browser.close(); await server.close(); }
});

test('BNB Chain tab: another pool behind the factory is refused; nothing is quoted or sent', { timeout: 120_000 }, async () => {
  const server = await servePage();
  const browser = await chromium.launch(chromiumOptions());
  try {
    const node = bscNode({ pool: '0x' + '66'.repeat(20) }), log = [];
    const { page } = await open(browser, server, node, log);
    await page.fill('#bsc-amount', '1000');
    await page.waitForFunction(() => /Refused: the PancakeSwap contracts or the pool/.test(document.getElementById('bsc-status').textContent));
    assert.match(await page.textContent('#bsc-status'), /factory pool = 0x6666/);
    assert.equal(await page.isDisabled('#bsc-btn'), true);
    assert.equal(node.st.calls.filter((c) => c.sel === B.SELECTORS.quote).length, 0, 'no quote');
    assert.equal(log.filter((x) => x.method === 'eth_sendTransaction').length, 0, 'nothing sent');
  } finally { await browser.close(); await server.close(); }
});
