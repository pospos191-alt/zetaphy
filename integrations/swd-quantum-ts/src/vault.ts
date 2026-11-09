/// <reference lib="es2020.bigint" />
// Vault addresses, account decoding and instruction builders for
// programs/swd_quantum (web3.js 1.x, no Anchor client needed).
import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ID_LEN, N, P, VaultKeys, OneTimeSignature, concat, publicKey, sign, signatureBytes, vaultKeys } from "./lmots";
import { ACTION_SPEND_SOL, ACTION_SPEND_TOKEN, FLAG_CLOSE_SOURCE, SpendMessage, encodeSpendMessage } from "./message";

/** Placeholder id (declare_id! in programs/swd_quantum/src/lib.rs) until a real deploy; pass `programId` explicitly. */
export const SWD_QUANTUM_PROGRAM_ID = new PublicKey("HGtZWKNPwqNY19RNJBrzs8qQwwmnAexxAWZFxAwFuF9h");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const VAULT_SEED = new TextEncoder().encode("swdq-vault");
/** Size of the Vault account (8-byte discriminator + fields). */
export const VAULT_ACCOUNT_SIZE = 94;

const te = new TextEncoder();
export const ixDiscriminator = (name: string) => sha256(te.encode(`global:${name}`)).slice(0, 8);
export const accountDiscriminator = (name: string) => sha256(te.encode(`account:${name}`)).slice(0, 8);

function u64le(x: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(x), true);
  return out;
}

export function findVaultAddress(id: Uint8Array, genesisKey: Uint8Array, programId = SWD_QUANTUM_PROGRAM_ID): [PublicKey, number] {
  if (id.length !== ID_LEN || genesisKey.length !== N) throw new TypeError("id: 16 bytes, key: 24 bytes");
  return PublicKey.findProgramAddressSync([VAULT_SEED, id, genesisKey], programId);
}

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** Everything a wallet needs to know about vault `vaultIndex` of a master seed. */
export function vaultFromSeed(master: Uint8Array, vaultIndex = 0, programId = SWD_QUANTUM_PROGRAM_ID) {
  const keys = vaultKeys(master, vaultIndex);
  const genesisKey = publicKey(keys, 0);
  const [address, bump] = findVaultAddress(keys.id, genesisKey, programId);
  return { keys, genesisKey, address, bump };
}

export interface VaultState {
  version: number;
  bump: number;
  id: Uint8Array;
  genesisKey: Uint8Array;
  /** the one-time public key that must sign the next spend */
  key: Uint8Array;
  /** its index q */
  seq: number;
  openedSlot: bigint;
  spends: bigint;
}

export function decodeVault(data: Uint8Array): VaultState {
  const disc = accountDiscriminator("Vault");
  if (data.length < VAULT_ACCOUNT_SIZE || !disc.every((b, i) => data[i] === b)) throw new Error("not a swd_quantum Vault account");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    version: data[8],
    bump: data[9],
    id: data.slice(10, 26),
    genesisKey: data.slice(26, 50),
    key: data.slice(50, 74),
    seq: dv.getUint32(74, true),
    openedSlot: dv.getBigUint64(78, true),
    spends: dv.getBigUint64(86, true),
  };
}

const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });

export function openVaultIx(a: { payer: PublicKey; id: Uint8Array; key: Uint8Array; programId?: PublicKey }): TransactionInstruction {
  const programId = a.programId ?? SWD_QUANTUM_PROGRAM_ID;
  const [vault] = findVaultAddress(a.id, a.key, programId);
  return new TransactionInstruction({
    programId,
    keys: [w(a.payer, true), w(vault), r(SystemProgram.programId)],
    data: Buffer.from(concat(ixDiscriminator("open_vault"), a.id, a.key)),
  });
}

export function depositSolIx(a: { depositor: PublicKey; vault: PublicKey; lamports: bigint | number; programId?: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: a.programId ?? SWD_QUANTUM_PROGRAM_ID,
    keys: [w(a.depositor, true), w(a.vault), r(SystemProgram.programId)],
    data: Buffer.from(concat(ixDiscriminator("deposit_sol"), u64le(a.lamports))),
  });
}

/** Deposits into the vault's associated token account (created if missing; the depositor pays its rent). */
export function depositTokenIx(a: {
  depositor: PublicKey;
  vault: PublicKey;
  mint: PublicKey;
  from: PublicKey;
  amount: bigint | number;
  tokenProgram?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const tokenProgram = a.tokenProgram ?? TOKEN_PROGRAM_ID;
  return new TransactionInstruction({
    programId: a.programId ?? SWD_QUANTUM_PROGRAM_ID,
    keys: [
      w(a.depositor, true),
      r(a.vault),
      r(a.mint),
      w(a.from),
      w(associatedTokenAddress(a.vault, a.mint, tokenProgram)),
      r(tokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    data: Buffer.from(concat(ixDiscriminator("deposit_token"), u64le(a.amount))),
  });
}

export function spendSolIx(a: {
  vault: PublicKey;
  destination: PublicKey;
  signature: { c: Uint8Array; y: Uint8Array[] };
  amount: bigint | number;
  nextKey: Uint8Array;
  programId?: PublicKey;
}): TransactionInstruction {
  if (a.signature.y.length !== P) throw new TypeError("signature: 26 chains");
  return new TransactionInstruction({
    programId: a.programId ?? SWD_QUANTUM_PROGRAM_ID,
    keys: [w(a.vault), w(a.destination)],
    data: Buffer.from(concat(ixDiscriminator("spend_sol"), signatureBytes(a.signature), u64le(a.amount), a.nextKey)),
  });
}

export function spendTokenIx(a: {
  vault: PublicKey;
  mint: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  signature: { c: Uint8Array; y: Uint8Array[] };
  amount: bigint | number;
  flags: number;
  nextKey: Uint8Array;
  tokenProgram?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  if (a.signature.y.length !== P) throw new TypeError("signature: 26 chains");
  return new TransactionInstruction({
    programId: a.programId ?? SWD_QUANTUM_PROGRAM_ID,
    keys: [w(a.vault), r(a.mint), w(a.source), w(a.destination), r(a.tokenProgram ?? TOKEN_PROGRAM_ID)],
    data: Buffer.from(
      concat(ixDiscriminator("spend_token"), signatureBytes(a.signature), u64le(a.amount), Uint8Array.of(a.flags), a.nextKey),
    ),
  });
}

/**
 * Compute units to request for a spend. Measured on a local validator
 * (tests/swd_quantum.ts, Agave 3.1.10): about 147 CU per chain hash plus
 * ~8k (SOL) / ~20-40k (token, Token-2022) fixed; this adds a margin. The
 * hash count is known before sending; its maximum is 6375 (~0.95M CU).
 */
export function spendComputeUnits(verifyHashes: number, token: boolean): number {
  return Math.min(1_400_000, Math.ceil(verifyHashes * 152 + (token ? 80_000 : 40_000)));
}

export interface PreparedSpend {
  /** [SetComputeUnitLimit, spend] — add a fee payer and a recent blockhash, sign with the payer, send. */
  instructions: TransactionInstruction[];
  message: Uint8Array;
  signature: OneTimeSignature;
  nextKey: Uint8Array;
  computeUnits: number;
}

function checkKeys(keys: VaultKeys, state: VaultState): void {
  const sameId = keys.id.every((b, i) => b === state.id[i]);
  const k = publicKey(keys, state.seq);
  if (!sameId || !k.every((b, i) => b === state.key[i])) {
    throw new Error("this seed does not hold the vault's current key (wrong seed, wrong vault index, or stale vault state)");
  }
}

/**
 * Builds a SOL spend from the vault's CURRENT on-chain state (read it with
 * getAccountInfo + decodeVault right before). One-time-key rule: once this
 * returns, the key `state.seq` is used up — send exactly this signature (any
 * fee payer, any blockhash, as often as needed) and never sign a different
 * message for the same `state.seq`.
 */
export function prepareSpendSol(a: {
  keys: VaultKeys;
  vault: PublicKey;
  state: VaultState;
  destination: PublicKey;
  lamports: bigint | number;
  programId?: PublicKey;
  tries?: number;
}): PreparedSpend {
  const programId = a.programId ?? SWD_QUANTUM_PROGRAM_ID;
  checkKeys(a.keys, a.state);
  const nextKey = publicKey(a.keys, a.state.seq + 1);
  const m: SpendMessage = {
    action: ACTION_SPEND_SOL,
    programId,
    vault: a.vault,
    openedSlot: a.state.openedSlot,
    seq: a.state.seq,
    nextKey,
    mint: PublicKey.default,
    tokenProgram: PublicKey.default,
    source: a.vault,
    destination: a.destination,
    amount: BigInt(a.lamports),
    flags: 0,
  };
  const message = encodeSpendMessage(m);
  const signature = sign(a.keys, a.state.seq, message, a.tries ?? 4096);
  const computeUnits = spendComputeUnits(signature.verifyHashes, false);
  return {
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      spendSolIx({ vault: a.vault, destination: a.destination, signature, amount: a.lamports, nextKey, programId }),
    ],
    message,
    signature,
    nextKey,
    computeUnits,
  };
}

/** Builds a token spend (same one-time-key rule as prepareSpendSol). `source` defaults to the vault's ATA. */
export function prepareSpendToken(a: {
  keys: VaultKeys;
  vault: PublicKey;
  state: VaultState;
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint | number;
  closeSource?: boolean;
  source?: PublicKey;
  tokenProgram?: PublicKey;
  programId?: PublicKey;
  tries?: number;
}): PreparedSpend {
  const programId = a.programId ?? SWD_QUANTUM_PROGRAM_ID;
  const tokenProgram = a.tokenProgram ?? TOKEN_PROGRAM_ID;
  const source = a.source ?? associatedTokenAddress(a.vault, a.mint, tokenProgram);
  checkKeys(a.keys, a.state);
  const nextKey = publicKey(a.keys, a.state.seq + 1);
  const flags = a.closeSource ? FLAG_CLOSE_SOURCE : 0;
  const message = encodeSpendMessage({
    action: ACTION_SPEND_TOKEN,
    programId,
    vault: a.vault,
    openedSlot: a.state.openedSlot,
    seq: a.state.seq,
    nextKey,
    mint: a.mint,
    tokenProgram,
    source,
    destination: a.destination,
    amount: BigInt(a.amount),
    flags,
  });
  const signature = sign(a.keys, a.state.seq, message, a.tries ?? 4096);
  const computeUnits = spendComputeUnits(signature.verifyHashes, true);
  return {
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      spendTokenIx({ vault: a.vault, mint: a.mint, source, destination: a.destination, signature, amount: a.amount, flags, nextKey, tokenProgram, programId }),
    ],
    message,
    signature,
    nextKey,
    computeUnits,
  };
}
