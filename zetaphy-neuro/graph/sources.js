// Where the money-flow graph reads each chain from. Free, keyless sources
// only, that a browser may call directly (CORS) or a GitHub Actions job /
// runner machine may call without an account:
//   - the chain's public JSON-RPC (from src/chains.js): logs, nonces, code
//   - Blockscout's Etherscan-compatible API (keyless) where an official
//     instance exists: contract creation, first incoming transfer, logs
//   - ZETAPHY: its own RPC and its Cosmos REST (no explorer index needed)
//   - Solana: the public RPC (getSignaturesForAddress / getTransaction)
//   - CosmWasm chains: the chain's REST (contract info, tx search)
import { CHAINS } from '../src/chains.js';

/**
 * ZETAPHY mainnet (zetaphy_3659-1, EVM chain 3659) and the contracts the graph knows, from
 * zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json and zetaphy-launch/state/3659.contracts.json. The testnet
 * (chain 77390, rpc.sawasdeecoin.com) was shut down on 2026-11-14.
 */
export const ZETAPHY = {
  chainId: 3659,
  rpc: 'https://129-221-199-191.sslip.io',
  rest: 'https://129-221-199-191.sslip.io/rest',
  bech32: 'zetaphy',
  threatRegistry: '0xaacfc7cf7148b7ae530c2ab891d4220e648a2139',
  dex: {
    name: 'ZETAPHY DEX', factory: '0x93463b001483970f8cae63cd8b60d28f17a1c1aa', router: '0xa5221a7f25cf10d99446fde3e95c15b1f696e783',
    weth: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', native: 'ZTPHY', amountIn: '10000000000000000',
  },
  dlmmFactory: '0x65fe29eb6deabf1ae8929de7e0a793ab394c887a',
  // Pair tokens that are never "the new token" of a pool (mainnet has no stablecoin yet: the native coin only).
  baseTokens: ['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'],
};

/**
 * Per chain key: { kind, chainId?, rpcs, blockscout?, rest?, bech32?, dex?, logRange, hubNonce }.
 *   logRange: widest eth_getLogs block range the public RPC accepts
 *   hubNonce: an address that sent at least this many transactions is a busy
 *     service (exchange hot wallet, bridge relayer): a funding trail stops
 *     there and wallets funded by it are NOT grouped together
 */
export const GRAPH_SOURCES = {
  eth: { blockscout: 'https://eth.blockscout.com', logRange: 5_000, hubNonce: 5_000 },
  base: { blockscout: 'https://base.blockscout.com', logRange: 5_000, hubNonce: 5_000 },
  arbitrum: { blockscout: 'https://arbitrum.blockscout.com', logRange: 10_000, hubNonce: 5_000 },
  // No official keyless explorer API for BNB Chain: RPC only (logs, nonces,
  // trace_filter where offered); funding trails are often "unknown" there.
  bsc: { blockscout: null, logRange: 2_000, hubNonce: 5_000 },
  zetaphy: { blockscout: null, rest: [ZETAPHY.rest], bech32: ZETAPHY.bech32, dex: ZETAPHY.dex, logRange: 10_000, hubNonce: 2_000 },
  // ZETAPHY mainnet (src/chains.js zetaphyMainnet): the key the web page uses since the testnet was shut down
  zetaphyMainnet: { blockscout: null, rest: [ZETAPHY.rest], bech32: ZETAPHY.bech32, dex: ZETAPHY.dex, logRange: 10_000, hubNonce: 2_000 },
  sol: { hubSignatures: 1000 },
  osmosis: {},
  neutron: {},
};

/** Full source config for a chain key, or null when the graph does not cover it. */
export function sourcesFor(chainKey, overrides = {}) {
  const c = CHAINS[chainKey];
  const g = GRAPH_SOURCES[chainKey];
  if (!c || !g) return null;
  const base = { key: chainKey, kind: c.kind, name: c.name, rpcs: c.rpcs, ...g };
  if (c.kind === 'evm') Object.assign(base, { chainId: c.id, dex: g.dex ?? c.dex ?? null });
  if (c.kind === 'solana') base.genesisHash = c.genesisHash;
  if (c.kind === 'cosmwasm') Object.assign(base, { rest: c.rpcs, bech32: c.prefix });
  return { ...base, ...overrides };
}

/** Chain kinds the graph can trace. */
export const graphSupported = (chainKey) => sourcesFor(chainKey) != null;
