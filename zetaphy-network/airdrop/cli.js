#!/usr/bin/env node
// Airdrop list tooling (docs/AIRDROP.md). Nothing here moves coins, signs anything or deploys anything.
//   SWD holders (Solana) -> pro-rata (stage 2):
//   node airdrop/cli.js snapshot --mint <SWD mint> [--rpc URL] [--exclude a,b] > snapshot.json
//   node airdrop/cli.js allocate snapshot.json [--min 1000000] [--cap-bps 100] > allocations.json
//   node airdrop/cli.js merkle allocations.json > merkle.json      (Solana-owner leaves, the stage-2 format)
//   EVM rounds for ZtphyMerkleDistributor (amounts in ZTPHY, decimals allowed; --pool defaults to 200,000,000):
//   node airdrop/cli.js from-csv <file.csv> [--equal | --each Z | --weight score] [--cap Z] [--pool Z] [--min-score N]
//        [--exclude list.txt] [--rpc <URL of the chain the list came from>] [--batch 100] > recipients.json
//   node airdrop/cli.js link-message <solanaOwner> <0xEVM> --chain-id N
//   node airdrop/cli.js link-solana allocations.json links.json --chain-id N > linked.json
//   node airdrop/cli.js merge a.json b.json ... [--pool Z] > round.json
//   node airdrop/cli.js merkle round.json --out <dir> [--chain-id N] [--prefix 3] [--pool Z]
//   node airdrop/cli.js verify <dir> [--rpc URL --distributor 0x…]
//   node airdrop/cli.js init-code <dir> --start <ISO date|unix s> --deadline <ISO|unix> --return-to 0x… [--guardian 0x…]
//        prints the distributor's init code (for `zetaphy pq native deploy <init code>` or any wallet); deploys nothing
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseUnits, formatUnits, getAddress, Interface, ZeroAddress } from 'ethers';
import { takeSnapshot } from './snapshot.js';
import { allocate, POOL } from './allocate.js';
import { buildTree } from './merkle.js';
import { parseRecipients, dropContracts, assignAmounts, reasons } from './recipients.js';
import { linkMessage, linkSolana } from './link.js';
import { buildRound, writeRound, verifyRound } from './distributor.js';

const FLAGS = new Set(['equal']); // options without a value
export function parseArgs(argv) {
  const opt = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { pos.push(argv[i]); continue; }
    const k = argv[i].slice(2);
    opt[k] = FLAGS.has(k) ? true : argv[++i];
  }
  return { opt, pos };
}
const ztphy = (s, name) => {
  if (s == null) return null;
  if (!/^\d+(\.\d{1,18})?$/.test(String(s).replaceAll('_', '').replaceAll(',', ''))) throw new Error(`--${name}: a ZTPHY amount, e.g. 1000 or 0.5`);
  return parseUnits(String(s).replaceAll('_', '').replaceAll(',', ''), 18);
};
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const z = (wei) => `${formatUnits(BigInt(wei), 18)} ZTPHY`;

/** Runs one command; returns the JSON to print (and writes a short report to `log`). */
export async function run(argv, { log = (s) => console.error(s), fetchImpl = globalThis.fetch } = {}) {
  const [cmd, ...rest] = argv;
  const { opt, pos } = parseArgs(rest);
  const pool = ztphy(opt.pool, 'pool') ?? POOL;
  if (cmd === 'snapshot') {
    return takeSnapshot({ mint: opt.mint, rpcUrl: opt.rpc ?? 'https://api.mainnet-beta.solana.com', exclude: opt.exclude ? opt.exclude.split(',') : [], fetchImpl });
  }
  if (cmd === 'allocate') {
    return allocate(readJson(pos[0]), { minAmount: BigInt(opt.min ?? 1), capBps: Number(opt['cap-bps'] ?? 10_000) });
  }
  if (cmd === 'from-csv') {
    if (!pos[0]) throw new Error('from-csv <file.csv>');
    const modes = [opt.equal && 'equal', opt.each != null && 'each', opt.weight != null && 'weight'].filter(Boolean);
    if (modes.length > 1) throw new Error('pick one of --equal, --each, --weight');
    const mode = modes[0] ?? 'given';
    if (mode === 'weight' && !['score', 'weight'].includes(opt.weight)) throw new Error('--weight score (the column to weigh by)');
    const exclude = opt.exclude ? readFileSync(opt.exclude, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
    const parsed = parseRecipients(readFileSync(pos[0], 'utf8'), { exclude, minScore: BigInt(opt['min-score'] ?? 0) });
    let rows = parsed.rows;
    const dropped = [...parsed.dropped];
    if (opt.rpc) {
      const c = await dropContracts(rows, { rpcUrl: opt.rpc, batch: Number(opt.batch ?? 100), fetchImpl });
      rows = c.rows;
      dropped.push(...c.dropped);
    }
    const r = assignAmounts(rows, { mode, pool, each: ztphy(opt.each, 'each'), cap: ztphy(opt.cap, 'cap') });
    const why = reasons(dropped);
    log(`from-csv: ${r.count} recipients, ${z(r.total)} of ${z(r.pool)} (${mode}${opt.cap ? `, cap ${opt.cap} ZTPHY, ${r.capped} capped` : ''}); dropped ${dropped.length}: ${JSON.stringify(why)}${opt.rpc ? '' : ' (contracts NOT checked: pass --rpc)'}`);
    return { source: pos[0], mode, contractsChecked: Boolean(opt.rpc), ...r, droppedCount: dropped.length, droppedByReason: why, dropped };
  }
  if (cmd === 'link-message') {
    return { message: linkMessage(pos[0], pos[1], opt['chain-id']) };
  }
  if (cmd === 'link-solana') {
    if (!pos[0] || !pos[1]) throw new Error('link-solana <allocations.json> <links.json> --chain-id N');
    const links = readJson(pos[1]);
    const r = linkSolana(readJson(pos[0]), Array.isArray(links) ? links : links.links, { chainId: Number(opt['chain-id']) });
    log(`link-solana: ${r.count} EVM recipients (${z(r.total)}) from ${r.linkedOwners} linked Solana owners; ${r.rejected.length} records rejected, ${r.conflicts.length} conflicts, ${r.duplicates} duplicates; unlinked (not paid this round): ${r.unlinked.count} owners, ${z(r.unlinked.total)}`);
    return r;
  }
  if (cmd === 'merge') {
    const sum = new Map();
    for (const f of pos) for (const a of readJson(f).allocations) {
      const k = getAddress(a.address);
      sum.set(k, (sum.get(k) ?? 0n) + BigInt(a.amount));
    }
    const allocations = [...sum].map(([address, amount]) => ({ address, amount: amount.toString() }));
    const total = allocations.reduce((s, a) => s + BigInt(a.amount), 0n);
    if (total > pool) throw new Error(`merged total ${z(total)} is more than the pool ${z(pool)}`);
    log(`merge: ${allocations.length} recipients, ${z(total)} from ${pos.length} files`);
    return { pool: pool.toString(), total: total.toString(), count: allocations.length, sources: pos, allocations };
  }
  if (cmd === 'merkle') {
    const a = readJson(pos[0]);
    if (!a.allocations?.length || !('address' in a.allocations[0])) return { pool: a.pool, ...buildTree(a.allocations) }; // stage-2 Solana format
    if (!opt.out) throw new Error('merkle <round.json> --out <dir> (an EVM round writes summary.json, list.csv and shards/)');
    const t0 = Date.now();
    const round = buildRound(a.allocations, { chainId: opt['chain-id'] ? Number(opt['chain-id']) : null, prefixLen: opt.prefix ? Number(opt.prefix) : undefined, pool: opt.pool ? pool : undefined });
    const s = writeRound(opt.out, round);
    log(`merkle: ${s.count} leaves, ${z(s.total)}, root ${s.root}, depth ${s.depth}, ${s.shards} shards in ${opt.out} (${Date.now() - t0} ms)`);
    return s;
  }
  if (cmd === 'verify') {
    const r = verifyRound(pos[0]);
    if (opt.rpc && opt.distributor) {
      const call = async (data) => (await (await fetchImpl(opt.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: opt.distributor, data }, 'latest'] }) })).json()).result;
      const [root, total, count] = await Promise.all(['0x2eb4a7ab', '0x45f7f249', '0x30e69fc3'].map(call)); // merkleRoot(), totalAllocated(), leafCount()
      if (root?.toLowerCase() !== r.root) r.errors.push(`the distributor's root ${root} is not the list's ${r.root}`);
      if (BigInt(total ?? '0x0').toString() !== r.total) r.errors.push(`the distributor's totalAllocated ${BigInt(total ?? '0x0')} is not the list's ${r.total}`);
      if (Number(BigInt(count ?? '0x0')) !== r.count) r.errors.push(`the distributor's leafCount ${BigInt(count ?? '0x0')} is not the list's ${r.count}`);
      r.ok = r.errors.length === 0;
      r.distributor = opt.distributor;
    }
    log(r.ok ? `verify: OK, ${r.count} leaves, ${z(r.total)}, root ${r.root}` : `verify: FAILED\n  ${r.errors.slice(0, 20).join('\n  ')}`);
    if (!r.ok) process.exitCode = 1;
    return r;
  }
  if (cmd === 'init-code') {
    const s = readJson(`${pos[0]}/summary.json`);
    const when = (v, name) => {
      if (v == null) throw new Error(`--${name} <ISO date or unix seconds>`);
      const n = /^\d+$/.test(v) ? Number(v) : Math.floor(Date.parse(v) / 1000);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`--${name}: not a date`);
      return n;
    };
    const start = when(opt.start, 'start'), deadline = when(opt.deadline, 'deadline');
    if (deadline <= start) throw new Error('--deadline must be after --start');
    if (!opt['return-to']) throw new Error('--return-to 0x… (the community fund / governance address that gets what is left)');
    const returnTo = getAddress(opt['return-to']);
    const guardian = opt.guardian ? getAddress(opt.guardian) : ZeroAddress;
    const art = JSON.parse(readFileSync(new URL('../artifacts/ZtphyMerkleDistributor.json', import.meta.url), 'utf8'));
    const args = [s.root, BigInt(s.total), BigInt(s.count), BigInt(start), BigInt(deadline), returnTo, guardian];
    const initCode = art.bytecode + new Interface(art.abi).encodeDeploy(args).slice(2);
    log(`init-code: root ${s.root}, ${s.count} leaves, ${z(s.total)}, claims ${new Date(start * 1000).toISOString()} .. ${new Date(deadline * 1000).toISOString()}, returnTo ${returnTo}, guardian ${guardian === ZeroAddress ? 'none' : guardian}`);
    return { contract: 'ZtphyMerkleDistributor', args: { root: s.root, totalAllocated: s.total, leafCount: s.count, claimStart: start, claimDeadline: deadline, returnTo, guardian }, initCode };
  }
  throw Object.assign(new Error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 16).join('\n')), { usage: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const out = await run(process.argv.slice(2));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } catch (e) {
    console.error(e.message);
    process.exitCode = e.usage ? 2 : 1;
  }
}
