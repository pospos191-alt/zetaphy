// Every network where ZTPHY trades, for the one Swap page (xswap.js). A market is ZTPHY bridged by Saphan on that chain
// against a stablecoin, in a Uniswap-v3-style pool (PancakeSwap v3 on BNB Chain, Uniswap v3 elsewhere). Pure: addresses,
// calldata and arithmetic; the page does the RPC and the wallet.
//
// Adding a network: a MARKETS entry with the chain, the DEX's own contracts and the route's synthetic ZTPHY (from
// zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json; test/markets.test.js fails while a recorded synthetic has
// no entry). Its pool needs no entry: the page asks the DEX's factory for the ZTPHY/stable pool and shows the network
// only once that pool exists, so a new pool appears on the page by itself. A pinned `pool` must equal the factory's.
// Only the two tokens of a market can be traded (no address typed by the user), so a fake "ZTPHY" can never be picked.
import { encodeArgs, isAddress } from './abi.js';
import * as B from './bscswap.js';

const ZTPHY = (address) => Object.freeze({ address, symbol: 'ZTPHY', decimals: 18, name: 'ZTPHY (bridged from ZETAPHY by Saphan)' });

export const MARKETS = Object.freeze([
  Object.freeze({
    id: 'bsc', chain: B.BSC, explorerName: 'BscScan', dex: 'PancakeSwap', router: 'v3', fee: B.FEE,
    factory: B.PANCAKE.factory, swapRouter: B.PANCAKE.swapRouter, quoter: B.PANCAKE.quoterV2, pool: B.PANCAKE.pool,
    ztphy: B.ZTPHY, stable: B.USDT, gecko: 'bsc', dexscreener: 'bsc',
    trade: (a, b) => `https://pancakeswap.finance/swap?chain=bsc&inputCurrency=${a}&outputCurrency=${b}`,
  }),
  Object.freeze({
    id: 'base',
    chain: Object.freeze({ chainId: 8453, chainIdHex: '0x2105', name: 'Base', explorer: 'https://basescan.org', rpc: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }),
    explorerName: 'BaseScan', dex: 'Uniswap', router: 'v3-02', fee: 10000,
    // Uniswap's own Base deployments (sdk-core BASE_ADDRESSES; the factory is the one saphan-mainnet.json names)
    factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', swapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481', quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', pool: null,
    ztphy: ZTPHY('0x68aa0f0144605024eCe1aDccFCC1626352779569'),
    stable: Object.freeze({ address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, name: 'USD Coin (native USDC on Base, issued by Circle)' }),
    gecko: 'base', dexscreener: 'base',
    trade: (a, b) => `https://app.uniswap.org/swap?chain=base&inputCurrency=${a}&outputCurrency=${b}`,
  }),
]);

export const marketById = (id) => MARKETS.find((m) => m.id === id) ?? null;

export const SELECTORS = Object.freeze({
  ...B.SELECTORS,
  swap02: '0x04e45aaf', // SwapRouter02 exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)): no deadline
  multicallDeadline: '0x5ae401dc', // SwapRouter02 multicall(uint256 deadline, bytes[] data): the deadline for the call inside
  slot0: '0x3850c7bd',
});

export const tokens = (m) => [m.ztphy, m.stable];
export const other = (m, t) => (t.address === m.ztphy.address ? m.stable : m.ztphy);
export const getPoolCall = (m) => SELECTORS.getPool + encodeArgs(['address', 'address', 'uint24'], [m.ztphy.address, m.stable.address, m.fee]);
export const quoteCall = (m, tin, amountIn) => SELECTORS.quote + encodeArgs(['address', 'address', 'uint256', 'uint24', 'uint160'], [tin.address, other(m, tin).address, amountIn, m.fee, 0]);
export const { readQuote, approveCall, allowanceCall, balanceCall, word, addressOf, minOut, MAX_SLIPPAGE_BPS } = B;

function bytesArrayOfOne(hex) {
  const h = hex.replace(/^0x/, ''), len = h.length / 2;
  const pad = h + '0'.repeat((64 - (h.length % 64)) % 64);
  return [1n, 32n, BigInt(len)].map((n) => n.toString(16).padStart(64, '0')).join('') + pad;
}

/** The swap transaction's `data` for the market's router; the deadline is enforced on chain either way. */
export function swapCall(m, tin, amountIn, min, recipient, deadline) {
  if (!isAddress(recipient)) throw new Error('bad recipient');
  if (min <= 0n) throw new Error('minimum out must be above zero');
  const out = other(m, tin).address;
  if (m.router === 'v3') return SELECTORS.swap + encodeArgs(['address', 'address', 'uint24', 'address', 'uint256', 'uint256', 'uint256', 'uint160'], [tin.address, out, m.fee, recipient, deadline, amountIn, min, 0]);
  if (m.router === 'v3-02') {
    const inner = SELECTORS.swap02 + encodeArgs(['address', 'address', 'uint24', 'address', 'uint256', 'uint256', 'uint160'], [tin.address, out, m.fee, recipient, amountIn, min, 0]);
    return SELECTORS.multicallDeadline + BigInt(deadline).toString(16).padStart(64, '0') + (64n).toString(16).padStart(64, '0') + bytesArrayOfOne(inner);
  }
  throw new Error(`unknown router kind ${m.router}`);
}

/** Price as stable per ZTPHY from the pool's sqrtPriceX96, whichever token is token0 and whatever the decimals. */
export function priceOf(m, sqrtPriceX96) {
  const q = sqrtPriceX96 * sqrtPriceX96; // token1 per token0 (raw units) * 2^192
  if (q === 0n) return 0;
  const zIs0 = BigInt(m.ztphy.address) < BigInt(m.stable.address);
  const S = 10n ** 36n, dz = m.ztphy.decimals, ds = m.stable.decimals;
  // raw stable per raw ZTPHY, scaled by 1e36 (a ratio as small as 1e-16 keeps 20 digits)
  const raw = zIs0 ? (q * S) >> 192n : ((1n << 192n) * S) / q;
  return Number(raw) / 1e36 * 10 ** (dz - ds);
}

/** How far a trade moves the price, in basis points. */
export function impactBps(m, before, after) {
  if (!before || !after) return 0;
  const a = priceOf(m, before), b = priceOf(m, after);
  return a > 0 ? Math.round(Math.abs(b - a) / a * 10000) : 0;
}

/** The DEX's links for the market's page. */
export const links = (m, pool) => ({
  token: `${m.chain.explorer}/token/${m.ztphy.address}`,
  pool: pool ? `${m.chain.explorer}/address/${pool}` : null,
  trade: m.trade(m.stable.address, m.ztphy.address),
  gecko: pool ? `https://www.geckoterminal.com/${m.gecko}/pools/${pool.toLowerCase()}` : null,
  dexscreener: pool ? `https://dexscreener.com/${m.dexscreener}/${pool.toLowerCase()}` : null,
});
