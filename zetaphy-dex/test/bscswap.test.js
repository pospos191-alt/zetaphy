// lib/bscswap.js: the BNB Chain tab's calldata and arithmetic, checked against ethers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface, id, getAddress } from 'ethers';
import * as B from '../web/lib/bscswap.js';

const QUOTER = new Interface(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const ROUTER = new Interface(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const ERC20 = new Interface(['function approve(address,uint256)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
const FACTORY = new Interface(['function getPool(address,address,uint24) view returns (address)']);
const ME = getAddress('0x' + '12'.repeat(20));

test('selectors and fixed addresses', () => {
  assert.equal(B.SELECTORS.quote, id('quoteExactInputSingle((address,address,uint256,uint24,uint160))').slice(0, 10));
  assert.equal(B.SELECTORS.swap, id('exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))').slice(0, 10));
  assert.equal(B.SELECTORS.factory, id('factory()').slice(0, 10));
  assert.equal(B.SELECTORS.getPool, id('getPool(address,address,uint24)').slice(0, 10));
  for (const a of [B.ZTPHY.address, B.USDT.address, ...Object.values(B.PANCAKE)]) assert.equal(getAddress(a), a, `${a} checksummed`);
  // the pool and the position manager the owner used (zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json) are PancakeSwap's
  assert.equal(B.PANCAKE.factory, '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865');
  assert.equal(B.PANCAKE.pool, '0xB4D4eE5f2C173B483D494EE481496754cE230f88');
  assert.equal(B.FEE, 10000);
  assert.deepEqual(B.TOKENS.map((t) => t.symbol), ['ZTPHY', 'USDT']);
});

test('calldata is exactly what ethers encodes', () => {
  const amt = 123n * 10n ** 18n;
  assert.equal(B.quoteCall(B.ZTPHY, amt), QUOTER.encodeFunctionData('quoteExactInputSingle', [[B.ZTPHY.address, B.USDT.address, amt, 10000, 0]]));
  assert.equal(B.quoteCall(B.USDT, amt), QUOTER.encodeFunctionData('quoteExactInputSingle', [[B.USDT.address, B.ZTPHY.address, amt, 10000, 0]]));
  assert.equal(B.swapCall(B.USDT, amt, 5n, ME, 1700000000n), ROUTER.encodeFunctionData('exactInputSingle', [[B.USDT.address, B.ZTPHY.address, 10000, ME, 1700000000n, amt, 5n, 0]]));
  assert.equal(B.approveCall(B.PANCAKE.swapRouter, amt), ERC20.encodeFunctionData('approve', [B.PANCAKE.swapRouter, amt]));
  assert.equal(B.allowanceCall(ME, B.PANCAKE.swapRouter), ERC20.encodeFunctionData('allowance', [ME, B.PANCAKE.swapRouter]));
  assert.equal(B.balanceCall(ME), ERC20.encodeFunctionData('balanceOf', [ME]));
  assert.equal(B.getPoolCall(), FACTORY.encodeFunctionData('getPool', [B.ZTPHY.address, B.USDT.address, 10000]));
  assert.throws(() => B.swapCall(B.USDT, amt, 0n, ME, 1n), /minimum/);
  assert.throws(() => B.swapCall(B.USDT, amt, 1n, 'nope', 1n), /recipient/);
});

test('quote decoding, minimum out, price and impact', () => {
  const enc = QUOTER.encodeFunctionResult('quoteExactInputSingle', [42n, 7922816251426433759354395033600n, 3, 90000n]);
  assert.deepEqual(B.readQuote(enc), { amountOut: 42n, sqrtPriceX96After: 7922816251426433759354395033600n });
  assert.equal(B.minOut(10000n, 100), 9900n);
  assert.throws(() => B.minOut(1n, 0), /slippage/);
  assert.throws(() => B.minOut(1n, 501), /slippage/);
  // the pool was made at 0.0001 USDT per ZTPHY (saphan-pool.js plan: sqrtPriceX96 7922816251426433759354395033600)
  assert.equal(B.usdtPerZtphy(7922816251426433759354395033600n), 0.0001);
  const after = 7922816251426433759354395033600n * 9n / 10n; // fewer ZTPHY per USDT: ZTPHY dearer
  assert.ok(B.impactBps(7922816251426433759354395033600n, after) > 2000);
  assert.equal(B.impactBps(0n, after), 0);
});
