//! Host unit tests: `cargo test -p swd_quantum`.
//!
//! The golden vectors in `golden_vectors.txt` are shared with the
//! TypeScript library (integrations/swd-quantum-ts/test) — both
//! implementations must reproduce every value bit for bit.

use super::*;
use crate::message::{SpendMessage, ACTION_SPEND_SOL, ACTION_SPEND_TOKEN, LEN};
use crate::wots::signer::vault_keys;
use crate::wots::{candidate_key, digits, message_hash, verify_hashes, MAX_DIGIT, P};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn golden() -> std::collections::HashMap<String, String> {
    include_str!("golden_vectors.txt")
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| {
            let (k, v) = l.split_once('=').unwrap();
            (k.trim().to_string(), v.trim().to_string())
        })
        .collect()
}

fn pk(g: &std::collections::HashMap<String, String>, k: &str) -> Pubkey {
    Pubkey::new_from_array(unhex(&g[k]).try_into().unwrap())
}

fn golden_message(g: &std::collections::HashMap<String, String>) -> SpendMessage {
    SpendMessage {
        action: g["msg.action"].parse().unwrap(),
        program_id: pk(g, "msg.program_id"),
        vault: pk(g, "msg.vault"),
        opened_slot: g["msg.opened_slot"].parse().unwrap(),
        seq: g["msg.seq"].parse().unwrap(),
        next_key: unhex(&g["msg.next_key"]).try_into().unwrap(),
        mint: pk(g, "msg.mint"),
        token_program: pk(g, "msg.token_program"),
        source: pk(g, "msg.source"),
        destination: pk(g, "msg.destination"),
        amount: g["msg.amount"].parse().unwrap(),
        flags: g["msg.flags"].parse().unwrap(),
    }
}

#[test]
fn golden_vectors_match() {
    let g = golden();
    let master: [u8; 32] = unhex(&g["master_seed"]).try_into().unwrap();
    let vi: u32 = g["vault_index"].parse().unwrap();
    let keys = vault_keys(&master, vi);
    assert_eq!(hex(&keys.id), g["id"]);
    assert_eq!(hex(&keys.seed), g["lmots_seed"]);
    assert_eq!(hex(&keys.public_key(0)), g["k0"]);
    assert_eq!(hex(&keys.public_key(1)), g["k1"]);
    let x0 = keys.private_chains(0);
    assert_eq!(hex(&x0[0]), g["x0_0"]);
    assert_eq!(hex(&x0[25]), g["x0_25"]);

    let m = golden_message(&g);
    assert_eq!(hex(&m.next_key), g["k1"]);
    let enc = m.encode();
    assert_eq!(hex(&enc), g["msg.encoded"]);

    let tries: u32 = g["sign.tries"].parse().unwrap();
    let (c, y) = keys.sign(m.seq, &enc, tries);
    assert_eq!(hex(&c), g["sig.c"]);
    let y_hex: String = y.iter().map(|v| hex(v)).collect();
    assert_eq!(y_hex, g["sig.y"]);
    let d = digits(&message_hash(&keys.id, m.seq, &c, &enc));
    assert_eq!(verify_hashes(&d).to_string(), g["sig.verify_hashes"]);
    assert_eq!(hex(&candidate_key(&keys.id, m.seq, &c, &y, &enc)), g["k0"]);

    // Vault PDA and commitment helper (same values in the TS tests).
    let program = pk(&g, "msg.program_id");
    let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, &keys.id, &keys.public_key(0)], &program);
    assert_eq!(hex(vault.as_ref()), g["vault_pda"]);

    let mldsa_pk: Vec<u8> = (0..1312u32).map(|i| ((i * 7 + 1) & 0xff) as u8).collect();
    let kh = anchor_lang::solana_program::keccak::hash(&mldsa_pk).to_bytes();
    assert_eq!(hex(&kh), g["commit.mldsa_pk_hash"]);
    let secret: [u8; 32] = unhex(&g["commit.secret"]).try_into().unwrap();
    assert_eq!(hex(&pq_commitment(&pk(&g, "commit.wallet"), &kh, &secret)), g["commit.value"]);
}

#[test]
fn signature_rejects_any_changed_byte() {
    let keys = vault_keys(&[7u8; 32], 3);
    let k = keys.public_key(5);
    let msg = sample_message(5);
    let enc = msg.encode();
    let (c, y) = keys.sign(5, &enc, 16);
    assert_eq!(candidate_key(&keys.id, 5, &c, &y, &enc), k);
    // every message byte
    for i in 0..LEN {
        let mut e = enc;
        e[i] ^= 1;
        assert_ne!(candidate_key(&keys.id, 5, &c, &y, &e), k, "byte {i}");
    }
    // the randomizer, every chain value, the key index, the identifier
    let mut c2 = c;
    c2[0] ^= 0x80;
    assert_ne!(candidate_key(&keys.id, 5, &c2, &y, &enc), k);
    for i in 0..P {
        let mut y2 = y;
        y2[i][23] ^= 1;
        assert_ne!(candidate_key(&keys.id, 5, &c, &y2, &enc), k, "chain {i}");
    }
    assert_ne!(candidate_key(&keys.id, 6, &c, &y, &enc), k);
    let mut id2 = keys.id;
    id2[0] ^= 1;
    assert_ne!(candidate_key(&id2, 5, &c, &y, &enc), k);
    // a signature made with another key index does not verify under this one
    let (c6, y6) = keys.sign(6, &enc, 16);
    assert_ne!(candidate_key(&keys.id, 5, &c6, &y6, &enc), k);
}

#[test]
fn checksum_blocks_forward_forgery() {
    // From one signature an attacker can only walk chains FORWARD, i.e.
    // produce digits >= the signed ones. With the checksum, a different
    // digit vector always has some digit that is smaller: no forgery.
    let mut seed = 0x1234_5678_9abc_def0u64;
    let mut rnd = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for _ in 0..20_000 {
        let mut a = [0u8; N];
        let mut b = [0u8; N];
        for i in 0..N {
            a[i] = rnd() as u8;
            b[i] = if rnd() % 3 == 0 { a[i] } else { rnd() as u8 };
        }
        if a == b {
            continue;
        }
        let (da, db) = (digits(&a), digits(&b));
        assert!(da.iter().zip(db.iter()).any(|(x, y)| y < x), "dominating digits found");
    }
}

#[test]
fn verification_cost_bounds() {
    assert_eq!(verify_hashes(&digits(&[MAX_DIGIT; N])), 255 * 2 - 0 - 0);
    // all-zero Q: checksum 24*255 = 6120 = 0x17e8
    let d = digits(&[0u8; N]);
    assert_eq!((d[24], d[25]), (0x17, 0xe8));
    assert_eq!(verify_hashes(&d), 6120 + (255 - 0x17) + (255 - 0xe8));
    // grinding the randomizer lowers the cost on average
    let keys = vault_keys(&[9u8; 32], 0);
    let enc = sample_message(0).encode();
    let one = verify_hashes(&digits(&message_hash(&keys.id, 0, &keys.sign(0, &enc, 1).0, &enc)));
    let many = verify_hashes(&digits(&message_hash(&keys.id, 0, &keys.sign(0, &enc, 4096).0, &enc)));
    assert!(many <= one);
    assert!(many < 2600, "4096 tries should land well below the 3315 mean, got {many}");
    // the cost only depends on the checksum's high byte
    for qh in [[0u8; N], [MAX_DIGIT; N], [128u8; N], [17u8; N]] {
        let d = digits(&qh);
        assert_eq!(verify_hashes(&d), 255 * (d[24] as u32 + 2));
    }
}

#[test]
fn message_layout_is_fixed() {
    let m = sample_message(0x0102_0304);
    let e = m.encode();
    assert_eq!(&e[0..16], b"SWD-QVAULT-MSG-1");
    assert_eq!(e[16], ACTION_SPEND_TOKEN);
    assert_eq!(&e[89..93], &0x0102_0304u32.to_le_bytes());
    assert_eq!(&e[245..253], &m.amount.to_le_bytes());
    assert_eq!(e[253], m.flags);
    let mut sol = sample_message(0);
    sol.action = ACTION_SPEND_SOL;
    assert_ne!(sol.encode(), sample_message(0).encode());
}

#[test]
fn commitment_in_force_rule() {
    let mut r = PqCommitment {
        wallet: Pubkey::new_unique(),
        bump: 255,
        active: [0; 32],
        active_since: 0,
        pending: [1; 32],
        pending_since: 1000,
        has_pending: true,
        changes: 1,
    };
    assert_eq!(r.in_force_at(1000), None);
    assert_eq!(r.in_force_at(1000 + COMMIT_DELAY_SECS - 1), None);
    assert_eq!(r.in_force_at(1000 + COMMIT_DELAY_SECS), Some([1; 32]));
    promote_if_mature(&mut r, 1000 + COMMIT_DELAY_SECS);
    assert!(!r.has_pending);
    assert_eq!(r.active_since, 1000 + COMMIT_DELAY_SECS);
    // a rotation: the old one stays in force until the new one matures
    r.pending = [2; 32];
    r.pending_since = 5000;
    r.has_pending = true;
    assert_eq!(r.in_force_at(5000 + COMMIT_DELAY_SECS - 1), Some([1; 32]));
    assert_eq!(r.in_force_at(5000 + COMMIT_DELAY_SECS), Some([2; 32]));
    // a revoke ([0; 32]) also waits, then means "no commitment"
    r.pending = [0; 32];
    assert_eq!(r.in_force_at(5000), Some([1; 32]));
    assert_eq!(r.in_force_at(5000 + COMMIT_DELAY_SECS), None);
}

fn sample_message(seq: u32) -> SpendMessage {
    SpendMessage {
        action: ACTION_SPEND_TOKEN,
        program_id: crate::ID,
        vault: Pubkey::new_from_array([3; 32]),
        opened_slot: 42,
        seq,
        next_key: [5; N],
        mint: Pubkey::new_from_array([6; 32]),
        token_program: anchor_spl::token::ID,
        source: Pubkey::new_from_array([8; 32]),
        destination: Pubkey::new_from_array([9; 32]),
        amount: 1_234_567,
        flags: 1,
    }
}
