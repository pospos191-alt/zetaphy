#!/usr/bin/env node
// ZETAPHY Saphan MAINNET, the whole route on LOCAL chains: nothing is sent to ZETAPHY mainnet or Base mainnet.
//   Base     BASE_RPC: an anvil fork of Base mainnet (its real Mailbox, merkle tree hook, ISM factory, USDC and Uniswap v3)
//            or, with --local-base yes, a plain anvil 8453 with Hyperlane core from the pinned CLI (+ Uniswap v3 from npm)
//   ZETAPHY  ZETAPHY_RPC: a fresh anvil 3659 with Hyperlane core deployed by the pinned CLI from the config that
//            `saphan-mainnet.js core-config` writes (every owner the timelock stand-in)
// Same code as the owner's tool (scripts/saphan-mainnet.js steps, saphan-pool.js plans); throwaway keys stand in for the
// validators, the gov module, the guardians and the Base multisig owners, so this run can sign everything itself.
// Gas comes from anvil_setBalance on the local chains only (never a faucet).
//
//   node scripts/saphan-mainnet-dryrun.js prepare --work <dir> [--local-base yes]
//       stand-ins on the local ZETAPHY (timelock 48 h, guardian 2-of-3, native-coin stand-in), the dry config, the core
//       config and the local registry for the CLI. Then the caller runs `hyperlane core deploy` (the workflow does).
//   node scripts/saphan-mainnet-dryrun.js run --work <dir>
//       core hand-over, the three deploy steps, verify, opening through both timelocks, ZTPHY to Base for the pools,
//       the pools, caps, burn -> release after the delay, pause, forged messages. Prints MAINNET DRY RUN OK.
// env: ZETAPHY_RPC, BASE_RPC, DEV_KEY (any key: funded here), UNISWAP_DIR (local base: node_modules with @uniswap/v3-*).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { JsonRpcProvider, Wallet, Contract, ContractFactory, NonceManager, Interface, getAddress, keccak256, toUtf8Bytes, parseUnits, formatUnits, AbiCoder, toBeHex, getBytes, zeroPadValue } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import * as P from '../src/saphanpool.js';
import { messageIdMetadata, bytes32 } from '../src/saphan.js';
import * as T from './saphan-mainnet.js';
import { poolPlans } from './saphan-pool.js';

const log = (...a) => console.log(...a);
const fail = (m) => { throw new Error(m); };
const art = M.art;
const E = 10n ** 18n;
const key = (label) => new Wallet(keccak256(toUtf8Bytes(`saphan mainnet dry run ${label}`))); // public throwaway keys, local chains only
const KEYS = { gov: key('gov module'), g: [1, 2, 3].map((i) => key(`guardian ${i}`)), b: [1, 2, 3].map((i) => key(`base owner ${i}`)),
  vz: [1, 2].map((i) => key(`validator zetaphy ${i}`)), vb: [1, 2].map((i) => key(`validator base ${i}`)), safe: key('liquidity safe'), liq: key('liquidity multisig'), stranger: key('stranger') };
const sorted = (ws) => [...ws].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
const MAILBOX = new Interface(['event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)', 'function process(bytes metadata, bytes message) payable',
  'function dispatch(uint32,bytes32,bytes) payable returns (bytes32)', 'function quoteDispatch(uint32,bytes32,bytes) view returns (uint256)']);
const HOOK = ['function latestCheckpoint() view returns (bytes32, uint32)'];
const ERRORS = new Interface(['ZetaphyTokenVault', 'SaphanSyntheticToken', 'SimpleMultisig'].flatMap((n) => art(n).abi.filter((f) => f.type === 'error')));
const messageOf = (rc) => rc.logs.map((l) => { try { return MAILBOX.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'Dispatch')?.args.message ?? fail('no Dispatch event');
const idOf = (m) => keccak256('0x' + m.slice(2 + 77 * 2));
async function refused(label, fn, want = null) {
  try { await fn(); } catch (e) {
    let why = e.shortMessage ?? e.message;
    try { const d = e.data && ERRORS.parseError(e.data); if (d) why = d.name; } catch { /* not ours */ }
    if (want && !why.includes(want) && !String(e.message).includes(want)) fail(`${label}: refused, but with ${why.slice(0, 120)} (wanted ${want})`);
    log(`  refused as it should: ${label} (${why.slice(0, 80)})`);
    return;
  }
  fail(`${label}: accepted`);
}
const rpc = (p, m, a) => p.send(m, a);
const fund = async (p, who) => { for (const a of who) await rpc(p, 'anvil_setBalance', [a, '0x3635c9adc5dea00000']); };
const warp = async (p, s) => { await rpc(p, 'evm_increaseTime', [s]); await rpc(p, 'evm_mine', []); };
const deploy = async (a, args, s) => { const k = await new ContractFactory(a.abi, a.bytecode, s).deploy(...args); await k.waitForDeployment(); return k; };
const opt = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };

function providers() {
  return { zp: new JsonRpcProvider(process.env.ZETAPHY_RPC, 3659n, { staticNetwork: true, cacheTimeout: -1 }), bp: new JsonRpcProvider(process.env.BASE_RPC, 8453n, { staticNetwork: true, cacheTimeout: -1 }) };
}

/** Phase 1: stand-ins on the local ZETAPHY, the dry config, the core config, the local registry. */
async function prepare(work, localBase) {
  mkdirSync(work, { recursive: true });
  const { zp, bp } = providers();
  const dev = new Wallet(process.env.DEV_KEY);
  await fund(zp, [dev.address, KEYS.gov.address, ...KEYS.g.map((w) => w.address), KEYS.liq.address, KEYS.stranger.address]);
  await fund(bp, [dev.address, ...KEYS.b.map((w) => w.address), KEYS.safe.address, KEYS.stranger.address]);
  const zs = new NonceManager(dev.connect(zp));
  // the ZETAPHY timelock (48 h; proposer: the gov module stand-in; executor: anyone) and the guardian multisig (2 of 3)
  const tl = await deploy(art('ZetaphyTimelock'), [172800, [KEYS.gov.address], ['0x' + '00'.repeat(20)], '0x' + '00'.repeat(20)], zs);
  const g = await deploy(art('SimpleMultisig'), [KEYS.g.map((w) => w.address), 2], zs);
  const native = await deploy(art('BridgedToken'), ['ZTPHY (dry-run stand-in for the native ERC-20)', 'ZTPHY', 18, dev.address], zs);
  const cfg = JSON.parse(readFileSync(M.MAINNET_FILE, 'utf8'));
  Object.assign(cfg.zetaphy, { rpc: ['https://zetaphy.invalid'], timelock: getAddress(tl.target), govModule: KEYS.gov.address, govModuleBech32: M.zetaphyBech32(KEYS.gov.address),
    guardian: getAddress(g.target), guardianOwners: KEYS.g.map((w) => w.address), guardianThreshold: 2 });
  Object.assign(cfg.base, { owners: KEYS.b.map((w) => w.address), threshold: 2 });
  cfg.validators.zetaphyOrigin = { validators: KEYS.vz.map((w) => w.address), threshold: 2 };
  cfg.validators.baseOrigin = { mode: 'ours', validators: KEYS.vb.map((w) => w.address), threshold: 2 };
  cfg.deployer.address = dev.address;
  cfg.liquidity.zetaphyMultisig = KEYS.liq.address;
  cfg.liquidity.zetaphyMultisigBech32 = null;
  cfg.liquidity.baseRecipient = KEYS.safe.address;
  const p = M.mainnetProblems(cfg);
  if (p.length) fail(`dry config: ${p.join('; ')}`);
  writeFileSync(join(work, 'saphan-mainnet.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(join(work, 'standins.json'), JSON.stringify({ native: getAddress(native.target), localBase: !!localBase }, null, 2));
  writeFileSync(join(work, 'core-config.yaml'), M.coreConfigYaml(cfg));
  const reg = join(work, 'reg/chains');
  mkdirSync(join(reg, 'zetaphy'), { recursive: true });
  writeFileSync(join(reg, 'zetaphy/metadata.yaml'), readFileSync(new URL('registry/chains/zetaphy/metadata.yaml', M.MAINNET_DIR), 'utf8').replace('https://129-221-199-191.sslip.io', process.env.ZETAPHY_RPC));
  if (localBase) {
    mkdirSync(join(reg, 'base'), { recursive: true });
    writeFileSync(join(reg, 'base/metadata.yaml'), `name: base\ndisplayName: Base (local)\nchainId: 8453\ndomainId: 8453\nprotocol: ethereum\nrpcUrls:\n  - http: ${process.env.BASE_RPC}\nnativeToken:\n  name: Ether\n  symbol: ETH\n  decimals: 18\nblocks:\n  confirmations: 1\n  reorgPeriod: 1\n  estimateBlockTime: 2\n`);
    writeFileSync(join(work, 'base-core.yaml'), `owner: "${dev.address}"\ndefaultIsm:\n  type: testIsm\ndefaultHook:\n  type: merkleTreeHook\nrequiredHook:\n  type: protocolFee\n  owner: "${dev.address}"\n  beneficiary: "${dev.address}"\n  protocolFee: "0"\n  maxProtocolFee: "1000000000"\n`);
  }
  log(`prepared ${work}: ZETAPHY timelock stand-in ${tl.target}, guardian ${g.target}, native stand-in ${native.target}${localBase ? '; local Base: deploy its core with base-core.yaml' : ''}`);
}

/** Blocks [from, to] of `p`: the gas each sender used. */
async function gasUsed(p, from, to, who) {
  let g = 0n;
  for (let b = from; b <= to; b++) {
    const blk = await p.getBlock(b, true);
    for (const tx of blk?.prefetchedTransactions ?? []) if (who.some((w) => w.toLowerCase() === tx.from.toLowerCase())) g += (await p.getTransactionReceipt(tx.hash)).gasUsed;
  }
  return g;
}

/** The local Uniswap v3 (plain Base only): factory + position manager from the npm artifacts (the canonical pool init code). */
async function localUniswap(bs) {
  const req = createRequire(join(process.env.UNISWAP_DIR ?? '/dev/shm/uni', 'package.json'));
  const F = req('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json');
  const N = req('@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json');
  const f = await deploy(F, [], bs);
  const n = await deploy(N, [f.target, '0x4200000000000000000000000000000000000006', '0x' + '00'.repeat(19) + '01'], bs);
  return { factory: getAddress(f.target), positionManager: getAddress(n.target) };
}

/** An ERC-20 balance on the fork: find the balances mapping slot (0..30) and write it. */
async function deal(bp, token, who, amount) {
  const t = new Contract(token, P.ERC20, bp);
  for (let slot = 0; slot < 30; slot++) {
    const at = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [who, slot]));
    const before = await rpc(bp, 'eth_getStorageAt', [token, at, 'latest']);
    await rpc(bp, 'anvil_setStorageAt', [token, at, zeroPadValue(toBeHex(amount), 32)]);
    if ((await t.balanceOf(who)) === amount) return slot;
    await rpc(bp, 'anvil_setStorageAt', [token, at, before]);
  }
  throw new Error(`could not set a ${token} balance`);
}

async function run(work) {
  const { zp, bp } = providers();
  const dev = new Wallet(process.env.DEV_KEY);
  const S = JSON.parse(readFileSync(join(work, 'standins.json'), 'utf8'));
  const cfg = JSON.parse(readFileSync(join(work, 'saphan-mainnet.json'), 'utf8'));
  const fork = (await bp.getCode(cfg.base.mailbox)) !== '0x';
  const zs = new NonceManager(dev.connect(zp)), bs = new NonceManager(dev.connect(bp));
  if (!fork) {
    const bc = M.parseAddressesYaml(readFileSync(join(work, 'reg/chains/base/addresses.yaml'), 'utf8'));
    for (const k of ['mailbox', 'merkleTreeHook', 'validatorAnnounce', 'staticMessageIdMultisigIsmFactory']) cfg.base[k] = bc[k] ?? fail(`local Base core: no ${k}`);
    cfg.liquidity.uniswapV3 = await localUniswap(bs);
    log(`local Base: Hyperlane core ${cfg.base.mailbox}, Uniswap v3 ${cfg.liquidity.uniswapV3.factory} / ${cfg.liquidity.uniswapV3.positionManager}`);
  } else log(`Base: a fork of Base mainnet (Mailbox ${cfg.base.mailbox} has code)`);
  // stable stand-ins where there is no real one (USDT always: its address is an owner input; USDC off the fork)
  const stables = {};
  for (const pool of cfg.liquidity.pools) {
    if (fork && pool.address) { stables[pool.stable] = pool.address; continue; }
    const k = await deploy(art('BridgedToken'), [`${pool.stable} (dry-run stand-in)`, pool.stable, pool.decimals, dev.address], bs);
    stables[pool.stable] = getAddress(k.target);
  }
  const core = M.parseAddressesYaml(readFileSync(join(work, 'reg/chains/zetaphy/addresses.yaml'), 'utf8'));
  const stateFile = join(work, 'state.json');
  if (existsSync(stateFile)) fail(`${stateFile} exists: use a fresh --work`);
  const ctx = T.context({ cfg, state: { steps: {} }, core, stateFile, send: true, zp, bp, zs, bs });
  ctx.tokenStandIn = S.native;
  log(`dry run: ZETAPHY (local 3659) <-> Base (${fork ? 'fork of mainnet' : 'local'} 8453), deployer ${dev.address}`);
  const z0 = await zp.getBlockNumber(), b0 = await bp.getBlockNumber();

  // 0. read-only check (the owner's first command)
  const chk = await T.check(ctx);
  // expected here only: no USDT address (an owner input), and the local stand-ins (ThreatRegistry not on the local ZETAPHY,
  // the Safe stand-in is a plain key)
  if (fork && chk.problems.some((x) => !/USDT|pending|ThreatRegistry|baseRecipient/.test(x))) fail(`check: ${chk.problems.join('; ')}`);
  log(`check: ${chk.problems.length ? chk.problems.join('; ') : 'no problems'} (USDC ${JSON.stringify(chk.base.USDC)})`);

  // 1. the core hand-over (the CLI gave the interchain account router to the deployer)
  const ho = await T.coreHandover(ctx);
  if (!ho.ok) fail(`core hand-over: ${JSON.stringify(ho.rows)}`);
  log(`core: every owner is the timelock (${ho.rows.map((r) => `${r.name}${r.action ? ' (handed over)' : ''}`).join(', ')})`);

  // 2. the three deploy steps, then again (resumable: all skipped)
  const r1 = await T.stepBaseRoles(ctx);
  const r2 = await T.stepVault(ctx, { threats: 'none' });
  const r3 = await T.stepSynthetic(ctx);
  log(`deploy: Base multisig ${r1.multisig}, Base timelock ${r1.timelock}, our ISM ${r1.ism}; vault ${r2.vault} (ISM ${r2.ism}); synthetic ${r3.synthetic}`);
  for (const f of [T.stepBaseRoles, T.stepVault, T.stepSynthetic]) if (!(await f(ctx)).skipped) fail('a done step ran again');
  log('resume: every done step is skipped');
  const v = await T.verify(ctx);
  if (!v.ok) fail(`verify: ${v.rows.filter((x) => !x.ok).map((x) => `${x.what}: ${x.got} (want ${x.want})`).join('; ')}`);
  log(`verify: ${v.rows.length} read-back checks pass; both ends CLOSED`);
  const gz = await gasUsed(zp, z0 + 1, await zp.getBlockNumber(), [dev.address]), gb = await gasUsed(bp, b0 + 1, await bp.getBlockNumber(), [dev.address]);

  const vault = new Contract(r2.vault, art('ZetaphyTokenVault').abi, zs), syn = new Contract(r3.synthetic, art('SaphanSyntheticToken').abi, bs);
  const native = new Contract(S.native, [...P.ERC20.fragments.map((f) => f.format('full')), 'function mint(address,uint256)'], zs);
  const zMailbox = new Contract(core.mailbox, MAILBOX, zs), bMailbox = new Contract(cfg.base.mailbox, MAILBOX, bs);
  const L = cfg.token.limits, U = (x) => parseUnits(String(x), 18);
  await native.mint(KEYS.liq.address, U('3000000')).then((t) => t.wait());
  await refused('a lock while closed', () => vault.connect(KEYS.liq.connect(zp)).lock.staticCall(KEYS.safe.address, E), 'IsPaused');

  // 3. opening: ZETAPHY through the gov proposal's exact Data; Base through the multisig and its timelock
  const op = T.openFiles(ctx, join(work, 'open')).plan;
  const govMsg = JSON.parse(readFileSync(join(work, 'open/open-zetaphy.gov-proposal.json'), 'utf8')).messages[0];
  if (govMsg.Sender !== cfg.zetaphy.govModuleBech32 || getAddress(govMsg.To) !== getAddress(cfg.zetaphy.timelock)) fail('gov proposal: wrong sender or target');
  await (await KEYS.gov.connect(zp).sendTransaction({ to: govMsg.To, data: '0x' + Buffer.from(govMsg.Data, 'base64').toString('hex') })).wait();
  const ztl = new Contract(cfg.zetaphy.timelock, art('ZetaphyTimelock').abi, zp);
  await refused('executing the opening before 48 h', () => KEYS.stranger.connect(zp).call({ to: cfg.zetaphy.timelock, data: op.zetaphy.execute }));
  const msig = (w) => new Contract(r1.multisig, art('SimpleMultisig').abi, w.connect(bp));
  const viaBase = async (data) => {
    const id = await msig(KEYS.b[0]).proposalCount();
    await (await KEYS.b[0].connect(bp).sendTransaction({ to: r1.multisig, data })).wait();
    await refused('a Base multisig call with 1 of 2 confirmations', () => msig(KEYS.b[0]).execute.staticCall(id), 'NotEnough');
    await (await msig(KEYS.b[1]).confirm(id)).wait();
    await (await msig(KEYS.b[1]).execute(id)).wait();
  };
  await viaBase(op.base.proposeSchedule);
  await warp(zp, 172800 + 1); await warp(bp, 172800 + 1);
  await (await KEYS.stranger.connect(zp).sendTransaction({ to: cfg.zetaphy.timelock, data: op.zetaphy.execute })).wait();
  await viaBase(op.base.proposeExecute);
  if (await vault.paused() || await syn.paused()) fail('not open after both timelocks');
  if (Number(await ztl.getOperationState(op.zetaphy.operationId)) !== 3) fail('the ZETAPHY operation is not Done');
  log('open: the gov proposal (scheduled by the gov module stand-in) + 48 h on ZETAPHY; the Base multisig 2-of-3 + its timelock 48 h');

  // 4. ZTPHY to Base for the pools: the liquidity multisig's exact calls (saphan-pool.js bridge plan)
  const signZ = async (m, ws) => { const [root, index] = await new Contract(core.merkleTreeHook, HOOK, zp).latestCheckpoint(); return messageIdMetadata(m, sorted(ws), { merkleTreeHook: core.merkleTreeHook, root, index: Number(index) }); };
  const signB = async (m, ws) => { const [root, index] = await new Contract(cfg.base.merkleTreeHook, HOOK, bp).latestCheckpoint(); return messageIdMetadata(m, sorted(ws), { merkleTreeHook: cfg.base.merkleTreeHook, root, index: Number(index) }); };
  const bridge = P.bridgePlan(cfg, ctx.state);
  if (bridge.total !== String(U('2000000'))) fail(`bridge total ${bridge.total}`);
  const liq = KEYS.liq.connect(zp);
  let rcLock = null;
  for (const c of bridge.calls) rcLock = await (await liq.sendTransaction({ to: getAddress(c.to) === getAddress(cfg.token.address) ? S.native : c.to, data: c.data })).wait();
  const mOut = messageOf(rcLock);
  await refused('a mint signed by a stranger', async () => bMailbox.process.staticCall(await signZ(mOut, [KEYS.stranger]), mOut));
  await refused('a mint signed by 1 of our 2 validators', async () => bMailbox.process.staticCall(await signZ(mOut, [KEYS.vz[0]]), mOut));
  await refused('a mint signed by the Base-origin validators', async () => bMailbox.process.staticCall(await signZ(mOut, KEYS.vb), mOut));
  await (await bMailbox.process(await signZ(mOut, KEYS.vz), mOut)).wait();
  await refused('the same mint again', async () => bMailbox.process.staticCall(await signZ(mOut, KEYS.vz), mOut));
  await refused('a claim before the mint delay', () => syn.claim.staticCall(idOf(mOut)), 'NotReady');
  await warp(bp, L.mintDelay + 1);
  await (await syn.claim(idOf(mOut))).wait();
  if ((await syn.balanceOf(KEYS.safe.address)) !== U('2000000')) fail('the Safe did not get 2,000,000 ZTPHY');
  log(`lock -> mint: ${formatUnits(U('2000000'), 18)} ZTPHY locked by the liquidity multisig, minted to the Safe on Base after ${L.mintDelay} s`);

  // 5. caps: the rest of lockCap fits, the daily mint limit makes it wait a day, one more is over the cap
  const rest = U(L.lockCap) - U('2000000');
  await (await native.connect(KEYS.liq.connect(zp)).approve(r2.vault, rest + E)).wait();
  const rcRest = await (await vault.connect(KEYS.liq.connect(zp)).lock(KEYS.safe.address, rest)).wait();
  await refused('a lock over lockCap', () => vault.connect(KEYS.liq.connect(zp)).lock.staticCall(KEYS.safe.address, E), 'OverCap');
  const mRest = messageOf(rcRest);
  await (await bMailbox.process(await signZ(mRest, KEYS.vz), mRest)).wait();
  await warp(bp, L.mintDelay + 1);
  const today = await syn.remainingToday();
  if (today < rest) await refused('a mint over the daily mint limit', () => syn.claim.staticCall(idOf(mRest)), 'OverLimit');
  await warp(bp, 86400);
  await (await syn.claim(idOf(mRest))).wait();
  if ((await syn.totalSupply()) !== U(L.supplyCap)) fail('supply is not the cap');
  log(`caps: lockCap ${L.lockCap} reached and enforced; daily mint limit ${L.mintDailyLimit} enforced (the rest waited for the next day)`);

  // 6. the pools (saphan-pool.js plans), signed here by the Safe stand-in
  const pc = { ...cfg, liquidity: { ...cfg.liquidity, pools: cfg.liquidity.pools.map((x) => ({ ...x, address: stables[x.stable] })) } };
  const plans = poolPlans(pc, ctx.state, {});
  const safe = new NonceManager(KEYS.safe.connect(bp));
  for (const pool of pc.liquidity.pools) {
    const need = M.units(pool.stableAmount, pool.decimals);
    if (fork && cfg.liquidity.pools.find((x) => x.stable === pool.stable)?.address) await deal(bp, pool.address, KEYS.safe.address, need);
    else await (await new Contract(pool.address, ['function mint(address,uint256)'], bs).mint(KEYS.safe.address, need)).wait();
    log(`  the Safe stand-in holds ${formatUnits(await new Contract(pool.address, P.ERC20, bp).balanceOf(KEYS.safe.address), pool.decimals)} ${pool.stable} at ${pool.address}`);
  }
  const pb0 = await bp.getBlockNumber();
  for (const p of plans.pools) {
    for (const t of p.txs) {
      try { await (await safe.sendTransaction({ to: t.to, data: t.data })).wait(); }
      catch (e) { fail(`pool ZTPHY/${p.stable}: "${t.what}" reverted: ${e.shortMessage ?? e.message}${e.data ? ` data ${e.data}` : ''} (token0 ${p.token0}, token1 ${p.token1}, sqrtPriceX96 ${p.sqrtPriceX96})`); }
    }
    const at = await new Contract(cfg.liquidity.uniswapV3.factory, P.FACTORY, bp).getPool(p.token0, p.token1, p.feeTier);
    const [sqrt] = await new Contract(at, P.POOL, bp).slot0();
    if (String(sqrt) !== p.sqrtPriceX96) fail(`${p.stable} pool price ${sqrt}, planned ${p.sqrtPriceX96}`);
    const held = [await new Contract(p.ztphy, P.ERC20, bp).balanceOf(at), await new Contract(p.stableAddress, P.ERC20, bp).balanceOf(at)];
    log(`pool ZTPHY/${p.stable} ${at}: price ${p.priceText}; holds ${formatUnits(held[0], 18)} ZTPHY + ${formatUnits(held[1], 6)} ${p.stable}`);
    for (const l of P.impactLines(p)) log(l);
  }
  if ((await new Contract(cfg.liquidity.uniswapV3.positionManager, P.NPM, bp).balanceOf(KEYS.safe.address)) !== BigInt(plans.pools.length)) fail('the Safe does not hold one position per pool');
  const gpool = await gasUsed(bp, pb0 + 1, await bp.getBlockNumber(), [KEYS.safe.address]);

  // 7. back: burn on Base -> release on ZETAPHY after the delay, within the daily release limit
  const back = U(L.releaseDailyLimit) - U('50000');
  const rcB = await (await syn.connect(safe).sendBack(KEYS.liq.address, back, { value: await syn.quote(KEYS.liq.address, back) })).wait();
  const mIn = messageOf(rcB);
  await refused('a release signed by our ZETAPHY-origin validators', async () => zMailbox.process.staticCall(await signB(mIn, KEYS.vz), mIn));
  await (await zMailbox.process(await signB(mIn, KEYS.vb), mIn)).wait();
  await refused('a release before the delay', () => vault.claim.staticCall(idOf(mIn)), 'NotReady');
  await warp(zp, L.releaseDelay + 1);
  const before = await native.balanceOf(KEYS.liq.address);
  await (await vault.claim(idOf(mIn))).wait();
  if ((await native.balanceOf(KEYS.liq.address)) - before !== back) fail('not released');
  const rcB2 = await (await syn.connect(safe).sendBack(KEYS.liq.address, U('100000'), { value: await syn.quote(KEYS.liq.address, U('100000')) })).wait();
  const mIn2 = messageOf(rcB2);
  await (await zMailbox.process(await signB(mIn2, KEYS.vb), mIn2)).wait();
  await warp(zp, L.releaseDelay + 1);
  if ((await vault.remainingToday()) < U('100000')) await refused('a release over the daily release limit', () => vault.claim.staticCall(idOf(mIn2)), 'OverLimit');
  await warp(zp, 86400);
  await (await vault.claim(idOf(mIn2))).wait();
  if ((await vault.locked()) !== (await syn.totalSupply())) fail('locked on ZETAPHY != supply on Base');
  log(`burn -> release: ${formatUnits(back, 18)} ZTPHY back after ${L.releaseDelay} s; the daily release limit ${L.releaseDailyLimit} held a second one to the next day; locked == supply`);

  // 8. pause: the guardians' calldata (saphan-mainnet.js pause), 2 of 3 on each chain, at once
  const pz = M.pausePlan(cfg, ctx.state);
  const gm = (w) => new Contract(cfg.zetaphy.guardian, art('SimpleMultisig').abi, w.connect(zp));
  const gid = await gm(KEYS.g[0]).proposalCount();
  await (await KEYS.g[0].connect(zp).sendTransaction({ to: pz.zetaphy.multisig, data: pz.zetaphy.pause.propose })).wait();
  await (await gm(KEYS.g[1]).confirm(gid)).wait();
  await (await gm(KEYS.g[2]).execute(gid)).wait();
  await viaBase(pz.base.pause.propose);
  if (!(await vault.paused()) || !(await syn.paused())) fail('pause did not pause both ends');
  await (await native.connect(KEYS.liq.connect(zp)).approve(r2.vault, E)).wait();
  await refused('a lock while paused', () => vault.connect(KEYS.liq.connect(zp)).lock.staticCall(KEYS.safe.address, 1n), 'IsPaused');
  await refused('a send-back while paused', () => syn.connect(safe).sendBack.staticCall(KEYS.liq.address, E), 'IsPaused');
  await refused('unpause by a guardian (only the timelock opens)', () => vault.connect(KEYS.g[0].connect(zp)).unpause.staticCall(), 'NotGovernance');
  log('pause: both guardian multisigs paused their end at once (2 of 3); locks and send-backs refused');

  // 9. forged: validly signed messages from a contract that is not the other end
  const body = AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256', 'address', 'address', 'uint256', 'uint256', 'address', 'address'],
    [8453n, r3.synthetic, 99n, dev.address, dev.address, E, 3659n, r2.vault, S.native]);
  const rcF = await (await bMailbox.dispatch(3659, bytes32(r2.vault), body, { value: await bMailbox.quoteDispatch(3659, bytes32(r2.vault), body) })).wait();
  const mF = messageOf(rcF);
  await refused('a release dispatched by a stranger contract on Base (validly signed)', async () => zMailbox.process.staticCall(await signB(mF, KEYS.vb), mF), 'WrongSender');
  const bodyM = AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256', 'address', 'address', 'uint256', 'uint256', 'address', 'address'],
    [3659n, r2.vault, 99n, dev.address, dev.address, E, 8453n, r3.synthetic, S.native]);
  const rcM = await (await zMailbox.dispatch(8453, bytes32(r3.synthetic), bodyM, { value: await zMailbox.quoteDispatch(8453, bytes32(r3.synthetic), bodyM) })).wait();
  const mM = messageOf(rcM);
  await refused('a mint dispatched by a stranger contract on ZETAPHY (validly signed)', async () => bMailbox.process.staticCall(await signZ(mM, KEYS.vz), mM), 'WrongSender');

  // 10. the agents' settings and the gas the deploy used
  const env = M.relayerEnv(cfg, ctx.state), ac = M.agentConfig(cfg, core, { baseFrom: ctx.state.steps['base-roles'].fromBlock });
  if (!env[1].includes(r2.vault.slice(2).toLowerCase()) || ac.chains.zetaphy.mailbox !== core.mailbox) fail('relayer env / agent config');
  const G = M.GAS;
  log(`gas measured: deployer on ZETAPHY ${gz} (estimate ${G.zetaphy.coreHandover + G.zetaphy.ism + G.zetaphy.vault}, core not included), on Base ${gb} (estimate ${G.base.multisig + G.base.timelock + G.base.ism + G.base.synthetic}); the pools ${gpool} (estimate ${BigInt(plans.pools.length) * (2n * G.base.approve + G.base.createPool + G.base.mint)})`);
  log('MAINNET DRY RUN OK: ZTPHY ZETAPHY -> Base -> ZETAPHY, caps, pause, forged messages, the pools; nothing was sent to any real chain');
}

const [cmd] = process.argv.slice(2);
const work = opt('work') ?? fail('--work <dir>');
(cmd === 'prepare' ? prepare(work, opt('local-base') === 'yes') : cmd === 'run' ? run(work) : Promise.reject(new Error('prepare|run --work <dir>')))
  .then(() => process.exit(0), (e) => { console.error(`dry run FAILED: ${e.shortMessage ?? e.message}`); if (process.env.DRY_DEBUG) console.error(e.stack); process.exit(1); });
