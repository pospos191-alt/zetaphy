//! Reads an unsigned Solana transaction (legacy or v0 wire format) with no Solana dependency and says what it does to
//! one account. [`crate::SwdClient::buy_swd_transaction`] runs it on every transaction the server sends, so a
//! compromised or impersonated server (or a wrong base URL) cannot slip an extra instruction past the caller.
//!
//! What it cannot see: what a program does inside (CPI). That is why the default policy also refuses programs it
//! does not know; the wallet's own simulation is still the last check before signing.

/// Programs a Buy SWD transaction may call at the top level by default.
pub const KNOWN_PROGRAMS: &[(&str, &str)] = &[
    ("11111111111111111111111111111111", "System"),
    ("ComputeBudget111111111111111111111111111111", "Compute Budget"),
    ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "SPL Token"),
    ("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "Token-2022"),
    ("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "Associated Token"),
    ("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo"),
    ("Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo", "Memo (v1)"),
    ("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "Jupiter v6"),
];
const SYSTEM: &str = "11111111111111111111111111111111";
const TOKEN_PROGRAMS: [&str; 2] = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
/// An account index that comes from an address lookup table (not resolvable offline).
pub const LOOKUP: &str = "(lookup table)";

/// One instruction: program, accounts (base58, or [`LOOKUP`]), data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedInstruction {
    pub program_id: String,
    pub accounts: Vec<String>,
    pub data: Vec<u8>,
}

/// A decoded wire-format transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedTransaction {
    /// None = legacy, Some(0) = v0
    pub version: Option<u8>,
    pub signatures: Vec<[u8; 64]>,
    pub static_keys: Vec<String>,
    /// the first `num_required_signatures` keys
    pub signers: Vec<String>,
    pub fee_payer: String,
    pub recent_blockhash: String,
    pub instructions: Vec<DecodedInstruction>,
    /// address lookup tables used (their addresses)
    pub lookup_tables: Vec<String>,
}

/// What [`inspect_transaction`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxInspection {
    pub fee_payer: String,
    pub signers: Vec<String>,
    pub programs: Vec<String>,
    pub unknown_programs: Vec<String>,
    /// lamports leaving the account through top-level System instructions
    pub sol_out_lamports: u128,
    /// why the transaction is not safe to sign for the account (empty = nothing found)
    pub problems: Vec<String>,
    pub uses_lookup_tables: bool,
}

/// The checks' settings.
#[derive(Debug, Clone, Default)]
pub struct InspectPolicy {
    /// program ids allowed at the top level besides [`KNOWN_PROGRAMS`]
    pub allow_programs: Vec<String>,
    /// the most lamports the transaction may move out of the account (None = no limit)
    pub max_sol_out_lamports: Option<u128>,
}

const B58: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/// Bytes → base58.
pub fn base58(bytes: &[u8]) -> String {
    let mut digits: Vec<u8> = Vec::new(); // little-endian base-58 digits
    for &b in bytes {
        let mut carry = b as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let zeros = bytes.iter().take_while(|&&b| b == 0).count();
    let mut s = String::with_capacity(zeros + digits.len());
    s.extend(std::iter::repeat('1').take(zeros));
    s.extend(digits.iter().rev().map(|&d| B58[d as usize] as char));
    s
}

struct Reader<'a> {
    b: &'a [u8],
    o: usize,
}
impl<'a> Reader<'a> {
    fn u8(&mut self) -> Result<u8, String> {
        let v = *self.b.get(self.o).ok_or("truncated transaction")?;
        self.o += 1;
        Ok(v)
    }
    fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.o.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("truncated transaction")?;
        let s = &self.b[self.o..end];
        self.o = end;
        Ok(s)
    }
    /// compact-u16
    fn len(&mut self) -> Result<usize, String> {
        let mut v = 0usize;
        for i in 0..3 {
            let x = self.u8()?;
            v |= ((x & 0x7f) as usize) << (7 * i);
            if x & 0x80 == 0 {
                return Ok(v);
            }
        }
        Err("bad length".into())
    }
}

/// Wire bytes → transaction. Errors on anything malformed (truncated, trailing bytes, bad indexes).
pub fn decode_transaction(bytes: &[u8]) -> Result<DecodedTransaction, String> {
    let mut r = Reader { b: bytes, o: 0 };
    let nsig = r.len()?;
    if !(1..=64).contains(&nsig) {
        return Err("bad signature count".into());
    }
    let mut signatures = Vec::with_capacity(nsig);
    for _ in 0..nsig {
        let mut s = [0u8; 64];
        s.copy_from_slice(r.bytes(64)?);
        signatures.push(s);
    }
    let mut first = r.u8()?;
    let mut version = None;
    if first & 0x80 != 0 {
        if first & 0x7f != 0 {
            return Err(format!("unsupported transaction version {}", first & 0x7f));
        }
        version = Some(0);
        first = r.u8()?;
    }
    let required = first as usize;
    r.u8()?;
    r.u8()?;
    let nkeys = r.len()?;
    let mut static_keys = Vec::with_capacity(nkeys);
    for _ in 0..nkeys {
        static_keys.push(base58(r.bytes(32)?));
    }
    if nkeys == 0 || required == 0 || required > nkeys || required != nsig {
        return Err("bad signer count".into());
    }
    let recent_blockhash = base58(r.bytes(32)?);
    let mut raw = Vec::new();
    for _ in 0..r.len()? {
        let program = r.u8()? as usize;
        let mut idx = Vec::new();
        for _ in 0..r.len()? {
            idx.push(r.u8()? as usize);
        }
        let n = r.len()?;
        raw.push((program, idx, r.bytes(n)?.to_vec()));
    }
    let mut lookup_tables = Vec::new();
    let mut loaded = 0usize;
    if version.is_some() {
        for _ in 0..r.len()? {
            lookup_tables.push(base58(r.bytes(32)?));
            let w = r.len()?;
            r.bytes(w)?;
            let ro = r.len()?;
            r.bytes(ro)?;
            loaded += w + ro;
        }
    }
    if r.o != bytes.len() {
        return Err("trailing bytes after the transaction".into());
    }
    let mut instructions = Vec::with_capacity(raw.len());
    for (program, idx, data) in raw {
        let program_id = static_keys.get(program).ok_or("program id index out of range")?.clone();
        let mut accounts = Vec::with_capacity(idx.len());
        for i in idx {
            accounts.push(if i < nkeys {
                static_keys[i].clone()
            } else if i < nkeys + loaded {
                LOOKUP.to_string()
            } else {
                return Err("account index out of range".into());
            });
        }
        instructions.push(DecodedInstruction { program_id, accounts, data });
    }
    Ok(DecodedTransaction {
        version,
        signatures,
        signers: static_keys[..required].to_vec(),
        fee_payer: static_keys[0].clone(),
        static_keys,
        recent_blockhash,
        instructions,
        lookup_tables,
    })
}

fn u32le(d: &[u8], at: usize) -> u32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&d[at..at + 4]);
    u32::from_le_bytes(b)
}
fn u64le(d: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[at..at + 8]);
    u64::from_le_bytes(b)
}

/// What a transaction does to `account` (base58), checked against `policy`.
pub fn inspect_transaction(tx: &DecodedTransaction, account: &str, policy: &InspectPolicy) -> TxInspection {
    let mut problems = Vec::new();
    let mut programs: Vec<String> = Vec::new();
    let mut sol_out: u128 = 0;
    if tx.fee_payer != account {
        problems.push(format!("the fee payer is {}, not {account}", tx.fee_payer));
    }
    let others: Vec<&String> = tx.signers.iter().filter(|s| *s != account).collect();
    if !others.is_empty() {
        problems.push(format!("other signers are required: {}", others.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
    }
    if tx.signatures.iter().any(|s| s.iter().any(|&b| b != 0)) {
        problems.push("the transaction arrived already (partly) signed".into());
    }
    for ix in &tx.instructions {
        if !programs.contains(&ix.program_id) {
            programs.push(ix.program_id.clone());
        }
        let d = &ix.data;
        let a = |i: usize| ix.accounts.get(i).map(String::as_str).unwrap_or("?");
        if ix.program_id == SYSTEM && d.len() >= 4 {
            let kind = u32le(d, 0);
            if (kind == 0 || kind == 2) && d.len() >= 12 && a(0) == account {
                sol_out += u64le(d, 4) as u128;
            }
            if kind == 11 && d.len() >= 12 && a(1) == account {
                sol_out += u64le(d, 4) as u128;
            }
            if kind == 3 && d.len() >= 44 && a(0) == account {
                let seed_len = u64le(d, 36);
                if seed_len <= 32 && d.len() >= 44 + seed_len as usize + 8 {
                    sol_out += u64le(d, 44 + seed_len as usize) as u128;
                } else {
                    problems.push("unreadable CreateAccountWithSeed".into());
                }
            }
            if (kind == 1 && a(0) == account) || (kind == 10 && a(1) == account) {
                problems.push("System Assign: gives the wallet account to another program".into());
            }
            if (kind == 8 && a(0) == account) || (kind == 9 && a(1) == account) {
                problems.push("System Allocate on the wallet account".into());
            }
            if kind == 4 || kind == 7 {
                problems.push("nonce account instruction (a transaction that never expires)".into());
            }
        }
        if TOKEN_PROGRAMS.contains(&ix.program_id.as_str()) && !d.is_empty() {
            let who = match d[0] {
                3 | 4 | 8 | 9 | 15 => Some(2),
                6 => Some(1),
                12 | 13 => Some(3),
                _ => None,
            };
            if who.map(|w| a(w) == account).unwrap_or(false) {
                match d[0] {
                    4 => problems.push(format!("SPL Approve: lets {} move your tokens", a(1))),
                    13 => problems.push(format!("SPL Approve: lets {} move your tokens", a(2))),
                    6 => problems.push("SPL SetAuthority: hands a token account (or mint) of yours to someone else".into()),
                    3 => problems.push(format!("SPL transfer of your tokens to {}", a(1))),
                    12 => problems.push(format!("SPL transfer of your tokens to {}", a(2))),
                    8 | 15 => problems.push("SPL Burn of your tokens".into()),
                    9 if a(1) != account => problems.push(format!("SPL CloseAccount sends the account's SOL to {}", a(1))),
                    _ => {}
                }
            }
        }
    }
    let unknown_programs: Vec<String> = programs
        .iter()
        .filter(|p| !KNOWN_PROGRAMS.iter().any(|(k, _)| k == p) && !policy.allow_programs.contains(p))
        .cloned()
        .collect();
    if !unknown_programs.is_empty() {
        problems.push(format!("unknown programs: {}", unknown_programs.join(", ")));
    }
    if let Some(max) = policy.max_sol_out_lamports {
        if sol_out > max {
            problems.push(format!("moves {sol_out} lamports out of the account, more than the {max} allowed"));
        }
    }
    TxInspection {
        fee_payer: tx.fee_payer.clone(),
        signers: tx.signers.clone(),
        programs,
        unknown_programs,
        sol_out_lamports: sol_out,
        problems,
        uses_lookup_tables: !tx.lookup_tables.is_empty(),
    }
}
