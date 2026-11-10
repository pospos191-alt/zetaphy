//! The exact bytes a vault's one-time key signs. Fixed length, fixed field
//! order, no optional fields: one message has exactly one encoding, and no
//! field can be shifted into another (no malleability).
//!
//! | off | len | field |
//! |----:|----:|-------|
//! |   0 |  16 | domain tag `SWD-QVAULT-MSG-1` |
//! |  16 |   1 | action (1 = spend SOL, 2 = spend token) |
//! |  17 |  32 | program id |
//! |  49 |  32 | vault address |
//! |  81 |   8 | vault `opened_slot` (u64 LE) |
//! |  89 |   4 | key index `seq` (u32 LE; also LM-OTS `q`) |
//! |  93 |  24 | next one-time public key K' (the key that replaces this one) |
//! | 117 |  32 | mint (all zero for SOL) |
//! | 149 |  32 | token program (all zero for SOL) |
//! | 181 |  32 | source: the vault's token account (the vault itself for SOL) |
//! | 213 |  32 | destination (a wallet for SOL, a token account for tokens) |
//! | 245 |   8 | amount (u64 LE, lamports or base units) |
//! | 253 |   1 | flags (bit 0: close the emptied source token account into the vault) |
//!
//! Replay: `seq` and K change on every spend, so a used signature never
//! verifies again; `opened_slot` and the vault address tie it to one vault.

use anchor_lang::prelude::Pubkey;

use crate::wots::N;

pub const DOMAIN: [u8; 16] = *b"SWD-QVAULT-MSG-1";
pub const LEN: usize = 254;

pub const ACTION_SPEND_SOL: u8 = 1;
pub const ACTION_SPEND_TOKEN: u8 = 2;

/// Close the vault's source token account (into the vault) after it was emptied.
pub const FLAG_CLOSE_SOURCE: u8 = 1;
pub const KNOWN_FLAGS: u8 = FLAG_CLOSE_SOURCE;

pub struct SpendMessage {
    pub action: u8,
    pub program_id: Pubkey,
    pub vault: Pubkey,
    pub opened_slot: u64,
    pub seq: u32,
    pub next_key: [u8; N],
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub source: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub flags: u8,
}

impl SpendMessage {
    pub fn encode(&self) -> [u8; LEN] {
        let mut m = [0u8; LEN];
        m[0..16].copy_from_slice(&DOMAIN);
        m[16] = self.action;
        m[17..49].copy_from_slice(self.program_id.as_ref());
        m[49..81].copy_from_slice(self.vault.as_ref());
        m[81..89].copy_from_slice(&self.opened_slot.to_le_bytes());
        m[89..93].copy_from_slice(&self.seq.to_le_bytes());
        m[93..117].copy_from_slice(&self.next_key);
        m[117..149].copy_from_slice(self.mint.as_ref());
        m[149..181].copy_from_slice(self.token_program.as_ref());
        m[181..213].copy_from_slice(self.source.as_ref());
        m[213..245].copy_from_slice(self.destination.as_ref());
        m[245..253].copy_from_slice(&self.amount.to_le_bytes());
        m[253] = self.flags;
        m
    }
}
