// A tiny wire-format transaction builder for the tests (legacy / v0), no Solana dependency.
#![allow(dead_code)]
use base64::Engine;

pub const BUYER: &str = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
pub const ATTACKER: &str = "HUj3cyrb8eoZDJ6CWFSkQxjxDvK8Wn8PPcnYZbFEsWLx";
pub const WSOL_ATA: &str = "4T8mq3mX7nB2cR8tY4wZ1aS6dF5gH3jK2kP9o5867iN";
pub const SYS: &str = "11111111111111111111111111111111";
pub const CB: &str = "ComputeBudget111111111111111111111111111111";
pub const TOK: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const JUP: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
pub const EVIL: &str = "Evi1Program111111111111111111111111111111111";

pub fn b58dec(s: &str) -> Vec<u8> {
    const A: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut out: Vec<u8> = Vec::new(); // little-endian bytes
    for c in s.bytes() {
        let mut carry = A.iter().position(|&x| x == c).expect("base58") as u32;
        for b in out.iter_mut() {
            carry += (*b as u32) * 58;
            *b = (carry & 255) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            out.push((carry & 255) as u8);
            carry >>= 8;
        }
    }
    for c in s.bytes() {
        if c != b'1' {
            break;
        }
        out.push(0);
    }
    out.reverse();
    let mut v = vec![0u8; 32usize.saturating_sub(out.len())];
    v.extend(out);
    v
}
fn sv(mut n: usize, o: &mut Vec<u8>) {
    loop {
        let mut b = (n & 0x7f) as u8;
        n >>= 7;
        if n > 0 {
            b |= 0x80;
        }
        o.push(b);
        if n == 0 {
            break;
        }
    }
}
pub fn le(v: u64, n: usize) -> Vec<u8> {
    v.to_le_bytes()[..n].to_vec()
}
pub struct Ix {
    pub program: &'static str,
    pub accounts: Vec<&'static str>,
    pub data: Vec<u8>,
}
pub fn transfer(from: &'static str, to: &'static str, lamports: u64) -> Ix {
    let mut data = le(2, 4);
    data.extend(le(lamports, 8));
    Ix { program: SYS, accounts: vec![from, to], data }
}
pub struct Opts {
    pub fee_payer: &'static str,
    pub signers: usize,
    pub signed: bool,
    pub lamports: u64,
    pub extra_keys: Vec<&'static str>,
}
impl Default for Opts {
    fn default() -> Self {
        Opts { fee_payer: BUYER, signers: 1, signed: false, lamports: 100_000_000, extra_keys: vec![] }
    }
}
/// What a real Jupiter buy looks like (v0 + one lookup table): compute budget, wrap SOL, the route, close wSOL back.
pub fn buy_tx(extra: Vec<Ix>, o: Opts) -> Vec<u8> {
    let mut keys: Vec<&str> = vec![o.fee_payer, BUYER];
    keys.extend(o.extra_keys.iter().copied());
    keys.extend([WSOL_ATA, ATTACKER, SYS, CB, TOK, JUP, EVIL]);
    let mut uniq: Vec<&str> = Vec::new();
    for k in keys {
        if !uniq.contains(&k) {
            uniq.push(k);
        }
    }
    let mut ixs = vec![
        Ix { program: CB, accounts: vec![], data: [vec![2], le(200_000, 4)].concat() },
        transfer(BUYER, WSOL_ATA, o.lamports),
        Ix { program: TOK, accounts: vec![WSOL_ATA], data: vec![17] },
        Ix { program: JUP, accounts: vec![BUYER, WSOL_ATA, "LOOKUP"], data: vec![1, 2, 3] },
        Ix { program: TOK, accounts: vec![WSOL_ATA, BUYER, BUYER], data: vec![9] },
    ];
    ixs.extend(extra);
    build(&uniq, o.signers, true, &ixs, 1, o.signed)
}
pub fn build(keys: &[&str], signers: usize, v0: bool, ixs: &[Ix], lookups: usize, signed: bool) -> Vec<u8> {
    let idx = |k: &str| keys.iter().position(|x| *x == k).expect("key") as u8;
    let mut m = Vec::new();
    if v0 {
        m.push(0x80);
    }
    m.extend([signers as u8, 0, 0]);
    sv(keys.len(), &mut m);
    for k in keys {
        m.extend(b58dec(k));
    }
    m.extend([7u8; 32]);
    sv(ixs.len(), &mut m);
    for ix in ixs {
        m.push(idx(ix.program));
        sv(ix.accounts.len(), &mut m);
        for a in &ix.accounts {
            m.push(if *a == "LOOKUP" { keys.len() as u8 } else { idx(a) });
        }
        sv(ix.data.len(), &mut m);
        m.extend(&ix.data);
    }
    if v0 {
        sv(lookups, &mut m);
        for _ in 0..lookups {
            m.extend([9u8; 32]);
            m.extend([1, 0, 0]);
        }
    }
    let mut out = Vec::new();
    sv(signers, &mut out);
    for _ in 0..signers {
        out.extend([if signed { 1u8 } else { 0 }; 64]);
    }
    out.extend(m);
    out
}
pub fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}
