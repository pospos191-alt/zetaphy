// The list of a ZtphyMerkleDistributor round (contracts/ZtphyMerkleDistributor.sol, docs/AIRDROP.md):
// EVM accounts and native ZTPHY amounts, the Merkle root the contract holds, and the files to publish.
//   leaf   = keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount))))
//   parent = keccak256(sorted pair)  (an odd node at the end of a layer moves up unchanged)
// Index = position in the list sorted by lower-case address, so the same allocations always give the same root.
//
// Published directory (static files, nothing secret):
//   summary.json            root, count, total, sha256 of list.csv, how leaves are made, the shard prefix length
//   list.csv                index,address,amount (amount in base units, 18 decimals) - the whole list, for anyone to check
//   shards/<hex prefix>.json  { root, claims: { <lower-case address>: { index, amount, proof } } }, the claim page reads one

import { keccak_256 } from '@noble/hashes/sha3.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'ethers';

export const LEAF_ENCODING = 'keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount))))';
const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;
const word = (v) => Buffer.from(BigInt(v).toString(16).padStart(64, '0'), 'hex');

/** The leaf of (index, account, amount) as bytes (the contract's leafOf). */
export function leafBytes(index, account, amount) {
  const enc = Buffer.concat([word(index), word(BigInt(account)), word(amount)]);
  return keccak_256(keccak_256(enc));
}
export const leafHash = (index, account, amount) => hex(leafBytes(index, account, amount));

const pairBytes = (a, b) => keccak_256(Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a]));

/** Allocations -> the indexed list (sorted by address, checksummed, no duplicates, no zero amounts). */
export function indexList(allocations) {
  const seen = new Set();
  const rows = allocations.map((a) => {
    const address = getAddress(a.address);
    const amount = BigInt(a.amount);
    if (amount <= 0n) throw new Error(`zero amount for ${address}`);
    const k = address.toLowerCase();
    if (seen.has(k)) throw new Error(`duplicate address ${address}`);
    seen.add(k);
    return { address, amount };
  }).sort((x, y) => (x.address.toLowerCase() < y.address.toLowerCase() ? -1 : 1));
  return rows.map((r, index) => ({ index, ...r }));
}

/** The whole tree over an indexed list: { root, layers, proofOf(i) } (layers of 32-byte Uint8Arrays). */
export function buildDistributorTree(list) {
  if (!list.length) throw new Error('empty list');
  const layers = [list.map((r) => leafBytes(r.index, r.address, r.amount))];
  while (layers.at(-1).length > 1) {
    const prev = layers.at(-1);
    const next = new Array(Math.ceil(prev.length / 2));
    for (let i = 0; i < prev.length; i += 2) next[i >> 1] = i + 1 < prev.length ? pairBytes(prev[i], prev[i + 1]) : prev[i];
    layers.push(next);
  }
  const proofOf = (index) => {
    const proof = [];
    for (let l = 0, i = index; l < layers.length - 1; l++, i >>= 1) {
      const sib = i ^ 1;
      if (sib < layers[l].length) proof.push(hex(layers[l][sib]));
    }
    return proof;
  };
  return { root: hex(layers.at(-1)[0]), depth: layers.length - 1, proofOf };
}

/** Root a proof leads to (the contract's verifyProof, without the comparison). */
export function processProof(index, account, amount, proof) {
  let h = leafBytes(index, account, amount);
  for (const p of proof) h = pairBytes(h, Buffer.from(p.slice(2), 'hex'));
  return hex(h);
}
export const verifyClaim = (root, c) => processProof(c.index, c.address, c.amount, c.proof) === root.toLowerCase();

export const listCsv = (list) => `index,address,amount\n${list.map((r) => `${r.index},${r.address},${r.amount}`).join('\n')}\n`;
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
/** Hex characters of the shard key: about <= 256 claims per shard (100,000 people -> 3, i.e. 4096 files of ~30 KB). */
export const autoPrefix = (n) => Math.max(1, Math.min(6, Math.ceil(Math.log(Math.max(n, 1) / 256) / Math.log(16))));
export const shardKey = (address, prefixLen) => address.toLowerCase().slice(2, 2 + prefixLen);

/**
 * Everything to publish for a list, in memory: { summary, csv, shards: {key: {...}} }.
 * @param {Array<{address:string, amount:string|bigint}>} allocations
 * @param {{chainId?:number, prefixLen?:number, pool?:bigint}} [o]
 */
export function buildRound(allocations, { chainId = null, prefixLen, pool } = {}) {
  const list = indexList(allocations);
  const total = list.reduce((s, r) => s + r.amount, 0n);
  if (pool != null && total > BigInt(pool)) throw new Error(`total ${total} is more than the pool ${pool}`);
  const tree = buildDistributorTree(list);
  const p = prefixLen ?? autoPrefix(list.length);
  const shards = {};
  for (const r of list) {
    const k = shardKey(r.address, p);
    (shards[k] ??= { root: tree.root, claims: {} }).claims[r.address.toLowerCase()] = { index: r.index, amount: r.amount.toString(), proof: tree.proofOf(r.index) };
  }
  const csv = listCsv(list);
  const summary = {
    kind: 'zetaphy-airdrop-round', version: 1, chainId, root: tree.root, count: list.length, total: total.toString(),
    depth: tree.depth, leaf: LEAF_ENCODING, pairs: 'keccak256 of the sorted pair; an odd last node moves up unchanged',
    order: 'index = position after sorting by lower-case address', listFile: 'list.csv', listSha256: sha256(csv),
    shardPrefixLength: p, shards: Object.keys(shards).length, shardPath: 'shards/<first N hex chars of the lower-case address, without 0x>.json',
  };
  return { summary, csv, shards, list, tree };
}

/** Writes a round to a directory; returns its summary. */
export function writeRound(dir, round) {
  mkdirSync(join(dir, 'shards'), { recursive: true });
  writeFileSync(join(dir, 'list.csv'), round.csv);
  for (const [k, s] of Object.entries(round.shards)) writeFileSync(join(dir, 'shards', `${k}.json`), JSON.stringify(s));
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(round.summary, null, 2)}\n`);
  return round.summary;
}

/** Parses a published list.csv strictly (header, consecutive indices, checksummed addresses, positive amounts). */
export function parseListCsv(csv) {
  const lines = csv.split('\n');
  if (lines[0] !== 'index,address,amount') throw new Error('list.csv: header must be index,address,amount');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '' && i === lines.length - 1) break;
    const m = /^(\d+),(0x[0-9a-fA-F]{40}),(\d+)$/.exec(lines[i]);
    if (!m) throw new Error(`list.csv line ${i + 1}: not index,address,amount`);
    if (Number(m[1]) !== out.length) throw new Error(`list.csv line ${i + 1}: index ${m[1]}, expected ${out.length}`);
    if (getAddress(m[2]) !== m[2]) throw new Error(`list.csv line ${i + 1}: address not in checksum form`);
    out.push({ index: out.length, address: m[2], amount: BigInt(m[3]) });
  }
  return out;
}

/**
 * Checks a published directory from scratch: list.csv hash, order, uniqueness, total, count, root, and (unless
 * shards:false) that every shard entry is the list's row with a proof to the root and every row is in its shard.
 * @returns {{ok:boolean, errors:string[], root:string, count:number, total:string}}
 */
export function verifyRound(dir, { shards: checkShards = true } = {}) {
  const errors = [];
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  const csv = readFileSync(join(dir, summary.listFile ?? 'list.csv'), 'utf8');
  if (sha256(csv) !== summary.listSha256) errors.push(`list.csv sha256 ${sha256(csv)} is not the summary's ${summary.listSha256}`);
  let list = [];
  try { list = parseListCsv(csv); } catch (e) { errors.push(e.message); }
  const again = list.length ? indexList(list.map((r) => ({ address: r.address, amount: r.amount }))) : [];
  if (again.some((r, i) => r.address !== list[i].address)) errors.push('list.csv is not sorted by lower-case address (or has duplicates)');
  const total = list.reduce((s, r) => s + r.amount, 0n);
  if (total.toString() !== summary.total) errors.push(`total ${total} is not the summary's ${summary.total}`);
  if (list.length !== summary.count) errors.push(`count ${list.length} is not the summary's ${summary.count}`);
  const tree = list.length ? buildDistributorTree(list) : null;
  const root = tree?.root ?? null;
  if (root !== summary.root) errors.push(`root ${root} is not the summary's ${summary.root}`);
  if (checkShards && list.length && existsSync(join(dir, 'shards'))) {
    const p = summary.shardPrefixLength;
    const byAddr = new Map(list.map((r) => [r.address.toLowerCase(), r]));
    let seen = 0;
    for (const f of readdirSync(join(dir, 'shards')).filter((x) => x.endsWith('.json'))) {
      const s = JSON.parse(readFileSync(join(dir, 'shards', f), 'utf8'));
      if (s.root !== summary.root) errors.push(`shards/${f}: another root`);
      for (const [a, c] of Object.entries(s.claims)) {
        const r = byAddr.get(a);
        if (!r || shardKey(a, p) !== f.slice(0, -5) || r.index !== c.index || r.amount.toString() !== c.amount) { errors.push(`shards/${f}: ${a} is not the list's row`); continue; }
        // the root was rebuilt from list.csv above: a shard proof is right iff it is that tree's proof
        const want = tree.proofOf(c.index);
        if (!Array.isArray(c.proof) || c.proof.length !== want.length || c.proof.some((p, i) => p !== want[i])) errors.push(`shards/${f}: ${a}: the proof does not lead to the root`);
        seen++;
      }
    }
    if (seen !== list.length) errors.push(`the shards hold ${seen} claims, the list ${list.length}`);
  }
  return { ok: errors.length === 0, errors, root, count: list.length, total: total.toString() };
}
