// ZETAPHY Saphan MAINNET: the ZTPHY routes ZETAPHY (3659) <-> Base (8453) and <-> every enabled chain under
// `destinations` (BNB Smart Chain, Arbitrum One; Polygon PoS prepared, disabled), as pure functions over the config
// zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json (docs/SAPHAN-MAINNET.md). No network, no key here: the owner's
// tool (scripts/saphan-mainnet.js), the pool helper (scripts/saphan-pool.js), the local dry run and the tests use these.
//
// What it gives:
//   route(cfg, name) / routeNames(cfg)   one route in one shape (Base keeps its original config fields); the enabled ones
//   mainnetProblems(cfg)     what is wrong with the config (refused everywhere)
//   missingInputs(cfg)       owner inputs still null, per chain (the plan lists them; a deploy refuses)
//   riskLines(cfg)           the plain risk statement, printed by every plan
//   routeTable(cfg, core, name)  the config as the chain table scripts/saphan.js deploys from (same deploy code as the testnets)
//   coreConfigYaml(cfg)      the Hyperlane core config of ZETAPHY mainnet (every owner the ZETAPHY timelock)
//   openPlan / pausePlan     the exact governance and guardian calls per route (gov proposal JSON, multisig calldata)
//   relayerWhitelist / relayerEnv / agentConfig   the off-chain agents' settings, every deployed route (no secrets)
//   costEstimate(cfg, opts)  the itemised cost (Base as before, the other routes under .routes in their gas token)
import { readFileSync, existsSync } from 'node:fs';
import { getAddress, isAddress, Interface, parseUnits, formatUnits, formatEther, parseEther, getBytes, id as hashText } from 'ethers';
import { sortAddresses, bytes32, NATIVE_ERC20 } from './saphan.js';
import { operationId, scheduleData, executeData } from './timelock.js';
import { toBech32 } from './pqtx.js';

export const MAINNET_DIR = new URL('../../zetaphy-chain/hyperlane/mainnet/', import.meta.url);
export const MAINNET_FILE = new URL('saphan-mainnet.json', MAINNET_DIR);
export const CORE_FILE = new URL('registry/chains/zetaphy/addresses.yaml', MAINNET_DIR);
/** What the deploy wrote (addresses, start blocks): public, committed by the owner after the deploy. */
export const STATE_FILE = new URL('saphan-mainnet-state.json', MAINNET_DIR);

export const ZETAPHY_CHAIN_ID = 3659;
export const BASE_CHAIN_ID = 8453;
/** Native USDC on Base (Circle): zetaphy-neuro/src/known-tokens.js, the Uniswap and Superchain token lists. */
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** The address in the 2026-11-14 brief, which is NOT USDC (same start, different end): refused. */
export const NOT_USDC = '0x833589fcd6edb6e08f4c7c32d29b5dd5ac9f4f8e';
export const TOTAL_SUPPLY = 1_000_000_000n;

const ZERO = '0x' + '00'.repeat(20);
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const addrOk = (v) => ADDR.test(String(v ?? '')) && isAddress(String(v));
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const AMOUNT = /^(\d{1,30})(?:\.(\d{1,18}))?$/;
const art = (n) => JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), 'utf8'));
export const MULTISIG = new Interface(['function propose(address to, uint256 value, bytes data) returns (uint256)', 'function confirm(uint256 id)', 'function execute(uint256 id) returns (bytes)',
  'function proposalCount() view returns (uint256)', 'function threshold() view returns (uint8)', 'function isOwner(address) view returns (bool)']);
export const ENDPOINT = new Interface(['function pause()', 'function unpause()', 'function veto(bytes32 id)', 'function lowerDailyLimit(uint256 v)', 'function raiseDelay(uint64 d)',
  'function lowerLockCap(uint256 v)', 'function lowerSupplyCap(uint256 v)', 'function paused() view returns (bool)']);

export function loadMainnet(file = process.env.SAPHAN_MAINNET || MAINNET_FILE) {
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  const p = mainnetProblems(cfg);
  if (p.length) throw new Error(`saphan mainnet config ${file}:\n  - ${p.join('\n  - ')}`);
  return cfg;
}

export function loadState(file = process.env.SAPHAN_MAINNET_STATE || STATE_FILE) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { steps: {} }; }
}

/** key: "0x…" lines of a Hyperlane addresses.yaml (the CLI's output). */
export function parseAddressesYaml(text) {
  const out = {};
  for (const m of String(text).matchAll(/^(\w+):\s*"?(0x[0-9a-fA-F]{40})"?/gm)) out[m[1]] = getAddress(m[2]);
  return out;
}
export function loadCore(file = process.env.ZETAPHY_CORE || CORE_FILE) {
  return existsSync(file) ? parseAddressesYaml(readFileSync(file, 'utf8')) : null;
}

/** Whole tokens -> base units (refuses more decimals than the token has). */
export const units = (v, decimals) => {
  const m = AMOUNT.exec(String(v ?? ''));
  if (!m || (m[2]?.length ?? 0) > decimals) throw new Error(`not an amount of a ${decimals}-decimal token: ${v}`);
  return parseUnits(String(v), decimals);
};
const amountOk = (v, d = 18) => { try { return units(v, d) > 0n; } catch { return false; } };

// ---------------------------------------------------------------- the routes (one per destination chain)
//
// Base is the first route and keeps its original place in the config (base, validators.baseOrigin, token.limits,
// liquidity.*, costs.base*). Every other destination is one entry under `destinations.<name>`, with the same fields
// in one place. route(cfg, name) gives both the same shape, so every function below works on any route and a new EVM
// chain is a config entry, not code. Each route has its own vault on ZETAPHY (ZetaphyTokenVault talks to exactly one
// remote contract), its own synthetic, multisig, timelock, ISM, caps, Safe, DEX and pools.

/** The DEXes the pool helper builds: Uniswap-v3-style position managers, with their fee tier -> tick spacing. */
export const DEXES = {
  'uniswap-v3': { label: 'Uniswap v3', tickSpacing: { 100: 1, 500: 10, 3000: 60, 10000: 200 } },
  // PancakeV3Factory's constructor (pancake-v3-contracts projects/v3-core/contracts/PancakeV3Factory.sol): 2500, not 3000
  'pancakeswap-v3': { label: 'PancakeSwap v3', tickSpacing: { 100: 1, 500: 10, 2500: 50, 10000: 200 } },
};
/** Uniswap v3 fee tier -> tick spacing (UniswapV3Factory.feeAmountTickSpacing). */
export const TICK_SPACING = DEXES['uniswap-v3'].tickSpacing;
const ROUTE_NAME = /^[a-z]{2,20}$/;
const CORE_KEYS = ['mailbox', 'merkleTreeHook', 'validatorAnnounce', 'staticMessageIdMultisigIsmFactory', 'interchainGasPaymaster'];

/** One route in one shape, whatever its place in the config. `at` names each field's path (for problems and missing inputs). */
export function route(cfg, name = 'base') {
  if (name === 'base') {
    const b = cfg?.base ?? {}, q = cfg?.liquidity ?? {}, c = cfg?.costs ?? {}, v = cfg?.validators ?? {};
    return {
      name, legacy: true, enabled: true, displayName: b.displayName ?? 'Base', chainId: b.chainId, domain: b.domain, rpc: b.rpc, explorer: b.explorer,
      estimateBlockTime: b.estimateBlockTime, reorgPeriod: b.reorgPeriod, confirmations: 3, indexChunk: 1999, nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      core: Object.fromEntries(CORE_KEYS.map((k) => [k, b[k]])), owners: b.owners, ownersSuggested: null, threshold: b.threshold, timelockDelay: b.timelockDelay,
      origin: v.baseOrigin ?? {}, hyperlaneDefault: v.hyperlaneBaseDefault ?? null, limits: cfg?.token?.limits ?? {},
      liquidity: { recipient: q.baseRecipient ?? null, dex: q.dex, factory: q.uniswapV3?.factory, positionManager: q.uniswapV3?.positionManager, feeTier: q.feeTier, slippageBps: q.slippageBps,
        pools: q.pools, verifiedTokens: { USDC: { address: BASE_USDC, decimals: 6, issuer: 'Circle (native USDC on Base)' } } },
      costs: { gasGwei: c.baseGasGwei, l1FeeNative: c.baseL1FeeEth, nativeUsd: c.ethUsd, relayerFloor: '0.002' }, funding: null,
      steps: { roles: 'base-roles', vault: 'zetaphy-vault', synthetic: 'base-synthetic' },
      at: { entry: 'base', core: 'base', rpc: 'base.rpc', owners: 'base.owners', threshold: 'base.threshold', timelockDelay: 'base.timelockDelay', origin: 'validators.baseOrigin',
        hyperlaneDefault: 'validators.hyperlaneBaseDefault', limits: 'token.limits', recipient: 'liquidity.baseRecipient', dex: 'liquidity.dex', factory: 'liquidity.uniswapV3.factory',
        positionManager: 'liquidity.uniswapV3.positionManager', feeTier: 'liquidity.feeTier', slippageBps: 'liquidity.slippageBps', pools: 'liquidity.pools', costs: 'costs', funding: null },
    };
  }
  const d = name !== 'about' ? cfg?.destinations?.[name] : null;
  if (!d || typeof d !== 'object') throw new Error(`unknown route ${name}: one of ${routeNames(cfg, { all: true }).join(', ')}`);
  const A = `destinations.${name}`, l = d.liquidity ?? {};
  return {
    name, legacy: false, enabled: d.enabled === true, displayName: d.displayName, chainId: d.chainId, domain: d.domain, rpc: d.rpc, explorer: d.explorer,
    estimateBlockTime: d.estimateBlockTime, reorgPeriod: d.reorgPeriod, confirmations: d.confirmations, indexChunk: d.indexChunk, nativeToken: d.nativeToken ?? {},
    core: d.hyperlane ?? {}, owners: d.owners ?? null, ownersSuggested: d.ownersSuggested ?? null, threshold: d.threshold, timelockDelay: d.timelockDelay,
    origin: d.originValidators ?? {}, hyperlaneDefault: d.hyperlaneDefault ?? null, limits: d.limits ?? {},
    liquidity: { recipient: l.recipient ?? null, dex: l.dex, factory: l.factory, positionManager: l.positionManager, feeTier: l.feeTier, slippageBps: l.slippageBps, pools: l.pools,
      verifiedTokens: l.verifiedTokens ?? {} },
    costs: d.costs ?? {}, funding: d.funding ?? {},
    steps: { roles: `${name}-roles`, vault: `zetaphy-vault-${name}`, synthetic: `${name}-synthetic` },
    at: { entry: A, core: `${A}.hyperlane`, rpc: `${A}.rpc`, owners: `${A}.owners`, threshold: `${A}.threshold`, timelockDelay: `${A}.timelockDelay`, origin: `${A}.originValidators`,
      hyperlaneDefault: `${A}.hyperlaneDefault`, limits: `${A}.limits`, recipient: `${A}.liquidity.recipient`, dex: `${A}.liquidity.dex`, factory: `${A}.liquidity.factory`,
      positionManager: `${A}.liquidity.positionManager`, feeTier: `${A}.liquidity.feeTier`, slippageBps: `${A}.liquidity.slippageBps`, pools: `${A}.liquidity.pools`, costs: `${A}.costs`, funding: `${A}.funding` },
  };
}

/** The route names: Base first, then `destinations` in config order. Only the enabled ones unless `all`. */
export function routeNames(cfg, { all = false } = {}) {
  const extra = Object.keys(cfg?.destinations ?? {}).filter((k) => k !== 'about');
  return ['base', ...extra].filter((n) => all || (n === 'base' || cfg.destinations[n]?.enabled === true));
}

/** Refuses a route that is not enabled (`"enabled": false` = prepared only). */
export function enabledRoute(cfg, name = 'base') {
  const r = route(cfg, name);
  if (!r.enabled) throw new Error(`route ${name} is disabled (${r.at.entry}.enabled is not true): prepared only, nothing is deployed, opened or relayed for it`);
  return r;
}

/** The validator set that signs messages from the route's chain to ZETAPHY (our own, or Hyperlane's published one). */
export function originSet(cfg, name = 'base') {
  const r = route(cfg, name), o = r.origin ?? {};
  return o.mode === 'hyperlane' ? r.hyperlaneDefault : { validators: o.validators ?? [], threshold: o.threshold };
}
/** The validator set that signs Base -> ZETAPHY (our own, or Hyperlane's published one). */
export const baseOriginSet = (cfg) => originSet(cfg, 'base');

function setProblems(p, at, set, allowSingle) {
  if (!Array.isArray(set?.validators)) { p.push(`${at}.validators: a list of 0x addresses`); return; }
  set.validators.forEach((v, i) => { if (!addrOk(v)) p.push(`${at}.validators[${i}]: not a 0x address`); });
  if (new Set(set.validators.map((v) => String(v).toLowerCase())).size !== set.validators.length) p.push(`${at}: a validator twice`);
  if (!(Number.isInteger(set.threshold) && set.threshold >= 1 && set.threshold <= Math.max(1, set.validators.length))) p.push(`${at}.threshold: 1..number of validators`);
  if (set.validators.length && set.threshold === 1 && !allowSingle) {
    p.push(`${at}: threshold 1 (${set.validators.length === 1 ? '1-of-1' : `1-of-${set.validators.length}`}) lets ONE key decide; refused unless validators.allowSingleValidator is true (owner flag)`);
  }
}

const poolsTotal = (r) => (r.liquidity.pools ?? []).reduce((s, x) => s + (amountOk(x.ztphyAmount) ? units(x.ztphyAmount, 18) : 0n), 0n);
const ONE_PERCENT = (TOTAL_SUPPLY / 100n) * 10n ** 18n;

/** The problems of one route (any route: Base keeps its original field paths and messages). */
function routeProblems(p, cfg, r, single) {
  const need = (v, at) => { if (!addrOk(v)) p.push(`${at}: not a 0x address`); };
  const opt = (v, at) => { if (v != null) need(v, at); };
  const z = cfg?.zetaphy ?? {}, A = r.at, D = r.displayName ?? r.name;
  if (r.legacy) {
    if (r.chainId !== BASE_CHAIN_ID || r.domain !== BASE_CHAIN_ID) p.push(`base: chainId and domain must be ${BASE_CHAIN_ID}`);
  } else {
    const d = cfg.destinations[r.name];
    if (!ROUTE_NAME.test(r.name)) p.push(`${A.entry}: a route name of 2-20 letters a-z (it names the chain for the agents)`);
    if (typeof d.enabled !== 'boolean') p.push(`${A.entry}.enabled: true or false (explicit)`);
    if (typeof r.displayName !== 'string' || !r.displayName.trim()) p.push(`${A.entry}.displayName: a name`);
    if (!(Number.isInteger(r.chainId) && r.chainId > 0 && Number.isInteger(r.domain) && r.domain > 0)) p.push(`${A.entry}: chainId and domain (the EVM chain id and the Hyperlane domain id)`);
    if (r.nativeToken?.decimals !== 18 || !/^[A-Za-z]{2,8}$/.test(String(r.nativeToken?.symbol ?? '')) || !String(r.nativeToken?.name ?? '').trim()) p.push(`${A.entry}.nativeToken: name, symbol, decimals 18 (the gas token)`);
    if (!(typeof r.estimateBlockTime === 'number' && r.estimateBlockTime > 0)) p.push(`${A.entry}.estimateBlockTime: seconds`);
    if (!(r.reorgPeriod === 'finalized' || (Number.isInteger(r.reorgPeriod) && r.reorgPeriod >= 0))) p.push(`${A.entry}.reorgPeriod: blocks or "finalized"`);
    if (!(Number.isInteger(r.confirmations) && r.confirmations >= 1)) p.push(`${A.entry}.confirmations: 1 or more`);
    if (!(Number.isInteger(r.indexChunk) && r.indexChunk >= 100 && r.indexChunk <= 10000)) p.push(`${A.entry}.indexChunk: 100..10000 blocks`);
    if (r.explorer != null && !/^https:\/\/\S+$/.test(r.explorer)) p.push(`${A.entry}.explorer: an https URL`);
  }
  for (const k of CORE_KEYS) need(r.core?.[k], `${A.core}.${k}`);
  if (!Array.isArray(r.rpc) || !r.rpc.length || r.rpc.some((u) => !/^https:\/\/\S+$/.test(u))) p.push(`${A.rpc}: https URLs`);
  if (r.owners == null && !r.legacy) { /* an owner input (missingInputs) */ }
  else if (!Array.isArray(r.owners) || !r.owners.length) p.push(`${A.owners}: the ${D} multisig owners`);
  else { r.owners.forEach((v, i) => need(v, `${A.owners}[${i}]`)); if (new Set(r.owners.map((x) => String(x).toLowerCase())).size !== r.owners.length) p.push(`${A.owners}: an owner twice`); }
  if (r.ownersSuggested != null) (Array.isArray(r.ownersSuggested) ? r.ownersSuggested : [null]).forEach((v, i) => need(v, `${A.entry}.ownersSuggested[${i}]`));
  const nOwners = Array.isArray(r.owners) ? r.owners.length : Infinity;
  if (!(Number.isInteger(r.threshold) && r.threshold >= 2 && r.threshold <= nOwners)) p.push(`${A.threshold}: 2..number of owners (never one key)`);
  if (!(Number.isInteger(r.timelockDelay) && r.timelockDelay >= 172800)) p.push(`${A.timelockDelay}: at least 172800 (48 h)`);
  if (!['ours', 'hyperlane'].includes(r.origin?.mode)) p.push(`${A.origin}.mode: "ours" or "hyperlane"`);
  setProblems(p, A.origin, r.origin, single);
  if (r.hyperlaneDefault != null || r.legacy) {
    setProblems(p, A.hyperlaneDefault, r.hyperlaneDefault, false);
    if (!(r.hyperlaneDefault?.validators?.length >= 1)) p.push(`${A.hyperlaneDefault}: the published set`);
  } else if (r.origin?.mode === 'hyperlane') p.push(`${A.origin}.mode: "hyperlane" needs ${A.hyperlaneDefault} (Hyperlane's published set for ${D}); none is recorded, so use "ours"`);
  const l = r.limits ?? {};
  for (const f of ['lockCap', 'supplyCap', 'mintDailyLimit', 'releaseDailyLimit']) if (!amountOk(l[f])) p.push(`${A.limits}.${f}: whole ZTPHY above 0`);
  for (const f of ['mintDelay', 'releaseDelay']) if (!(Number.isInteger(l[f]) && l[f] >= 3600 && l[f] <= 30 * 86400)) p.push(`${A.limits}.${f}: seconds, 3600 (1 h) .. 30 days`);
  if (!p.some((x) => x.startsWith(`${A.limits}.`))) {
    const [lock, supply, mint, rel] = ['lockCap', 'supplyCap', 'mintDailyLimit', 'releaseDailyLimit'].map((f) => units(l[f], 18));
    if (supply > lock) p.push(`${A.limits}.supplyCap: at most lockCap (no more ZTPHY on ${D} than can be locked)`);
    if (mint > supply) p.push(`${A.limits}.mintDailyLimit: at most supplyCap`);
    if (rel > lock) p.push(`${A.limits}.releaseDailyLimit: at most lockCap`);
    if (lock > ONE_PERCENT) p.push(`${A.limits}.lockCap: at most 1% of the supply (10,000,000 ZTPHY) while the bridge is unaudited`);
    const pools = poolsTotal(r);
    if (pools > mint || pools > lock) p.push(`${A.limits}: the pools need ${formatEther(pools)} ZTPHY on ${D}; mintDailyLimit and lockCap must allow it`);
  }
  const q = r.liquidity, liq = cfg?.liquidity ?? {};
  opt(q.recipient, A.recipient);
  if (q.recipient != null && [liq.zetaphyMultisig, z.timelock, z.guardian, z.govModule, ...(z.guardianOwners ?? [])].some((x) => same(x, q.recipient))) {
    p.push(`${A.recipient}: a Safe ON ${D.toUpperCase()}, never a ZETAPHY multisig or module address (nobody holds those keys on ${D})`);
  }
  const dex = DEXES[q.dex];
  if (!dex) p.push(`${A.dex}: ${Object.keys(DEXES).map((x) => `"${x}"`).join(' or ')} (the ones this helper builds)`);
  need(q.factory, A.factory);
  need(q.positionManager, A.positionManager);
  if (dex && !dex.tickSpacing[q.feeTier]) p.push(`${A.feeTier}: ${Object.keys(dex.tickSpacing).join(', ')} (${dex.label} fee tiers)`);
  if (!(Number.isInteger(q.slippageBps) && q.slippageBps >= 0 && q.slippageBps <= 1000)) p.push(`${A.slippageBps}: 0..1000`);
  const vt = q.verifiedTokens ?? {};
  for (const [sym, x] of Object.entries(vt)) { need(x?.address, `${A.entry === 'base' ? 'base' : `${A.entry}.liquidity`}.verifiedTokens.${sym}.address`); if (!(Number.isInteger(x?.decimals) && x.decimals >= 0 && x.decimals <= 18)) p.push(`verifiedTokens.${sym}.decimals: 0..18`); }
  if (!Array.isArray(q.pools) || !q.pools.length) p.push(`${A.pools}: a list of {stable, address, decimals, stableAmount, ztphyAmount}`);
  else {
    const seen = new Set();
    q.pools.forEach((x, i) => {
      const at = `${A.pools}[${i}]`, sym = String(x.stable ?? '').toUpperCase();
      if (!/^[A-Za-z0-9.]{1,12}$/.test(String(x.stable ?? ''))) p.push(`${at}.stable: a symbol`);
      if (seen.has(sym)) p.push(`${at}: ${x.stable} twice`); seen.add(sym);
      opt(x.address, `${at}.address`);
      if (r.legacy && same(x.address, NOT_USDC)) p.push(`${at}.address ${x.address} is NOT USDC on Base (USDC is ${BASE_USDC})`);
      const known = Object.entries(vt).find(([k]) => k.toUpperCase() === sym)?.[1];
      if (known && x.address != null && !same(x.address, known.address)) p.push(`${at}: ${x.stable} on ${D} is ${known.address}`);
      if (known && x.decimals !== known.decimals) p.push(`${at}.decimals: ${x.stable} on ${D} has ${known.decimals} decimals`);
      if (!(Number.isInteger(x.decimals) && x.decimals >= 0 && x.decimals <= 18)) p.push(`${at}.decimals: 0..18`);
      if (!amountOk(x.stableAmount, Number.isInteger(x.decimals) ? x.decimals : 18)) p.push(`${at}.stableAmount: whole tokens above 0 (an owner input)`);
      if (!amountOk(x.ztphyAmount)) p.push(`${at}.ztphyAmount: whole ZTPHY above 0 (an owner input; it sets the initial price)`);
    });
  }
  if (!r.legacy) {
    const c = r.costs ?? {};
    for (const f of ['gasGwei', 'l1FeeNative', 'nativeUsd', 'relayerFloor']) if (!/^\d+(\.\d+)?$/.test(String(c[f] ?? ''))) p.push(`${A.costs}.${f}: a number`);
    for (const f of ['deployer', 'relayer']) if (r.funding?.[f] != null && !amountOk(r.funding[f])) p.push(`${A.funding}.${f}: an amount of ${r.nativeToken?.symbol ?? 'the gas token'} above 0 (or null while not decided)`);
  }
}

/** Every problem with the mainnet config (empty when usable). Missing owner inputs (null) are not problems: see missingInputs. */
export function mainnetProblems(cfg) {
  const p = [];
  const need = (v, at) => { if (!addrOk(v)) p.push(`${at}: not a 0x address`); };
  if (cfg?.network !== 'mainnet') p.push('network: must be "mainnet"');
  const z = cfg?.zetaphy ?? {};
  if (z.chainId !== ZETAPHY_CHAIN_ID || z.domain !== ZETAPHY_CHAIN_ID) p.push(`zetaphy: chainId and domain must be ${ZETAPHY_CHAIN_ID}`);
  if (z.cosmosChainId !== 'zetaphy_3659-1') p.push('zetaphy.cosmosChainId: zetaphy_3659-1');
  for (const k of ['timelock', 'govModule', 'guardian', 'threats']) need(z[k], `zetaphy.${k}`);
  if (!Array.isArray(z.rpc) || !z.rpc.length || z.rpc.some((u) => !/^https:\/\/\S+$/.test(u))) p.push('zetaphy.rpc: https URLs');
  if (!(Number.isInteger(z.timelockDelay) && z.timelockDelay >= 172800)) p.push('zetaphy.timelockDelay: at least 172800 (48 h)');
  if (!/^zetaphy1[0-9a-z]{38}$/.test(String(z.govModuleBech32 ?? ''))) p.push('zetaphy.govModuleBech32: zetaphy1…');
  else if (addrOk(z.govModule) && toBech32(getBytes(getAddress(z.govModule)), 'zetaphy') !== z.govModuleBech32) p.push('zetaphy.govModuleBech32 is not the bech32 of zetaphy.govModule');
  if (!amountOk(z.proposalDeposit)) p.push('zetaphy.proposalDeposit: whole ZTPHY');
  const v = cfg?.validators ?? {};
  const single = v.allowSingleValidator === true;
  setProblems(p, 'validators.zetaphyOrigin', v.zetaphyOrigin, single);
  const t = cfg?.token ?? {};
  if (!same(t.address, NATIVE_ERC20) || t.decimals !== 18 || t.native !== true) p.push(`token: the native coin's ERC-20 ${NATIVE_ERC20}, 18 decimals, native: true`);
  if (t.key !== 'ztphy' || t.symbol !== 'ZTPHY') p.push('token: key ztphy, symbol ZTPHY');
  if (!/^[\w.-]{1,12}$/.test(String(t.synthetic?.symbol ?? '')) || !String(t.synthetic?.name ?? '').trim()) p.push('token.synthetic: name and symbol');
  if (cfg?.deployer?.address != null) need(cfg.deployer.address, 'deployer.address');
  const q = cfg?.liquidity ?? {};
  need(q.zetaphyMultisig, 'liquidity.zetaphyMultisig');
  if (q.zetaphyMultisigBech32 != null && (!addrOk(q.zetaphyMultisig) || toBech32(getBytes(getAddress(q.zetaphyMultisig)), 'zetaphy') !== q.zetaphyMultisigBech32)) p.push('liquidity.zetaphyMultisigBech32 is not the bech32 of liquidity.zetaphyMultisig');
  if (cfg?.destinations != null && (typeof cfg.destinations !== 'object' || Array.isArray(cfg.destinations))) p.push('destinations: an object of destination entries');
  else if (cfg?.destinations?.base) p.push('destinations.base: Base is configured at the top level (base, liquidity, token.limits), not here');
  else {
    const names = routeNames(cfg, { all: true }), ids = new Map();
    for (const n of names) {
      const r = route(cfg, n);
      routeProblems(p, cfg, r, single);
      for (const [k, x] of [['chainId', r.chainId], ['domain', r.domain]]) {
        if (x === ZETAPHY_CHAIN_ID) p.push(`${r.at.entry}.${k}: ${x} is ZETAPHY's`);
        else if (ids.has(`${k}:${x}`)) p.push(`${r.at.entry}.${k}: ${x} is also ${ids.get(`${k}:${x}`)}'s`);
        ids.set(`${k}:${x}`, n);
      }
    }
    // every open route has its own vault on ZETAPHY: together they must stay under the same 1% bound
    const caps = routeNames(cfg).map((n) => route(cfg, n).limits?.lockCap);
    if (caps.every((x) => amountOk(x))) {
      const sum = caps.reduce((s, x) => s + units(x, 18), 0n);
      if (sum > ONE_PERCENT) p.push(`lockCap of the open routes together: ${formatEther(sum)} ZTPHY, at most 1% of the supply (10,000,000 ZTPHY) while the bridge is unaudited`);
    }
  }
  const c = cfg?.costs ?? {};
  for (const f of ['baseGasGwei', 'baseL1FeeEth', 'ethUsd']) if (!/^\d+(\.\d+)?$/.test(String(c[f] ?? ''))) p.push(`costs.${f}: a number`);
  if (!(Number.isInteger(c.relayerDeliveries) && c.relayerDeliveries >= 1)) p.push('costs.relayerDeliveries: a whole number');
  return p;
}

/**
 * Owner inputs still missing: [{ field, why, blocks, chain }]. Each blocks the steps named in `blocks` (exact step ids).
 * `chain`: 'all' (shared), or the route. Disabled routes are left out unless `all`.
 */
export function missingInputs(cfg, { all = false } = {}) {
  const m = [];
  if (!cfg.deployer?.address) m.push({ field: 'deployer.address', why: 'a fresh deployer key (same address on ZETAPHY and every destination), funded with the amounts of `costs`', blocks: 'every deploy step', chain: 'all' });
  if (!cfg.validators?.zetaphyOrigin?.validators?.length) m.push({ field: 'validators.zetaphyOrigin.validators', why: 'our validator address(es) (setup-agents-mainnet.sh addresses)', blocks: `core, ${routeNames(cfg).map((n) => route(cfg, n).steps.roles).join(', ')} (our ISM on each destination)`, chain: 'all' });
  if (cfg.validators?.baseOrigin?.mode === 'ours' && !cfg.validators.baseOrigin.validators?.length) m.push({ field: 'validators.baseOrigin.validators', why: 'our Base-origin validator address(es) (VALIDATE_BASE=yes), or set baseOrigin.mode to "hyperlane"', blocks: 'core (default ISM), zetaphy-vault (its ISM)', chain: 'base' });
  if (!cfg.liquidity?.baseRecipient) m.push({ field: 'liquidity.baseRecipient', why: 'the Safe on Base that receives the bridged ZTPHY and owns the pools', blocks: 'saphan-pool.js (bridge, pools)', chain: 'base' });
  for (const [i, x] of (cfg.liquidity?.pools ?? []).entries()) if (!x.address) m.push({ field: `liquidity.pools[${i}].address`, why: `the ${x.stable} token on Base, checked on basescan.org (not verifiable from this repository)`, blocks: `the ${x.stable} pool`, chain: 'base' });
  for (const n of routeNames(cfg, { all }).filter((x) => x !== 'base')) {
    const r = route(cfg, n), A = r.at, D = r.displayName, S = r.steps, sym = r.nativeToken?.symbol ?? 'gas';
    const host = String(r.explorer ?? '').replace(/^https:\/\//, '') || 'its explorer';
    if (r.owners == null) m.push({ field: A.owners, why: `the ${D} multisig owners (suggested in ownersSuggested: the ZETAPHY guardian owners; copy them to confirm)`, blocks: `${S.roles}`, chain: n });
    if (r.origin?.mode === 'ours' && !r.origin.validators?.length) m.push({ field: `${A.origin}.validators`, why: `our ${D}-origin validator address(es) (VALIDATE_ORIGINS=${n}), or mode "hyperlane"`, blocks: `${S.vault} (its ISM)`, chain: n });
    if (!r.liquidity.recipient) m.push({ field: A.recipient, why: `the Safe on ${D} that receives the bridged ZTPHY and owns the pools (deploy it on ${D} first; the same address as on Base is possible, not automatic)`, blocks: `saphan-pool.js --route ${n} (bridge, pools)`, chain: n });
    for (const [i, x] of (r.liquidity.pools ?? []).entries()) if (!x.address) m.push({ field: `${A.pools}[${i}].address`, why: `the ${x.stable} token on ${D}, checked on ${host}`, blocks: `the ${x.stable} pool`, chain: n });
    if (r.funding?.deployer == null) m.push({ field: `${A.funding}.deployer`, why: `the ${sym} you send the deployer on ${D} (costs recommends an amount)`, blocks: `${S.roles}, ${S.synthetic}`, chain: n });
    if (r.funding?.relayer == null) m.push({ field: `${A.funding}.relayer`, why: `the ${sym} you send the relayer on ${D} (costs recommends a float)`, blocks: `start-relayer (${n})`, chain: n });
  }
  return m;
}

/** The plain risk statement. Every plan prints it. */
export function riskLines(cfg) {
  const z = cfg.validators?.zetaphyOrigin ?? {};
  const n = (x) => (x?.validators?.length ? `${x.threshold} of ${x.validators.length}` : 'validators not set yet');
  const names = routeNames(cfg);
  const L = [
    'RISK: ZETAPHY mainnet runs on ONE validator: if it stops, the bridge stops; if it is taken over, it can rewrite ZETAPHY.',
    ...names.map((rn) => {
      const r = route(cfg, rn), D = r.displayName, b = originSet(cfg, rn);
      return `RISK: ZETAPHY -> ${D} mints are signed by OUR validators only (${n(z)}), ${D} -> ZETAPHY releases by ${r.origin?.mode === 'hyperlane' ? "Hyperlane's published validators" : 'OUR validators'} (${n(b)}): a small set, not Hyperlane's network.`;
    }),
    'RISK: the bridge contracts (ZetaphyTokenVault, SaphanSyntheticToken) are NOT audited. Users bridge only what they can afford to lose.',
    `Bounded by${names.length > 1 ? ' (Base, its own vault)' : ''}: lockCap ${cfg.token.limits.lockCap} ZTPHY, supplyCap ${cfg.token.limits.supplyCap}, mint ${cfg.token.limits.mintDailyLimit}/day after ${cfg.token.limits.mintDelay} s, release ${cfg.token.limits.releaseDailyLimit}/day after ${cfg.token.limits.releaseDelay} s; guardians pause and veto at once.`,
  ];
  for (const rn of names.filter((x) => x !== 'base')) {
    const r = route(cfg, rn), l = r.limits;
    L.push(`Bounded by (${r.displayName}, its own vault): lockCap ${l.lockCap} ZTPHY, supplyCap ${l.supplyCap}, mint ${l.mintDailyLimit}/day after ${l.mintDelay} s, release ${l.releaseDailyLimit}/day after ${l.releaseDelay} s.`);
    for (const x of r.liquidity.pools ?? []) if (x.issuer) L.push(`RISK (${r.displayName}): the pool's stable is ${x.stable}, ${x.issuer}.`);
  }
  if (names.length > 1) L.push(`NOTE: ZTPHY on ${names.map((x) => route(cfg, x).displayName).join(', ')} are SEPARATE synthetic tokens (one per chain, each backed by its own vault of locked native ZTPHY): separate markets with separate prices, not one token.`);
  for (const [at, s] of [...names.map((rn) => [`ZETAPHY -> ${route(cfg, rn).displayName}`, z]), ...names.map((rn) => [`${route(cfg, rn).displayName} -> ZETAPHY`, originSet(cfg, rn)])]) {
    if (s?.validators?.length && s.threshold === 1) L.push(`RISK (owner flag allowSingleValidator): ${at} is ${s.threshold}-of-${s.validators.length}: ONE key on one machine can sign a false message (unbacked ZTPHY on a destination, or a release from a vault), stopped only by the delay, the guardians and the caps.`);
  }
  return L;
}

/**
 * The config as the chain table of src/saphan.js, so the testnet deploy code (scripts/saphan.js originPrepare,
 * zetaphyIsm, tokenVault, tokenSynthetic) deploys mainnet unchanged. `core`: ZETAPHY's Hyperlane addresses.
 */
export function routeTable(cfg, core, name = 'base') {
  if (!core?.mailbox || !core?.merkleTreeHook || !core?.staticMessageIdMultisigIsmFactory) throw new Error('no Hyperlane core on ZETAPHY yet (registry/chains/zetaphy/addresses.yaml): run the core step first');
  const r = route(cfg, name), bo = originSet(cfg, name), k = cfg.token, L = r.limits;
  return {
    zetaphy: { name: 'zetaphy', displayName: cfg.zetaphy.displayName, chainId: cfg.zetaphy.chainId, domain: cfg.zetaphy.domain, rpc: cfg.zetaphy.rpc,
      mailbox: core.mailbox, merkleTreeHook: core.merkleTreeHook, validatorAnnounce: core.validatorAnnounce, staticMessageIdMultisigIsmFactory: core.staticMessageIdMultisigIsmFactory,
      timelock: cfg.zetaphy.timelock, guardian: cfg.zetaphy.guardian, threats: cfg.zetaphy.threats },
    zetaphyValidators: { validators: cfg.validators.zetaphyOrigin.validators, threshold: cfg.validators.zetaphyOrigin.threshold },
    origin: { owners: r.owners ?? [], threshold: r.threshold, timelockDelay: r.timelockDelay },
    chains: { [name]: { displayName: r.displayName, chainId: r.chainId, domain: r.domain, rpc: r.rpc, explorer: r.explorer, estimateBlockTime: r.estimateBlockTime,
      mailbox: r.core.mailbox, merkleTreeHook: r.core.merkleTreeHook, validatorAnnounce: r.core.validatorAnnounce, staticMessageIdMultisigIsmFactory: r.core.staticMessageIdMultisigIsmFactory,
      validators: bo.validators, threshold: bo.threshold } },
    tokens: { [k.key]: { displayName: k.displayName, symbol: k.symbol, address: k.address, decimals: k.decimals, native: k.native, synthetic: k.synthetic,
      destinations: [name], limits: { lockCap: L.lockCap, releaseDailyLimit: L.releaseDailyLimit, releaseDelay: L.releaseDelay,
        mintDailyLimit: L.mintDailyLimit, mintDelay: L.mintDelay, supplyCap: L.supplyCap } } },
  };
}

/** The Hyperlane core config of ZETAPHY mainnet (`hyperlane core deploy --config`): every owner the ZETAPHY timelock. */
export function coreConfigYaml(cfg) {
  const tl = getAddress(cfg.zetaphy.timelock), bo = baseOriginSet(cfg);
  if (!bo.validators?.length) throw new Error('validators.baseOrigin: no validators yet (the default ISM of ZETAPHY trusts them for messages from Base)');
  const q = (s) => `"${s}"`;
  return [
    '# Hyperlane core on ZETAPHY MAINNET (3659), written by `node scripts/saphan-mainnet.js core-config` from',
    '# zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json. Every owner and the fee beneficiary is the ZETAPHY timelock',
    '# (48 h, the gov module proposes); no key keeps a role. No interchain gas paymaster (our relayer pays, whitelisted).',
    `# Default ISM for origin Base: ${cfg.validators.baseOrigin.mode === 'hyperlane' ? "Hyperlane's published Base validators" : 'OUR Base-origin validators'} (${bo.threshold} of ${bo.validators.length}).`,
    '# The ZTPHY route does not use the default ISM: the vault has its own (the same validators, made by the factory).',
    `owner: ${q(tl)}`, 'proxyAdmin:', `  owner: ${q(tl)}`,
    'defaultIsm:', '  type: domainRoutingIsm', `  owner: ${q(tl)}`, '  domains:', '    base:', '      type: messageIdMultisigIsm', '      validators:',
    ...sortAddresses(bo.validators).map((v) => `        - ${q(v.toLowerCase())}`), `      threshold: ${bo.threshold}`,
    'defaultHook:', '  type: merkleTreeHook',
    'requiredHook:', '  type: protocolFee', `  owner: ${q(tl)}`, `  beneficiary: ${q(tl)}`, '  protocolFee: "0"', '  maxProtocolFee: "1000000000"', '',
  ].join('\n');
}

/** A gov proposal file (gov.sh propose-file): the gov module calls `to` with `data` (MsgEVMCall, Go field names). */
export function govProposal(cfg, { to, data, title, summary, gasLimit = 500000 }) {
  return {
    messages: [{ '@type': '/zetaphy.pq.v1.MsgEVMCall', Sender: cfg.zetaphy.govModuleBech32, To: getAddress(to), Value: '0', Data: Buffer.from(String(data).slice(2), 'hex').toString('base64'), GasLimit: String(gasLimit) }],
    metadata: '', deposit: `${units(cfg.zetaphy.proposalDeposit, 18)}azetaphy`, title: String(title).slice(0, 140), summary, expedited: false,
  };
}

/** One timelock call: its operation id, schedule and execute calldata (salt fixed per purpose, chain and target). */
export function timelockCall({ chainId, timelock, target, data, delay, purpose }) {
  const salt = hashText(`saphan-mainnet ${purpose} ${chainId} ${getAddress(target)}`);
  const op = { target: getAddress(target), value: 0n, data, salt };
  return { chainId, timelock: getAddress(timelock), target: op.target, data, salt, delay, operationId: operationId(op), schedule: scheduleData({ ...op, delay }), execute: executeData(op) };
}

/** The deployed addresses of one route (state steps), or null. */
export function deployedRoute(cfg, state, name = 'base') {
  const S = route(cfg, name).steps, st = state?.steps ?? {};
  const v = st[S.vault], s = st[S.synthetic], r = st[S.roles];
  if (!v?.vault || !s?.synthetic || !r?.multisig || !r?.timelock) return null;
  return { vault: v.vault, synthetic: s.synthetic, multisig: r.multisig, timelock: r.timelock, vaultBlock: v.block, fromBlock: r.fromBlock ?? s.block };
}
const routeOf = (cfg, state, name) => {
  const d = deployedRoute(cfg, state, name), S = route(cfg, name).steps;
  if (!d) throw new Error(`the route is not deployed yet (state: ${S.vault}, ${S.roles}, ${S.synthetic})`);
  return d;
};

/**
 * Opening a route (both ends are deployed paused): ZETAPHY timelock -> vault.unpause(), destination timelock -> synthetic.unpause().
 * ZETAPHY: the gov module schedules (a gov proposal), anyone executes after 48 h. Destination: its multisig proposes the
 * schedule to its timelock, then (after 48 h) the execute. `what = 'unpause'` opens; other ENDPOINT calls work the same way.
 * Returns { zetaphy, <route>: …, destination: … } (for Base: `.base`, as before).
 */
export function openPlan(cfg, state, { what = 'unpause', args = [], route: name = 'base' } = {}) {
  const R = enabledRoute(cfg, name), r = routeOf(cfg, state, name);
  const data = ENDPOINT.encodeFunctionData(what, args);
  const z = timelockCall({ chainId: cfg.zetaphy.chainId, timelock: cfg.zetaphy.timelock, target: r.vault, data, delay: cfg.zetaphy.timelockDelay, purpose: what });
  const b = timelockCall({ chainId: R.chainId, timelock: r.timelock, target: r.synthetic, data, delay: R.timelockDelay, purpose: what });
  const dest = { ...b, multisig: r.multisig, proposeSchedule: MULTISIG.encodeFunctionData('propose', [r.timelock, 0n, b.schedule]), proposeExecute: MULTISIG.encodeFunctionData('propose', [r.timelock, 0n, b.execute]) };
  return {
    route: name,
    zetaphy: { ...z, proposal: govProposal(cfg, { to: cfg.zetaphy.timelock, data: z.schedule, title: `Saphan mainnet: ZetaphyTokenVault.${what}() (ZTPHY -> ${R.displayName})`,
      summary: `Schedules ${what}() on the ZTPHY vault ${r.vault} (the ${R.displayName} route) through the ZetaphyTimelock ${cfg.zetaphy.timelock} (operation ${z.operationId}, delay ${z.delay} s). After the delay anyone executes it. The bridge contracts are NOT audited (docs/SAPHAN-MAINNET.md).` }) },
    [name]: dest, destination: dest,
  };
}

/** What the guardians send at once (no timelock): pause both ends; veto a queued payout; lower a limit. Calldata for the SimpleMultisigs. */
export function pausePlan(cfg, state, { veto = null, route: name = 'base' } = {}) {
  const R = route(cfg, name), r = routeOf(cfg, state, name);
  const call = (to, fn, a = []) => { const data = ENDPOINT.encodeFunctionData(fn, a); return { to, data, propose: MULTISIG.encodeFunctionData('propose', [to, 0n, data]) }; };
  const dest = { multisig: r.multisig, owners: R.owners, threshold: R.threshold, pause: call(r.synthetic, 'pause') };
  const out = { route: name, zetaphy: { multisig: getAddress(cfg.zetaphy.guardian), owners: cfg.zetaphy.guardianOwners, threshold: cfg.zetaphy.guardianThreshold, pause: call(r.vault, 'pause') }, [name]: dest, destination: dest };
  if (veto) { out.zetaphy.veto = call(r.vault, 'veto', [veto]); dest.veto = call(r.synthetic, 'veto', [veto]); }
  return out;
}

/** The deployed, enabled routes, Base first. */
export const relayedRoutes = (cfg, state) => routeNames(cfg).filter((n) => deployedRoute(cfg, state, n));

/** The relayer delivers only these: each vault -> its destination, each synthetic -> ZETAPHY (deployed, enabled routes). */
export function relayerWhitelist(cfg, state) {
  const names = relayedRoutes(cfg, state);
  if (!names.length) routeOf(cfg, state, 'base'); // throws: nothing deployed
  return names.flatMap((n) => {
    const R = route(cfg, n), r = deployedRoute(cfg, state, n);
    return [{ originDomain: cfg.zetaphy.domain, senderAddress: bytes32(r.vault), destinationDomain: R.domain },
      { originDomain: R.domain, senderAddress: bytes32(r.synthetic), destinationDomain: cfg.zetaphy.domain }];
  });
}

/** The relayer's environment (no secrets): chains, whitelist, start blocks (the deploy's). */
export function relayerEnv(cfg, state) {
  const names = relayedRoutes(cfg, state);
  const from = {};
  for (const n of names.length ? names : ['base']) {
    const r = deployedRoute(cfg, state, n), S = route(cfg, n).steps;
    if (!Number.isInteger(r?.vaultBlock) || !Number.isInteger(r?.fromBlock)) throw new Error(`state: no start blocks (${S.vault}.block, ${S.roles}.fromBlock)`);
    from[n] = r.fromBlock;
  }
  return [`HYP_RELAYCHAINS=zetaphy,${names.join(',')}`, `HYP_WHITELIST=${JSON.stringify(relayerWhitelist(cfg, state))}`, 'HYP_CHAINS_ZETAPHY_INDEX_CHUNK=499',
    ...names.map((n) => `HYP_CHAINS_${n.toUpperCase()}_INDEX_FROM=${from[n]}`), 'HYP_GASPAYMENTENFORCEMENT=[{"type":"none"}]'];
}

/**
 * The agent config (relayer and validators read it as CONFIG_FILES): ZETAPHY with its core, each destination with
 * Hyperlane's core there. The same fields `hyperlane registry agent-config` writes for EVM chains. `zFrom`: where our
 * validator reads ZETAPHY's tree. Chains: Base, plus every enabled route given a start block in `from` (or `routes`).
 */
export function agentConfig(cfg, core, { zFrom = 0, baseFrom = null, rpc = {}, from = {}, routes = null } = {}) {
  if (!core?.mailbox) throw new Error('no ZETAPHY core addresses');
  const z = cfg.zetaphy;
  const names = routes ?? ['base', ...routeNames(cfg).filter((n) => n !== 'base' && Number.isInteger(from[n]))];
  const chain = (name, c, a, x) => ({ name, displayName: c.displayName, chainId: c.chainId, domainId: c.domain, protocol: 'ethereum', isTestnet: false,
    rpcUrls: (rpc[name] ?? c.rpc).map((http) => ({ http })), nativeToken: x.nativeToken, blocks: x.blocks,
    mailbox: a.mailbox, merkleTreeHook: a.merkleTreeHook, validatorAnnounce: a.validatorAnnounce, interchainGasPaymaster: a.interchainGasPaymaster ?? ZERO,
    ...(a.proxyAdmin ? { proxyAdmin: a.proxyAdmin } : {}), index: x.index });
  const chains = { zetaphy: chain('zetaphy', z, core, { nativeToken: { name: 'ZETAPHY', symbol: 'ZTPHY', decimals: 18 }, blocks: { confirmations: 1, reorgPeriod: 1, estimateBlockTime: z.estimateBlockTime },
    index: { from: zFrom, chunk: 499 } }) };
  for (const n of names) {
    const r = enabledRoute(cfg, n), f = n === 'base' ? (baseFrom ?? from.base ?? 0) : from[n];
    if (!Number.isInteger(f)) throw new Error(`agent config: no start block for ${n} (--${n}-from <block>; default: the deploy block of ${r.steps.roles})`);
    chains[n] = chain(n, r, r.core, { nativeToken: r.nativeToken, blocks: { confirmations: r.confirmations, reorgPeriod: r.reorgPeriod, estimateBlockTime: r.estimateBlockTime },
      index: { from: f, chunk: r.indexChunk } });
  }
  return { chains, defaultRpcConsensusType: 'fallback' };
}

/** Gas of each step (estimates; the local dry run prints what it measured next to them). `base` = any destination (same contracts). */
export const GAS = {
  zetaphy: { core: 35_000_000n, coreHandover: 120_000n, ism: 450_000n, vault: 2_700_000n, announce: 130_000n, delivery: 400_000n, claim: 150_000n, lock: 320_000n },
  base: { multisig: 1_400_000n, timelock: 2_700_000n, ism: 450_000n, synthetic: 2_700_000n, announce: 130_000n, delivery: 400_000n, claim: 150_000n, openPerEnd: 1_000_000n,
    safe: 400_000n, approve: 60_000n, createPool: 5_200_000n, mint: 600_000n },
};

/**
 * The itemised cost of one route: its ZETAPHY rows (vault, the relayer's deliveries there, the lock) in ZTPHY, its
 * destination rows in the destination's gas token at `gwei` (default: the route's costs.gasGwei), and the funding
 * recommendation; `warnings` when the owner's funding inputs are below it.
 */
export function routeCost(cfg, name, { gwei = null, zetaphyGasGwei = cfg.zetaphy.minGasPriceGwei, deliveries = cfg.costs.relayerDeliveries } = {}) {
  const r = route(cfg, name), c = r.costs, sym = r.nativeToken.symbol, D = r.displayName, G = GAS.base;
  const g = String(gwei ?? c.gasGwei), zg = parseUnits(String(zetaphyGasGwei), 9), bg = parseUnits(g, 9), l1 = parseEther(String(c.l1FeeNative));
  const pools = (r.liquidity.pools ?? []).length, ownOrigin = r.origin?.mode === 'ours', N = BigInt(deliveries);
  const items = [
    ['zetaphy', 'deployer', `ISM for origin ${D} (factory) + ZetaphyTokenVault`, GAS.zetaphy.ism + GAS.zetaphy.vault],
    ['zetaphy', 'relayer', `${deliveries} deliveries ${D} -> ZETAPHY`, GAS.zetaphy.delivery * N],
    ['zetaphy', 'liquidity multisig', `approve + lock (${pools} pool(s), one lock)`, GAS.zetaphy.lock + 60_000n],
    [name, 'deployer', `SimpleMultisig + ZetaphyTimelock (${D} governance)`, G.multisig + G.timelock],
    [name, 'deployer', 'our ISM (factory) + SaphanSyntheticToken', G.ism + G.synthetic],
    ...(ownOrigin ? [[name, 'validator', `our ${D}-origin validator announces itself (once)`, G.announce]] : []),
    [name, `${D} multisig owners`, 'open: propose/confirm/execute of schedule, then of execute', G.openPerEnd],
    [name, 'relayer', `${deliveries} deliveries ZETAPHY -> ${D} (the float)`, G.delivery * N],
    [name, 'anyone', 'claim the first mint (after the delay)', G.claim],
    [name, 'liquidity Safe', `Safe on ${D} + ${pools} pool(s): approvals, create + initialise, mint full range`, G.safe + BigInt(pools) * (2n * G.approve + G.createPool + G.mint)],
  ];
  const rows = items.map(([chain, who, what, gas]) => ({ chain, who, what, gas: String(gas), cost: chain === 'zetaphy' ? `${formatEther(gas * zg)} ZTPHY` : `${formatEther(gas * bg)} ${sym}` }));
  const sum = (ch, who = null) => items.filter((x) => x[0] === ch && (who == null || x[1] === who)).reduce((s, x) => s + x[3], 0n);
  const total = sum(name) * bg + l1 * 4n; // L1 data fee allowance: deploys + pool txs (0 where the chain has none)
  const deployer = sum(name, 'deployer') * bg + l1 * 2n, relayer = G.delivery * N * bg, floor = parseEther(String(c.relayerFloor));
  const usd = (wei) => (Number(formatEther(wei)) * Number(c.nativeUsd)).toFixed(2);
  const deployerRec = deployer * 3n, relayerRec = relayer > floor ? relayer : floor;
  const warnings = [];
  for (const [f, rec] of [['deployer', deployerRec], ['relayer', relayerRec]]) {
    const have = r.funding?.[f];
    if (have != null && amountOk(have) && parseEther(String(have)) < rec) warnings.push(`${r.at.funding}.${f} ${have} ${sym} is below the recommended ${formatEther(rec)} ${sym} at ${g} gwei`);
  }
  return {
    route: name, displayName: D, native: sym, inputs: { gasGwei: g, zetaphyGasGwei: String(zetaphyGasGwei), relayerDeliveries: deliveries, l1FeeNative: String(c.l1FeeNative), nativeUsd: String(c.nativeUsd) },
    rows,
    totals: { zetaphyZtphy: formatEther(sum('zetaphy') * zg), zetaphyDeployerZtphy: formatEther(sum('zetaphy', 'deployer') * zg), native: formatEther(total), nativeUsd: usd(total),
      deployerNative: formatEther(deployer), relayerFloatNative: formatEther(relayer), relayerFloatUsd: usd(relayer) },
    recommend: { deployer: `${formatEther(deployerRec)} ${sym} on ${D} (3x the estimate at ${g} gwei)`, deployerAmount: formatEther(deployerRec),
      relayer: `${formatEther(relayerRec)} ${sym} on ${D} for the relayer (refill when status says low)`, relayerAmount: formatEther(relayerRec) },
    funding: r.funding ? { deployer: r.funding.deployer ?? null, relayer: r.funding.relayer ?? null } : null,
    warnings,
  };
}

/**
 * The itemised cost: ZETAPHY gas in ZTPHY, Base gas in ETH at `baseGasGwei`, the relayer's float (as before), and
 * `routes`: the same for every other enabled route, in its own gas token (`gwei`: { <route>: gwei }).
 */
export function costEstimate(cfg, { baseGasGwei = cfg.costs.baseGasGwei, zetaphyGasGwei = cfg.zetaphy.minGasPriceGwei, deliveries = cfg.costs.relayerDeliveries, gwei = {} } = {}) {
  const zg = parseUnits(String(zetaphyGasGwei), 9);
  const shared = [
    ['zetaphy', 'deployer', 'Hyperlane core (Mailbox, merkle tree hook, ISM factories, ValidatorAnnounce, ProxyAdmin, ICA router)', GAS.zetaphy.core],
    ['zetaphy', 'deployer', 'core hand-over (interchain account router -> timelock)', GAS.zetaphy.coreHandover],
    ['zetaphy', 'validator', 'our validator announces itself (once)', GAS.zetaphy.announce],
  ];
  const b = routeCost(cfg, 'base', { gwei: baseGasGwei, zetaphyGasGwei, deliveries });
  const rows = [...shared.map(([chain, who, what, gas]) => ({ chain, who, what, gas: String(gas), cost: `${formatEther(gas * zg)} ZTPHY` })), ...b.rows];
  const zSum = (who = null) => rows.filter((x) => x.chain === 'zetaphy' && (who == null || x.who === who)).reduce((s, x) => s + BigInt(x.gas), 0n);
  const routes = Object.fromEntries(routeNames(cfg).filter((n) => n !== 'base').map((n) => [n, routeCost(cfg, n, { gwei: gwei[n] ?? null, zetaphyGasGwei, deliveries })]));
  return {
    inputs: { baseGasGwei: String(baseGasGwei), zetaphyGasGwei: String(zetaphyGasGwei), relayerDeliveries: deliveries, baseL1FeeEth: cfg.costs.baseL1FeeEth, ethUsd: cfg.costs.ethUsd },
    rows,
    totals: {
      zetaphyZtphy: formatEther(zSum() * zg),
      zetaphyDeployerZtphy: formatEther(zSum('deployer') * zg),
      baseEth: b.totals.native, baseUsd: b.totals.nativeUsd,
      baseDeployerEth: b.totals.deployerNative,
      relayerFloatEth: b.totals.relayerFloatNative, relayerFloatUsd: b.totals.relayerFloatUsd,
      proposalDepositZtphy: `${cfg.zetaphy.proposalDeposit} (per gov proposal; refunded when it passes, burned on a veto)`,
      allRoutesZetaphyZtphy: formatEther(zSum() * zg + Object.values(routes).reduce((s, x) => s + parseEther(x.totals.zetaphyZtphy), 0n)),
    },
    recommend: {
      deployerZtphy: '1 ZTPHY on ZETAPHY (covers core + every vault at 1 gwei many times over)',
      deployerEth: `${b.recommend.deployerAmount} ETH on Base (3x the estimate at ${baseGasGwei} gwei)`,
      relayerEth: `${b.recommend.relayerAmount} ETH on Base for the relayer (refill when status says low)`,
      validatorZtphy: '0.1 ZTPHY to each validator address (announce)',
    },
    routes,
  };
}

/** Every step of the deploy, in order, with who sends it and what it reads/changes. The plan prints this. */
export const STEPS = [
  { id: 'check', label: '[อ่าน]', chain: 'both', who: 'nobody', what: 'read both chains: chain ids, Base Mailbox / merkle tree hook / ISM factory, the deployer balances and nonces' },
  { id: 'core-config', label: '[เปลี่ยนไฟล์]', chain: 'none', who: 'nobody', what: 'write the Hyperlane core config for ZETAPHY mainnet (every owner the timelock)' },
  { id: 'core', label: '[เปลี่ยนเชน]', chain: 'zetaphy', who: 'deployer', what: 'hyperlane core deploy on ZETAPHY (the pinned CLI); writes registry/chains/zetaphy/addresses.yaml' },
  { id: 'core-handover', label: '[เปลี่ยนเชน]', chain: 'zetaphy', who: 'deployer', what: 'every core contract still owned by the deployer -> the timelock; then reads every owner back' },
  { id: 'base-roles', label: '[เปลี่ยนเชน]', chain: 'base', who: 'deployer', what: 'Base: SimpleMultisig (owners from config) + ZetaphyTimelock (48 h) + our ISM for origin ZETAPHY; fixes where the synthetic will be' },
  { id: 'zetaphy-vault', label: '[เปลี่ยนเชน]', chain: 'zetaphy', who: 'deployer', what: 'ZETAPHY: the ISM for origin Base, ZetaphyTokenVault (CLOSED; governance the timelock, guardian the guardian multisig, ThreatRegistry)' },
  { id: 'base-synthetic', label: '[เปลี่ยนเชน]', chain: 'base', who: 'deployer', what: 'Base: SaphanSyntheticToken "ZTPHY" exactly where the vault points (CLOSED; governance the Base timelock, guardian the Base multisig)' },
  { id: 'verify', label: '[อ่าน]', chain: 'both', who: 'nobody', what: 'read back both ends: closed, caps, limits, delays, ISMs, roles; nothing held by the deployer' },
  { id: 'open', label: '[เปลี่ยนเชน]', chain: 'both', who: 'gov vote + Base multisig', what: 'opening (separate owner step, 48 h): open-proposals writes the gov proposal and the Base multisig calls' },
];

/** The steps of one route (Base: its rows of STEPS; any other: the same three deploys, verify and open, with --route). */
export function routeSteps(cfg, name) {
  if (name === 'base') return STEPS.filter((s) => ['base-roles', 'zetaphy-vault', 'base-synthetic', 'verify', 'open'].includes(s.id));
  const r = route(cfg, name), D = r.displayName, S = r.steps;
  return [
    { id: S.roles, route: name, label: '[เปลี่ยนเชน]', chain: name, who: 'deployer', what: `${D}: SimpleMultisig + ZetaphyTimelock (48 h) + our ISM for origin ZETAPHY (deploy --route ${name} --step roles)` },
    { id: S.vault, route: name, label: '[เปลี่ยนเชน]', chain: 'zetaphy', who: 'deployer', what: `ZETAPHY: the ISM for origin ${D}, a SECOND ZetaphyTokenVault for ${D} only (CLOSED; same governance and guardian) (--step vault)` },
    { id: S.synthetic, route: name, label: '[เปลี่ยนเชน]', chain: name, who: 'deployer', what: `${D}: SaphanSyntheticToken "ZTPHY" (its own, not Base's) where that vault points (CLOSED) (--step synthetic)` },
    { id: `verify-${name}`, route: name, label: '[อ่าน]', chain: 'both', who: 'nobody', what: `verify --route ${name}: read back both ends` },
    { id: `open-${name}`, route: name, label: '[เปลี่ยนเชน]', chain: 'both', who: `gov vote + ${D} multisig`, what: `open-proposals --route ${name} (its own gov proposal, 48 h each side)` },
  ];
}

/** STEPS, then the steps of every other enabled route. */
export const allSteps = (cfg) => [...STEPS, ...routeNames(cfg).filter((n) => n !== 'base').flatMap((n) => routeSteps(cfg, n))];

export const zetaphyBech32 = (a) => toBech32(getBytes(getAddress(a)), 'zetaphy');
export { formatUnits, art };
