//! LM-OTS one-time signatures (Winternitz family), parameter set
//! **LMOTS_SHA256_N24_W8** — RFC 8554 section 4 with the SHA-256/192
//! parameter sets that NIST SP 800-208 adds (type code 8).
//!
//! Why this parameter set (docs/SWD_QUANTUM.md, "Parameters"):
//! - n = 24 bytes (SHA-256 truncated to 192 bits): ~192-bit classical and
//!   ~96-bit generic quantum (Grover) preimage security per chain step — the
//!   same strength class as AES-192 key search, above ML-DSA-44 (NIST
//!   category 2). Every hash is tweaked with the key identifier I, the key
//!   index q, the chain index i and the step j (RFC 8554's design), so
//!   attacking many keys or many chains at once does not help.
//! - w = 8 (one byte per chain): p = 26 chains (24 message digits + 2
//!   checksum digits), a 24 + 26*24 = 648-byte signature. That fits in ONE
//!   Solana transaction (1232-byte limit) next to the token accounts, so no
//!   signature buffer account and no multi-transaction flow is needed.
//!   W4 would need 51 chains (1248 bytes: too big); N32 (128-bit quantum)
//!   would need 34*32 = 1088 bytes (too big for one transaction with accounts).
//! - The checksum is what makes a single revealed signature useless for a
//!   forgery: raising any message digit lowers the checksum, and chains can
//!   only be walked forward.
//! - Verification costs sum(255 - a_i) hashes; each is one `sol_sha256`
//!   syscall on a 47-byte input (85 + 23 = 108 CU; ~147 CU measured with
//!   the loop). Because the checksum digits mirror the message digits, that
//!   sum is exactly 255 * (floor(Cksm / 256) + 2): between 510 and 6375
//!   hashes, mean ~3315. The signer picks the randomizer C among many
//!   candidates to keep it low (C is the signer's choice in RFC 8554 too);
//!   4096 tries typically give 2040-2295 hashes, ~0.31-0.35M CU.
//!
//! The on-chain part is only `candidate_key` (RFC 8554 Algorithm 4b). Key
//! generation and signing (`signer`) are host-only; the TypeScript library
//! (integrations/swd-quantum-ts) implements the same bytes, checked against
//! the shared golden vectors in `golden_vectors.txt` (docs/SWD_QUANTUM.md,
//! "Testing").

use anchor_lang::solana_program::hash::hash;

/// Bytes per hash value (SHA-256/192).
pub const N: usize = 24;
/// Number of chains: 24 message digits + 2 checksum digits.
pub const P: usize = 26;
/// Chain length is 2^W - 1 = 255 steps (W = 8).
pub const MAX_DIGIT: u8 = 255;
/// Key identifier length (RFC 8554 `I`).
pub const ID_LEN: usize = 16;
/// RFC 8554 / SP 800-208 type code of LMOTS_SHA256_N24_W8.
pub const TYPE_CODE: u32 = 8;
pub const D_PBLC: [u8; 2] = [0x80, 0x80];
pub const D_MESG: [u8; 2] = [0x81, 0x81];

/// A one-time signature: the randomizer C and the 26 chain values y[i].
/// (RFC 8554's leading 4-byte type code is implied: the program accepts
/// only type 8.)
pub type Chains = [[u8; N]; P];

#[inline(always)]
fn h24(data: &[u8]) -> [u8; N] {
    let d = hash(data).to_bytes();
    let mut out = [0u8; N];
    out.copy_from_slice(&d[..N]);
    out
}

/// Q = H(I || u32(q) || D_MESG || C || message), truncated to n bytes.
pub fn message_hash(id: &[u8; ID_LEN], q: u32, c: &[u8; N], message: &[u8]) -> [u8; N] {
    anchor_lang::solana_program::hash::hashv(&[id, &q.to_be_bytes(), &D_MESG, c, message]).to_bytes()[..N]
        .try_into()
        .unwrap()
}

/// The 26 base-256 digits of Q || Cksm(Q) (w = 8, ls = 0).
pub fn digits(qh: &[u8; N]) -> [u8; P] {
    let mut d = [0u8; P];
    let mut sum: u16 = 0;
    for (i, b) in qh.iter().enumerate() {
        d[i] = *b;
        sum += (MAX_DIGIT - *b) as u16;
    }
    let c = sum.to_be_bytes();
    d[N] = c[0];
    d[N + 1] = c[1];
    d
}

/// How many chain hashes verification will run for these digits.
pub fn verify_hashes(d: &[u8; P]) -> u32 {
    d.iter().map(|a| (MAX_DIGIT - *a) as u32).sum()
}

/// Walks chain `i` from step `from` up to step 254 (inclusive).
#[inline(always)]
fn walk(id: &[u8; ID_LEN], q: u32, i: u16, from: u8, to: u8, start: &[u8; N]) -> [u8; N] {
    // I(16) || q(4) || i(2) || j(1) || tmp(24) = 47 bytes, one syscall per step.
    let mut buf = [0u8; ID_LEN + 4 + 2 + 1 + N];
    buf[..ID_LEN].copy_from_slice(id);
    buf[ID_LEN..ID_LEN + 4].copy_from_slice(&q.to_be_bytes());
    buf[ID_LEN + 4..ID_LEN + 6].copy_from_slice(&i.to_be_bytes());
    buf[ID_LEN + 7..].copy_from_slice(start);
    let mut j = from;
    while j < to {
        buf[ID_LEN + 6] = j;
        let d = hash(&buf).to_bytes();
        buf[ID_LEN + 7..].copy_from_slice(&d[..N]);
        j += 1;
    }
    buf[ID_LEN + 7..].try_into().unwrap()
}

/// RFC 8554 Algorithm 4b: the public key K that this (C, y) signature on
/// `message` implies. The signature is valid iff the result equals the
/// stored K. Never fails: a wrong signature simply yields another K.
pub fn candidate_key(id: &[u8; ID_LEN], q: u32, c: &[u8; N], y: &Chains, message: &[u8]) -> [u8; N] {
    let qh = message_hash(id, q, c, message);
    let d = digits(&qh);
    // I || u32(q) || D_PBLC || z[0] || ... || z[25]
    let mut kbuf = [0u8; ID_LEN + 4 + 2 + P * N];
    kbuf[..ID_LEN].copy_from_slice(id);
    kbuf[ID_LEN..ID_LEN + 4].copy_from_slice(&q.to_be_bytes());
    kbuf[ID_LEN + 4..ID_LEN + 6].copy_from_slice(&D_PBLC);
    let base = ID_LEN + 6;
    for i in 0..P {
        let z = walk(id, q, i as u16, d[i], MAX_DIGIT, &y[i]);
        kbuf[base + i * N..base + (i + 1) * N].copy_from_slice(&z);
    }
    h24(&kbuf)
}

/// Host-only key generation and signing (wallets, tests). Never compiled
/// into the on-chain program.
#[cfg(not(target_os = "solana"))]
pub mod signer {
    use super::*;

    /// Per-vault key material derived from a 32-byte master seed:
    /// I = SHA256("SWD-QV1/I" || seed || u32(v))[..16],
    /// SEED = SHA256("SWD-QV1/S" || seed || u32(v))[..24].
    pub struct VaultKeys {
        pub id: [u8; ID_LEN],
        pub seed: [u8; N],
    }

    pub fn vault_keys(master: &[u8; 32], vault_index: u32) -> VaultKeys {
        let i = anchor_lang::solana_program::hash::hashv(&[b"SWD-QV1/I", master, &vault_index.to_be_bytes()]).to_bytes();
        let s = anchor_lang::solana_program::hash::hashv(&[b"SWD-QV1/S", master, &vault_index.to_be_bytes()]).to_bytes();
        VaultKeys { id: i[..ID_LEN].try_into().unwrap(), seed: s[..N].try_into().unwrap() }
    }

    impl VaultKeys {
        /// RFC 8554 Appendix A: x_q[i] = H(I || u32(q) || u16(i) || 0xff || SEED).
        pub fn private_chains(&self, q: u32) -> Chains {
            let mut x = [[0u8; N]; P];
            for (i, xi) in x.iter_mut().enumerate() {
                *xi = h24(&[&self.id[..], &q.to_be_bytes(), &(i as u16).to_be_bytes(), &[0xff], &self.seed].concat());
            }
            x
        }

        /// The one-time public key K of key index q.
        pub fn public_key(&self, q: u32) -> [u8; N] {
            let x = self.private_chains(q);
            let mut kbuf = Vec::with_capacity(ID_LEN + 6 + P * N);
            kbuf.extend_from_slice(&self.id);
            kbuf.extend_from_slice(&q.to_be_bytes());
            kbuf.extend_from_slice(&D_PBLC);
            for (i, xi) in x.iter().enumerate() {
                kbuf.extend_from_slice(&walk(&self.id, q, i as u16, 0, MAX_DIGIT, xi));
            }
            h24(&kbuf)
        }

        /// Deterministic randomizer candidate `counter` for (q, message).
        pub fn randomizer(&self, q: u32, counter: u32, message: &[u8]) -> [u8; N] {
            h24(&[&b"SWD-QV1/C"[..], &self.seed, &q.to_be_bytes(), &counter.to_be_bytes(), message].concat())
        }

        /// Signs with key index q. Tries `tries` randomizers and keeps the
        /// one with the fewest verification hashes (lowest counter on ties).
        pub fn sign(&self, q: u32, message: &[u8], tries: u32) -> ([u8; N], Chains) {
            let mut best = (u32::MAX, [0u8; N]);
            for k in 0..tries.max(1) {
                let c = self.randomizer(q, k, message);
                let cost = verify_hashes(&digits(&message_hash(&self.id, q, &c, message)));
                if cost < best.0 {
                    best = (cost, c);
                }
            }
            let c = best.1;
            let d = digits(&message_hash(&self.id, q, &c, message));
            let x = self.private_chains(q);
            let mut y = [[0u8; N]; P];
            for i in 0..P {
                y[i] = walk(&self.id, q, i as u16, 0, d[i], &x[i]);
            }
            (c, y)
        }
    }
}
