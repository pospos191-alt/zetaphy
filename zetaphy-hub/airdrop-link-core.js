// airdrop-link.html, pure parts: the ZTPHY airdrop round-1 link (docs/AIRDROP-ROUND1.md). The same rules as
// zetaphy-network/airdrop/link.js, without dependencies, so the page checks a signature exactly as the owner's
// tooling will:
//   message   ZETAPHY airdrop: link <solanaOwner> to <0xEVM, EIP-55 checksum> on 3659
//   Solana    base58 of a 32-byte ed25519 public key
//   EVM       0x + 40 hex; mixed case must carry a correct EIP-55 checksum; never the zero address, a precompile /
//             reserved address (< 0x10000) or a known burn / placeholder address
//   signature 64 bytes as base58, 0x-hex or base64; strict RFC 8032 ed25519 (the rules of @noble/curves with
//             zip215: false: canonical R and A, S < L, A not of small order, the cofactored equation)
// keccak (bytes -> 32 bytes) is passed in, as in airdrop-core.js; SHA-512 is WebCrypto's (browser and Node).
// Nothing here signs or sends anything.

export const CHAIN_ID = 3659;
export const REPO = 'pospos191-alt/zetaphy';
export const FORM = 'airdrop-link.yml';
export const ISSUE_TITLE = 'ZTPHY airdrop round 1: link a Solana wallet';
/** Round 1 (UTC): the SWD snapshot and the end of the linking window. */
export const SNAPSHOT = '2026-11-20T14:00:00Z';
export const DEADLINE = '2026-12-04T14:00:00Z';

// ------------------------------------------------------------------ base58 (Bitcoin / Solana alphabet)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
export function encodeBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}`; }
  return out;
}
/** base58 -> bigint (leading '1's add nothing, as ethers' decodeBase58 that link.js uses). */
const base58Int = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); return n; };
/** bigint -> exactly `len` big-endian bytes, or null when it does not fit (link.js: toBeHex(x, len)). */
function intBytes(n, len) {
  if (n >> BigInt(8 * len) !== 0n) return null;
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}
const hexBytes = (h) => Uint8Array.from(h.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ addresses
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const KNOWN_NON_USERS = new Set([
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0xffffffffffffffffffffffffffffffffffffffff',
]);

/** 32-byte ed25519 public key of a Solana address, or null. */
export function solanaKey(owner) {
  if (typeof owner !== 'string' || !SOL.test(owner)) return null;
  return intBytes(base58Int(owner), 32);
}

/** EIP-55 checksum form of a 0x address (any case). */
export function checksum(addr, keccak) {
  if (!ADDR.test(addr)) throw new Error('bad-address');
  const lower = addr.slice(2).toLowerCase();
  const h = toHex(keccak(new TextEncoder().encode(lower)));
  return `0x${[...lower].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('')}`;
}

/** Why an EVM address cannot receive the airdrop (null: fine). The reasons of zetaphy-network/airdrop/recipients.js. */
export function evmProblem(raw, keccak) {
  if (typeof raw !== 'string' || !ADDR.test(raw)) return 'bad-address';
  const body = raw.slice(2);
  if (body !== body.toLowerCase() && body !== body.toUpperCase() && checksum(raw, keccak) !== raw) return 'bad-checksum';
  const n = BigInt(raw);
  if (n === 0n) return 'zero-address';
  if (KNOWN_NON_USERS.has(raw.toLowerCase())) return 'known-non-user';
  if (n < 0x10000n) return 'precompile-or-reserved';
  return null;
}

/** The exact message a holder signs. */
export function linkMessage(solanaOwner, evm, keccak, chainId = CHAIN_ID) {
  if (!solanaKey(solanaOwner)) throw new Error('bad-solana-address');
  const bad = evmProblem(evm, keccak);
  if (bad) throw new Error(`bad-evm-address:${bad}`);
  return `ZETAPHY airdrop: link ${solanaOwner} to ${checksum(evm, keccak)} on ${Number(chainId)}`;
}

/** A 64-byte signature from base58, 0x-hex or base64 (link.js sigBytes), or null. */
export function sigBytes(s) {
  if (typeof s !== 'string') return null;
  if (/^0x[0-9a-fA-F]{128}$/.test(s)) return hexBytes(s.slice(2));
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s)) { const b = intBytes(base58Int(s), 64); if (b) return b; }
  if (/^[A-Za-z0-9+/]{86}==$/.test(s)) {
    const bin = atob(s);
    if (bin.length === 64) return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  return null;
}

// ------------------------------------------------------------------ ed25519 verification (RFC 8032, strict)
const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function pow(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; } return r; }
const inv = (a) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);
const Gy = mod(4n * inv(5n));
const ZERO = [0n, 1n, 1n, 0n];
const leInt = (b) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };

/** Decodes a 32-byte point; null if not canonical (y >= p, or x = 0 with the sign bit set) or not on the curve. */
function decodePoint(bytes) {
  const b = Uint8Array.from(bytes);
  const sign = (b[31] & 0x80) !== 0;
  b[31] &= 0x7f;
  const y = leInt(b);
  if (y >= P) return null;
  const u = mod(y * y - 1n), v = mod(D * y * y + 1n);
  let x = mod(u * pow(v, 3n) * pow(u * pow(v, 7n), (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === mod(-u)) x = mod(x * SQRT_M1);
  else if (vx2 !== u) return null;
  if (x === 0n && sign) return null;
  if ((x & 1n) === 1n) { if (!sign) x = P - x; } else if (sign) x = mod(P - x);
  return [x, y, 1n, mod(x * y)];
}
function add([X1, Y1, Z1, T1], [X2, Y2, Z2, T2]) {
  const A = mod((Y1 - X1) * (Y2 - X2)), B = mod((Y1 + X1) * (Y2 + X2)), C = mod(2n * D * T1 * T2), Dd = mod(2n * Z1 * Z2);
  const E = B - A, F = Dd - C, G = Dd + C, H = B + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function mul(p, k) { let r = ZERO, q = p; while (k > 0n) { if (k & 1n) r = add(r, q); q = add(q, q); k >>= 1n; } return r; }
const neg = ([X, Y, Z, T]) => [mod(-X), Y, Z, mod(-T)];
const isZero = ([X, Y, Z]) => mod(X) === 0n && mod(Y - Z) === 0n;
const BASE = (() => { const g = decodePoint(intBytes(Gy, 32).reverse()); return g; })();

async function sha512(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', bytes));
}

/** Strict ed25519 verify (zip215: false). */
export async function ed25519Verify(sig, msg, pub) {
  if (sig?.length !== 64 || pub?.length !== 32) return false;
  const A = decodePoint(pub), R = decodePoint(sig.subarray(0, 32));
  if (!A || !R) return false;
  const s = leInt(sig.subarray(32));
  if (s >= L) return false;
  if (isZero(mul(A, 8n))) return false; // small-order public key
  const buf = new Uint8Array(64 + msg.length);
  buf.set(sig.subarray(0, 32)); buf.set(pub, 32); buf.set(msg, 64);
  const k = mod(leInt(await sha512(buf)), L);
  const diff = add(add(R, mul(A, k)), neg(mul(BASE, s)));
  return isZero(mul(diff, 8n));
}

/**
 * Checks one link { solana, evm, signature } for chain 3659, as link.js verifyLink does.
 * @returns {Promise<{ok:true, solana:string, evm:string, message:string} | {ok:false, reason:string}>}
 */
export async function verifyLink({ solana, evm, signature }, keccak, chainId = CHAIN_ID) {
  solana = String(solana ?? '').trim();
  evm = String(evm ?? '').trim();
  const pub = solanaKey(solana);
  if (!pub) return { ok: false, reason: 'bad-solana-address' };
  const bad = evmProblem(evm, keccak);
  if (bad) return { ok: false, reason: `bad-evm-address:${bad}` };
  const sig = sigBytes(String(signature ?? '').trim());
  if (!sig) return { ok: false, reason: 'bad-signature-format' };
  const message = linkMessage(solana, evm, keccak, chainId);
  const good = await ed25519Verify(sig, new TextEncoder().encode(message), pub);
  return good ? { ok: true, solana, evm: checksum(evm, keccak), message } : { ok: false, reason: 'bad-signature' };
}

/** The wallet's signMessage answer (Phantom / Backpack: {signature}; some: the bytes) -> 64 bytes, or null. */
export function signatureOf(res) {
  const s = res instanceof Uint8Array || Array.isArray(res) ? res : res?.signature;
  if (!s || typeof s.length !== 'number' || s.length !== 64) return null;
  return Uint8Array.from(s);
}

/** The prefilled GitHub "new issue" URL of .github/ISSUE_TEMPLATE/airdrop-link.yml (field ids as query parameters). */
export function issueUrl({ solana, evm, signature }, repo = REPO) {
  const q = new URLSearchParams({ template: FORM, title: ISSUE_TITLE, solana, evm, signature });
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}
