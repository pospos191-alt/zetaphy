#!/usr/bin/env node
// ZETAPHY Saphan MAINNET: the owner's tool for the ZTPHY routes ZETAPHY (3659) <-> Base (8453) and <-> every enabled
// chain under `destinations` (--route bsc, --route arbitrum, …; without --route: Base, as before). Resumable: each
// deploy step writes its result to zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json and is skipped when done.
// Nothing is ever sent without `--send yes`; without it every chain step prints what it would send (a dry run).
// Config: zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json. Runbook (EN/TH): docs/SAPHAN-MAINNET.md.
//
//   node scripts/saphan-mainnet.js plan                       [อ่าน] offline: problems, missing owner inputs per chain, risks, steps, costs
//   node scripts/saphan-mainnet.js check [--route r]          [อ่าน] ZETAPHY + the route's chain: ids, core, timelock, guardian, stable, DEX, Safe, deployer
//   node scripts/saphan-mainnet.js costs [--base-gwei 0.02] [--bsc-gwei 0.1] [--arbitrum-gwei 0.02] [--deliveries 200]   [อ่าน] the itemised cost
//   node scripts/saphan-mainnet.js core-config                [เปลี่ยนไฟล์] writes mainnet/core-config.yaml (owners: the timelock)
//   node scripts/saphan-mainnet.js core [--send yes]          [เปลี่ยนเชน] hyperlane core deploy on ZETAPHY (prints the command without --send)
//   node scripts/saphan-mainnet.js core-handover [--send yes] [เปลี่ยนเชน] core contracts still owned by the deployer -> the timelock
//   node scripts/saphan-mainnet.js deploy --step base-roles|zetaphy-vault|base-synthetic|all [--send yes]   [เปลี่ยนเชน] Base
//   node scripts/saphan-mainnet.js deploy --route bsc --step roles|vault|synthetic|all [--send yes]          [เปลี่ยนเชน] another route
//   node scripts/saphan-mainnet.js verify [--route r]         [อ่าน] read back both ends (closed, caps, limits, ISMs, roles)
//   node scripts/saphan-mainnet.js open-proposals [--route r] [--out dir]  [เปลี่ยนไฟล์] the gov proposal (ZETAPHY) + the route multisig calls that open
//   node scripts/saphan-mainnet.js pause [--route r|all] [--veto 0x<id>]   [อ่าน] the guardians' calldata: pause both ends (or veto a payout)
//   node scripts/saphan-mainnet.js status [--route r|all]     [อ่าน] paused?, locked, supply, messages each way, today's room
//   node scripts/saphan-mainnet.js agent-config --out f [--zetaphy-from N --<route>-from N --rpc-zetaphy URL --rpc-<route> URL]
//                                                             [เปลี่ยนไฟล์] the agents' config, every deployed route (no secrets; private RPCs are better)
//   node scripts/saphan-mainnet.js relayer-env                [อ่าน] HYP_* settings for the relayer, every deployed route (no secrets)
//
// env: KEYFILE (the deployer's key file, read only by --send steps, never printed), ZETAPHY_RPC / BASE_RPC / BSC_RPC /
// ARBITRUM_RPC / <ROUTE>_RPC (override the config's), SAPHAN_MAINNET / SAPHAN_MAINNET_STATE / ZETAPHY_CORE (other config /
// state / core addresses: the dry run's).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Contract, Wallet, NonceManager, getAddress, formatEther, formatUnits, parseUnits, id as keccakId } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import { bytes32 } from '../src/saphan.js';
import { providerFor, settled, originPrepare, tokenVault, tokenSynthetic, factoryIsm } from './saphan.js';

const say = (...a) => console.log(...a);
const ZERO = '0x' + '00'.repeat(20);
const OWN = ['function owner() view returns (address)', 'function transferOwnership(address)'];
const MAILBOX = ['function localDomain() view returns (uint32)', 'function defaultIsm() view returns (address)', 'function requiredHook() view returns (address)', 'function defaultHook() view returns (address)'];
const ISM = ['function validatorsAndThreshold(bytes) view returns (address[], uint8)', 'function moduleType() view returns (uint8)'];
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** Everything a step needs. Providers and signers are made lazily; `send` false = nothing is signed. */
export function context({ cfg = M.loadMainnet(), state = M.loadState(), core = M.loadCore(), stateFile = process.env.SAPHAN_MAINNET_STATE || M.STATE_FILE, send = false,
  zp = null, bp = null, zs = null, bs = null, providers = {}, signers = {} } = {}) {
  const ctx = { cfg, state, core, stateFile, send, log: say };
  const P = { ...providers, ...(bp ? { base: bp } : {}) }, SG = { ...signers, ...(bs ? { base: bs } : {}) }, cache = {}, scache = {};
  ctx.zetaphy = async () => (ctx._zp ??= zp ?? await providerFor(process.env.ZETAPHY_RPC || cfg.zetaphy.rpc.join(','), cfg.zetaphy.chainId));
  /** The provider of a route's chain (<ROUTE>_RPC overrides the config's list). */
  ctx.dest = async (name = 'base') => (cache[name] ??= P[name] ?? await (async () => { const r = M.route(cfg, name); return providerFor(process.env[`${name.toUpperCase()}_RPC`] || r.rpc.join(','), r.chainId); })());
  ctx.base = () => ctx.dest('base');
  const key = () => {
    if (!process.env.KEYFILE) throw new Error('KEYFILE=<the deployer key file> is needed for --send');
    const w = new Wallet(readFileSync(String(process.env.KEYFILE), 'utf8').trim());
    if (cfg.deployer.address && !same(w.address, cfg.deployer.address)) throw new Error(`KEYFILE is ${w.address}, not deployer.address ${cfg.deployer.address}: nothing sent`);
    return w;
  };
  ctx.zSigner = async () => (ctx._zs ??= zs ?? new NonceManager(key().connect(await ctx.zetaphy())));
  ctx.dSigner = async (name = 'base') => (scache[name] ??= SG[name] ?? new NonceManager(key().connect(await ctx.dest(name))));
  ctx.bSigner = () => ctx.dSigner('base');
  ctx.save = (id, rec) => { ctx.state.steps ??= {}; ctx.state.steps[id] = { ...rec, at: new Date().toISOString() }; writeFileSync(ctx.stateFile, JSON.stringify(ctx.state, null, 2) + '\n'); };
  return ctx;
}

const deployerOf = async (ctx) => (ctx.send ? (await ctx.zSigner()).getAddress() : ctx.cfg.deployer.address);
function needInputs(ctx, stepId) {
  // exact step ids: 'zetaphy-vault' must not match 'zetaphy-vault-bsc'
  const miss = M.missingInputs(ctx.cfg).filter((m) => m.blocks === 'every deploy step' || m.blocks.split(/[\s,()]+/).includes(stepId));
  if (miss.length) throw new Error(`step ${stepId}: owner inputs missing: ${miss.map((m) => `${m.field} (${m.why})`).join('; ')}`);
}

/** [อ่าน] ZETAPHY and one route's chain, read only. `route`: base (default) or any enabled destination. */
export async function check(ctx, { route: name = 'base' } = {}) {
  const { cfg } = ctx, r = M.enabledRoute(cfg, name), D = r.displayName, out = { route: name, zetaphy: {}, [name]: {}, problems: [] };
  const P = (m) => out.problems.push(m), o = out[name];
  const bp = await ctx.dest(name), b = r.core;
  const code = async (p, a) => (await p.getCode(a)) !== '0x';
  o.chainId = Number((await bp.getNetwork()).chainId);
  if (o.chainId !== r.chainId) P(`${D} RPC: chain id ${o.chainId}, config ${r.chainId}`);
  o.mailboxDomain = Number(await new Contract(b.mailbox, MAILBOX, bp).localDomain().catch(() => -1));
  if (o.mailboxDomain !== r.domain) P(`${D} Mailbox ${b.mailbox}: localDomain ${o.mailboxDomain}`);
  for (const k of ['merkleTreeHook', 'validatorAnnounce', 'staticMessageIdMultisigIsmFactory']) if (!(await code(bp, b[k]))) P(`${D} ${k} ${b[k]}: no code`);
  const hookMb = await new Contract(b.merkleTreeHook, ['function mailbox() view returns (address)'], bp).mailbox().catch(() => null);
  if (!same(hookMb, b.mailbox)) P(`${D} merkle tree hook's mailbox is ${hookMb}`);
  const ours = cfg.validators.zetaphyOrigin;
  if (ours.validators.length) o.ourIsm = await factoryIsm(bp, b.staticMessageIdMultisigIsmFactory, ours.validators, ours.threshold);
  const { ERC20, NPM, FACTORY } = await import('../src/saphanpool.js');
  const q = r.liquidity;
  for (const x of q.pools) {
    if (!x.address) { o[x.stable] = 'address not set (owner input)'; continue; }
    const tk = new Contract(x.address, ERC20, bp);
    const [sym, dec] = await Promise.all([tk.symbol().catch(() => null), tk.decimals().then(Number, () => null)]);
    o[x.stable] = { address: x.address, symbol: sym, decimals: dec };
    if (dec !== x.decimals) P(`${x.stable} ${x.address}: decimals ${dec}, config ${x.decimals}`);
  }
  const label = M.DEXES[q.dex]?.label ?? q.dex;
  const npmFactory = await new Contract(q.positionManager, NPM, bp).factory().catch(() => null);
  if (!same(npmFactory, q.factory)) P(`${label} position manager's factory() is ${npmFactory}, config ${q.factory}`);
  const spacing = await new Contract(q.factory, FACTORY, bp).feeAmountTickSpacing(q.feeTier).then(Number, () => null);
  o.feeTier = { fee: q.feeTier, tickSpacing: spacing };
  if (spacing !== M.DEXES[q.dex]?.tickSpacing[q.feeTier]) P(`${label} factory: fee ${q.feeTier} has tick spacing ${spacing}, not ${M.DEXES[q.dex]?.tickSpacing[q.feeTier]}`);
  if (q.dex === 'pancakeswap-v3') {
    // PancakeV3Factory's owner can switch a tier off or put it behind a whitelist (setFeeAmountExtraInfo)
    const info = await new Contract(q.factory, ['function feeAmountTickSpacingExtraInfo(uint24) view returns (bool whitelistRequested, bool enabled)'], bp).feeAmountTickSpacingExtraInfo(q.feeTier).catch(() => null);
    o.feeTier.extraInfo = info ? { whitelistRequested: info[0], enabled: info[1] } : 'unreadable';
    if (!info || !info[1] || info[0]) P(`${label} factory: fee ${q.feeTier} is ${!info ? 'unreadable' : !info[1] ? 'disabled' : 'whitelist-only'} for new pools`);
  }
  if (q.recipient) {
    o.recipientIsContract = await code(bp, q.recipient);
    // the same Safe address on every chain is possible, never automatic: read it on THIS chain
    if (!o.recipientIsContract) P(`${r.at.recipient} ${q.recipient} has no code on ${D}: create the Safe first`);
    else o.recipientSafe = await new Contract(q.recipient, ['function getThreshold() view returns (uint256)', 'function getOwners() view returns (address[])'], bp)
      .getOwners().then(async (owners) => ({ owners, threshold: Number(await new Contract(q.recipient, ['function getThreshold() view returns (uint256)'], bp).getThreshold()) }), () => 'not a Safe (no getOwners())');
  }
  const zp = await ctx.zetaphy(), z = cfg.zetaphy;
  const tl = new Contract(z.timelock, M.art('ZetaphyTimelock').abi, zp);
  out.zetaphy.timelockDelay = Number(await tl.getMinDelay().catch(() => -1));
  if (out.zetaphy.timelockDelay < 172800) P(`ZETAPHY timelock ${z.timelock}: delay ${out.zetaphy.timelockDelay}`);
  out.zetaphy.govProposes = await tl.hasRole(keccakId('PROPOSER_ROLE'), z.govModule).catch(() => false);
  if (!out.zetaphy.govProposes) P('the gov module is not a proposer of the ZETAPHY timelock');
  const g = new Contract(z.guardian, M.MULTISIG, zp);
  out.zetaphy.guardianThreshold = Number(await g.threshold().catch(() => -1));
  if (out.zetaphy.guardianThreshold !== z.guardianThreshold) P(`guardian multisig threshold ${out.zetaphy.guardianThreshold}`);
  for (const ow of z.guardianOwners) if (!(await g.isOwner(ow).catch(() => false))) P(`guardian multisig: ${ow} is not an owner`);
  if (!(await code(zp, z.threats))) P(`ThreatRegistry ${z.threats}: no code`);
  out.zetaphy.nativeDecimals = Number(await new Contract(ctx.tokenStandIn ?? cfg.token.address, ERC20, zp).decimals().catch(() => -1));
  if (out.zetaphy.nativeDecimals !== 18) P(`native ERC-20 ${cfg.token.address}: decimals ${out.zetaphy.nativeDecimals}`);
  out.zetaphy.liquidityMultisig = { address: cfg.liquidity.zetaphyMultisig, balance: formatEther(await zp.getBalance(cfg.liquidity.zetaphyMultisig)) };
  out.zetaphy.core = ctx.core ? { mailbox: ctx.core.mailbox, deployed: await code(zp, ctx.core.mailbox) } : 'not deployed yet (step core)';
  const d = cfg.deployer.address;
  if (d) {
    for (const [n, p] of [['zetaphy', zp], [name, bp]]) {
      const [bal, nn, pend] = await Promise.all([p.getBalance(d), p.getTransactionCount(d, 'latest'), p.getTransactionCount(d, 'pending')]);
      out[n].deployer = { address: d, balance: formatEther(bal), nonce: nn, pending: pend - nn };
      if (pend !== nn) P(`deployer has pending ${n} transactions: the synthetic's address is not fixed`);
    }
  }
  return out;
}

/** [เปลี่ยนไฟล์] */
export function writeCoreConfig(ctx, file = fileURLToPath(new URL('core-config.yaml', M.MAINNET_DIR))) {
  writeFileSync(file, M.coreConfigYaml(ctx.cfg));
  return { wrote: file };
}

/** [เปลี่ยนเชน] hyperlane core deploy (the pinned CLI). Without send: the command. */
export function coreDeploy(ctx, { cli = 'hyperlane', registry = fileURLToPath(new URL('registry', M.MAINNET_DIR)), config = fileURLToPath(new URL('core-config.yaml', M.MAINNET_DIR)) } = {}) {
  if (ctx.core?.mailbox) return { skipped: `core already deployed (Mailbox ${ctx.core.mailbox}); never redeployed` };
  const args = ['core', 'deploy', '--chain', 'zetaphy', '--config', config, '-r', 'https://github.com/hyperlane-xyz/hyperlane-registry', '-r', registry, '--yes'];
  const shown = `HYP_KEY=$(cat "$KEYFILE") ${cli} ${args.join(' ')}   # @hyperlane-xyz/cli@45.0.1`;
  if (!ctx.send) return { wouldRun: shown };
  needInputs(ctx, 'core');
  if (!existsSync(config)) throw new Error(`${config} missing: run core-config first`);
  const key = readFileSync(String(process.env.KEYFILE), 'utf8').trim();
  const r = spawnSync(cli, args, { stdio: 'inherit', env: { ...process.env, HYP_KEY: key } });
  if (r.status !== 0) throw new Error(`hyperlane core deploy failed (${r.status}); nothing recorded, safe to re-run`);
  const file = join(registry, 'chains/zetaphy/addresses.yaml');
  if (!/interchainGasPaymaster/.test(readFileSync(file, 'utf8'))) appendFileSync(file, `interchainGasPaymaster: "${ZERO}"\n`); // no IGP on ZETAPHY: the agents need the field
  ctx.core = M.parseAddressesYaml(readFileSync(file, 'utf8'));
  return { deployed: ctx.core };
}

/** [เปลี่ยนเชน] / [อ่าน] Every core contract owned by the timelock; the deployer's ones are handed over (with send). */
export async function coreHandover(ctx) {
  if (!ctx.core?.mailbox) throw new Error('no core yet (step core)');
  const zp = await ctx.zetaphy(), tl = getAddress(ctx.cfg.zetaphy.timelock);
  const mb = new Contract(ctx.core.mailbox, MAILBOX, zp);
  const items = { mailbox: ctx.core.mailbox, proxyAdmin: ctx.core.proxyAdmin, defaultIsm: await mb.defaultIsm(), requiredHook: await mb.requiredHook(), interchainAccountRouter: ctx.core.interchainAccountRouter };
  const me = ctx.send ? await (await ctx.zSigner()).getAddress() : ctx.cfg.deployer.address;
  const rows = [];
  for (const [name, addr] of Object.entries(items)) {
    if (!addr || addr === ZERO) continue;
    let o = await new Contract(addr, OWN, zp).owner().then(getAddress, () => null);
    let action = null;
    if (o && me && same(o, me)) {
      action = 'deployer-owned: hand to the timelock';
      if (ctx.send) { await (await new Contract(addr, OWN, await ctx.zSigner()).transferOwnership(tl)).wait(); o = getAddress(await settled(`${name}.owner`, () => new Contract(addr, OWN, zp).owner())); action = 'handed to the timelock'; }
    }
    rows.push({ name, address: addr, owner: o, timelock: same(o, tl), ...(action ? { action } : {}) });
  }
  const bad = rows.filter((r) => !r.timelock);
  if (ctx.send && bad.length) throw new Error(`not owned by the timelock: ${bad.map((r) => `${r.name} (${r.owner})`).join(', ')}`);
  if (ctx.send) ctx.save('core-handover', { rows });
  return { rows, ok: !bad.length };
}

/** The chain table the deploy code reads. `ctx.tokenStandIn`: the dry run's stand-in for the native ERC-20 (anvil has no precompile). */
function tableOf(ctx, name = 'base') {
  const t = M.routeTable(ctx.cfg, ctx.core, name);
  if (ctx.tokenStandIn) Object.assign(t.tokens[ctx.cfg.token.key], { address: ctx.tokenStandIn, native: false });
  return t;
}

/** [เปลี่ยนเชน] The route's chain: SimpleMultisig + ZetaphyTimelock + our ISM; where the synthetic will be. */
export async function stepRoles(ctx, { route: name = 'base' } = {}) {
  const r = M.enabledRoute(ctx.cfg, name), id = r.steps.roles;
  const done = ctx.state.steps?.[id];
  if (done?.multisig) return { skipped: 'done', ...done };
  const t = tableOf(ctx, name), c = { name, ...t.chains[name] };
  if (!ctx.send) return { wouldDeploy: [`SimpleMultisig(${t.origin.owners.join(',') || '<owners: owner input>'}, ${t.origin.threshold})`, `ZetaphyTimelock(${t.origin.timelockDelay}, [multisig], [anyone], no admin)`,
    `our ISM via ${c.staticMessageIdMultisigIsmFactory}: ${t.zetaphyValidators.threshold} of [${t.zetaphyValidators.validators.join(', ')}]`], on: name };
  needInputs(ctx, id);
  const bp = await ctx.dest(name), fromBlock = await bp.getBlockNumber();
  const res = await originPrepare(t, c, bp, await ctx.dSigner(name));
  const rec = { multisig: res.multisig, timelock: res.timelock, ism: res.ism, deployer: res.deployer, nonce: res.nonce, syntheticAt: res.lockboxAt, fromBlock };
  ctx.save(id, rec);
  return rec;
}
/** [เปลี่ยนเชน] Base: SimpleMultisig + ZetaphyTimelock + our ISM; where the synthetic will be. */
export const stepBaseRoles = (ctx) => stepRoles(ctx);

/** [เปลี่ยนเชน] ZETAPHY: the ISM for the route's origin + the route's own ZetaphyTokenVault (closed), sending to the synthetic's future address. */
export async function stepVault(ctx, { governance, guardian, threats, route: name = 'base' } = {}) {
  const r = M.enabledRoute(ctx.cfg, name), id = r.steps.vault;
  const done = ctx.state.steps?.[id];
  if (done?.vault) return { skipped: 'done', ...done };
  const roles = ctx.state.steps?.[r.steps.roles];
  if (!roles?.syntheticAt) throw new Error(`step ${r.steps.roles} first (it fixes where the synthetic will be)`);
  const t = tableOf(ctx, name), c = { name, ...t.chains[name] }, k = { key: ctx.cfg.token.key, ...t.tokens[ctx.cfg.token.key] };
  if (!ctx.send) return { wouldDeploy: [`ISM for origin ${r.displayName} via ${t.zetaphy.staticMessageIdMultisigIsmFactory}: ${c.threshold} of [${c.validators.join(', ')}]`,
    `ZetaphyTokenVault(native ZTPHY -> ${roles.syntheticAt} on ${r.displayName}; lockCap ${k.limits.lockCap}, release ${k.limits.releaseDailyLimit}/day after ${k.limits.releaseDelay} s; governance ${governance ?? t.zetaphy.timelock}, guardian ${guardian ?? t.zetaphy.guardian}; PAUSED)`], on: 'zetaphy' };
  needInputs(ctx, id);
  // the synthetic's address depends on the deployer's nonce on the route's chain: refuse if it moved since the roles step
  const bs = await ctx.dSigner(name), n = await bs.getNonce('pending');
  if (n !== roles.nonce) throw new Error(`the deployer's ${r.displayName} nonce is ${n}, ${r.steps.roles} fixed ${roles.nonce}: the synthetic would not be at ${roles.syntheticAt}; nothing deployed (docs/SAPHAN-MAINNET.md "nonce moved")`);
  const zp = await ctx.zetaphy();
  const v = await tokenVault(t, k, c, zp, await ctx.zSigner(), { expect: roles.syntheticAt, governance, guardian, threats });
  const rec = { vault: v.vault, ism: v.ism, governance: v.governance, guardian: v.guardian, threats: v.threats, tx: v.tx, block: v.block };
  ctx.save(id, rec);
  return rec;
}

/** [เปลี่ยนเชน] The route's chain: the SaphanSyntheticToken exactly where the route's vault sends (closed). */
export async function stepSynthetic(ctx, { governance, route: name = 'base' } = {}) {
  const r = M.enabledRoute(ctx.cfg, name), id = r.steps.synthetic;
  const done = ctx.state.steps?.[id];
  if (done?.synthetic) return { skipped: 'done', ...done };
  const roles = ctx.state.steps?.[r.steps.roles], vault = ctx.state.steps?.[r.steps.vault];
  if (!vault?.vault) throw new Error(`step ${r.steps.vault} first`);
  const t = tableOf(ctx, name), c = { name, ...t.chains[name] }, k = { key: ctx.cfg.token.key, ...t.tokens[ctx.cfg.token.key] };
  if (!ctx.send) return { wouldDeploy: [`SaphanSyntheticToken("${k.synthetic.name}", "${k.synthetic.symbol}", 18) at ${roles.syntheticAt} on ${r.displayName}; minted only by ${vault.vault}; supplyCap ${k.limits.supplyCap}, mint ${k.limits.mintDailyLimit}/day after ${k.limits.mintDelay} s; governance ${roles.timelock}, guardian ${roles.multisig}; PAUSED`], on: name };
  needInputs(ctx, id);
  const s = await tokenSynthetic(t, k, c, await ctx.dest(name), await ctx.dSigner(name), { vault: vault.vault, expect: roles.syntheticAt, multisig: roles.multisig, timelock: roles.timelock, ism: roles.ism, governance });
  const rec = { synthetic: s.synthetic, symbol: s.symbol, tx: s.tx, block: s.block };
  ctx.save(id, rec);
  return rec;
}

/** [อ่าน] Both ends of a route read back against the config. `expect`: governance/guardian overrides (the dry run's stand-ins). */
export async function verify(ctx, expect = {}) {
  const name = expect.route ?? 'base', R = M.route(ctx.cfg, name), S = R.steps, D = R.displayName;
  const s = ctx.state.steps ?? {}, cfg = ctx.cfg, L = R.limits;
  const rows = [], ok = (what, got, want) => rows.push({ what, got: String(got), want: String(want), ok: String(got).toLowerCase() === String(want).toLowerCase() });
  const zp = await ctx.zetaphy(), bp = await ctx.dest(name);
  const V = new Contract(s[S.vault].vault, M.art('ZetaphyTokenVault').abi, zp), Y = new Contract(s[S.synthetic].synthetic, M.art('SaphanSyntheticToken').abi, bp);
  const E18 = (x) => parseUnits(x, 18);
  const zGov = expect.zetaphyGovernance ?? cfg.zetaphy.timelock, zGuard = expect.zetaphyGuardian ?? cfg.zetaphy.guardian;
  const bGov = expect.baseGovernance ?? s[S.roles].timelock, bGuard = s[S.roles].multisig;
  const me = cfg.deployer.address ?? s[S.roles].deployer;
  ok('vault paused (closed)', await V.paused(), expect.open ? false : true);
  ok('vault lockCap', await V.lockCap(), E18(L.lockCap));
  ok('vault release daily limit', await V.dailyLimit(), E18(L.releaseDailyLimit));
  ok('vault release delay', await V.delay(), L.releaseDelay);
  ok('vault governance', await V.governance(), zGov);
  ok('vault guardian', await V.guardian(zGuard), true);
  ok('vault: deployer is no guardian', await V.guardian(me), false);
  ok('vault remote = the synthetic', await V.remote(), bytes32(s[S.synthetic].synthetic));
  ok('vault remote domain', await V.remoteDomain(), R.domain);
  ok('vault origin token (native ZTPHY)', await V.originToken(), ctx.tokenStandIn ?? cfg.token.address);
  // one vault per route: no other route's vault may point at this synthetic
  for (const other of M.routeNames(cfg, { all: true }).filter((n) => n !== name)) {
    const ov = s[M.route(cfg, other).steps.vault]?.vault;
    if (ov) ok(`the ${other} vault is another contract`, same(ov, s[S.vault].vault), false);
  }
  ok('synthetic paused (closed)', await Y.paused(), expect.open ? false : true);
  ok('synthetic supplyCap', await Y.supplyCap(), E18(L.supplyCap));
  ok('synthetic mint daily limit', await Y.dailyLimit(), E18(L.mintDailyLimit));
  ok('synthetic mint delay', await Y.delay(), L.mintDelay);
  ok('synthetic governance', await Y.governance(), bGov);
  ok('synthetic guardian', await Y.guardian(bGuard), true);
  ok('synthetic: deployer is no guardian', await Y.guardian(me), false);
  ok('synthetic symbol', await Y.symbol(), cfg.token.synthetic.symbol);
  ok('synthetic remote domain', await Y.remoteDomain(), 3659);
  ok('synthetic remote = this route\'s vault', await Y.remote(), bytes32(s[S.vault].vault));
  const bo = M.originSet(cfg, name), ours = cfg.validators.zetaphyOrigin;
  const sortJ = (vs) => vs.map(getAddress).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).join(',');
  const [vz, tz] = await new Contract(await V.interchainSecurityModule(), ISM, zp).validatorsAndThreshold('0x');
  ok(`ZETAPHY ISM (origin ${D})`, `${tz} of ${vz.map(getAddress).join(',')}`, `${bo.threshold} of ${sortJ(bo.validators)}`);
  const [vb, tb] = await new Contract(await Y.interchainSecurityModule(), ISM, bp).validatorsAndThreshold('0x');
  ok(`${D} ISM (origin ZETAPHY)`, `${tb} of ${vb.map(getAddress).join(',')}`, `${ours.threshold} of ${sortJ(ours.validators)}`);
  const BT = new Contract(s[S.roles].timelock, M.art('ZetaphyTimelock').abi, bp);
  ok(`${D} timelock delay`, await BT.getMinDelay(), R.timelockDelay);
  ok(`${D} timelock: the multisig proposes`, await BT.hasRole(keccakId('PROPOSER_ROLE'), bGuard), true);
  ok(`${D} timelock: deployer is no admin`, await BT.hasRole('0x' + '00'.repeat(32), me), false);
  const BM = new Contract(bGuard, M.MULTISIG, bp);
  ok(`${D} multisig threshold`, await BM.threshold(), R.threshold);
  for (const o of R.owners) ok(`${D} multisig owner ${o}`, await BM.isOwner(o), true);
  ok(`${D} multisig: deployer is no owner`, await BM.isOwner(me), false);
  return { route: name, ok: rows.every((r) => r.ok), rows };
}

/** [อ่าน] The route now. */
export async function status(ctx, { route: name = 'base' } = {}) {
  const s = ctx.state.steps ?? {}, R = M.route(ctx.cfg, name), S = R.steps;
  if (!s[S.vault]?.vault || !s[S.synthetic]?.synthetic) {
    const next = name === 'base' ? M.STEPS.find((x) => !s[x.id] && !['check', 'core-config', 'verify', 'open'].includes(x.id))?.id : [S.roles, S.vault, S.synthetic].find((x) => !s[x]);
    return { route: name, enabled: R.enabled, deployed: false, next };
  }
  const V = new Contract(s[S.vault].vault, M.art('ZetaphyTokenVault').abi, await ctx.zetaphy()), Y = new Contract(s[S.synthetic].synthetic, M.art('SaphanSyntheticToken').abi, await ctx.dest(name));
  const f = (x) => formatUnits(x, 18);
  const [vp, locked, vn, vr, vroom, sp, sup, sn, sr, sroom] = await Promise.all([V.paused(), V.locked(), V.nonce(), V.received(), V.remainingToday(), Y.paused(), Y.totalSupply(), Y.nonce(), Y.received(), Y.remainingToday()]);
  return { route: name, vault: { address: s[S.vault].vault, paused: vp, locked: f(locked), sent: Number(vn), received: Number(vr), releaseRoomToday: f(vroom) },
    synthetic: { chain: R.displayName, address: s[S.synthetic].synthetic, paused: sp, totalSupply: f(sup), sent: Number(sn), received: Number(sr), mintRoomToday: f(sroom) },
    waiting: { [name === 'base' ? 'toBase' : `to_${name}`]: Number(vn) - Number(sr), toZetaphy: Number(sn) - Number(vr) }, backed: sup <= locked };
}

/** [เปลี่ยนไฟล์] The opening's files of a route: the gov proposal (ZETAPHY) and what the route's multisig sends. */
export function openFiles(ctx, outDir, { route: name = 'base' } = {}) {
  const p = M.openPlan(ctx.cfg, ctx.state, { route: name }), R = M.route(ctx.cfg, name), d = p.destination, D = R.displayName;
  const sfx = name === 'base' ? '' : `-${name}`; // Base keeps its file names
  mkdirSync(outDir, { recursive: true });
  const files = { gov: join(outDir, `open-zetaphy${sfx}.gov-proposal.json`), plan: join(outDir, `open-plan${sfx}.json`) };
  writeFileSync(files.gov, JSON.stringify(p.zetaphy.proposal, null, 2) + '\n');
  writeFileSync(files.plan, JSON.stringify(p, null, 2) + '\n');
  return { files, plan: p, steps: [
    `[เปลี่ยนเชน] ZETAPHY: bash zetaphy-chain/gov.sh propose-file ${files.gov}   (deposit ${ctx.cfg.zetaphy.proposalDeposit} ZTPHY), vote; after it passes wait ${p.zetaphy.delay} s, then anyone:`,
    `             cast send --rpc-url <ZETAPHY RPC> ${p.zetaphy.timelock} ${p.zetaphy.execute} --keystore <any funded key>`,
    `[เปลี่ยนเชน] ${D}: one owner: cast send --rpc-url <${D} RPC> ${d.multisig} ${d.proposeSchedule} --keystore <owner>   (then ${R.threshold - 1} more owner(s): confirm(<id>), then execute(<id>))`,
    `             after ${d.delay} s: cast send ${d.multisig} ${d.proposeExecute} (propose), confirm, execute`,
    `[อ่าน]       node scripts/saphan-mainnet.js status${name === 'base' ? '' : ` --route ${name}`}   (both paused: false), then set "state": "OPEN" in the state file`,
  ] };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  return o;
}
const bigint = (_, v) => (typeof v === 'bigint' ? String(v) : v);

/** The offline plan: problems, missing inputs (per chain), risks, steps with their state, costs, the routes. */
export function plan(cfg, state, opts = {}) {
  const steps = M.allSteps(cfg).map((s) => ({ ...s, state: state.steps?.[s.id] ? 'done' : 'todo' }));
  const routes = M.routeNames(cfg, { all: true }).map((n) => {
    const r = M.route(cfg, n);
    return { name: n, displayName: r.displayName, chainId: r.chainId, enabled: r.enabled, dex: M.DEXES[r.liquidity.dex]?.label ?? r.liquidity.dex,
      pools: (r.liquidity.pools ?? []).map((p) => `${p.ztphyAmount} ZTPHY + ${p.stableAmount} ${p.stable}`), recipient: r.liquidity.recipient, gas: r.nativeToken?.symbol, deployed: !!M.deployedRoute(cfg, state, n) };
  });
  return { problems: M.mainnetProblems(cfg), missing: M.missingInputs(cfg), risks: M.riskLines(cfg), steps, costs: M.costEstimate(cfg, opts), routes };
}

export function printPlan(p) {
  const open = (p.routes ?? []).filter((r) => r.enabled), off = (p.routes ?? []).filter((r) => !r.enabled);
  say(`== Saphan mainnet: ZTPHY  ZETAPHY (3659) <-> ${open.map((r) => `${r.displayName} (${r.chainId})`).join(', ') || 'Base (8453)'}`);
  for (const r of open) say(`   route ${r.name.padEnd(9)} ${r.displayName}: ${r.dex}, ${r.pools.join('; ')}, Safe ${r.recipient ?? '(owner input)'}, gas ${r.gas}${r.deployed ? ', deployed' : ''}`);
  for (const r of off) say(`   route ${r.name.padEnd(9)} ${r.displayName}: prepared, DISABLED (enabled: false; every deploy step refuses it)`);
  for (const r of p.risks) say(r);
  say(p.problems.length ? `\nPROBLEMS (fix the config):\n  - ${p.problems.join('\n  - ')}` : '\nconfig: no problems');
  if (p.missing.length) {
    say('\nOWNER INPUTS STILL MISSING:');
    const by = (c) => p.missing.filter((m) => (m.chain ?? 'all') === c);
    for (const c of ['all', ...open.map((r) => r.name)]) {
      const ms = by(c);
      say(`  ${c === 'all' ? 'every route' : `${open.find((r) => r.name === c).displayName} (${c})`}: ${ms.length ? '' : 'nothing missing'}`);
      for (const m of ms) say(`    - ${m.field}: ${m.why}  [blocks: ${m.blocks}]`);
    }
  } else say('\nowner inputs: all set');
  if (p.steps.length) say('\nSTEPS (each resumable; chain steps send only with --send yes):');
  for (const s of p.steps) say(`  ${s.state === 'done' ? 'done' : '    '}  ${s.label.padEnd(12)} ${s.id.padEnd(22)} ${s.chain.padEnd(9)} by ${s.who}: ${s.what}`);
  const c = p.costs;
  say(`\nCOSTS, Base (ZETAPHY gas ${c.inputs.zetaphyGasGwei} gwei, Base gas ${c.inputs.baseGasGwei} gwei, ETH $${c.inputs.ethUsd}):`);
  for (const r of c.rows) say(`  ${r.chain.padEnd(9)} ${r.who.padEnd(22)} ${r.gas.padStart(11)} gas  ${r.cost.padStart(22)}  ${r.what}`);
  say(`  total ZETAPHY ${c.totals.zetaphyZtphy} ZTPHY; total Base ${c.totals.baseEth} ETH (~$${c.totals.baseUsd}, incl. L1 data fee allowance); relayer float ${c.totals.relayerFloatEth} ETH (~$${c.totals.relayerFloatUsd})`);
  say(`  fund: deployer ${c.recommend.deployerZtphy}; ${c.recommend.deployerEth}; ${c.recommend.relayerEth}; ${c.recommend.validatorZtphy}`);
  for (const x of Object.values(c.routes ?? {})) {
    say(`\nCOSTS, ${x.displayName} (${x.route}; gas ${x.inputs.gasGwei} gwei, ${x.native} $${x.inputs.nativeUsd}; --${x.route}-gwei <gwei> to change):`);
    for (const r of x.rows) say(`  ${r.chain.padEnd(9)} ${r.who.padEnd(22)} ${r.gas.padStart(11)} gas  ${r.cost.padStart(22)}  ${r.what}`);
    say(`  total ZETAPHY ${x.totals.zetaphyZtphy} ZTPHY; total ${x.displayName} ${x.totals.native} ${x.native} (~$${x.totals.nativeUsd}); relayer float ${x.totals.relayerFloatNative} ${x.native} (~$${x.totals.relayerFloatUsd})`);
    say(`  fund: deployer ${x.recommend.deployer}; ${x.recommend.relayer}; your inputs: deployer ${x.funding?.deployer ?? 'not set'}, relayer ${x.funding?.relayer ?? 'not set'} ${x.native}`);
    for (const w of x.warnings) say(`  WARNING: ${w}`);
  }
  say(`\n  every route together on ZETAPHY: ${c.totals.allRoutesZetaphyZtphy} ZTPHY of gas; gov proposal deposit: ${c.totals.proposalDepositZtphy}, one proposal per route to open`);
}

const routeArg = (o) => (o.route && o.route !== true ? String(o.route) : 'base');
const ROUTE_STEP = { roles: 'roles', vault: 'vault', synthetic: 'synthetic', 'base-roles': 'roles', 'zetaphy-vault': 'vault', 'base-synthetic': 'synthetic' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'plan', ...rest] = process.argv.slice(2);
  const o = args(rest);
  (async () => {
    const cfg = M.loadMainnet();
    const ctx = context({ cfg, send: o.send === 'yes' });
    const name = routeArg(o);
    const each = (fn) => (name === 'all' ? Promise.all(M.routeNames(cfg).map(fn)) : fn(name));
    const gwei = Object.fromEntries(M.routeNames(cfg).filter((n) => n !== 'base' && o[`${n}-gwei`]).map((n) => [n, String(o[`${n}-gwei`])]));
    let res;
    if (cmd === 'plan') { printPlan(plan(cfg, ctx.state, { gwei })); process.exit(0); }
    else if (cmd === 'costs') { const p = plan(cfg, ctx.state, { baseGasGwei: o['base-gwei'] ?? cfg.costs.baseGasGwei, deliveries: o.deliveries ? Number(o.deliveries) : cfg.costs.relayerDeliveries, gwei }); printPlan({ ...p, steps: [], risks: [] }); process.exit(0); }
    else if (cmd === 'check') res = await each((n) => check(ctx, { route: n }));
    else if (cmd === 'core-config') res = writeCoreConfig(ctx, o.out);
    else if (cmd === 'core') res = coreDeploy(ctx, { cli: o.cli ?? 'hyperlane' });
    else if (cmd === 'core-handover') res = await coreHandover(ctx);
    else if (cmd === 'deploy') {
      const want = o.step === 'all' ? ['roles', 'vault', 'synthetic'] : [ROUTE_STEP[String(o.step ?? '')]];
      const fn = { roles: stepRoles, vault: stepVault, synthetic: stepSynthetic };
      if (want.some((s) => !fn[s])) throw new Error(name === 'base' ? '--step base-roles|zetaphy-vault|base-synthetic|all' : '--route <route> --step roles|vault|synthetic|all');
      res = {};
      for (const s of want) { res[M.route(cfg, name).steps[s]] = await fn[s](ctx, { route: name }); if (!ctx.send && o.step === 'all') break; }
      if (!ctx.send) res.note = 'nothing sent (add --send yes). Steps after the first need its addresses, so a dry --step all shows the first only.';
    } else if (cmd === 'verify') res = await verify(ctx, { route: name });
    else if (cmd === 'status') res = await each((n) => status(ctx, { route: n }));
    else if (cmd === 'open-proposals') res = openFiles(ctx, o.out ?? fileURLToPath(new URL('open', M.MAINNET_DIR)), { route: name });
    else if (cmd === 'pause') res = name === 'all' ? M.relayedRoutes(cfg, ctx.state).map((n) => M.pausePlan(cfg, ctx.state, { veto: o.veto ?? null, route: n })) : M.pausePlan(cfg, ctx.state, { veto: o.veto ?? null, route: name });
    else if (cmd === 'relayer-env') { say(M.relayerEnv(cfg, ctx.state).join('\n')); process.exit(0); }
    else if (cmd === 'agent-config') {
      if (!o.out) throw new Error('--out <file>');
      const zFrom = o['zetaphy-from'] != null ? Number(o['zetaphy-from']) : 0;
      // every enabled route: its start block from --<route>-from or the state (the deploy block of its roles step)
      const from = {}, routes = [];
      for (const n of M.routeNames(cfg)) {
        const f = o[`${n}-from`] != null ? Number(o[`${n}-from`]) : (ctx.state.steps?.[M.route(cfg, n).steps.roles]?.fromBlock ?? null);
        if (f == null) {
          if (n === 'base') throw new Error('--base-from <block> (the relayer and a Base validator start there; default: the deploy block of base-roles)');
          console.error(`note: route ${n} is not deployed yet (no ${M.route(cfg, n).steps.roles}): left out of the agent config`);
          continue;
        }
        from[n] = f; routes.push(n);
      }
      const rpc = { ...(o['rpc-zetaphy'] ? { zetaphy: [o['rpc-zetaphy']] } : {}), ...Object.fromEntries(M.routeNames(cfg).filter((n) => o[`rpc-${n}`]).map((n) => [n, [o[`rpc-${n}`]]])) };
      writeFileSync(o.out, JSON.stringify(M.agentConfig(cfg, ctx.core, { zFrom, from, routes, rpc }), null, 2) + '\n');
      res = { wrote: o.out, chains: ['zetaphy', ...routes] };
    } else throw new Error(`unknown command ${cmd} (see the head of scripts/saphan-mainnet.js)`);
    console.log(JSON.stringify(res, bigint, 2));
    process.exit(0);
  })().catch((e) => { console.error(`error: ${e.shortMessage ?? e.message}`); process.exit(1); });
}
