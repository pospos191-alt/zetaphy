// lib/markets.js: every network of the Swap page. Calldata against ethers for both router kinds, the price whichever token
// is token0 and whatever the decimals, and the list kept in step with the bridge: every synthetic ZTPHY the Saphan
// deployment records must be a market (a new route fails here until it is added; its pool then appears by itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface, getAddress, id } from 'ethers';
import * as M from '../web/lib/markets.js';

const ME = getAddress('0x' + '12'.repeat(20));
const V3 = new Interface(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const R02 = new Interface(['function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])', 'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const Q = new Interface(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)']);
const F = new Interface(['function getPool(address,address,uint24) view returns (address)']);

test('markets: ids unique, addresses checksummed, chains distinct; the new selectors are the real ones', () => {
  assert.equal(new Set(M.MARKETS.map((m) => m.id)).size, M.MARKETS.length);
  assert.equal(new Set(M.MARKETS.map((m) => m.chain.chainId)).size, M.MARKETS.length);
  for (const m of M.MARKETS) {
    for (const a of [m.factory, m.swapRouter, m.quoter, m.ztphy.address, m.stable.address, ...(m.pool ? [m.pool] : [])]) assert.equal(getAddress(a), a, `${m.id} ${a}`);
    assert.equal(m.chain.chainIdHex, `0x${m.chain.chainId.toString(16)}`);
    assert.ok(m.chain.rpc.length >= 1 && m.chain.rpc.every((u) => u.startsWith('https://')));
    assert.ok(['v3', 'v3-02'].includes(m.router));
  }
  assert.equal(M.SELECTORS.swap02, id('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))').slice(0, 10));
  assert.equal(M.SELECTORS.multicallDeadline, id('multicall(uint256,bytes[])').slice(0, 10));
  assert.equal(M.SELECTORS.slot0, id('slot0()').slice(0, 10));
});

test('markets: every synthetic ZTPHY the Saphan mainnet deployment records has a market on its chain', () => {
  const state = JSON.parse(readFileSync(new URL('../../zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json', import.meta.url), 'utf8'));
  const routes = Object.entries(state.steps ?? state).filter(([k, v]) => /-synthetic$/.test(k) && v?.synthetic);
  assert.ok(routes.length >= 2, 'the BSC and Base synthetics are recorded');
  for (const [k, v] of routes) {
    const idOf = k.replace(/-synthetic$/, '');
    const m = M.marketById(idOf);
    assert.ok(m, `${idOf}: the bridge has a synthetic ZTPHY (${v.synthetic}) but the Swap page has no market for it: add it to web/lib/markets.js`);
    assert.equal(m.ztphy.address, getAddress(v.synthetic), `${idOf}: the market's ZTPHY is the bridge's synthetic`);
  }
});

test('markets: getPool, quote and both swap calls are exactly what ethers encodes', () => {
  for (const m of M.MARKETS) {
    assert.equal(M.getPoolCall(m), F.encodeFunctionData('getPool', [m.ztphy.address, m.stable.address, m.fee]));
    assert.equal(M.quoteCall(m, m.stable, 5n), Q.encodeFunctionData('quoteExactInputSingle', [[m.stable.address, m.ztphy.address, 5n, m.fee, 0]]));
  }
  const bsc = M.marketById('bsc'), base = M.marketById('base');
  assert.equal(M.swapCall(bsc, bsc.ztphy, 7n, 3n, ME, 1700000000n), V3.encodeFunctionData('exactInputSingle', [[bsc.ztphy.address, bsc.stable.address, 10000, ME, 1700000000n, 7n, 3n, 0]]));
  const inner = R02.encodeFunctionData('exactInputSingle', [[base.stable.address, base.ztphy.address, 10000, ME, 2_000_000n, 17n, 0]]);
  assert.equal(M.swapCall(base, base.stable, 2_000_000n, 17n, ME, 1700000000n), R02.encodeFunctionData('multicall', [1700000000n, [inner]]));
  assert.throws(() => M.swapCall(base, base.stable, 1n, 0n, ME, 1n), /minimum/);
  assert.throws(() => M.swapCall(base, base.stable, 1n, 1n, 'nope', 1n), /recipient/);
});

test('markets: price per ZTPHY with the stable as token0 (BSC, 18 decimals) and as token1 (Base, USDC 6 decimals)', () => {
  const bsc = M.marketById('bsc'), base = M.marketById('base');
  assert.ok(BigInt(bsc.stable.address) < BigInt(bsc.ztphy.address) && BigInt(base.ztphy.address) < BigInt(base.stable.address));
  assert.ok(Math.abs(M.priceOf(bsc, 7922816251426433759354395033600n) - 0.0001) < 1e-12);
  assert.ok(Math.abs(M.priceOf(base, 792281625142643375935n) - 0.0001) < 1e-10);
  assert.equal(M.priceOf(base, 0n), 0);
  // 1% more price on Base is 100 bps, whichever side
  const up = 796232636614484566640n; // sqrt(1.01) times the above
  assert.ok(Math.abs(M.impactBps(base, 792281625142643375935n, up) - 100) <= 1);
  const L = M.links(base, '0x' + 'ab'.repeat(20));
  assert.match(L.trade, /app\.uniswap\.org\/swap\?chain=base/);
  assert.equal(L.gecko, `https://www.geckoterminal.com/base/pools/0x${'ab'.repeat(20)}`);
  assert.equal(M.links(base, null).pool, null);
});
