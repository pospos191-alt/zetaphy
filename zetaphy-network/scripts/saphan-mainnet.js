#!/usr/bin/env node
// ZETAPHY Saphan MAINNET: the owner's tool for the ZTPHY route ZETAPHY (3659) <-> Base (8453). Resumable: each deploy
// step writes its result to zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json and is skipped when done.
// Nothing is ever sent without `--send yes`; without it every chain step prints what it would send (a dry run).
// Config: zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json. Runbook (EN/TH): docs/SAPHAN-MAINNET.md.
//
//   node scripts/saphan-mainnet.js plan                       [อ่าน] offline: problems, missing owner inputs, risks, steps, costs
//   node scripts/saphan-mainnet.js check                      [อ่าน] both chains: ids, Base core, timelock, guardian, USDC, Uniswap, deployer
//   node scripts/saphan-mainnet.js costs [--base-gwei 0.02] [--deliveries 200]   [อ่าน] the itemised cost
//   node scripts/saphan-mainnet.js core-config                [เปลี่ยนไฟล์] writes mainnet/core-config.yaml (owners: the timelock)
//   node scripts/saphan-mainnet.js core [--send yes]          [เปลี่ยนเชน] hyperlane core deploy on ZETAPHY (prints the command without --send)
//   node scripts/saphan-mainnet.js core-handover [--send yes] [เปลี่ยนเชน] core contracts still owned by the deployer -> the timelock
//   node scripts/saphan-mainnet.js deploy --step base-roles|zetaphy-vault|base-synthetic|all [--send yes]   [เปลี่ยนเชน]
//   node scripts/saphan-mainnet.js verify                     [อ่าน] read back both ends (closed, caps, limits, ISMs, roles)
//   node scripts/saphan-mainnet.js open-proposals [--out dir] [เปลี่ยนไฟล์] the gov proposal (ZETAPHY) + the Base multisig calls that open
//   node scripts/saphan-mainnet.js pause [--veto 0x<id>]      [อ่าน] the guardians' calldata: pause both ends (or veto a payout)
//   node scripts/saphan-mainnet.js status                     [อ่าน] paused?, locked, supply, messages each way, today's room
//   node scripts/saphan-mainnet.js agent-config --out f [--zetaphy-from N --base-from N --rpc-zetaphy URL --rpc-base URL]
//                                                             [เปลี่ยนไฟล์] the agents' config (no secrets; a private RPC for Base is better)
//   node scripts/saphan-mainnet.js relayer-env                [อ่าน] HYP_* settings for the relayer (no secrets)
//
// env: KEYFILE (the deployer's key file, read only by --send steps, never printed), ZETAPHY_RPC / BASE_RPC (override the
// config's), SAPHAN_MAINNET / SAPHAN_MAINNET_STATE / ZETAPHY_CORE (other config / state / core addresses: the dry run's).
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
  zp = null, bp = null, zs = null, bs = null } = {}) {
  const ctx = { cfg, state, core, stateFile, send, log: say };
  ctx.zetaphy = async () => (ctx._zp ??= zp ?? await providerFor(process.env.ZETAPHY_RPC || cfg.zetaphy.rpc.join(','), cfg.zetaphy.chainId));
  ctx.base = async () => (ctx._bp ??= bp ?? await providerFor(process.env.BASE_RPC || cfg.base.rpc.join(','), cfg.base.chainId));
  const key = () => {
    if (!process.env.KEYFILE) throw new Error('KEYFILE=<the deployer key file> is needed for --send');
    const w = new Wallet(readFileSync(String(process.env.KEYFILE), 'utf8').trim());
    if (cfg.deployer.address && !same(w.address, cfg.deployer.address)) throw new Error(`KEYFILE is ${w.address}, not deployer.address ${cfg.deployer.address}: nothing sent`);
    return w;
  };
  ctx.zSigner = async () => (ctx._zs ??= zs ?? new NonceManager(key().connect(await ctx.zetaphy())));
  ctx.bSigner = async () => (ctx._bs ??= bs ?? new NonceManager(key().connect(await ctx.base())));
  ctx.save = (id, rec) => { ctx.state.steps ??= {}; ctx.state.steps[id] = { ...rec, at: new Date().toISOString() }; writeFileSync(ctx.stateFile, JSON.stringify(ctx.state, null, 2) + '\n'); };
  return ctx;
}

const deployerOf = async (ctx) => (ctx.send ? (await ctx.zSigner()).getAddress() : ctx.cfg.deployer.address);
function needInputs(ctx, stepId) {
  const miss = M.missingInputs(ctx.cfg).filter((m) => m.blocks.includes(stepId) || m.blocks === 'every deploy step');
  if (miss.length) throw new Error(`step ${stepId}: owner inputs missing: ${miss.map((m) => `${m.field} (${m.why})`).join('; ')}`);
}

/** [อ่าน] Both chains, read only. */
export async function check(ctx) {
  const { cfg } = ctx, out = { zetaphy: {}, base: {}, problems: [] };
  const P = (m) => out.problems.push(m);
  const bp = await ctx.base(), b = cfg.base;
  const code = async (p, a) => (await p.getCode(a)) !== '0x';
  out.base.mailboxDomain = Number(await new Contract(b.mailbox, MAILBOX, bp).localDomain().catch(() => -1));
  if (out.base.mailboxDomain !== 8453) P(`Base Mailbox ${b.mailbox}: localDomain ${out.base.mailboxDomain}`);
  for (const k of ['merkleTreeHook', 'validatorAnnounce', 'staticMessageIdMultisigIsmFactory']) if (!(await code(bp, b[k]))) P(`Base ${k} ${b[k]}: no code`);
  const hookMb = await new Contract(b.merkleTreeHook, ['function mailbox() view returns (address)'], bp).mailbox().catch(() => null);
  if (!same(hookMb, b.mailbox)) P(`Base merkle tree hook's mailbox is ${hookMb}`);
  const ours = cfg.validators.zetaphyOrigin;
  if (ours.validators.length) out.base.ourIsm = await factoryIsm(bp, b.staticMessageIdMultisigIsmFactory, ours.validators, ours.threshold);
  const { ERC20, NPM } = await import('../src/saphanpool.js');
  for (const x of cfg.liquidity.pools) {
    if (!x.address) { out.base[x.stable] = 'address not set (owner input)'; continue; }
    const t = new Contract(x.address, ERC20, bp);
    const [sym, dec] = await Promise.all([t.symbol().catch(() => null), t.decimals().then(Number, () => null)]);
    out.base[x.stable] = { address: x.address, symbol: sym, decimals: dec };
    if (dec !== x.decimals) P(`${x.stable} ${x.address}: decimals ${dec}, config ${x.decimals}`);
  }
  const npmFactory = await new Contract(cfg.liquidity.uniswapV3.positionManager, NPM, bp).factory().catch(() => null);
  if (!same(npmFactory, cfg.liquidity.uniswapV3.factory)) P(`Uniswap v3 position manager's factory() is ${npmFactory}, config ${cfg.liquidity.uniswapV3.factory}`);
  if (cfg.liquidity.baseRecipient) {
    out.base.recipientIsContract = await code(bp, cfg.liquidity.baseRecipient);
    if (!out.base.recipientIsContract) P(`liquidity.baseRecipient ${cfg.liquidity.baseRecipient} has no code on Base: create the Safe first`);
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
  for (const o of z.guardianOwners) if (!(await g.isOwner(o).catch(() => false))) P(`guardian multisig: ${o} is not an owner`);
  if (!(await code(zp, z.threats))) P(`ThreatRegistry ${z.threats}: no code`);
  out.zetaphy.nativeDecimals = Number(await new Contract(ctx.tokenStandIn ?? cfg.token.address, ERC20, zp).decimals().catch(() => -1));
  if (out.zetaphy.nativeDecimals !== 18) P(`native ERC-20 ${cfg.token.address}: decimals ${out.zetaphy.nativeDecimals}`);
  out.zetaphy.liquidityMultisig = { address: cfg.liquidity.zetaphyMultisig, balance: formatEther(await zp.getBalance(cfg.liquidity.zetaphyMultisig)) };
  out.zetaphy.core = ctx.core ? { mailbox: ctx.core.mailbox, deployed: await code(zp, ctx.core.mailbox) } : 'not deployed yet (step core)';
  const d = cfg.deployer.address;
  if (d) {
    for (const [name, p] of [['zetaphy', zp], ['base', bp]]) {
      const [bal, n, pend] = await Promise.all([p.getBalance(d), p.getTransactionCount(d, 'latest'), p.getTransactionCount(d, 'pending')]);
      out[name].deployer = { address: d, balance: formatEther(bal), nonce: n, pending: pend - n };
      if (pend !== n) P(`deployer has pending ${name} transactions: the synthetic's address is not fixed`);
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
function tableOf(ctx) {
  const t = M.routeTable(ctx.cfg, ctx.core);
  if (ctx.tokenStandIn) Object.assign(t.tokens[ctx.cfg.token.key], { address: ctx.tokenStandIn, native: false });
  return t;
}

/** [เปลี่ยนเชน] Base: SimpleMultisig + ZetaphyTimelock + our ISM; where the synthetic will be. */
export async function stepBaseRoles(ctx) {
  const done = ctx.state.steps?.['base-roles'];
  if (done?.multisig) return { skipped: 'done', ...done };
  const t = tableOf(ctx), c = { name: 'base', ...t.chains.base };
  if (!ctx.send) return { wouldDeploy: [`SimpleMultisig(${t.origin.owners.join(',')}, ${t.origin.threshold})`, `ZetaphyTimelock(${t.origin.timelockDelay}, [multisig], [anyone], no admin)`,
    `our ISM via ${c.staticMessageIdMultisigIsmFactory}: ${t.zetaphyValidators.threshold} of [${t.zetaphyValidators.validators.join(', ')}]`], on: 'base' };
  needInputs(ctx, 'base-roles');
  const bp = await ctx.base(), fromBlock = await bp.getBlockNumber();
  const r = await originPrepare(t, c, bp, await ctx.bSigner());
  const rec = { multisig: r.multisig, timelock: r.timelock, ism: r.ism, deployer: r.deployer, nonce: r.nonce, syntheticAt: r.lockboxAt, fromBlock };
  ctx.save('base-roles', rec);
  return rec;
}

/** [เปลี่ยนเชน] ZETAPHY: the ISM for origin Base + ZetaphyTokenVault (closed), sending to the synthetic's future address. */
export async function stepVault(ctx, { governance, guardian, threats } = {}) {
  const done = ctx.state.steps?.['zetaphy-vault'];
  if (done?.vault) return { skipped: 'done', ...done };
  const roles = ctx.state.steps?.['base-roles'];
  if (!roles?.syntheticAt) throw new Error('step base-roles first (it fixes where the synthetic will be)');
  const t = tableOf(ctx), c = { name: 'base', ...t.chains.base }, k = { key: ctx.cfg.token.key, ...t.tokens[ctx.cfg.token.key] };
  if (!ctx.send) return { wouldDeploy: [`ISM for origin Base via ${t.zetaphy.staticMessageIdMultisigIsmFactory}: ${c.threshold} of [${c.validators.join(', ')}]`,
    `ZetaphyTokenVault(native ZTPHY -> ${roles.syntheticAt} on Base; lockCap ${k.limits.lockCap}, release ${k.limits.releaseDailyLimit}/day after ${k.limits.releaseDelay} s; governance ${governance ?? t.zetaphy.timelock}, guardian ${guardian ?? t.zetaphy.guardian}; PAUSED)`], on: 'zetaphy' };
  needInputs(ctx, 'zetaphy-vault');
  // the synthetic's address depends on the deployer's Base nonce: refuse if it moved since base-roles
  const bs = await ctx.bSigner(), n = await bs.getNonce('pending');
  if (n !== roles.nonce) throw new Error(`the deployer's Base nonce is ${n}, base-roles fixed ${roles.nonce}: the synthetic would not be at ${roles.syntheticAt}; nothing deployed (docs/SAPHAN-MAINNET.md "nonce moved")`);
  const zp = await ctx.zetaphy();
  const v = await tokenVault(t, k, c, zp, await ctx.zSigner(), { expect: roles.syntheticAt, governance, guardian, threats });
  const rec = { vault: v.vault, ism: v.ism, governance: v.governance, guardian: v.guardian, threats: v.threats, tx: v.tx, block: v.block };
  ctx.save('zetaphy-vault', rec);
  return rec;
}

/** [เปลี่ยนเชน] Base: the SaphanSyntheticToken exactly where the vault sends (closed). */
export async function stepSynthetic(ctx, { governance } = {}) {
  const done = ctx.state.steps?.['base-synthetic'];
  if (done?.synthetic) return { skipped: 'done', ...done };
  const roles = ctx.state.steps?.['base-roles'], vault = ctx.state.steps?.['zetaphy-vault'];
  if (!vault?.vault) throw new Error('step zetaphy-vault first');
  const t = tableOf(ctx), c = { name: 'base', ...t.chains.base }, k = { key: ctx.cfg.token.key, ...t.tokens[ctx.cfg.token.key] };
  if (!ctx.send) return { wouldDeploy: [`SaphanSyntheticToken("${k.synthetic.name}", "${k.synthetic.symbol}", 18) at ${roles.syntheticAt}; minted only by ${vault.vault}; supplyCap ${k.limits.supplyCap}, mint ${k.limits.mintDailyLimit}/day after ${k.limits.mintDelay} s; governance ${roles.timelock}, guardian ${roles.multisig}; PAUSED`], on: 'base' };
  const s = await tokenSynthetic(t, k, c, await ctx.base(), await ctx.bSigner(), { vault: vault.vault, expect: roles.syntheticAt, multisig: roles.multisig, timelock: roles.timelock, ism: roles.ism, governance });
  const rec = { synthetic: s.synthetic, symbol: s.symbol, tx: s.tx, block: s.block };
  ctx.save('base-synthetic', rec);
  return rec;
}

/** [อ่าน] Both ends read back against the config. `expect`: governance/guardian overrides (the dry run's stand-ins). */
export async function verify(ctx, expect = {}) {
  const s = ctx.state.steps ?? {}, cfg = ctx.cfg, L = cfg.token.limits;
  const rows = [], ok = (what, got, want) => rows.push({ what, got: String(got), want: String(want), ok: String(got).toLowerCase() === String(want).toLowerCase() });
  const zp = await ctx.zetaphy(), bp = await ctx.base();
  const V = new Contract(s['zetaphy-vault'].vault, M.art('ZetaphyTokenVault').abi, zp), S = new Contract(s['base-synthetic'].synthetic, M.art('SaphanSyntheticToken').abi, bp);
  const E18 = (x) => parseUnits(x, 18);
  const zGov = expect.zetaphyGovernance ?? cfg.zetaphy.timelock, zGuard = expect.zetaphyGuardian ?? cfg.zetaphy.guardian;
  const bGov = expect.baseGovernance ?? s['base-roles'].timelock, bGuard = s['base-roles'].multisig;
  const me = cfg.deployer.address ?? s['base-roles'].deployer;
  ok('vault paused (closed)', await V.paused(), expect.open ? false : true);
  ok('vault lockCap', await V.lockCap(), E18(L.lockCap));
  ok('vault release daily limit', await V.dailyLimit(), E18(L.releaseDailyLimit));
  ok('vault release delay', await V.delay(), L.releaseDelay);
  ok('vault governance', await V.governance(), zGov);
  ok('vault guardian', await V.guardian(zGuard), true);
  ok('vault: deployer is no guardian', await V.guardian(me), false);
  ok('vault remote = the synthetic', await V.remote(), bytes32(s['base-synthetic'].synthetic));
  ok('vault remote domain', await V.remoteDomain(), 8453);
  ok('vault origin token (native ZTPHY)', await V.originToken(), ctx.tokenStandIn ?? cfg.token.address);
  ok('synthetic paused (closed)', await S.paused(), expect.open ? false : true);
  ok('synthetic supplyCap', await S.supplyCap(), E18(L.supplyCap));
  ok('synthetic mint daily limit', await S.dailyLimit(), E18(L.mintDailyLimit));
  ok('synthetic mint delay', await S.delay(), L.mintDelay);
  ok('synthetic governance', await S.governance(), bGov);
  ok('synthetic guardian', await S.guardian(bGuard), true);
  ok('synthetic: deployer is no guardian', await S.guardian(me), false);
  ok('synthetic symbol', await S.symbol(), cfg.token.synthetic.symbol);
  ok('synthetic remote domain', await S.remoteDomain(), 3659);
  const bo = M.baseOriginSet(cfg), ours = cfg.validators.zetaphyOrigin;
  const [vz, tz] = await new Contract(await V.interchainSecurityModule(), ISM, zp).validatorsAndThreshold('0x');
  ok('ZETAPHY ISM (origin Base)', `${tz} of ${vz.map(getAddress).join(',')}`, `${bo.threshold} of ${bo.validators.map(getAddress).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).join(',')}`);
  const [vb, tb] = await new Contract(await S.interchainSecurityModule(), ISM, bp).validatorsAndThreshold('0x');
  ok('Base ISM (origin ZETAPHY)', `${tb} of ${vb.map(getAddress).join(',')}`, `${ours.threshold} of ${ours.validators.map(getAddress).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).join(',')}`);
  const BT = new Contract(s['base-roles'].timelock, M.art('ZetaphyTimelock').abi, bp);
  ok('Base timelock delay', await BT.getMinDelay(), cfg.base.timelockDelay);
  ok('Base timelock: the multisig proposes', await BT.hasRole(keccakId('PROPOSER_ROLE'), bGuard), true);
  ok('Base timelock: deployer is no admin', await BT.hasRole('0x' + '00'.repeat(32), me), false);
  const BM = new Contract(bGuard, M.MULTISIG, bp);
  ok('Base multisig threshold', await BM.threshold(), cfg.base.threshold);
  for (const o of cfg.base.owners) ok(`Base multisig owner ${o}`, await BM.isOwner(o), true);
  ok('Base multisig: deployer is no owner', await BM.isOwner(me), false);
  return { ok: rows.every((r) => r.ok), rows };
}

/** [อ่าน] The route now. */
export async function status(ctx) {
  const s = ctx.state.steps ?? {};
  if (!s['zetaphy-vault']?.vault || !s['base-synthetic']?.synthetic) return { deployed: false, next: M.STEPS.find((x) => !s[x.id] && !['check', 'core-config', 'verify', 'open'].includes(x.id))?.id };
  const V = new Contract(s['zetaphy-vault'].vault, M.art('ZetaphyTokenVault').abi, await ctx.zetaphy()), S = new Contract(s['base-synthetic'].synthetic, M.art('SaphanSyntheticToken').abi, await ctx.base());
  const f = (x) => formatUnits(x, 18);
  const [vp, locked, vn, vr, vroom, sp, sup, sn, sr, sroom] = await Promise.all([V.paused(), V.locked(), V.nonce(), V.received(), V.remainingToday(), S.paused(), S.totalSupply(), S.nonce(), S.received(), S.remainingToday()]);
  return { vault: { address: s['zetaphy-vault'].vault, paused: vp, locked: f(locked), sent: Number(vn), received: Number(vr), releaseRoomToday: f(vroom) },
    synthetic: { address: s['base-synthetic'].synthetic, paused: sp, totalSupply: f(sup), sent: Number(sn), received: Number(sr), mintRoomToday: f(sroom) },
    waiting: { toBase: Number(vn) - Number(sr), toZetaphy: Number(sn) - Number(vr) }, backed: sup <= locked };
}

/** [เปลี่ยนไฟล์] The opening's files: the gov proposal (ZETAPHY) and what the Base multisig sends. */
export function openFiles(ctx, outDir) {
  const p = M.openPlan(ctx.cfg, ctx.state);
  mkdirSync(outDir, { recursive: true });
  const files = { gov: join(outDir, 'open-zetaphy.gov-proposal.json'), plan: join(outDir, 'open-plan.json') };
  writeFileSync(files.gov, JSON.stringify(p.zetaphy.proposal, null, 2) + '\n');
  writeFileSync(files.plan, JSON.stringify(p, null, 2) + '\n');
  return { files, plan: p, steps: [
    `[เปลี่ยนเชน] ZETAPHY: bash zetaphy-chain/gov.sh propose-file ${files.gov}   (deposit ${ctx.cfg.zetaphy.proposalDeposit} ZTPHY), vote; after it passes wait ${p.zetaphy.delay} s, then anyone:`,
    `             cast send --rpc-url <ZETAPHY RPC> ${p.zetaphy.timelock} ${p.zetaphy.execute} --keystore <any funded key>`,
    `[เปลี่ยนเชน] Base: one owner: cast send --rpc-url <Base RPC> ${p.base.multisig} ${p.base.proposeSchedule} --keystore <owner>   (then ${ctx.cfg.base.threshold - 1} more owner(s): confirm(<id>), then execute(<id>))`,
    `             after ${p.base.delay} s: cast send ${p.base.multisig} ${p.base.proposeExecute} (propose), confirm, execute`,
    `[อ่าน]       node scripts/saphan-mainnet.js status   (both paused: false), then set "state": "OPEN" in the state file`,
  ] };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  return o;
}
const bigint = (_, v) => (typeof v === 'bigint' ? String(v) : v);

/** The offline plan: problems, missing inputs, risks, steps with their state, costs. */
export function plan(cfg, state, opts = {}) {
  const steps = M.STEPS.map((s) => ({ ...s, state: state.steps?.[s.id] ? 'done' : 'todo' }));
  return { problems: M.mainnetProblems(cfg), missing: M.missingInputs(cfg), risks: M.riskLines(cfg), steps, costs: M.costEstimate(cfg, opts) };
}

export function printPlan(p) {
  say('== Saphan mainnet: ZTPHY  ZETAPHY (3659) <-> Base (8453)');
  for (const r of p.risks) say(r);
  say(p.problems.length ? `\nPROBLEMS (fix the config):\n  - ${p.problems.join('\n  - ')}` : '\nconfig: no problems');
  say(p.missing.length ? `\nOWNER INPUTS STILL MISSING:\n${p.missing.map((m) => `  - ${m.field}: ${m.why}  [blocks: ${m.blocks}]`).join('\n')}` : '\nowner inputs: all set');
  say('\nSTEPS (each resumable; chain steps send only with --send yes):');
  for (const s of p.steps) say(`  ${s.state === 'done' ? 'done' : '    '}  ${s.label.padEnd(12)} ${s.id.padEnd(15)} ${s.chain.padEnd(8)} by ${s.who}: ${s.what}`);
  const c = p.costs;
  say(`\nCOSTS (ZETAPHY gas ${c.inputs.zetaphyGasGwei} gwei, Base gas ${c.inputs.baseGasGwei} gwei, ETH $${c.inputs.ethUsd}):`);
  for (const r of c.rows) say(`  ${r.chain.padEnd(8)} ${r.who.padEnd(20)} ${r.gas.padStart(11)} gas  ${r.cost.padStart(22)}  ${r.what}`);
  say(`  total ZETAPHY ${c.totals.zetaphyZtphy} ZTPHY; total Base ${c.totals.baseEth} ETH (~$${c.totals.baseUsd}, incl. L1 data fee allowance); relayer float ${c.totals.relayerFloatEth} ETH (~$${c.totals.relayerFloatUsd})`);
  say(`  gov proposal deposit: ${c.totals.proposalDepositZtphy}`);
  say(`  fund: deployer ${c.recommend.deployerZtphy}; ${c.recommend.deployerEth}; ${c.recommend.relayerEth}; ${c.recommend.validatorZtphy}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'plan', ...rest] = process.argv.slice(2);
  const o = args(rest);
  (async () => {
    const cfg = M.loadMainnet();
    const ctx = context({ cfg, send: o.send === 'yes' });
    let res;
    if (cmd === 'plan') { printPlan(plan(cfg, ctx.state)); process.exit(0); }
    else if (cmd === 'costs') { const p = plan(cfg, ctx.state, { baseGasGwei: o['base-gwei'] ?? cfg.costs.baseGasGwei, deliveries: o.deliveries ? Number(o.deliveries) : cfg.costs.relayerDeliveries }); printPlan({ ...p, steps: [], risks: [] }); process.exit(0); }
    else if (cmd === 'check') res = await check(ctx);
    else if (cmd === 'core-config') res = writeCoreConfig(ctx, o.out);
    else if (cmd === 'core') res = coreDeploy(ctx, { cli: o.cli ?? 'hyperlane' });
    else if (cmd === 'core-handover') res = await coreHandover(ctx);
    else if (cmd === 'deploy') {
      const want = o.step === 'all' ? ['base-roles', 'zetaphy-vault', 'base-synthetic'] : [String(o.step ?? '')];
      const fn = { 'base-roles': stepBaseRoles, 'zetaphy-vault': stepVault, 'base-synthetic': stepSynthetic };
      res = {};
      for (const s of want) { if (!fn[s]) throw new Error('--step base-roles|zetaphy-vault|base-synthetic|all'); res[s] = await fn[s](ctx); if (!ctx.send && o.step === 'all') break; }
      if (!ctx.send) res.note = 'nothing sent (add --send yes). Steps after the first need its addresses, so a dry --step all shows the first only.';
    } else if (cmd === 'verify') res = await verify(ctx);
    else if (cmd === 'status') res = await status(ctx);
    else if (cmd === 'open-proposals') res = openFiles(ctx, o.out ?? fileURLToPath(new URL('open', M.MAINNET_DIR)));
    else if (cmd === 'pause') res = M.pausePlan(cfg, ctx.state, { veto: o.veto ?? null });
    else if (cmd === 'relayer-env') { say(M.relayerEnv(cfg, ctx.state).join('\n')); process.exit(0); }
    else if (cmd === 'agent-config') {
      if (!o.out) throw new Error('--out <file>');
      const zFrom = o['zetaphy-from'] != null ? Number(o['zetaphy-from']) : 0, baseFrom = o['base-from'] != null ? Number(o['base-from']) : (ctx.state.steps?.['base-roles']?.fromBlock ?? null);
      if (baseFrom == null) throw new Error('--base-from <block> (the relayer and a Base validator start there; default: the deploy block of base-roles)');
      const rpc = { ...(o['rpc-zetaphy'] ? { zetaphy: [o['rpc-zetaphy']] } : {}), ...(o['rpc-base'] ? { base: [o['rpc-base']] } : {}) };
      writeFileSync(o.out, JSON.stringify(M.agentConfig(cfg, ctx.core, { zFrom, baseFrom, rpc }), null, 2) + '\n');
      res = { wrote: o.out };
    } else throw new Error(`unknown command ${cmd} (see the head of scripts/saphan-mainnet.js)`);
    console.log(JSON.stringify(res, bigint, 2));
    process.exit(0);
  })().catch((e) => { console.error(`error: ${e.shortMessage ?? e.message}`); process.exit(1); });
}

