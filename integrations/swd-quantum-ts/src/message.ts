/// <reference lib="es2020.bigint" />
// The exact bytes a vault's one-time key signs (programs/swd_quantum/src/message.rs).
import { PublicKey } from "@solana/web3.js";
import { N } from "./lmots";

export const DOMAIN = new TextEncoder().encode("SWD-QVAULT-MSG-1");
export const MESSAGE_LEN = 254;
export const ACTION_SPEND_SOL = 1;
export const ACTION_SPEND_TOKEN = 2;
/** Close the emptied source token account (its rent goes into the vault). */
export const FLAG_CLOSE_SOURCE = 1;

export interface SpendMessage {
  action: number;
  programId: PublicKey;
  vault: PublicKey;
  openedSlot: bigint;
  seq: number;
  nextKey: Uint8Array;
  /** PublicKey.default for SOL */
  mint: PublicKey;
  /** PublicKey.default for SOL */
  tokenProgram: PublicKey;
  /** the vault itself for SOL, else the vault's token account */
  source: PublicKey;
  destination: PublicKey;
  amount: bigint;
  flags: number;
}

const U64_MAX = BigInt("18446744073709551615");

export function encodeSpendMessage(m: SpendMessage): Uint8Array {
  if (m.nextKey.length !== N) throw new TypeError("nextKey: 24 bytes");
  if (m.amount < BigInt(0) || m.amount > U64_MAX) throw new RangeError("amount: u64");
  if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 0xffffffff) throw new RangeError("seq: u32");
  const out = new Uint8Array(MESSAGE_LEN);
  const dv = new DataView(out.buffer);
  out.set(DOMAIN, 0);
  out[16] = m.action;
  out.set(m.programId.toBytes(), 17);
  out.set(m.vault.toBytes(), 49);
  dv.setBigUint64(81, m.openedSlot, true);
  dv.setUint32(89, m.seq, true);
  out.set(m.nextKey, 93);
  out.set(m.mint.toBytes(), 117);
  out.set(m.tokenProgram.toBytes(), 149);
  out.set(m.source.toBytes(), 181);
  out.set(m.destination.toBytes(), 213);
  dv.setBigUint64(245, m.amount, true);
  out[253] = m.flags;
  return out;
}
