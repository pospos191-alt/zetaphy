//! Jupiter AMM interface for SWD AMM **SWDMM v2** pools.
//!
//! Implements `jupiter_amm_interface::Amm` (crate version 0.6.1) for the
//! `SwdmmV2Pool` account of the `swd_amm` program
//! (`programs/swd_amm` in this repository): full-range constant-product
//! pools with a scheduled base fee, an optional volatility fee and an
//! optional Pyth price guard (see `docs/SWDMM_V2.md`).
//!
//! Quote math is the program's own: `swdmm_math.rs` is compiled into this
//! crate unchanged (`#[path]` below), and `quote::quote_exact_in` replays
//! `swap_v2` step by step. `tests/program_parity.rs` compares against the
//! program crate itself.
//!
//! Not covered: the legacy constant-product `Pool` (mandatory oracle, being
//! superseded by SWDMM v2) and DLMM pools. Exact-out is not supported
//! (the program has no exact-out instruction).

#[path = "../../../programs/swd_amm/src/swdmm_math.rs"]
#[allow(dead_code, clippy::all)]
pub mod swdmm_math;

pub mod quote;
pub mod state;

use anyhow::{anyhow, ensure, Context, Result};
use jupiter_amm_interface::{
    try_get_account_data, AccountMap, Amm, AmmContext, ClockRef, KeyedAccount, Quote, QuoteParams, Swap,
    SwapAndAccountMetas, SwapMode, SwapParams,
};
use rust_decimal::Decimal;
use solana_instruction::AccountMeta;
use solana_pubkey::{pubkey, Pubkey};
use std::sync::atomic::Ordering;

use quote::{OracleInputs, QuoteEnv};
use state::{mint_decimals, GovernanceSettings, PriceUpdate, SwdmmV2Pool};

pub const LABEL: &str = "SWD AMM";

/// The program id this SDK was written against (devnet). The mainnet id
/// does not exist yet; `from_keyed_account` takes the program id from the
/// pool account's owner, so nothing here has to change at launch except
/// this constant (used only as a default / in docs).
pub const SWD_AMM_PROGRAM_ID: Pubkey = pubkey!("3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL");

pub const GOV_SETTINGS_SEED: &[u8] = b"gov_settings";

/// Pyth push-oracle program: sponsored price-feed accounts are PDAs of
/// this program with seeds `[shard_id (u16 LE), feed_id]` and are owned by
/// the Pyth receiver program (`rec5EKMG…`, what `swd_amm` checks).
/// Taken from pyth-solana-receiver-sdk's `get_price_feed_address`;
/// re-check against Pyth's docs before relying on it on mainnet.
pub const PYTH_PUSH_ORACLE_PROGRAM_ID: Pubkey = pubkey!("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
pub const PYTH_DEFAULT_SHARD: u16 = 0;

/// `jupiter-amm-interface` has no `Swap` variant for SWD AMM: Jupiter adds
/// one (and the matching CPI encoding in its router) when it onboards a
/// DEX. Until then this placeholder is returned; see README.
pub const PLACEHOLDER_SWAP: Swap = Swap::TokenSwap;

/// Number of accounts in a `swap_v2` instruction.
pub const SWAP_V2_ACCOUNTS_LEN: usize = 13;

pub fn gov_settings_address(program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[GOV_SETTINGS_SEED], program_id).0
}

pub fn pyth_price_feed_address(shard: u16, feed_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[&shard.to_le_bytes(), feed_id], &PYTH_PUSH_ORACLE_PROGRAM_ID).0
}

#[derive(Clone)]
pub struct SwdAmm {
    key: Pubkey,
    program_id: Pubkey,
    pool: SwdmmV2Pool,
    settings_key: Pubkey,
    protocol_fee_share_bps: Option<u16>,
    price_update_a: Option<Pubkey>,
    price_update_b: Option<Pubkey>,
    oracle: Option<OracleInputs>,
    decimals_a: Option<u8>,
    decimals_b: Option<u8>,
    clock: ClockRef,
}

impl SwdAmm {
    pub fn pool(&self) -> &SwdmmV2Pool {
        &self.pool
    }

    fn env(&self) -> Result<QuoteEnv> {
        let share = self.protocol_fee_share_bps.context("GovernanceSettings not loaded; call update() first")?;
        Ok(QuoteEnv {
            now: self.clock.unix_timestamp.load(Ordering::Relaxed),
            slot: self.clock.slot.load(Ordering::Relaxed),
            protocol_fee_share_bps: share as u64,
        })
    }
}

impl Amm for SwdAmm {
    fn from_keyed_account(keyed_account: &KeyedAccount, amm_context: &AmmContext) -> Result<Self> {
        let pool = SwdmmV2Pool::decode(&keyed_account.account.data)?;
        let program_id = keyed_account.account.owner;
        let (price_update_a, price_update_b) = if pool.oracle.enabled {
            (
                Some(pyth_price_feed_address(PYTH_DEFAULT_SHARD, &pool.oracle.pyth_feed_id_a)),
                Some(pyth_price_feed_address(PYTH_DEFAULT_SHARD, &pool.oracle.pyth_feed_id_b)),
            )
        } else {
            (None, None)
        };
        Ok(Self {
            key: keyed_account.key,
            program_id,
            settings_key: gov_settings_address(&program_id),
            pool,
            protocol_fee_share_bps: None,
            price_update_a,
            price_update_b,
            oracle: None,
            decimals_a: None,
            decimals_b: None,
            clock: amm_context.clock_ref.clone(),
        })
    }

    fn label(&self) -> String {
        LABEL.to_string()
    }

    fn program_id(&self) -> Pubkey {
        self.program_id
    }

    fn key(&self) -> Pubkey {
        self.key
    }

    fn get_reserve_mints(&self) -> Vec<Pubkey> {
        vec![self.pool.mint_a, self.pool.mint_b]
    }

    fn get_accounts_to_update(&self) -> Vec<Pubkey> {
        let mut v = vec![self.key, self.settings_key];
        if let (Some(a), Some(b)) = (self.price_update_a, self.price_update_b) {
            v.extend([a, b, self.pool.mint_a, self.pool.mint_b]);
        }
        v
    }

    fn update(&mut self, account_map: &AccountMap) -> Result<()> {
        self.pool = SwdmmV2Pool::decode(try_get_account_data(account_map, &self.key)?)?;
        let settings = GovernanceSettings::decode(try_get_account_data(account_map, &self.settings_key)?)?;
        self.protocol_fee_share_bps = Some(settings.protocol_fee_share_bps);
        if let (Some(a), Some(b)) = (self.price_update_a, self.price_update_b) {
            if self.decimals_a.is_none() {
                self.decimals_a = Some(mint_decimals(try_get_account_data(account_map, &self.pool.mint_a)?)?);
                self.decimals_b = Some(mint_decimals(try_get_account_data(account_map, &self.pool.mint_b)?)?);
            }
            self.oracle = Some(OracleInputs {
                price_a: PriceUpdate::decode(try_get_account_data(account_map, &a)?)?,
                price_b: PriceUpdate::decode(try_get_account_data(account_map, &b)?)?,
                decimals_a: self.decimals_a.unwrap(),
                decimals_b: self.decimals_b.unwrap(),
            });
        }
        Ok(())
    }

    fn quote(&self, p: &QuoteParams) -> Result<Quote> {
        ensure!(p.swap_mode == SwapMode::ExactIn, "SWD AMM supports ExactIn only");
        let a_to_b = if p.input_mint == self.pool.mint_a && p.output_mint == self.pool.mint_b {
            true
        } else if p.input_mint == self.pool.mint_b && p.output_mint == self.pool.mint_a {
            false
        } else {
            return Err(anyhow!("mints do not match this pool"));
        };
        let q = quote::quote_exact_in(&self.pool, &self.env()?, self.oracle.as_ref(), p.amount, a_to_b)?;
        Ok(Quote {
            in_amount: p.amount,
            out_amount: q.amount_out,
            fee_amount: q.fee,
            fee_mint: if q.fee_in_b { self.pool.mint_b } else { self.pool.mint_a },
            fee_pct: Decimal::new(q.fee_bps as i64, 4),
        })
    }

    fn get_swap_and_account_metas(&self, sp: &SwapParams) -> Result<SwapAndAccountMetas> {
        let a_to_b = if sp.source_mint == self.pool.mint_a && sp.destination_mint == self.pool.mint_b {
            true
        } else if sp.source_mint == self.pool.mint_b && sp.destination_mint == self.pool.mint_a {
            false
        } else {
            return Err(anyhow!("mints do not match this pool"));
        };
        let (trader_a, trader_b) = if a_to_b {
            (sp.source_token_account, sp.destination_token_account)
        } else {
            (sp.destination_token_account, sp.source_token_account)
        };
        // Anchor encodes an absent `Option<Account>` as the program id.
        let none = AccountMeta::new_readonly(self.program_id, false);
        let pa = self.price_update_a.map(|k| AccountMeta::new_readonly(k, false)).unwrap_or(none.clone());
        let pb = self.price_update_b.map(|k| AccountMeta::new_readonly(k, false)).unwrap_or(none);
        // Order = `SwapV2` accounts struct in programs/swd_amm/src/swdmm_v2.rs.
        let account_metas = vec![
            AccountMeta::new_readonly(sp.token_transfer_authority, true), // trader
            AccountMeta::new_readonly(self.settings_key, false),          // settings
            AccountMeta::new(self.key, false),                            // pool
            AccountMeta::new_readonly(self.pool.mint_a, false),           // mint_a
            AccountMeta::new_readonly(self.pool.mint_b, false),           // mint_b
            AccountMeta::new(self.pool.vault_a, false),                   // vault_a
            AccountMeta::new(self.pool.vault_b, false),                   // vault_b
            AccountMeta::new(trader_a, false),                            // trader_token_a
            AccountMeta::new(trader_b, false),                            // trader_token_b
            AccountMeta::new_readonly(self.pool.token_program_a, false),  // token_program_a
            AccountMeta::new_readonly(self.pool.token_program_b, false),  // token_program_b
            pa,                                                           // price_update_a
            pb,                                                           // price_update_b
        ];
        debug_assert_eq!(account_metas.len(), SWAP_V2_ACCOUNTS_LEN);
        Ok(SwapAndAccountMetas { swap: PLACEHOLDER_SWAP, account_metas })
    }

    fn clone_amm(&self) -> Box<dyn Amm + Send + Sync> {
        Box::new(self.clone())
    }

    fn get_accounts_len(&self) -> usize {
        SWAP_V2_ACCOUNTS_LEN
    }

    fn is_active(&self) -> bool {
        !self.pool.swap_paused && self.pool.reserve_a > 0 && self.pool.reserve_b > 0
    }

    fn program_dependencies(&self) -> Vec<(Pubkey, String)> {
        vec![]
    }
}

/// The 8-byte Anchor instruction discriminator of `swap_v2`
/// (sha256("global:swap_v2")[..8]); data = this ‖ amount_in u64 LE ‖
/// min_amount_out u64 LE ‖ a_to_b u8. For Jupiter's router team.
pub const SWAP_V2_IX_DISCRIMINATOR: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];

pub fn swap_v2_ix_data(amount_in: u64, min_amount_out: u64, a_to_b: bool) -> Vec<u8> {
    let mut d = Vec::with_capacity(25);
    d.extend_from_slice(&SWAP_V2_IX_DISCRIMINATOR);
    d.extend_from_slice(&amount_in.to_le_bytes());
    d.extend_from_slice(&min_amount_out.to_le_bytes());
    d.push(a_to_b as u8);
    d
}
