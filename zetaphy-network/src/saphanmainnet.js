// ZETAPHY Saphan MAINNET: the ZTPHY route ZETAPHY (3659) <-> Base (8453), as pure functions over the config
// zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json (docs/SAPHAN-MAINNET.md). No network, no key here: the owner's
// tool (scripts/saphan-mainnet.js), the pool helper (scripts/saphan-pool.js), the local dry run and the tests use these.
//
// What it gives:
//   mainnetProblems(cfg)     what is wrong with the config (refused everywhere)
//   missingInputs(cfg)       owner inputs still null (the plan lists them; a deploy refuses)
//   riskLines(cfg)           the plain risk statement, printed by every plan
//   routeTable(cfg, core)    the config as the chain table scripts/saphan.js deploys from (same deploy code as the testnets)
//   coreConfigYaml(cfg)      the Hyperlane core config of ZETAPHY mainnet (every owner the ZETAPHY timelock)
//   openPlan / pausePlan     the exact governance and guardian calls (gov proposal JSON, multisig calldata)
//   relayerWhitelist / relayerEnv / agentConfig   the off-chain agents' settings (no secrets)
//   costEstimate(cfg, opts)  the itemised cost
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
/** Uniswap v3 fee tier -> tick spacing (UniswapV3Factory.feeAmountTickSpacing). */
export const TICK_SPACING = { 100: 1, 500: 10, 3000: 60, 10000: 200 };

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

/** The validator set that signs Base -> ZETAPHY (our own, or Hyperlane's published one). */
export function baseOriginSet(cfg) {
  const b = cfg.validators?.baseOrigin ?? {};
  return b.mode === 'hyperlane' ? cfg.validators.hyperlaneBaseDefault : { validators: b.validators ?? [], threshold: b.threshold };
}

function setProblems(p, at, set, allowSingle) {
  if (!Array.isArray(set?.validators)) { p.push(`${at}.validators: a list of 0x addresses`); return; }
  set.validators.forEach((v, i) => { if (!addrOk(v)) p.push(`${at}.validators[${i}]: not a 0x address`); });
  if (new Set(set.validators.map((v) => String(v).toLowerCase())).size !== set.validators.length) p.push(`${at}: a validator twice`);
  if (!(Number.isInteger(set.threshold) && set.threshold >= 1 && set.threshold <= Math.max(1, set.validators.length))) p.push(`${at}.threshold: 1..number of validators`);
  if (set.validators.length && set.threshold === 1 && !allowSingle) {
    p.push(`${at}: threshold 1 (${set.validators.length === 1 ? '1-of-1' : `1-of-${set.validators.length}`}) lets ONE key decide; refused unless validators.allowSingleValidator is true (owner flag)`);
  }
}

/** Every problem with the mainnet config (empty when usable). Missing owner inputs (null) are not problems: see missingInputs. */
export function mainnetProblems(cfg) {
  const p = [];
  const need = (v, at) => { if (!addrOk(v)) p.push(`${at}: not a 0x address`); };
  const opt = (v, at) => { if (v != null) need(v, at); };
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
  const b = cfg?.base ?? {};
  if (b.chainId !== BASE_CHAIN_ID || b.domain !== BASE_CHAIN_ID) p.push(`base: chainId and domain must be ${BASE_CHAIN_ID}`);
  for (const k of ['mailbox', 'merkleTreeHook', 'validatorAnnounce', 'staticMessageIdMultisigIsmFactory', 'interchainGasPaymaster']) need(b[k], `base.${k}`);
  if (!Array.isArray(b.rpc) || !b.rpc.length || b.rpc.some((u) => !/^https:\/\/\S+$/.test(u))) p.push('base.rpc: https URLs');
  if (!Array.isArray(b.owners) || !b.owners.length) p.push('base.owners: the Base multisig owners');
  else { b.owners.forEach((v, i) => need(v, `base.owners[${i}]`)); if (new Set(b.owners.map((x) => String(x).toLowerCase())).size !== b.owners.length) p.push('base.owners: an owner twice'); }
  if (!(Number.isInteger(b.threshold) && b.threshold >= 2 && b.threshold <= (b.owners?.length ?? 0))) p.push('base.threshold: 2..number of owners (never one key)');
  if (!(Number.isInteger(b.timelockDelay) && b.timelockDelay >= 172800)) p.push('base.timelockDelay: at least 172800 (48 h)');
  const v = cfg?.validators ?? {};
  const single = v.allowSingleValidator === true;
  setProblems(p, 'validators.zetaphyOrigin', v.zetaphyOrigin, single);
  if (!['ours', 'hyperlane'].includes(v.baseOrigin?.mode)) p.push('validators.baseOrigin.mode: "ours" or "hyperlane"');
  setProblems(p, 'validators.baseOrigin', v.baseOrigin, single);
  setProblems(p, 'validators.hyperlaneBaseDefault', v.hyperlaneBaseDefault, false);
  if (!(v.hyperlaneBaseDefault?.validators?.length >= 1)) p.push('validators.hyperlaneBaseDefault: the published set');
  const t = cfg?.token ?? {};
  if (!same(t.address, NATIVE_ERC20) || t.decimals !== 18 || t.native !== true) p.push(`token: the native coin's ERC-20 ${NATIVE_ERC20}, 18 decimals, native: true`);
  if (t.key !== 'ztphy' || t.symbol !== 'ZTPHY') p.push('token: key ztphy, symbol ZTPHY');
  if (!/^[\w.-]{1,12}$/.test(String(t.synthetic?.symbol ?? '')) || !String(t.synthetic?.name ?? '').trim()) p.push('token.synthetic: name and symbol');
  const l = t.limits ?? {};
  for (const f of ['lockCap', 'supplyCap', 'mintDailyLimit', 'releaseDailyLimit']) if (!amountOk(l[f])) p.push(`token.limits.${f}: whole ZTPHY above 0`);
  for (const f of ['mintDelay', 'releaseDelay']) if (!(Number.isInteger(l[f]) && l[f] >= 3600 && l[f] <= 30 * 86400)) p.push(`token.limits.${f}: seconds, 3600 (1 h) .. 30 days`);
  if (!p.some((x) => x.startsWith('token.limits'))) {
    const [lock, supply, mint, rel] = ['lockCap', 'supplyCap', 'mintDailyLimit', 'releaseDailyLimit'].map((f) => units(l[f], 18));
    if (supply > lock) p.push('token.limits.supplyCap: at most lockCap (no more ZTPHY on Base than can be locked)');
    if (mint > supply) p.push('token.limits.mintDailyLimit: at most supplyCap');
    if (rel > lock) p.push('token.limits.releaseDailyLimit: at most lockCap');
    if (lock > (TOTAL_SUPPLY / 100n) * 10n ** 18n) p.push('token.limits.lockCap: at most 1% of the supply (10,000,000 ZTPHY) while the bridge is unaudited');
    const pools = (cfg.liquidity?.pools ?? []).reduce((s, x) => s + (amountOk(x.ztphyAmount) ? units(x.ztphyAmount, 18) : 0n), 0n);
    if (pools > mint || pools > lock) p.push(`token.limits: the pools need ${formatEther(pools)} ZTPHY on Base; mintDailyLimit and lockCap must allow it`);
  }
  if (cfg?.deployer?.address != null) need(cfg.deployer.address, 'deployer.address');
  const q = cfg?.liquidity ?? {};
  need(q.zetaphyMultisig, 'liquidity.zetaphyMultisig');
  if (q.zetaphyMultisigBech32 != null && (!addrOk(q.zetaphyMultisig) || toBech32(getBytes(getAddress(q.zetaphyMultisig)), 'zetaphy') !== q.zetaphyMultisigBech32)) p.push('liquidity.zetaphyMultisigBech32 is not the bech32 of liquidity.zetaphyMultisig');
  opt(q.baseRecipient, 'liquidity.baseRecipient');
  if (q.baseRecipient != null && [q.zetaphyMultisig, z.timelock, z.guardian, z.govModule, ...(z.guardianOwners ?? [])].some((x) => same(x, q.baseRecipient))) {
    p.push('liquidity.baseRecipient: a Safe ON BASE, never a ZETAPHY multisig or module address (nobody holds those keys on Base)');
  }
  if (q.dex !== 'uniswap-v3') p.push('liquidity.dex: "uniswap-v3" (the only one this helper builds)');
  need(q.uniswapV3?.factory, 'liquidity.uniswapV3.factory');
  need(q.uniswapV3?.positionManager, 'liquidity.uniswapV3.positionManager');
  if (!TICK_SPACING[q.feeTier]) p.push('liquidity.feeTier: 100, 500, 3000 or 10000');
  if (!(Number.isInteger(q.slippageBps) && q.slippageBps >= 0 && q.slippageBps <= 1000)) p.push('liquidity.slippageBps: 0..1000');
  if (!Array.isArray(q.pools) || !q.pools.length) p.push('liquidity.pools: a list of {stable, address, decimals, stableAmount, ztphyAmount}');
  else {
    const seen = new Set();
    q.pools.forEach((x, i) => {
      const at = `liquidity.pools[${i}]`;
      if (!/^[A-Za-z0-9.]{1,12}$/.test(String(x.stable ?? ''))) p.push(`${at}.stable: a symbol`);
      if (seen.has(String(x.stable).toUpperCase())) p.push(`${at}: ${x.stable} twice`); seen.add(String(x.stable).toUpperCase());
      opt(x.address, `${at}.address`);
      if (same(x.address, NOT_USDC)) p.push(`${at}.address ${x.address} is NOT USDC on Base (USDC is ${BASE_USDC})`);
      if (String(x.stable).toUpperCase() === 'USDC' && x.address != null && !same(x.address, BASE_USDC)) p.push(`${at}: USDC on Base is ${BASE_USDC}`);
      if (!(Number.isInteger(x.decimals) && x.decimals >= 0 && x.decimals <= 18)) p.push(`${at}.decimals: 0..18`);
      if (!amountOk(x.stableAmount, Number.isInteger(x.decimals) ? x.decimals : 18)) p.push(`${at}.stableAmount: whole tokens above 0 (an owner input)`);
      if (!amountOk(x.ztphyAmount)) p.push(`${at}.ztphyAmount: whole ZTPHY above 0 (an owner input; it sets the initial price)`);
    });
  }
  const c = cfg?.costs ?? {};
  for (const f of ['baseGasGwei', 'baseL1FeeEth', 'ethUsd']) if (!/^\d+(\.\d+)?$/.test(String(c[f] ?? ''))) p.push(`costs.${f}: a number`);
  if (!(Number.isInteger(c.relayerDeliveries) && c.relayerDeliveries >= 1)) p.push('costs.relayerDeliveries: a whole number');
  return p;
}

/** Owner inputs still missing: [{ field, why }]. Each blocks the steps named in `blocks`. */
export function missingInputs(cfg) {
  const m = [];
  if (!cfg.deployer?.address) m.push({ field: 'deployer.address', why: 'a fresh deployer key (same address on ZETAPHY and Base), funded with the amounts of `costs`', blocks: 'every deploy step' });
  if (!cfg.validators?.zetaphyOrigin?.validators?.length) m.push({ field: 'validators.zetaphyOrigin.validators', why: 'our validator address(es) (setup-agents-mainnet.sh addresses)', blocks: 'core, base-roles (our ISM on Base)' });
  if (cfg.validators?.baseOrigin?.mode === 'ours' && !cfg.validators.baseOrigin.validators?.length) m.push({ field: 'validators.baseOrigin.validators', why: 'our Base-origin validator address(es) (VALIDATE_BASE=yes), or set baseOrigin.mode to "hyperlane"', blocks: 'core (default ISM), zetaphy-vault (its ISM)' });
  if (!cfg.liquidity?.baseRecipient) m.push({ field: 'liquidity.baseRecipient', why: 'the Safe on Base that receives the bridged ZTPHY and owns the pools', blocks: 'saphan-pool.js (bridge, pools)' });
  for (const [i, x] of (cfg.liquidity?.pools ?? []).entries()) if (!x.address) m.push({ field: `liquidity.pools[${i}].address`, why: `the ${x.stable} token on Base, checked on basescan.org (not verifiable from this repository)`, blocks: `the ${x.stable} pool` });
  return m;
}

/** The plain risk statement. Every plan prints it. */
export function riskLines(cfg) {
  const z = cfg.validators?.zetaphyOrigin ?? {}, b = baseOriginSet(cfg);
  const n = (x) => (x.validators?.length ? `${x.threshold} of ${x.validators.length}` : 'validators not set yet');
  const L = [
    'RISK: ZETAPHY mainnet runs on ONE validator: if it stops, the bridge stops; if it is taken over, it can rewrite ZETAPHY.',
    `RISK: ZETAPHY -> Base mints are signed by OUR validators only (${n(z)}), Base -> ZETAPHY releases by ${cfg.validators?.baseOrigin?.mode === 'hyperlane' ? "Hyperlane's published validators" : 'OUR validators'} (${n(b)}): a small set, not Hyperlane's network.`,
    'RISK: the bridge contracts (ZetaphyTokenVault, SaphanSyntheticToken) are NOT audited. Users bridge only what they can afford to lose.',
    `Bounded by: lockCap ${cfg.token.limits.lockCap} ZTPHY, supplyCap ${cfg.token.limits.supplyCap}, mint ${cfg.token.limits.mintDailyLimit}/day after ${cfg.token.limits.mintDelay} s, release ${cfg.token.limits.releaseDailyLimit}/day after ${cfg.token.limits.releaseDelay} s; guardians pause and veto at once.`,
  ];
  for (const [at, s] of [['ZETAPHY -> Base', z], ['Base -> ZETAPHY', b]]) {
    if (s.validators?.length && s.threshold === 1) L.push(`RISK (owner flag allowSingleValidator): ${at} is ${s.threshold}-of-${s.validators.length}: ONE key on one machine can sign a false message (unbacked ZTPHY on Base, or a release from the vault), stopped only by the delay, the guardians and the caps.`);
  }
  return L;
}

/**
 * The config as the chain table of src/saphan.js, so the testnet deploy code (scripts/saphan.js originPrepare,
 * zetaphyIsm, tokenVault, tokenSynthetic) deploys mainnet unchanged. `core`: ZETAPHY's Hyperlane addresses.
 */
export function routeTable(cfg, core) {
  if (!core?.mailbox || !core?.merkleTreeHook || !core?.staticMessageIdMultisigIsmFactory) throw new Error('no Hyperlane core on ZETAPHY yet (registry/chains/zetaphy/addresses.yaml): run the core step first');
  const b = cfg.base, bo = baseOriginSet(cfg), k = cfg.token;
  return {
    zetaphy: { name: 'zetaphy', displayName: cfg.zetaphy.displayName, chainId: cfg.zetaphy.chainId, domain: cfg.zetaphy.domain, rpc: cfg.zetaphy.rpc,
      mailbox: core.mailbox, merkleTreeHook: core.merkleTreeHook, validatorAnnounce: core.validatorAnnounce, staticMessageIdMultisigIsmFactory: core.staticMessageIdMultisigIsmFactory,
      timelock: cfg.zetaphy.timelock, guardian: cfg.zetaphy.guardian, threats: cfg.zetaphy.threats },
    zetaphyValidators: { validators: cfg.validators.zetaphyOrigin.validators, threshold: cfg.validators.zetaphyOrigin.threshold },
    origin: { owners: b.owners, threshold: b.threshold, timelockDelay: b.timelockDelay },
    chains: { base: { displayName: b.displayName, chainId: b.chainId, domain: b.domain, rpc: b.rpc, explorer: b.explorer, estimateBlockTime: b.estimateBlockTime,
      mailbox: b.mailbox, merkleTreeHook: b.merkleTreeHook, validatorAnnounce: b.validatorAnnounce, staticMessageIdMultisigIsmFactory: b.staticMessageIdMultisigIsmFactory,
      validators: bo.validators, threshold: bo.threshold } },
    tokens: { [k.key]: { displayName: k.displayName, symbol: k.symbol, address: k.address, decimals: k.decimals, native: k.native, synthetic: k.synthetic,
      destinations: ['base'], limits: { lockCap: k.limits.lockCap, releaseDailyLimit: k.limits.releaseDailyLimit, releaseDelay: k.limits.releaseDelay,
        mintDailyLimit: k.limits.mintDailyLimit, mintDelay: k.limits.mintDelay, supplyCap: k.limits.supplyCap } } },
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

const routeOf = (state) => {
  const v = state?.steps?.['zetaphy-vault'], s = state?.steps?.['base-synthetic'], r = state?.steps?.['base-roles'];
  if (!v?.vault || !s?.synthetic || !r?.multisig || !r?.timelock) throw new Error('the route is not deployed yet (state: zetaphy-vault, base-roles, base-synthetic)');
  return { vault: v.vault, synthetic: s.synthetic, multisig: r.multisig, timelock: r.timelock };
};

/**
 * Opening the route (both ends are deployed paused): ZETAPHY timelock -> vault.unpause(), Base timelock -> synthetic.unpause().
 * ZETAPHY: the gov module schedules (a gov proposal), anyone executes after 48 h. Base: the Base multisig proposes the
 * schedule to its timelock, then (after 48 h) the execute. `what = 'unpause'` opens; other ENDPOINT calls work the same way.
 */
export function openPlan(cfg, state, { what = 'unpause', args = [] } = {}) {
  const r = routeOf(state);
  const data = ENDPOINT.encodeFunctionData(what, args);
  const z = timelockCall({ chainId: cfg.zetaphy.chainId, timelock: cfg.zetaphy.timelock, target: r.vault, data, delay: cfg.zetaphy.timelockDelay, purpose: what });
  const b = timelockCall({ chainId: cfg.base.chainId, timelock: r.timelock, target: r.synthetic, data, delay: cfg.base.timelockDelay, purpose: what });
  return {
    zetaphy: { ...z, proposal: govProposal(cfg, { to: cfg.zetaphy.timelock, data: z.schedule, title: `Saphan mainnet: ZetaphyTokenVault.${what}() (ZTPHY -> Base)`,
      summary: `Schedules ${what}() on the ZTPHY vault ${r.vault} through the ZetaphyTimelock ${cfg.zetaphy.timelock} (operation ${z.operationId}, delay ${z.delay} s). After the delay anyone executes it. The bridge contracts are NOT audited (docs/SAPHAN-MAINNET.md).` }) },
    base: { ...b, multisig: r.multisig, proposeSchedule: MULTISIG.encodeFunctionData('propose', [r.timelock, 0n, b.schedule]), proposeExecute: MULTISIG.encodeFunctionData('propose', [r.timelock, 0n, b.execute]) },
  };
}

/** What the guardians send at once (no timelock): pause both ends; veto a queued payout; lower a limit. Calldata for the SimpleMultisigs. */
export function pausePlan(cfg, state, { veto = null } = {}) {
  const r = routeOf(state);
  const call = (to, fn, a = []) => { const data = ENDPOINT.encodeFunctionData(fn, a); return { to, data, propose: MULTISIG.encodeFunctionData('propose', [to, 0n, data]) }; };
  const out = {
    zetaphy: { multisig: getAddress(cfg.zetaphy.guardian), owners: cfg.zetaphy.guardianOwners, threshold: cfg.zetaphy.guardianThreshold, pause: call(r.vault, 'pause') },
    base: { multisig: r.multisig, owners: cfg.base.owners, threshold: cfg.base.threshold, pause: call(r.synthetic, 'pause') },
  };
  if (veto) { out.zetaphy.veto = call(r.vault, 'veto', [veto]); out.base.veto = call(r.synthetic, 'veto', [veto]); }
  return out;
}

/** The relayer delivers only these: the vault -> Base, the synthetic -> ZETAPHY. */
export function relayerWhitelist(cfg, state) {
  const r = routeOf(state);
  return [{ originDomain: cfg.zetaphy.domain, senderAddress: bytes32(r.vault), destinationDomain: cfg.base.domain },
    { originDomain: cfg.base.domain, senderAddress: bytes32(r.synthetic), destinationDomain: cfg.zetaphy.domain }];
}

/** The relayer's environment (no secrets): chains, whitelist, start blocks (the deploy's). */
export function relayerEnv(cfg, state) {
  const zFrom = state.steps['zetaphy-vault']?.block, bFrom = state.steps['base-roles']?.fromBlock ?? state.steps['base-synthetic']?.block;
  if (!Number.isInteger(zFrom) || !Number.isInteger(bFrom)) throw new Error('state: no start blocks (zetaphy-vault.block, base-roles.fromBlock)');
  return ['HYP_RELAYCHAINS=zetaphy,base', `HYP_WHITELIST=${JSON.stringify(relayerWhitelist(cfg, state))}`, 'HYP_CHAINS_ZETAPHY_INDEX_CHUNK=499',
    `HYP_CHAINS_BASE_INDEX_FROM=${bFrom}`, 'HYP_GASPAYMENTENFORCEMENT=[{"type":"none"}]'];
}

/**
 * The agent config (relayer and validators read it as CONFIG_FILES): ZETAPHY with its core, Base with Hyperlane's core.
 * The same fields `hyperlane registry agent-config` writes for EVM chains. `zFrom`: where our validator reads ZETAPHY's tree.
 */
export function agentConfig(cfg, core, { zFrom = 0, baseFrom = null, rpc = {} } = {}) {
  if (!core?.mailbox) throw new Error('no ZETAPHY core addresses');
  const z = cfg.zetaphy, b = cfg.base;
  const chain = (name, c, a, x) => ({ name, displayName: c.displayName, chainId: c.chainId, domainId: c.domain, protocol: 'ethereum', isTestnet: false,
    rpcUrls: (rpc[name] ?? c.rpc).map((http) => ({ http })), nativeToken: x.nativeToken, blocks: x.blocks,
    mailbox: a.mailbox, merkleTreeHook: a.merkleTreeHook, validatorAnnounce: a.validatorAnnounce, interchainGasPaymaster: a.interchainGasPaymaster ?? ZERO,
    ...(a.proxyAdmin ? { proxyAdmin: a.proxyAdmin } : {}), index: x.index });
  return {
    chains: {
      zetaphy: chain('zetaphy', z, core, { nativeToken: { name: 'ZETAPHY', symbol: 'ZTPHY', decimals: 18 }, blocks: { confirmations: 1, reorgPeriod: 1, estimateBlockTime: z.estimateBlockTime },
        index: { from: zFrom, chunk: 499 } }),
      base: chain('base', b, b, { nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blocks: { confirmations: 3, reorgPeriod: b.reorgPeriod, estimateBlockTime: b.estimateBlockTime },
        index: { from: baseFrom ?? 0, chunk: 1999 } }),
    },
    defaultRpcConsensusType: 'fallback',
  };
}

/** Gas of each step (estimates; the local dry run prints what it measured next to them). */
export const GAS = {
  zetaphy: { core: 35_000_000n, coreHandover: 120_000n, ism: 450_000n, vault: 2_700_000n, announce: 130_000n, delivery: 400_000n, claim: 150_000n, lock: 320_000n },
  base: { multisig: 1_400_000n, timelock: 2_700_000n, ism: 450_000n, synthetic: 2_700_000n, announce: 130_000n, delivery: 400_000n, claim: 150_000n, openPerEnd: 1_000_000n,
    safe: 400_000n, approve: 60_000n, createPool: 5_200_000n, mint: 600_000n },
};

/** The itemised cost: ZETAPHY gas in ZTPHY, Base gas in ETH at `baseGasGwei`, the relayer's float. */
export function costEstimate(cfg, { baseGasGwei = cfg.costs.baseGasGwei, zetaphyGasGwei = cfg.zetaphy.minGasPriceGwei, deliveries = cfg.costs.relayerDeliveries } = {}) {
  const zg = parseUnits(String(zetaphyGasGwei), 9), bg = parseUnits(String(baseGasGwei), 9), l1 = parseEther(String(cfg.costs.baseL1FeeEth));
  const pools = cfg.liquidity.pools.length, ownBase = cfg.validators.baseOrigin.mode === 'ours';
  const D = BigInt(deliveries);
  const items = [
    ['zetaphy', 'deployer', 'Hyperlane core (Mailbox, merkle tree hook, ISM factories, ValidatorAnnounce, ProxyAdmin, ICA router)', GAS.zetaphy.core],
    ['zetaphy', 'deployer', 'core hand-over (interchain account router -> timelock)', GAS.zetaphy.coreHandover],
    ['zetaphy', 'deployer', 'ISM for origin Base (factory) + ZetaphyTokenVault', GAS.zetaphy.ism + GAS.zetaphy.vault],
    ['zetaphy', 'validator', 'our validator announces itself (once)', GAS.zetaphy.announce],
    ['zetaphy', 'relayer', `${deliveries} deliveries Base -> ZETAPHY`, GAS.zetaphy.delivery * D],
    ['zetaphy', 'liquidity multisig', `approve + lock (${pools} pool(s), one lock)`, GAS.zetaphy.lock + 60_000n],
    ['base', 'deployer', 'SimpleMultisig + ZetaphyTimelock (Base governance)', GAS.base.multisig + GAS.base.timelock],
    ['base', 'deployer', 'our ISM (factory) + SaphanSyntheticToken', GAS.base.ism + GAS.base.synthetic],
    ...(ownBase ? [['base', 'validator', 'our Base-origin validator announces itself (once)', GAS.base.announce]] : []),
    ['base', 'Base multisig owners', 'open: propose/confirm/execute of schedule, then of execute', GAS.base.openPerEnd],
    ['base', 'relayer', `${deliveries} deliveries ZETAPHY -> Base (the float)`, GAS.base.delivery * D],
    ['base', 'anyone', 'claim the first mint (after the delay)', GAS.base.claim],
    ['base', 'liquidity Safe', `Safe on Base + ${pools} pool(s): approvals, create + initialise, mint full range`, GAS.base.safe + BigInt(pools) * (2n * GAS.base.approve + GAS.base.createPool + GAS.base.mint)],
  ];
  const rows = items.map(([chain, who, what, gas]) => ({ chain, who, what, gas: String(gas), cost: chain === 'zetaphy' ? `${formatEther(gas * zg)} ZTPHY` : `${formatEther(gas * bg)} ETH` }));
  const sum = (ch, who = null) => items.filter((x) => x[0] === ch && (who == null || x[1] === who)).reduce((s, x) => s + x[3], 0n);
  const baseEth = sum('base') * bg + l1 * 4n; // L1 data fee allowance: deploys + pool txs
  const relayerEth = GAS.base.delivery * D * bg;
  const usd = (wei) => (Number(formatEther(wei)) * Number(cfg.costs.ethUsd)).toFixed(2);
  return {
    inputs: { baseGasGwei: String(baseGasGwei), zetaphyGasGwei: String(zetaphyGasGwei), relayerDeliveries: deliveries, baseL1FeeEth: cfg.costs.baseL1FeeEth, ethUsd: cfg.costs.ethUsd },
    rows,
    totals: {
      zetaphyZtphy: formatEther(sum('zetaphy') * zg),
      zetaphyDeployerZtphy: formatEther(sum('zetaphy', 'deployer') * zg),
      baseEth: formatEther(baseEth), baseUsd: usd(baseEth),
      baseDeployerEth: formatEther(sum('base', 'deployer') * bg + l1 * 2n),
      relayerFloatEth: formatEther(relayerEth), relayerFloatUsd: usd(relayerEth),
      proposalDepositZtphy: `${cfg.zetaphy.proposalDeposit} (per gov proposal; refunded when it passes, burned on a veto)`,
    },
    recommend: {
      deployerZtphy: '1 ZTPHY on ZETAPHY (covers core + vault at 1 gwei many times over)',
      deployerEth: `${formatEther(((sum('base', 'deployer') * bg + l1 * 2n) * 3n))} ETH on Base (3x the estimate at ${baseGasGwei} gwei)`,
      relayerEth: `${formatEther(relayerEth > parseEther('0.002') ? relayerEth : parseEther('0.002'))} ETH on Base for the relayer (refill when status says low)`,
      validatorZtphy: '0.1 ZTPHY to each validator address (announce)',
    },
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

export const zetaphyBech32 = (a) => toBech32(getBytes(getAddress(a)), 'zetaphy');
export { formatUnits, art };
