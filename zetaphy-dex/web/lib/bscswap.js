// ZTPHY on BNB Smart Chain, swapped through the project's own PancakeSwap v3 pool (the "BNB Chain" tab, bsc.js).
// Pure: the fixed addresses, calldata and the arithmetic; the page does the RPC and the wallet. Only the two tokens
// below can be traded here (no address typed by the user), so a fake "ZTPHY" can never be picked.
// The addresses are PancakeSwap v3's own deployments on BSC; the page checks on-chain, before the first quote, that the
// router and the quoter name the same factory and that the factory's pool for the pair is POOL.
import { encodeArgs, isAddress } from './abi.js';

export const BSC = Object.freeze({
  chainId: 56, chainIdHex: '0x38', name: 'BNB Smart Chain', explorer: 'https://bscscan.com',
  rpc: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com'],
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
});
export const ZTPHY = Object.freeze({ address: '0x68aa0f0144605024eCe1aDccFCC1626352779569', symbol: 'ZTPHY', decimals: 18, name: 'ZTPHY (bridged from ZETAPHY by Saphan)' });
export const USDT = Object.freeze({ address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18, name: 'Binance-Peg BSC-USD (issued by Binance)' });
export const FEE = 10000; // the 1% tier the pool was made with
export const PANCAKE = Object.freeze({
  factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  swapRouter: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
  quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
  pool: '0xB4D4eE5f2C173B483D494EE481496754cE230f88',
});
export const SELECTORS = Object.freeze({
  quote: '0xc6a5026a', // quoteExactInputSingle((address,address,uint256,uint24,uint160))
  swap: '0x414bf389', // exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
  factory: '0xc45a0155', // factory()
  getPool: '0x1698ee82', // getPool(address,address,uint24)
  approve: '0x095ea7b3', allowance: '0xdd62ed3e', balanceOf: '0x70a08231',
});
export const TOKENS = Object.freeze([ZTPHY, USDT]);
export const other = (t) => (t.address === ZTPHY.address ? USDT : ZTPHY);
/** Never more than this slippage on a pool this thin; the default is 1%. */
export const MAX_SLIPPAGE_BPS = 500;

export const quoteCall = (tin, amountIn) => SELECTORS.quote + encodeArgs(['address', 'address', 'uint256', 'uint24', 'uint160'], [tin.address, other(tin).address, amountIn, FEE, 0]);
/** QuoterV2's answer: (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate). */
export function readQuote(hex) {
  const h = String(hex).replace(/^0x/, '');
  if (h.length < 64 * 4) throw new Error('bad quote');
  return { amountOut: BigInt('0x' + h.slice(0, 64)), sqrtPriceX96After: BigInt('0x' + h.slice(64, 128)) };
}
export function swapCall(tin, amountIn, minOut, recipient, deadline) {
  if (!isAddress(recipient)) throw new Error('bad recipient');
  if (minOut <= 0n) throw new Error('minimum out must be above zero');
  return SELECTORS.swap + encodeArgs(['address', 'address', 'uint24', 'address', 'uint256', 'uint256', 'uint256', 'uint160'],
    [tin.address, other(tin).address, FEE, recipient, deadline, amountIn, minOut, 0]);
}
export const approveCall = (spender, amount) => SELECTORS.approve + encodeArgs(['address', 'uint256'], [spender, amount]);
export const allowanceCall = (owner, spender) => SELECTORS.allowance + encodeArgs(['address', 'address'], [owner, spender]);
export const balanceCall = (who) => SELECTORS.balanceOf + encodeArgs(['address'], [who]);
export const getPoolCall = () => SELECTORS.getPool + encodeArgs(['address', 'address', 'uint24'], [ZTPHY.address, USDT.address, FEE]);
export const word = (hex) => BigInt('0x' + (String(hex).replace(/^0x/, '').slice(0, 64) || '0'));
export const addressOf = (hex) => '0x' + String(hex).replace(/^0x/, '').slice(24, 64);

export function minOut(amountOut, slippageBps) {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) throw new Error('slippage out of range');
  return (amountOut * BigInt(10000 - slippageBps)) / 10000n;
}

/** Price as USDT per ZTPHY from a pool sqrtPriceX96 (USDT is token0, ZTPHY token1; both 18 decimals). */
export function usdtPerZtphy(sqrtPriceX96) {
  // price(token1 per token0) = (sqrtP / 2^96)^2 ZTPHY per USDT; invert.
  const q = sqrtPriceX96 * sqrtPriceX96; // token1/token0 * 2^192
  if (q === 0n) return 0;
  return Number((1n << 192n) * 10n ** 12n / q) / 1e12;
}

/** How far this trade moves the price, in basis points (from the pool's price before and after). */
export function impactBps(before, after) {
  if (!before || !after) return 0;
  const a = usdtPerZtphy(before), b = usdtPerZtphy(after);
  return a > 0 ? Math.round(Math.abs(b - a) / a * 10000) : 0;
}
