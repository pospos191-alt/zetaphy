/// <reference lib="es2020.bigint" />
// PQ key commitment registry (programs/swd_quantum: commit_pq_key & co.).
//   commitment = keccak256("SWD QuantumCommit v1" || wallet || keccak256(ML-DSA-44 public key) || secret)
// Only the hash goes on chain. Keep the ML-DSA-44 key (its seed) and the
// 32-byte secret OFFLINE: after a future Q-day they are what proves the
// claim. Losing them = the commitment is worthless; leaking the secret
// alone does not let anyone claim (they also need the ML-DSA key).
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { concat } from "./lmots";
import { SWD_QUANTUM_PROGRAM_ID, accountDiscriminator, ixDiscriminator } from "./vault";

export const COMMIT_DOMAIN = new TextEncoder().encode("SWD QuantumCommit v1");
export const COMMIT_SEED = new TextEncoder().encode("swdq-commit");
export const MLDSA44_PUBLIC_KEY_BYTES = 1312;
export const COMMITMENT_ACCOUNT_SIZE = 126;

/** keccak256 of an ML-DSA-44 public key (the same key hash as ZETAPHY's QuantumRescue keyHashOf). */
export function mldsaKeyHash(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== MLDSA44_PUBLIC_KEY_BYTES) throw new TypeError("ML-DSA-44 public key: 1312 bytes");
  return keccak_256(publicKey);
}

export function pqCommitment(wallet: PublicKey, mldsaPublicKeyHash: Uint8Array, secret: Uint8Array): Uint8Array {
  if (mldsaPublicKeyHash.length !== 32 || secret.length !== 32) throw new TypeError("key hash and secret: 32 bytes each");
  return keccak_256(concat(COMMIT_DOMAIN, wallet.toBytes(), mldsaPublicKeyHash, secret));
}

export function findCommitAddress(wallet: PublicKey, programId = SWD_QUANTUM_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([COMMIT_SEED, wallet.toBytes()], programId);
}

/** Records (or with 32 zero bytes: revokes) the wallet's commitment; in force after the program's delay. */
export function commitPqKeyIx(a: { wallet: PublicKey; commitment: Uint8Array; programId?: PublicKey }): TransactionInstruction {
  const programId = a.programId ?? SWD_QUANTUM_PROGRAM_ID;
  if (a.commitment.length !== 32) throw new TypeError("commitment: 32 bytes");
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: a.wallet, isSigner: true, isWritable: true },
      { pubkey: findCommitAddress(a.wallet, programId)[0], isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concat(ixDiscriminator("commit_pq_key"), a.commitment)),
  });
}

export function promotePqKeyIx(a: { wallet: PublicKey; programId?: PublicKey }): TransactionInstruction {
  const programId = a.programId ?? SWD_QUANTUM_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [{ pubkey: findCommitAddress(a.wallet, programId)[0], isSigner: false, isWritable: true }],
    data: Buffer.from(ixDiscriminator("promote_pq_key")),
  });
}

export function cancelPqPendingIx(a: { wallet: PublicKey; programId?: PublicKey }): TransactionInstruction {
  const programId = a.programId ?? SWD_QUANTUM_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: a.wallet, isSigner: true, isWritable: false },
      { pubkey: findCommitAddress(a.wallet, programId)[0], isSigner: false, isWritable: true },
    ],
    data: Buffer.from(ixDiscriminator("cancel_pq_pending")),
  });
}

export interface CommitmentState {
  wallet: PublicKey;
  bump: number;
  active: Uint8Array;
  activeSince: bigint;
  pending: Uint8Array;
  pendingSince: bigint;
  hasPending: boolean;
  changes: number;
}

export function decodeCommitment(data: Uint8Array): CommitmentState {
  const disc = accountDiscriminator("PqCommitment");
  if (data.length < COMMITMENT_ACCOUNT_SIZE || !disc.every((b, i) => data[i] === b)) throw new Error("not a PqCommitment account");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    wallet: new PublicKey(data.slice(8, 40)),
    bump: data[40],
    active: data.slice(41, 73),
    activeSince: dv.getBigInt64(73, true),
    pending: data.slice(81, 113),
    pendingSince: dv.getBigInt64(113, true),
    hasPending: data[121] === 1,
    changes: dv.getUint32(122, true),
  };
}

/** The commitment in force at unix time t (null = none): PqCommitment::in_force_at in the program. */
export function inForceAt(s: CommitmentState, t: bigint, delaySecs: bigint): Uint8Array | null {
  let c: Uint8Array;
  if (s.hasPending && t >= s.pendingSince + delaySecs) c = s.pending;
  else if (s.activeSince !== BigInt(0) && t >= s.activeSince) c = s.active;
  else return null;
  return c.every((b) => b === 0) ? null : c;
}
