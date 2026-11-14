#!/usr/bin/env node
// ZETAPHY Saphan MAINNET: the owner's first ZTPHY pools on Base (Uniswap v3). Prints exactly what the liquidity multisig
// (ZETAPHY) and the liquidity Safe (Base) must sign; it never signs or sends anything itself.
// Amounts and tokens: saphan-mainnet.json -> liquidity.pools (owner inputs; default 1,000,000 ZTPHY + 100 USDC and
// 1,000,000 ZTPHY + 100 USDT, 0.0001 USD per ZTPHY). Runbook: docs/SAPHAN-MAINNET.md "Pools on Base".
//
//   node scripts/saphan-pool.js plan [--ztphy 0x<synthetic on Base>] [--out dir] [--live yes] [--deadline <unix s>]
//       [อ่าน] (without --out) / [เปลี่ยนไฟล์] (with --out: writes the files below)
//       (a) bridge: the ZETAPHY tx for the liquidity multisig: approve + lock the total for the Base Safe
//           -> <out>/bridge-zetaphy.unsigned.json (zetaphyd tx sign … --multisig …, 2 of 3, then multisign + broadcast)
//       (b)+(c) per pool: approvals, create + initialise at the owner's price, add full-range liquidity
//           -> <out>/pool-<STABLE>.safe-batch.json (app.safe.global -> Apps -> Transaction Builder -> drag the file)
//       per pool: the initial price, and how far one buy of $10 / $50 moves it (how thin the liquidity is)
//       --live yes: also reads Base (the pool must not exist yet, the Safe's balances and code)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Contract, getAddress, formatUnits } from 'ethers';
import * as M from '../src/saphanmainnet.js';
import * as P from '../src/saphanpool.js';

const say = (...a) => console.log(...a);
const ZERO = '0x' + '00'.repeat(20);

/** Everything the owner signs, for every pool of the config. `ztphy`: the synthetic on Base (state, or --ztphy). */
export function poolPlans(cfg, state, { ztphy = state?.steps?.['base-synthetic']?.synthetic ?? null, deadline = null, recipient = cfg.liquidity.baseRecipient } = {}) {
  const q = cfg.liquidity;
  const out = { warnings: [], pools: [], bridge: null };
  const stand = ztphy ?? '0x' + 'ff'.repeat(20);
  if (!ztphy) out.warnings.push('the synthetic ZTPHY on Base is not deployed yet: token order and calldata below use a placeholder (0xffff…); run again after deploy');
  if (!recipient) out.warnings.push('liquidity.baseRecipient (the Safe on Base) is not set: calldata uses a placeholder recipient');
  const dl = deadline ?? Math.floor(Date.now() / 1000) + 7 * 86400;
  for (const pool of q.pools) {
    if (!pool.address) {
      out.warnings.push(`${pool.stable}: the token address on Base is an owner input (liquidity.pools[].address). Verify it on basescan.org: the contract, name, decimals ${pool.decimals}, and who can mint, freeze or upgrade it. ${pool.issuer ?? ''}`);
      out.pools.push({ stable: pool.stable, missing: 'address', price: Number(pool.stableAmount) / Number(pool.ztphyAmount), impacts: [10, 50].map((buyUsd) => P.priceImpact({ stable: pool.stableAmount, ztphy: pool.ztphyAmount, buyUsd, feeTier: q.feeTier })),
        ztphyAmount: pool.ztphyAmount, stableAmount: pool.stableAmount });
      continue;
    }
    const p = P.poolPlan({ ztphy: stand, pool, feeTier: q.feeTier, slippageBps: q.slippageBps, recipient: recipient ?? '0x' + '11'.repeat(20), positionManager: q.uniswapV3.positionManager, factory: q.uniswapV3.factory, deadline: dl });
    out.pools.push({ ...p, ztphyAmount: pool.ztphyAmount, stableAmount: pool.stableAmount, batch: P.safeBatch({ chainId: cfg.base.chainId, name: `ZTPHY/${pool.stable} pool`, description: `Saphan mainnet: ZTPHY/${pool.stable} Uniswap v3 pool, ${p.priceText}`, txs: p.txs }) });
  }
  try { out.bridge = P.bridgePlan(cfg, state); } catch (e) { out.warnings.push(`bridge: ${e.message}`); }
  return out;
}

/** --live: what Base says now (the pool must not exist; the Safe holds enough). */
export async function liveChecks(cfg, plans, bp) {
  const q = cfg.liquidity, f = new Contract(q.uniswapV3.factory, P.FACTORY, bp), notes = [];
  for (const p of plans.pools.filter((x) => x.token0)) {
    const pool = await f.getPool(p.token0, p.token1, q.feeTier);
    if (pool !== ZERO) {
      const [sqrt] = await new Contract(pool, P.POOL, bp).slot0();
      notes.push(`${p.stable}: a ZTPHY/${p.stable} ${q.feeTier} pool EXISTS at ${pool} (sqrtPriceX96 ${sqrt}${String(sqrt) === p.sqrtPriceX96 ? ', our price' : `, NOT our ${p.sqrtPriceX96}`}): the mint's minimums refuse a wrong price; do not lower them`);
    } else notes.push(`${p.stable}: no pool yet (good)`);
    if (q.baseRecipient) {
      for (const [tok, need, sym] of [[p.ztphy, BigInt(p.token0 === p.ztphy ? p.amount0 : p.amount1), 'ZTPHY'], [p.stableAddress, BigInt(p.token0 === p.stableAddress ? p.amount0 : p.amount1), p.stable]]) {
        const bal = await new Contract(tok, P.ERC20, bp).balanceOf(q.baseRecipient).catch(() => null);
        notes.push(`  the Safe holds ${bal == null ? '?' : bal} of ${sym} (needs ${need})${bal != null && bal < need ? '  <- NOT ENOUGH' : ''}`);
      }
    }
  }
  if (q.baseRecipient && (await bp.getCode(q.baseRecipient)) === '0x') notes.push(`liquidity.baseRecipient ${q.baseRecipient} has NO code on Base: create the Safe first (a plain key would hold everything alone)`);
  return notes;
}

function printPlans(cfg, x) {
  say('== Saphan mainnet: ZTPHY pools on Base (Uniswap v3)');
  for (const w of x.warnings) say(`WARNING: ${w}`);
  const total = cfg.liquidity.pools.reduce((s, p) => s + M.units(p.ztphyAmount, 18), 0n);
  say(`\n(a) [เปลี่ยนเชน] bridge ${formatUnits(total, 18)} ZTPHY from the liquidity multisig ${cfg.liquidity.zetaphyMultisig} (ZETAPHY) to the Safe on Base ${cfg.liquidity.baseRecipient ?? '(not set)'}`);
  if (x.bridge) {
    say(`    one Cosmos tx, signed by 2 of 3 members (sender ${x.bridge.sender}):`);
    for (const c of x.bridge.calls) say(`      MsgEVMCall to ${c.to}  ${c.what}\n        data ${c.data}`);
    say(`    then on Base, after the mint delay (${cfg.token.limits.mintDelay} s): anyone sends claim(<id>) to ${x.bridge.claim.to ?? 'the synthetic'} (id: the Queued event of the delivery)`);
    say(`    caps: lockCap ${cfg.token.limits.lockCap}, mint ${cfg.token.limits.mintDailyLimit}/day: ${formatUnits(total, 18)} fits in one day`);
  }
  for (const p of x.pools) {
    say(`\n(b)+(c) [เปลี่ยนเชน] ZTPHY/${p.stable}: ${p.ztphyAmount} ZTPHY + ${p.stableAmount} ${p.stable}`);
    say(`  initial price: ${p.priceText ?? `${p.price} ${p.stable} per ZTPHY`}`);
    for (const l of P.impactLines(p)) say(l);
    if (p.missing) { say(`  calldata: not built (${p.stable} address missing)`); continue; }
    say(`  token0 ${p.token0}, token1 ${p.token1}, fee ${p.feeTier}, sqrtPriceX96 ${p.sqrtPriceX96}, ticks ${p.tickLower}..${p.tickUpper} (full range)`);
    say(`  the Safe signs, in this order (one batch):`);
    for (const t of p.txs) say(`    to ${t.to}: ${t.what}\n      data ${t.data}`);
  }
  say('\nThin pools: with $100 a side, small buys move the price a lot (above). Anyone can trade against them at once; arbitrage between the two pools keeps them close.');
}

function args(argv) { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; return o; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'plan', ...rest] = process.argv.slice(2);
  const o = args(rest);
  (async () => {
    if (cmd !== 'plan') throw new Error('usage: saphan-pool.js plan [--ztphy 0x…] [--out dir] [--live yes]');
    const cfg = M.loadMainnet(), state = M.loadState();
    const x = poolPlans(cfg, state, { ztphy: o.ztphy ? getAddress(o.ztphy) : undefined, deadline: o.deadline ? Number(o.deadline) : null });
    printPlans(cfg, x);
    if (o.live === 'yes') {
      const { providerFor } = await import('./saphan.js');
      for (const n of await liveChecks(cfg, x, await providerFor(process.env.BASE_RPC || cfg.base.rpc.join(','), cfg.base.chainId))) say(`live: ${n}`);
    }
    if (o.out) {
      mkdirSync(o.out, { recursive: true });
      const wrote = [];
      if (x.bridge) { writeFileSync(join(o.out, 'bridge-zetaphy.unsigned.json'), JSON.stringify(x.bridge.unsigned, null, 2) + '\n'); wrote.push('bridge-zetaphy.unsigned.json'); }
      for (const p of x.pools.filter((y) => y.batch)) { writeFileSync(join(o.out, `pool-${p.stable}.safe-batch.json`), JSON.stringify(p.batch, null, 2) + '\n'); wrote.push(`pool-${p.stable}.safe-batch.json`); }
      say(`\nwrote ${wrote.map((w) => join(o.out, w)).join(', ') || 'nothing (inputs missing)'}`);
    }
    process.exit(0);
  })().catch((e) => { console.error(`error: ${e.shortMessage ?? e.message}`); process.exit(1); });
}
