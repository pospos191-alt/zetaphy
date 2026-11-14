// Recipients of an EVM airdrop round from a CSV (docs/AIRDROP.md):
//   - a sign-up / registration export: address[,amount]           (amount in ZTPHY, or amount_wei in base units)
//   - the public-chain query (queries/active-evm-wallets.sql):     address,score
// Cleans the list (format, EIP-55 checksum, duplicates, zero / precompile / known non-user addresses, an
// optional exclude list, optionally contracts via eth_getCode), then gives amounts: given, equal split of the
// pool, a fixed amount each, or pro-rata to a weight column, with a per-address cap. Integer math only.
// Only addresses are read and written; any other column is ignored.

import { getAddress, parseUnits, sha256, toUtf8Bytes, dataSlice } from 'ethers';
import { allocate, POOL } from './allocate.js';

export { POOL };
const ADDR = /^0x[0-9a-fA-F]{40}$/;
/** Addresses that are never a person: burn and placeholder addresses (lower case). Precompiles: anything below 0x10000. */
export const KNOWN_NON_USERS = new Set([
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // "native coin" placeholder of many apps
  '0xffffffffffffffffffffffffffffffffffffffff',
]);
/**
 * ZETAPHY system addresses that are never a recipient of a push (gov.sh airdrop): the app's module accounts
 * (address = sha256(module name)[:20]; the bank refuses coins sent to them, which fails a whole MsgMultiSend) and the
 * EVM preinstalls in its genesis (cosmos/evm v0.7.3 DefaultPreinstalls, contracts on ZETAPHY).
 */
export const MODULE_NAMES = ['fee_collector', 'distribution', 'mint', 'bonded_tokens_pool', 'not_bonded_tokens_pool', 'gov',
  'transfer', 'evm', 'feemarket', 'erc20', 'precisebank', 'wasm', 'ratelimit'];
export const PREINSTALLS = ['0x4e59b44847b379578588920cA78FbF26c0B4956C', '0xcA11bde05977b3631167028862bE2a173976CA11',
  '0x000000000022D473030F116dDEE9F6B43aC78BA3', '0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7', '0x0000F90827F1C53a10cb7A02335B175320002935'];
export const moduleAddress = (name) => getAddress(dataSlice(sha256(toUtf8Bytes(name)), 0, 20));
export const SYSTEM_ADDRESSES = new Set([...MODULE_NAMES.map(moduleAddress), ...PREINSTALLS].map((a) => a.toLowerCase()));
const RESERVED_BELOW = 0x10000n; // Ethereum precompiles 0x01-0x11 and ZETAPHY's (0x…0100, 0x…0800-0x…0900) live here

/** Splits CSV text into rows of cells (quotes removed; no embedded commas are expected in these files). */
export function csvRows(text) {
  return text.replace(/^﻿/, '').split(/\r?\n/).map((l, i) => ({ line: i + 1, cells: l.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim()) }))
    .filter((r) => r.cells.some((c) => c !== ''));
}

/** Why an address is not a recipient (null: it is fine). */
export function addressProblem(raw) {
  if (!ADDR.test(raw)) return 'bad-address';
  const body = raw.slice(2);
  if (body !== body.toLowerCase() && body !== body.toUpperCase()) {
    try { if (getAddress(raw) !== raw) return 'bad-checksum'; } catch { return 'bad-checksum'; }
  }
  const n = BigInt(raw);
  if (n === 0n) return 'zero-address';
  if (KNOWN_NON_USERS.has(raw.toLowerCase())) return 'known-non-user';
  if (n < RESERVED_BELOW) return 'precompile-or-reserved';
  return null;
}

/**
 * Parses and cleans a recipients CSV.
 * @param {string} text
 * @param {{exclude?: Iterable<string>, minScore?: bigint}} [o]
 * @returns {{rows: Array<{address:string, line:number, amount?:bigint, score?:bigint}>, dropped: Array<{line:number, value:string, reason:string}>, columns:string[]}}
 */
export function parseRecipients(text, { exclude = [], minScore = 0n } = {}) {
  const all = csvRows(text);
  if (!all.length) throw new Error('empty CSV');
  let columns = ['address', 'amount'];
  let body = all;
  if (!ADDR.test(all[0].cells[0])) { columns = all[0].cells.map((c) => c.toLowerCase()); body = all.slice(1); }
  const col = (...names) => columns.findIndex((c) => names.includes(c));
  const ai = col('address', 'wallet', 'account', 'evm', 'from_address');
  if (ai < 0) throw new Error(`no address column (have: ${columns.join(', ')})`);
  const amt = col('amount', 'ztphy'), wei = col('amount_wei'), sc = col('score', 'weight');
  const ex = new Set([...exclude].map((a) => String(a).trim().toLowerCase()));
  const seen = new Set();
  const rows = [];
  const dropped = [];
  for (const { line, cells } of body) {
    const value = cells[ai] ?? '';
    const bad = addressProblem(value);
    if (bad) { dropped.push({ line, value, reason: bad }); continue; }
    const k = value.toLowerCase();
    if (ex.has(k)) { dropped.push({ line, value, reason: 'excluded' }); continue; }
    if (seen.has(k)) { dropped.push({ line, value, reason: 'duplicate' }); continue; }
    const row = { address: getAddress(value), line };
    try {
      if (wei >= 0 && cells[wei]) { if (!/^\d+$/.test(cells[wei])) throw new Error(); row.amount = BigInt(cells[wei]); }
      else if (amt >= 0 && cells[amt]) row.amount = parseUnits(cells[amt], 18);
      if (sc >= 0) { if (!/^\d+$/.test(cells[sc] ?? '')) throw new Error(); row.score = BigInt(cells[sc]); }
    } catch { dropped.push({ line, value, reason: 'bad-number' }); continue; }
    if (row.amount != null && row.amount <= 0n) { dropped.push({ line, value, reason: 'zero-amount' }); continue; }
    if (row.score != null && row.score < minScore) { dropped.push({ line, value, reason: 'below-min-score' }); continue; }
    seen.add(k);
    rows.push(row);
  }
  return { rows, dropped, columns };
}

/** EIP-7702: an EOA that delegated to code has code 0xef0100 || address; it is still a person's key, so it stays. */
export const isDelegatedEoa = (code) => /^0xef0100[0-9a-fA-F]{40}$/.test(code);

/**
 * Drops contracts (eth_getCode != 0x, except EIP-7702 delegations) using JSON-RPC batches on the chain the list
 * came from. Read-only. A failed or missing answer stops the run (never guesses).
 */
const RETRYABLE = /rate|limit|too many|capacity|busy|timeout|temporar|try again/i;

/**
 * Drops every address that has code on the public chain (a contract has no key on ZETAPHY). Public RPCs rate-limit a
 * 100,000-address run, so a batch that gets HTTP 429/5xx, a non-JSON answer or a rate-limit error is retried with a
 * growing wait (retries, default 8; waits from retryMs, default 2 s, doubling, at most 60 s); pauseMs waits between
 * batches. rpcUrl may be a comma-separated list: batches rotate over them. Any other error stops the run.
 */
export async function dropContracts(rows, { rpcUrl, batch = 100, fetchImpl = globalThis.fetch, block = 'latest', retries = 8, retryMs = 2000, pauseMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry } = {}) {
  const urls = String(rpcUrl).split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.length) throw new Error('dropContracts: no RPC URL');
  const keep = [];
  const dropped = [];
  for (let i = 0, n = 0; i < rows.length; i += batch, n++) {
    const part = rows.slice(i, i + batch);
    const payload = JSON.stringify(part.map((r, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getCode', params: [r.address, block] })));
    let byId;
    for (let attempt = 0; ; attempt++) {
      const url = urls[(n + attempt) % urls.length];
      let why = null;
      try {
        const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
        if (res.status === 429 || res.status >= 500) why = `HTTP ${res.status}`;
        else {
          let body;
          try { body = await res.json(); } catch { why = `HTTP ${res.status}, not JSON`; }
          if (!why) {
            const list = Array.isArray(body) ? body : [body];
            const bad = list.find((x) => x?.error && RETRYABLE.test(String(x.error.message)));
            if (bad) why = bad.error.message;
            else byId = new Map(list.map((x) => [x.id, x]));
          }
        }
      } catch (e) { why = e.message; }
      if (!why) break;
      if (attempt >= retries) throw new Error(`eth_getCode batch ${n + 1} (from ${part[0].address}): ${why} (gave up after ${retries} retries)`);
      const wait = Math.min(retryMs * 2 ** attempt, 60_000);
      onRetry?.({ batch: n + 1, attempt: attempt + 1, wait, why, url });
      await sleep(wait);
    }
    part.forEach((r, j) => {
      const a = byId.get(j);
      if (!a || a.error || typeof a.result !== 'string') throw new Error(`eth_getCode ${r.address}: ${a?.error?.message ?? 'no answer'}`);
      if (a.result === '0x' || isDelegatedEoa(a.result)) keep.push(r); else dropped.push({ line: r.line, value: r.address, reason: 'contract' });
    });
    if (pauseMs && i + batch < rows.length) await sleep(pauseMs);
  }
  return { rows: keep, dropped };
}

/**
 * Gives amounts. Modes:
 *   given   the CSV's amount column (total must fit the pool)
 *   equal   pool / count each (cap applies)
 *   each    a fixed amount each (count x each must fit the pool)
 *   weight  pro-rata to the score column, capped per address (water-filling: the capped get the cap, the rest share)
 * @returns {{pool:string, total:string, count:number, unallocated:string, allocations:Array<{address:string, amount:string}>, capped:number}}
 */
export function assignAmounts(rows, { mode, pool = POOL, each, cap } = {}) {
  pool = BigInt(pool);
  cap = cap != null ? BigInt(cap) : null;
  let out;
  let capped = 0;
  const capIt = (a) => (cap != null && a > cap ? (capped++, cap) : a);
  if (mode === 'given') {
    if (rows.some((r) => r.amount == null)) throw new Error('mode "given": every row needs an amount (or use --equal / --each / --weight)');
    out = rows.map((r) => ({ address: r.address, amount: capIt(r.amount) }));
  } else if (mode === 'equal') {
    if (!rows.length) throw new Error('no recipients');
    const base = pool / BigInt(rows.length);
    const per = cap != null && base > cap ? cap : base;
    capped = per !== base ? rows.length : 0;
    out = rows.map((r) => ({ address: r.address, amount: per }));
  } else if (mode === 'each') {
    const per = BigInt(each);
    out = rows.map((r) => ({ address: r.address, amount: per }));
  } else if (mode === 'weight') {
    if (rows.some((r) => r.score == null)) throw new Error('mode "weight": the CSV needs a score column');
    const r = allocate({ holders: rows.map((x) => ({ owner: x.address, amount: x.score })) }, { pool, minAmount: 0n, ...(cap != null ? { cap } : {}) });
    out = r.allocations.map((a) => ({ address: a.owner, amount: BigInt(a.zetaphy) }));
    if (cap != null) capped = out.filter((a) => a.amount === cap).length;
  } else throw new Error(`unknown mode ${mode}`);
  out = out.filter((a) => a.amount > 0n);
  const total = out.reduce((s, a) => s + a.amount, 0n);
  if (total > pool) throw new Error(`the amounts add up to ${total}, more than the pool ${pool}`);
  return { pool: pool.toString(), total: total.toString(), count: out.length, unallocated: (pool - total).toString(), capped,
    allocations: out.map((a) => ({ address: a.address, amount: a.amount.toString() })) };
}

/** Counts per reason, for the report. */
export const reasons = (dropped) => dropped.reduce((m, d) => ({ ...m, [d.reason]: (m[d.reason] ?? 0) + 1 }), {});
