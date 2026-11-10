/// <reference lib="es2020.bigint" />
// LM-OTS one-time signatures, parameter set LMOTS_SHA256_N24_W8
// (RFC 8554 section 4 + NIST SP 800-208, type code 8): the exact bytes that
// programs/swd_quantum/src/wots.rs verifies on chain. Key generation follows
// RFC 8554 Appendix A, from a per-vault SEED derived from a 32-byte master seed.
import { sha256 } from "@noble/hashes/sha2.js";

/** Bytes per hash value (SHA-256 truncated to 192 bits). */
export const N = 24;
/** Chains: 24 message digits + 2 checksum digits (w = 8). */
export const P = 26;
export const ID_LEN = 16;
export const MAX_DIGIT = 255;
/** RFC 8554 / SP 800-208 type code of LMOTS_SHA256_N24_W8. */
export const TYPE_CODE = 8;
/** Signature bytes as the program takes them: C (24) + 26 chains (24 each). */
export const SIGNATURE_BYTES = N + P * N;
const D_PBLC = Uint8Array.of(0x80, 0x80);
const D_MESG = Uint8Array.of(0x81, 0x81);
const enc = new TextEncoder();

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32be(x: number): Uint8Array {
  if (!Number.isInteger(x) || x < 0 || x > 0xffffffff) throw new RangeError("u32");
  return Uint8Array.of(x >>> 24, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff);
}

function u16be(x: number): Uint8Array {
  return Uint8Array.of(x >>> 8, x & 0xff);
}

const h24 = (data: Uint8Array): Uint8Array => sha256(data).slice(0, N);

function bytes(x: Uint8Array, len: number, what: string): Uint8Array {
  if (!(x instanceof Uint8Array) || x.length !== len) throw new TypeError(`${what}: expected ${len} bytes`);
  return x;
}

/** Key material of one vault: identifier I (public) and LM-OTS SEED (secret). */
export interface VaultKeys {
  /** LM-OTS identifier I (16 bytes, public: part of the vault address). */
  id: Uint8Array;
  /** LM-OTS SEED (24 bytes, SECRET: whoever has it can spend). */
  seed: Uint8Array;
}

/**
 * Derives vault `vaultIndex`'s keys from a 32-byte master seed:
 *   I    = SHA256("SWD-QV1/I" || master || u32(vaultIndex))[0..16]
 *   SEED = SHA256("SWD-QV1/S" || master || u32(vaultIndex))[0..24]
 * The same master seed always gives the same vaults (back it up!).
 */
export function vaultKeys(master: Uint8Array, vaultIndex = 0): VaultKeys {
  bytes(master, 32, "master seed");
  const v = u32be(vaultIndex);
  return {
    id: sha256(concat(enc.encode("SWD-QV1/I"), master, v)).slice(0, ID_LEN),
    seed: sha256(concat(enc.encode("SWD-QV1/S"), master, v)).slice(0, N),
  };
}

/** RFC 8554 Appendix A: x_q[i] = H(I || u32(q) || u16(i) || 0xff || SEED). */
export function privateChains(keys: VaultKeys, q: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < P; i++) out.push(h24(concat(keys.id, u32be(q), u16be(i), Uint8Array.of(0xff), keys.seed)));
  return out;
}

/** Walks chain i of key (I, q) from step `from` to step `to` (exclusive). */
function walk(id: Uint8Array, q: number, i: number, from: number, to: number, start: Uint8Array): Uint8Array {
  const buf = new Uint8Array(ID_LEN + 4 + 2 + 1 + N);
  buf.set(id, 0);
  buf.set(u32be(q), ID_LEN);
  buf.set(u16be(i), ID_LEN + 4);
  buf.set(start, ID_LEN + 7);
  for (let j = from; j < to; j++) {
    buf[ID_LEN + 6] = j;
    buf.set(sha256(buf).subarray(0, N), ID_LEN + 7);
  }
  return buf.slice(ID_LEN + 7);
}

/** The one-time public key K of key index q (26 x 255 hashes). */
export function publicKey(keys: VaultKeys, q: number): Uint8Array {
  const x = privateChains(keys, q);
  const parts = [keys.id, u32be(q), D_PBLC];
  for (let i = 0; i < P; i++) parts.push(walk(keys.id, q, i, 0, MAX_DIGIT, x[i]));
  return h24(concat(...parts));
}

/** Q = H(I || u32(q) || D_MESG || C || message)[0..24]. */
export function messageHash(id: Uint8Array, q: number, c: Uint8Array, message: Uint8Array): Uint8Array {
  return h24(concat(bytes(id, ID_LEN, "id"), u32be(q), D_MESG, bytes(c, N, "C"), message));
}

/** The 26 base-256 digits of Q || Cksm(Q). */
export function digits(qh: Uint8Array): Uint8Array {
  const d = new Uint8Array(P);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    d[i] = qh[i];
    sum += MAX_DIGIT - qh[i];
  }
  d[N] = sum >>> 8;
  d[N + 1] = sum & 0xff;
  return d;
}

/** Chain hashes the verifier runs for these digits (drives the compute cost). */
export function verifyHashes(d: Uint8Array): number {
  let s = 0;
  for (const a of d) s += MAX_DIGIT - a;
  return s;
}

/** Deterministic randomizer candidate: H("SWD-QV1/C" || SEED || u32(q) || u32(counter) || message). */
export function randomizer(keys: VaultKeys, q: number, counter: number, message: Uint8Array): Uint8Array {
  return h24(concat(enc.encode("SWD-QV1/C"), keys.seed, u32be(q), u32be(counter), message));
}

export interface OneTimeSignature {
  /** randomizer C (24 bytes) */
  c: Uint8Array;
  /** 26 chain values y[i] (24 bytes each) */
  y: Uint8Array[];
  /** how many hashes verification costs (sum of 255 - a_i) */
  verifyHashes: number;
}

/**
 * Signs `message` with key index q. Tries `tries` deterministic randomizers
 * and keeps the cheapest to verify (lowest counter on ties), so the same
 * (keys, q, message, tries) always gives the same signature: re-sending a
 * signature is safe, signing a DIFFERENT message with the same q is not.
 */
export function sign(keys: VaultKeys, q: number, message: Uint8Array, tries = 4096): OneTimeSignature {
  let best: { cost: number; c: Uint8Array } = { cost: Infinity, c: new Uint8Array(N) };
  for (let k = 0; k < Math.max(1, tries); k++) {
    const c = randomizer(keys, q, k, message);
    const cost = verifyHashes(digits(messageHash(keys.id, q, c, message)));
    if (cost < best.cost) best = { cost, c };
  }
  const d = digits(messageHash(keys.id, q, best.c, message));
  const x = privateChains(keys, q);
  const y = x.map((xi, i) => walk(keys.id, q, i, 0, d[i], xi));
  return { c: best.c, y, verifyHashes: best.cost };
}

/** RFC 8554 Algorithm 4b: the public key the signature implies. */
export function candidateKey(id: Uint8Array, q: number, c: Uint8Array, y: Uint8Array[], message: Uint8Array): Uint8Array {
  if (y.length !== P) throw new TypeError(`expected ${P} chains`);
  const d = digits(messageHash(id, q, c, message));
  const parts = [id, u32be(q), D_PBLC];
  for (let i = 0; i < P; i++) parts.push(walk(id, q, i, d[i], MAX_DIGIT, bytes(y[i], N, `y[${i}]`)));
  return h24(concat(...parts));
}

export function verify(id: Uint8Array, q: number, key: Uint8Array, sig: { c: Uint8Array; y: Uint8Array[] }, message: Uint8Array): boolean {
  const k = candidateKey(id, q, sig.c, sig.y, message);
  return k.length === key.length && k.every((b, i) => b === key[i]);
}

/** The signature as the program's instruction data takes it: C || y[0] || ... || y[25]. */
export function signatureBytes(sig: { c: Uint8Array; y: Uint8Array[] }): Uint8Array {
  return concat(sig.c, ...sig.y);
}
