// SWD holders are Solana wallets; the ZETAPHY airdrop pays EVM addresses. A holder links the two by signing, with
// the Solana wallet that held SWD at the snapshot, one fixed message (signMessage in Phantom / Solflare / Backpack,
// which sign the raw UTF-8 bytes with the wallet's ed25519 key):
//
//   ZETAPHY airdrop: link <solanaOwner> to <0xEVM, EIP-55 checksum> on <chainId>
//
// The chain id is in the message so a link made for the testnet round cannot be replayed for mainnet (or the
// reverse). Verification is strict RFC 8032 ed25519 (@noble/curves, zip215: false). One EVM address per Solana
// owner: the same record twice counts once; two different EVM addresses for one owner is a conflict and that
// owner is left out of the round (reported) until they sort it out. Several Solana owners may link the SAME EVM
// address (one person, several wallets): their amounts are added into one leaf. Unlinked holders are not paid in
// this round; they are reported with their amounts so a later round can pay them.

import { ed25519 } from '@noble/curves/ed25519.js';
import { decodeBase58, getAddress, toBeHex } from 'ethers';
import { addressProblem } from './recipients.js';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The exact message a holder signs. */
export function linkMessage(solanaOwner, evm, chainId) {
  if (!BASE58.test(solanaOwner)) throw new Error('not a Solana address');
  if (!Number.isSafeInteger(Number(chainId)) || Number(chainId) <= 0) throw new Error('bad chain id');
  return `ZETAPHY airdrop: link ${solanaOwner} to ${getAddress(evm)} on ${Number(chainId)}`;
}

/** 32-byte ed25519 public key of a Solana address (base58), or null. */
export function solanaKey(owner) {
  if (!BASE58.test(owner)) return null;
  try {
    const hex = toBeHex(decodeBase58(owner), 32);
    return hex.length === 66 ? Buffer.from(hex.slice(2), 'hex') : null;
  } catch { return null; }
}

/** A 64-byte signature from base58, 0x-hex or base64 (what wallets and forms tend to give). */
export function sigBytes(s) {
  if (typeof s !== 'string') return null;
  if (/^0x[0-9a-fA-F]{128}$/.test(s)) return Buffer.from(s.slice(2), 'hex');
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s)) {
    try { const h = toBeHex(decodeBase58(s), 64); if (h.length === 130) return Buffer.from(h.slice(2), 'hex'); } catch { /* not base58 */ }
  }
  if (/^[A-Za-z0-9+/]{86}==$/.test(s)) { const b = Buffer.from(s, 'base64'); if (b.length === 64) return b; }
  return null;
}

/**
 * Checks one link record { solana, evm, signature, chainId?, message? } for the round's chain id.
 * @returns {{ok:true, solana:string, evm:string} | {ok:false, reason:string}}
 */
export function verifyLink(rec, chainId) {
  const solana = String(rec?.solana ?? '').trim();
  const evmRaw = String(rec?.evm ?? '').trim();
  const pub = solanaKey(solana);
  if (!pub) return { ok: false, reason: 'bad-solana-address' };
  const evmBad = addressProblem(evmRaw);
  if (evmBad) return { ok: false, reason: `bad-evm-address:${evmBad}` };
  if (rec.chainId != null && Number(rec.chainId) !== Number(chainId)) return { ok: false, reason: 'wrong-chain-id' };
  const message = linkMessage(solana, evmRaw, chainId);
  if (rec.message != null && rec.message !== message) return { ok: false, reason: 'wrong-message' };
  const sig = sigBytes(rec.signature);
  if (!sig) return { ok: false, reason: 'bad-signature-format' };
  let good = false;
  try { good = ed25519.verify(sig, new TextEncoder().encode(message), pub, { zip215: false }); } catch { good = false; }
  return good ? { ok: true, solana, evm: getAddress(evmRaw) } : { ok: false, reason: 'bad-signature' };
}

/**
 * Maps a snapshot allocation (allocate.js: [{owner, zetaphy}]) onto linked EVM addresses.
 * @param {{allocations: Array<{owner:string, zetaphy:string}>}} alloc
 * @param {Array<object>} records  link records
 * @param {{chainId:number}} o
 */
export function linkSolana(alloc, records, { chainId }) {
  if (!chainId) throw new Error('the round\'s chain id is required');
  const amountOf = new Map(alloc.allocations.map((a) => [a.owner, BigInt(a.zetaphy)]));
  const rejected = [];
  const byOwner = new Map(); // solana -> Set(evm)
  let duplicates = 0;
  for (const [i, rec] of records.entries()) {
    const v = verifyLink(rec, chainId);
    if (!v.ok) { rejected.push({ record: i, solana: rec?.solana ?? null, evm: rec?.evm ?? null, reason: v.reason }); continue; }
    if (!amountOf.has(v.solana)) { rejected.push({ record: i, solana: v.solana, evm: v.evm, reason: 'not-in-snapshot' }); continue; }
    const set = byOwner.get(v.solana) ?? new Set();
    if (set.has(v.evm)) duplicates++;
    set.add(v.evm);
    byOwner.set(v.solana, set);
  }
  const conflicts = [];
  const byEvm = new Map();
  const owners = new Map(); // evm -> number of solana owners merged
  for (const [solana, set] of byOwner) {
    if (set.size > 1) { conflicts.push({ solana, evms: [...set], reason: 'conflict: several EVM addresses for one Solana owner' }); continue; }
    const [evm] = set;
    const amount = amountOf.get(solana);
    if (amount === 0n) continue;
    byEvm.set(evm, (byEvm.get(evm) ?? 0n) + amount);
    owners.set(evm, (owners.get(evm) ?? 0) + 1);
  }
  const linked = new Set([...byOwner].filter(([, s]) => s.size === 1).map(([o]) => o));
  const unlinked = alloc.allocations.filter((a) => !linked.has(a.owner) && BigInt(a.zetaphy) > 0n);
  const allocations = [...byEvm].map(([address, amount]) => ({ address, amount: amount.toString() }));
  return {
    chainId: Number(chainId),
    message: 'ZETAPHY airdrop: link <solanaOwner> to <0xEVM> on <chainId>',
    count: allocations.length,
    total: allocations.reduce((s, a) => s + BigInt(a.amount), 0n).toString(),
    linkedOwners: linked.size,
    duplicates,
    merged: [...owners].filter(([, n]) => n > 1).map(([address, n]) => ({ address, owners: n })),
    conflicts,
    rejected,
    unlinked: { count: unlinked.length, total: unlinked.reduce((s, a) => s + BigInt(a.zetaphy), 0n).toString(), owners: unlinked.map((a) => ({ owner: a.owner, zetaphy: a.zetaphy })) },
    allocations,
  };
}
