#!/usr/bin/env node
// ZETAPHY Saphan MAINNET: the owner's first ZTPHY pools on each route (Uniswap v3 on Base and Arbitrum One, PancakeSwap
// v3 on BNB Smart Chain). Prints exactly what the liquidity multisig (ZETAPHY) and the route's liquidity Safe must sign;
// it never signs or sends anything itself.
// Amounts and tokens: saphan-mainnet.json -> liquidity.pools (Base) / destinations.<route>.liquidity.pools (owner inputs;
// default 500,000 ZTPHY + 50 USDC on Base and Arbitrum, + 50 USDT on BSC, 0.0001 USD per ZTPHY). Runbook: docs/SAPHAN-MAINNET.md.
//
//   node scripts/saphan-pool.js plan [--route base|bsc|arbitrum] [--ztphy 0x<the route's synthetic>] [--out dir] [--live yes] [--deadline <unix s>]
//       [อ่าน] (without --out) / [เปลี่ยนไฟล์] (with --out: writes the files below)
//       (a) bridge: the ZETAPHY tx for the liquidity multisig: approve + lock the total for the Base Safe
//           -> <out>/bridge-zetaphy[-<route>].unsigned.json (zetaphyd tx sign … --multisig …, 2 of 3, then multisign + broadcast)
//       (b)+(c) per pool: approvals, create + initialise at the owner's price, add full-range liquidity
//           -> <out>/pool[-<route>]-<STABLE>.safe-batch.json (app.safe.global -> Apps -> Transaction Builder -> drag the file)
//       per pool: the initial price, and how far one buy of $10 / $50 moves it (how thin the liquidity is)
//       --live yes: also reads the route's chain (<ROUTE>_RPC overrides the config's RPCs) (the pool must not exist yet, the Safe's balances and code)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Contract, getAddress, formatUnits } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import * as P from '../src/saphanpool.js';

const say = (...a) => console.log(...a);
const ZERO = '0x' + '00'.repeat(20);

/** Everything the owner signs, for every pool of a route. `ztphy`: the route's synthetic (state, or --ztphy). */
export function poolPlans(cfg, state, { route: name = 'base', ztphy, deadline = null, recipient } = {}) {
  const r = M.route(cfg, name), q = r.liquidity, D = r.displayName;
  ztphy = ztphy === undefined ? (state?.steps?.[r.steps.synthetic]?.synthetic ?? null) : ztphy;
  recipient = recipient === undefined ? q.recipient : recipient;
  const out = { route: name, displayName: D, dex: q.dex, warnings: [], pools: [], bridge: null };
  if (!r.enabled) out.warnings.push(`route ${name} is disabled (${r.at.entry}.enabled: false): prepared only; nothing here will be signed`);
  const stand = ztphy ?? '0x' + 'ff'.repeat(20);
  if (!ztphy) out.warnings.push(`the synthetic ZTPHY on ${D} is not deployed yet: token order and calldata below use a placeholder (0xffff…); run again after deploy`);
  if (!recipient) out.warnings.push(`${r.at.recipient} (the Safe on ${D}) is not set: calldata uses a placeholder recipient`);
  const host = String(r.explorer ?? '').replace(/^https:\/\//, '') || 'the explorer';
  const dl = deadline ?? Math.floor(Date.now() / 1000) + 7 * 86400;
  for (const pool of q.pools) {
    if (!pool.address) {
      out.warnings.push(`${pool.stable}: the token address on ${D} is an owner input (${r.at.pools}[].address). Verify it on ${host}: the contract, name, decimals ${pool.decimals}, and who can mint, freeze or upgrade it. ${pool.issuer ?? ''}`);
      out.pools.push({ stable: pool.stable, missing: 'address', price: Number(pool.stableAmount) / Number(pool.ztphyAmount), impacts: [10, 50].map((buyUsd) => P.priceImpact({ stable: pool.stableAmount, ztphy: pool.ztphyAmount, buyUsd, feeTier: q.feeTier })),
        ztphyAmount: pool.ztphyAmount, stableAmount: pool.stableAmount });
      continue;
    }
    const p = P.poolPlan({ ztphy: stand, pool, feeTier: q.feeTier, slippageBps: q.slippageBps, recipient: recipient ?? '0x' + '11'.repeat(20), positionManager: q.positionManager, factory: q.factory, deadline: dl, dex: q.dex, chain: D });
    const label = M.DEXES[q.dex].label;
    out.pools.push({ ...p, ztphyAmount: pool.ztphyAmount, stableAmount: pool.stableAmount, batch: P.safeBatch({ chainId: r.chainId, name: `ZTPHY/${pool.stable} pool`, description: `Saphan mainnet: ZTPHY/${pool.stable} ${label} pool on ${D}, ${p.priceText}`, txs: p.txs }) });
  }
  try { out.bridge = P.bridgePlan(cfg, state, name); } catch (e) { out.warnings.push(`bridge: ${e.message}`); }
  return out;
}

/** --live: what the route's chain says now (the pool must not exist; the Safe holds enough; the fee tier is open). */
export async function liveChecks(cfg, plans, bp, name = plans.route ?? 'base') {
  const r = M.route(cfg, name), q = r.liquidity, f = new Contract(q.factory, P.FACTORY, bp), notes = [], D = r.displayName;
  const spacing = await f.feeAmountTickSpacing(q.feeTier).then(Number, () => null);
  notes.push(`${M.DEXES[q.dex].label} factory ${q.factory}: fee ${q.feeTier} has tick spacing ${spacing}${spacing === M.DEXES[q.dex].tickSpacing[q.feeTier] ? ' (as planned)' : `  <- NOT the planned ${M.DEXES[q.dex].tickSpacing[q.feeTier]}`}`);
  for (const p of plans.pools.filter((x) => x.token0)) {
    const pool = await f.getPool(p.token0, p.token1, q.feeTier);
    if (pool !== ZERO) {
      const [sqrt] = await new Contract(pool, P.POOL, bp).slot0();
      notes.push(`${p.stable}: a ZTPHY/${p.stable} ${q.feeTier} pool EXISTS at ${pool} (sqrtPriceX96 ${sqrt}${String(sqrt) === p.sqrtPriceX96 ? ', our price' : `, NOT our ${p.sqrtPriceX96}`}): the mint's minimums refuse a wrong price; do not lower them`);
    } else notes.push(`${p.stable}: no pool yet (good)`);
    if (q.recipient) {
      for (const [tok, need, sym] of [[p.ztphy, BigInt(p.token0 === p.ztphy ? p.amount0 : p.amount1), 'ZTPHY'], [p.stableAddress, BigInt(p.token0 === p.stableAddress ? p.amount0 : p.amount1), p.stable]]) {
        const bal = await new Contract(tok, P.ERC20, bp).balanceOf(q.recipient).catch(() => null);
        notes.push(`  the Safe holds ${bal == null ? '?' : bal} of ${sym} (needs ${need})${bal != null && bal < need ? '  <- NOT ENOUGH' : ''}`);
      }
    }
  }
  if (q.recipient && (await bp.getCode(q.recipient)) === '0x') notes.push(`${r.at.recipient} ${q.recipient} has NO code on ${D}: create the Safe there first (a plain key would hold everything alone)`);
  return notes;
}

function printPlans(cfg, x) {
  const r = M.route(cfg, x.route), D = r.displayName, sym = r.liquidity.pools.map((p) => p.stable).join('/');
  say(`== Saphan mainnet: ZTPHY pools on ${D} (${M.DEXES[r.liquidity.dex]?.label ?? r.liquidity.dex})`);
  for (const w of x.warnings) say(`WARNING: ${w}`);
  const total = r.liquidity.pools.reduce((s, p) => s + M.units(p.ztphyAmount, 18), 0n);
  say(`\n(a) [เปลี่ยนเชน] bridge ${formatUnits(total, 18)} ZTPHY from the liquidity multisig ${cfg.liquidity.zetaphyMultisig} (ZETAPHY) to the Safe on ${D} ${r.liquidity.recipient ?? '(not set)'}`);
  if (x.bridge) {
    say(`    one Cosmos tx, signed by 2 of 3 members (sender ${x.bridge.sender}):`);
    for (const c of x.bridge.calls) say(`      MsgEVMCall to ${c.to}  ${c.what}\n        data ${c.data}`);
    say(`    then on ${D}, after the mint delay (${r.limits.mintDelay} s): anyone sends claim(<id>) to ${x.bridge.claim.to ?? 'the synthetic'} (id: the Queued event of the delivery)`);
    say(`    caps: lockCap ${r.limits.lockCap}, mint ${r.limits.mintDailyLimit}/day: ${formatUnits(total, 18)} fits in one day`);
  }
  for (const p of x.pools) {
    say(`\n(b)+(c) [เปลี่ยนเชน] ZTPHY/${p.stable}: ${p.ztphyAmount} ZTPHY + ${p.stableAmount} ${p.stable}${p.stableDecimals != null ? ` (${p.stable} has ${p.stableDecimals} decimals on ${D})` : ''}`);
    say(`  initial price: ${p.priceText ?? `${p.price} ${p.stable} per ZTPHY`}`);
    for (const l of P.impactLines(p)) say(l);
    if (p.missing) { say(`  calldata: not built (${p.stable} address missing)`); continue; }
    say(`  token0 ${p.token0}, token1 ${p.token1}, fee ${p.feeTier}, sqrtPriceX96 ${p.sqrtPriceX96}, ticks ${p.tickLower}..${p.tickUpper} (full range)`);
    say(`  the Safe signs, in this order (one batch):`);
    for (const t of p.txs) say(`    to ${t.to}: ${t.what}\n      data ${t.data}`);
  }
  say(`\nThin pools: with ${sym} ${r.liquidity.pools.map((p) => p.stableAmount).join('/')} a side, small buys move the price a lot (above). Anyone can trade against them at once. ZTPHY on ${D} is its own synthetic: its pools are a separate market from the other chains' pools.`);
}

function args(argv) { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; return o; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'plan', ...rest] = process.argv.slice(2);
  const o = args(rest);
  (async () => {
    if (cmd !== 'plan') throw new Error('usage: saphan-pool.js plan [--route base|bsc|arbitrum|…] [--ztphy 0x…] [--out dir] [--live yes]');
    const cfg = M.loadMainnet(), state = M.loadState(), name = o.route ?? 'base', r = M.route(cfg, name);
    const x = poolPlans(cfg, state, { route: name, ztphy: o.ztphy ? getAddress(o.ztphy) : undefined, deadline: o.deadline ? Number(o.deadline) : null });
    printPlans(cfg, x);
    if (o.live === 'yes') {
      const { providerFor } = await import('./saphan.js');
      const url = process.env[`${name.toUpperCase()}_RPC`] || r.rpc.join(',');
      for (const n of await liveChecks(cfg, x, await providerFor(url, r.chainId), name)) say(`live: ${n}`);
    }
    if (o.out) {
      mkdirSync(o.out, { recursive: true });
      const wrote = [];
      const sfx = name === 'base' ? '' : `-${name}`; // Base keeps its file names
      if (x.bridge) { writeFileSync(join(o.out, `bridge-zetaphy${sfx}.unsigned.json`), JSON.stringify(x.bridge.unsigned, null, 2) + '\n'); wrote.push(`bridge-zetaphy${sfx}.unsigned.json`); }
      for (const p of x.pools.filter((y) => y.batch)) { writeFileSync(join(o.out, `pool${sfx}-${p.stable}.safe-batch.json`), JSON.stringify(p.batch, null, 2) + '\n'); wrote.push(`pool${sfx}-${p.stable}.safe-batch.json`); }
      say(`\nwrote ${wrote.map((w) => join(o.out, w)).join(', ') || 'nothing (inputs missing)'}`);
    }
    process.exit(0);
  })().catch((e) => { console.error(`error: ${e.shortMessage ?? e.message}`); process.exit(1); });
}
