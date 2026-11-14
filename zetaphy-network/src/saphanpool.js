// ZETAPHY Saphan MAINNET: the owner's first ZTPHY pools on Base (Uniswap v3), as pure functions. Nothing is sent here:
// scripts/saphan-pool.js prints these for the liquidity multisig (ZETAPHY) and the liquidity Safe (Base) to sign.
//
//   bridgePlan(cfg, state)      ZETAPHY: approve the vault on the native ERC-20 + vault.lock(baseRecipient, total), as an
//                               unsigned Cosmos tx of MsgEVMCall (the liquidity multisig is a Cosmos 2-of-3) and as raw calls
//   poolPlan(...)               Base, per pool: approvals, createAndInitializePoolIfNecessary at the owner's price, mint full range
//   priceImpact(...)            how far one buy of N USD moves the price (a full-range v3 position is x*y=k)
//   safeBatch(...)              a Safe Transaction Builder file (app.safe.global -> Transaction Builder -> load)
import { Interface, getAddress, parseUnits, formatUnits, getBytes } from 'ethers';
import { TICK_SPACING, units, zetaphyBech32, BASE_USDC } from './saphanmainnet.js';

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const Q96 = 2n ** 96n;
export const ERC20 = new Interface(['function approve(address spender, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function allowance(address,address) view returns (uint256)']);
export const NPM = new Interface([
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function factory() view returns (address)', 'function balanceOf(address) view returns (uint256)',
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
]);
export const FACTORY = new Interface(['function getPool(address,address,uint24) view returns (address)', 'function feeAmountTickSpacing(uint24) view returns (int24)']);
export const POOL = new Interface(['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)', 'function liquidity() view returns (uint128)',
  'function token0() view returns (address)', 'function token1() view returns (address)', 'function fee() view returns (uint24)']);
const VAULT = new Interface(['function lock(address to, uint256 amount) payable returns (bytes32)', 'function quote(address to, uint256 amount) view returns (uint256)']);
const SYN = new Interface(['function claim(bytes32 id)']);

/** floor(sqrt(n)) for a bigint. */
export function isqrt(n) {
  if (n < 0n) throw new Error('isqrt of a negative number');
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n)))) + 1n;
  for (;;) { const y = (x + n / x) >> 1n; if (y >= x) break; x = y; }
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

/** The full range of a fee tier: the outermost usable ticks. */
export function fullRange(feeTier) {
  const s = TICK_SPACING[feeTier];
  if (!s) throw new Error(`fee tier ${feeTier}: one of ${Object.keys(TICK_SPACING).join(', ')}`);
  return { tickLower: Math.ceil(MIN_TICK / s) * s, tickUpper: Math.floor(MAX_TICK / s) * s, tickSpacing: s };
}

/** sqrtPriceX96 of a pool holding amount0 of token0 and amount1 of token1 (raw units): sqrt(amount1/amount0) * 2^96. */
export const sqrtPriceX96 = (amount0, amount1) => isqrt((BigInt(amount1) << 192n) / BigInt(amount0));

/**
 * A buy of `usd` of ZTPHY with the stable, against a full-range position of S stable and Z ZTPHY (constant product, fee
 * taken from the input). Plain numbers (whole tokens): this is for the owner to read, not for the chain.
 */
export function priceImpact({ stable, ztphy, buyUsd, feeTier }) {
  const S = Number(stable), Z = Number(ztphy), f = feeTier / 1e6;
  const k = S * Z, S2 = S + buyUsd * (1 - f), Z2 = k / S2;
  const p0 = S / Z, p1 = S2 / Z2, got = Z - Z2;
  return { buyUsd, ztphyOut: got, avgPrice: buyUsd / got, priceBefore: p0, priceAfter: p1, movePct: (p1 / p0 - 1) * 100 };
}

const fmtPrice = (x) => (x >= 0.01 ? x.toFixed(6) : x.toPrecision(4));

/**
 * One pool: the Safe's calls on Base, in order. `ztphy`: the synthetic on Base (18 decimals). The price is set by the two
 * amounts: price = stableAmount / ztphyAmount (USD per ZTPHY for a 1-USD stable).
 */
export function poolPlan({ ztphy, pool, feeTier, slippageBps, recipient, positionManager, factory, deadline }) {
  if (!pool.address) throw new Error(`the ${pool.stable} address on Base is an owner input (liquidity.pools[].address), not set`);
  const zAmt = units(pool.ztphyAmount, 18), sAmt = units(pool.stableAmount, pool.decimals);
  const z = getAddress(ztphy), s = getAddress(pool.address);
  const zFirst = BigInt(z) < BigInt(s);
  const [token0, token1, amount0, amount1] = zFirst ? [z, s, zAmt, sAmt] : [s, z, sAmt, zAmt];
  const sqrtP = sqrtPriceX96(amount0, amount1);
  const { tickLower, tickUpper } = fullRange(feeTier);
  const min = (x) => (x * BigInt(10000 - slippageBps)) / 10000n;
  const npm = getAddress(positionManager);
  const mint = { token0, token1, fee: feeTier, tickLower, tickUpper, amount0Desired: amount0, amount1Desired: amount1, amount0Min: min(amount0), amount1Min: min(amount1), recipient: getAddress(recipient), deadline: BigInt(deadline) };
  const price = Number(pool.stableAmount) / Number(pool.ztphyAmount);
  const txs = [
    { to: z, value: '0', data: ERC20.encodeFunctionData('approve', [npm, zAmt]), what: `approve ${pool.ztphyAmount} ZTPHY to the Uniswap v3 position manager` },
    { to: s, value: '0', data: ERC20.encodeFunctionData('approve', [npm, sAmt]), what: `approve ${pool.stableAmount} ${pool.stable} to the Uniswap v3 position manager` },
    { to: npm, value: '0', data: NPM.encodeFunctionData('createAndInitializePoolIfNecessary', [token0, token1, feeTier, sqrtP]), what: `create the ZTPHY/${pool.stable} pool (fee ${feeTier / 10000}%) at ${fmtPrice(price)} ${pool.stable} per ZTPHY` },
    { to: npm, value: '0', data: NPM.encodeFunctionData('mint', [mint]), what: `add ${pool.ztphyAmount} ZTPHY + ${pool.stableAmount} ${pool.stable}, full range, position NFT to ${getAddress(recipient)}` },
  ];
  return {
    stable: pool.stable, stableAddress: s, ztphy: z, token0, token1, amount0: String(amount0), amount1: String(amount1), feeTier, sqrtPriceX96: String(sqrtP), tickLower, tickUpper,
    price, priceText: `${fmtPrice(price)} ${pool.stable} per ZTPHY (1 ${pool.stable} = ${(1 / price).toLocaleString('en-US')} ZTPHY)`,
    factory: getAddress(factory), positionManager: npm, mint: { ...mint, amount0Desired: String(amount0), amount1Desired: String(amount1), amount0Min: String(mint.amount0Min), amount1Min: String(mint.amount1Min), deadline: String(mint.deadline) },
    impacts: [10, 50].map((buyUsd) => priceImpact({ stable: pool.stableAmount, ztphy: pool.ztphyAmount, buyUsd, feeTier })),
    txs,
  };
}

/** Plain lines about how thin a pool is (printed per pool). */
export function impactLines(p) {
  return p.impacts.map((x) => `  a buy of $${x.buyUsd}: gets ${Math.round(x.ztphyOut).toLocaleString('en-US')} ZTPHY (avg ${fmtPrice(x.avgPrice)}), moves the price from ${fmtPrice(x.priceBefore)} to ${fmtPrice(x.priceAfter)} (+${x.movePct.toFixed(1)}%)`);
}

/** A Safe Transaction Builder batch (JSON format 1.0). */
export function safeBatch({ chainId, name, description, txs, createdAt = 0 }) {
  return { version: '1.0', chainId: String(chainId), createdAt, meta: { name, description, txBuilderVersion: '1.16.5' }, transactions: txs.map((t) => ({ to: t.to, value: t.value ?? '0', data: t.data, contractMethod: null, contractInputsValues: null })) };
}

/**
 * The ZETAPHY side of seeding the pools: the liquidity multisig approves the vault on the native ERC-20 and locks the total
 * for the Base Safe, in ONE Cosmos tx of two MsgEVMCall (signed offline by 2 of 3 members, as the launch's funding was).
 * Also the same two calls as raw (to, data) in case the members use an EVM multisig instead.
 */
export function bridgePlan(cfg, state) {
  const vault = state?.steps?.['zetaphy-vault']?.vault;
  if (!vault) throw new Error('no ZetaphyTokenVault in the state yet (deploy step zetaphy-vault)');
  const to = cfg.liquidity.baseRecipient;
  if (!to) throw new Error('liquidity.baseRecipient (the Safe on Base) is an owner input, not set');
  const total = cfg.liquidity.pools.reduce((s, p) => s + units(p.ztphyAmount, 18), 0n);
  const calls = [
    { to: getAddress(cfg.token.address), data: ERC20.encodeFunctionData('approve', [getAddress(vault), total]), gas: 120000n, what: `approve ${formatUnits(total, 18)} ZTPHY (native ERC-20) to the vault` },
    { to: getAddress(vault), data: VAULT.encodeFunctionData('lock', [getAddress(to), total]), gas: 600000n, what: `lock ${formatUnits(total, 18)} ZTPHY for ${getAddress(to)} on Base` },
  ];
  const sender = cfg.liquidity.zetaphyMultisigBech32 ?? zetaphyBech32(cfg.liquidity.zetaphyMultisig);
  const gas = calls.reduce((s, c) => s + c.gas, 0n) + 400000n;
  const fee = gas * parseUnits(String(cfg.zetaphy.minGasPriceGwei), 9);
  const unsigned = {
    body: { messages: calls.map((c) => ({ '@type': '/zetaphy.pq.v1.MsgEVMCall', Sender: sender, To: c.to, Value: '0', Data: Buffer.from(getBytes(c.data)).toString('base64'), GasLimit: String(c.gas) })),
      memo: 'saphan-pool: ZTPHY to Base for the first pools', timeout_height: '0', extension_options: [], non_critical_extension_options: [] },
    auth_info: { signer_infos: [], fee: { amount: [{ denom: 'azetaphy', amount: String(fee) }], gas_limit: String(gas), payer: '', granter: '' } },
    signatures: [],
  };
  return { total: String(total), totalText: `${formatUnits(total, 18)} ZTPHY`, vault: getAddress(vault), recipient: getAddress(to), sender, calls: calls.map((c) => ({ ...c, gas: String(c.gas) })), unsigned,
    claim: { to: state?.steps?.['base-synthetic']?.synthetic ?? null, how: `after the mint delay (${cfg.token.limits.mintDelay} s) anyone calls claim(id) on the synthetic; id = keccak256 of the message body (the Queued event)`, data: (id) => SYN.encodeFunctionData('claim', [id]) } };
}

export { BASE_USDC };
