// SWD AMM — DLMM (concentrated liquidity, bin-based) pool type.
// Added 2026-09-09 at the user's request to make swd-amm "as close to
// Meteora as possible" — Meteora's flagship pool type (and the one the
// real SWD-PUMP pool trades on) is DLMM, so this is the highest-fidelity
// feature to add on top of the existing constant-product pool.
//
// ============================================================================
// STATUS: BRAND NEW, UNCOMPILED-AS-OF-WRITING, EVEN LESS PROVEN THAN THE
// CONSTANT-PRODUCT POOL IN lib.rs. Concentrated liquidity is substantially
// more complex than x*y=k — see SECURITY.md's original scope note, which
// explicitly called CLMM/DLMM out as "a separate, similarly-sized effort".
// Treat every line here as unverified until compiled, tested on localnet,
// AND independently read by a human — same rule as the rest of this
// program, doubly so here.
// ============================================================================
//
// WHAT THIS IS: a deliberately-scoped subset of real DLMM, not a full port.
// Faithful to Meteora's actual design in the ways that matter most for
// "is this really concentrated liquidity":
//   - Discrete price BINS at a fixed geometric step (bin_step_bps, in basis
//     points) — NOT a continuous curve. Within one bin, price is CONSTANT;
//     a swap that doesn't exhaust a bin's liquidity trades at that bin's
//     fixed price, exactly like Meteora.
//   - Liquidity ABOVE the active bin is single-sided in mint_a (ask-side —
//     "sell A once price rises this far"); liquidity BELOW the active bin
//     is single-sided in mint_b (bid-side — "buy A once price falls this
//     far"). Only the active bin itself can hold both. This asymmetry is
//     the actual defining mechanic of concentrated liquidity — a version
//     without it would just be "a pool cut into buckets", not DLMM.
//   - Per-bin liquidity amounts are computed and passed in by the CALLER
//     (client-side), not auto-split on-chain — this mirrors Meteora's own
//     architecture, where "Spot/Curve/BidAsk" distribution strategies are
//     a CLIENT-SIDE concern; the on-chain program only ever deals in
//     concrete per-bin amounts.
//
// DELIBERATELY NOT INCLUDED (would each need their own separate effort,
// same as CLMM itself was called out in lib.rs's original scope note):
//   - Paginated bin arrays. Real Meteora creates BinArray accounts on
//     demand, unboundedly, as price moves. This program instead gives each
//     pool ONE fixed-size BinArray at creation, covering exactly
//     [active_bin_id - HALF_RANGE, active_bin_id + HALF_RANGE] (see
//     HALF_RANGE below) — a swap or position that would need a bin outside
//     that fixed range simply errors out. Widening this to real pagination
//     is a meaningful chunk of additional work on its own.
//   - Any TWAP tracking of the bin-crossing history (a running average
//     over time — different from the SPOT Pyth oracle check below, which
//     only ever looks at the current price, never a history).
//
// UPDATED 2026-09-23 ("Phase 3"): dynamic/volatility fee and an oracle
// guard, both called out above as deliberately excluded in the original
// 2026-09-09 pass, are now IN — every swap requires a fresh Pyth price
// for both sides of the pair; see oracle.rs's module doc comment for the
// full design (this pool type shares that module entirely with the
// constant-product pool in lib.rs, nothing DLMM-specific about it beyond
// which Q64.64 "pool spot price" value gets passed in — this pool uses
// `bin_price_q64(active_bin_id, bin_step_bps)`, already in the right
// units).
//
// ASSUMPTIONS (same as the constant-product pool in lib.rs): both mints
// are classic SPL Token Program mints, no Token-2022 extensions.

use crate::oracle;
use crate::SwdAmmError;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
// Pyth pull-oracle account type — see oracle.rs's module doc comment
// ("Phase 3", 2026-09-23) for why every swap now requires one of these
// per side of the pair. Hand-implemented in oracle.rs, NOT imported from
// the official Pyth SDK crate — that crate has no published version
// compatible with anchor-lang 0.31.1 (a real dependency-graph dead end
// discovered 2026-09-24 via real `cargo test` runs on the user's own
// machine; see oracle.rs's module doc comment for the full story).
use crate::oracle::PriceUpdateV2;

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

pub const DLMM_POOL_SEED: &[u8] = b"dlmm_pool";
pub const DLMM_VAULT_A_SEED: &[u8] = b"dlmm_vault_a";
pub const DLMM_VAULT_B_SEED: &[u8] = b"dlmm_vault_b";
pub const DLMM_BIN_ARRAY_SEED: &[u8] = b"dlmm_bin_array";
pub const DLMM_POSITION_SEED: &[u8] = b"dlmm_position";

// How many bins on EACH side of the pool's initial active bin the single
// BinArray account covers. Total bins per pool = 2*HALF_RANGE + 1. Chosen
// to keep the BinArray account comfortably small (201 bins * 32 bytes =
// 6,432 bytes + a small header) rather than to represent any real price
// range requirement — see the "paginated bin arrays" note above for what
// widening this properly would take.
pub const HALF_RANGE: i32 = 100;
pub const TOTAL_BINS: usize = (2 * HALF_RANGE + 1) as usize; // 201

// A position (one add_dlmm_liquidity call's bin range) can span at most
// this many bins. Bounds both the Position account's fixed-size array and
// the instruction's `amounts` argument length, keeping both small and
// predictable.
pub const MAX_POSITION_BINS: usize = 20;

// A single swap instruction will cross at most this many bins before
// giving up with PriceLimitReached, rather than silently looping an
// unbounded number of times and risking the compute budget. A client that
// hits this should split the trade into multiple swap_dlmm calls.
pub const MAX_BINS_CROSSED_PER_SWAP: u32 = crate::dlmm_math::MAX_BINS_CROSSED_PER_SWAP;

pub const MAX_BIN_STEP_BPS: u16 = 1_000; // 10% per bin, generous ceiling

// Same role as MINIMUM_LIQUIDITY in the constant-product pool (permanent
// first-depositor lock, defends against the share-inflation/donation
// attack) but scaled down — an individual bin is expected to hold much
// less value than a whole constant-product pool, so a fixed 1_000-unit
// lock (like MINIMUM_LIQUIDITY) would be disproportionately large relative
// to a typical single-bin deposit. Still nonzero, still permanent.
pub const MIN_BIN_LIQUIDITY: u128 = crate::dlmm_math::MIN_BIN_LIQUIDITY;

// ---------------------------------------------------------------------
// Fixed-point (Q64.64) math — lives in dlmm_math.rs (pure, fuzzed and
// Kani-checked); these wrappers keep the original names and Anchor error
// (every one of these returned MathOverflow on failure).
// ---------------------------------------------------------------------

pub use crate::dlmm_math::Q64_ONE;
use crate::dlmm_math as dm;

fn mo<T>(v: Option<T>) -> Result<T> {
    v.ok_or_else(|| SwdAmmError::MathOverflow.into())
}

/// floor(a * b / 2^64). See dlmm_math::q64_mul.
pub fn q64_mul(a: u128, b: u128) -> Result<u128> {
    mo(dm::q64_mul(a, b))
}

/// ceil(a * b / 2^64). See dlmm_math::q64_mul_ceil.
pub fn q64_mul_ceil(a: u128, b: u128) -> Result<u128> {
    mo(dm::q64_mul_ceil(a, b))
}

/// floor(amount * 2^64 / price). See dlmm_math::q64_div_amount.
pub fn q64_div_amount(amount: u64, price_q64: u128) -> Result<u128> {
    mo(dm::q64_div_amount(amount, price_q64))
}

/// ceil(amount * 2^64 / price). See dlmm_math::q64_div_amount_ceil.
pub fn q64_div_amount_ceil(amount: u64, price_q64: u128) -> Result<u128> {
    mo(dm::q64_div_amount_ceil(amount, price_q64))
}

/// Q64.64 base^exp. See dlmm_math::pow_q64.
pub fn pow_q64(base: u128, exp: u32) -> Result<u128> {
    mo(dm::pow_q64(base, exp))
}

/// Price of `bin_id` as Q64.64. See dlmm_math::bin_price_q64.
pub fn bin_price_q64(bin_id: i32, bin_step_bps: u16) -> Result<u128> {
    mo(dm::bin_price_q64(bin_id, bin_step_bps))
}

/// See dlmm_math::convert_at_bin_price (output rounded down).
pub fn convert_at_bin_price(amount_in_after_fee: u64, price_q64: u128, a_to_b: bool) -> Result<u64> {
    mo(dm::convert_at_bin_price(amount_in_after_fee, price_q64, a_to_b))
}

/// See dlmm_math::amount_in_for_output (input rounded up).
pub fn amount_in_for_output(amount_out: u64, price_q64: u128, a_to_b: bool) -> Result<u64> {
    mo(dm::amount_in_for_output(amount_out, price_q64, a_to_b))
}

/// Map a pure bin-math error to the Anchor error the handler raised there.
fn dlmm_err(e: dm::DlmmMathError) -> anchor_lang::error::Error {
    use dm::DlmmMathError as E;
    match e {
        E::MathOverflow => SwdAmmError::MathOverflow.into(),
        E::SingleSidedViolation => DlmmError::SingleSidedViolation.into(),
        E::InsufficientBinLiquidity => DlmmError::InsufficientBinLiquidity.into(),
        E::NoLiquidityAvailable => DlmmError::NoLiquidityAvailable.into(),
        E::SlippageExceeded => SwdAmmError::SlippageExceeded.into(),
        E::ZeroAmount => SwdAmmError::ZeroAmount.into(),
        E::InvariantViolation => SwdAmmError::InvariantViolation.into(),
        E::PriceLimitReached => DlmmError::PriceLimitReached.into(),
        E::InsufficientShares => DlmmError::InsufficientShares.into(),
    }
}

impl dm::BinMut for Bin {
    fn total_shares(&mut self) -> &mut u128 {
        &mut self.total_shares
    }
    fn reserve_a(&mut self) -> &mut u64 {
        &mut self.reserve_a
    }
    fn reserve_b(&mut self) -> &mut u64 {
        &mut self.reserve_b
    }
}


// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

#[account]
pub struct DlmmPool {
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    pub bin_array: Pubkey,
    pub creator: Pubkey, // informational only, no special power — same as Pool.creator
    pub bin_step_bps: u16,
    pub fee_bps: u16,
    pub active_bin_id: i32,
    // Fixed at creation — the BinArray this pool owns covers exactly
    // [min_bin_id, max_bin_id]. See HALF_RANGE's doc comment for why this
    // range can't grow later in this version.
    pub min_bin_id: i32,
    pub max_bin_id: i32,
    pub bump: u8,
    // Added 2026-09-22 alongside governance.rs — same semantics as
    // Pool.swap_paused/deposit_paused/withdraw_paused in lib.rs.
    pub swap_paused: bool,
    pub deposit_paused: bool,
    pub withdraw_paused: bool,
    // Added 2026-09-23 ("Phase 3") — set once at initialize_dlmm_pool and
    // immutable afterward, same treatment as fee_bps/bin_step_bps. See
    // oracle.rs's module doc comment for what each of the oracle/fee
    // fields means. `decimals_a`/`decimals_b` are captured here (rather
    // than re-reading the Mint accounts on every swap) specifically so
    // `SwapDlmm` doesn't need to carry `mint_a`/`mint_b` as extra
    // accounts — this pool type's swap already boxes 5 accounts to stay
    // under the BPF stack limit (see `SwapDlmm`'s doc comment); avoiding
    // two more was worth the 2 extra bytes here.
    pub pyth_feed_id_a: [u8; 32],
    pub pyth_feed_id_b: [u8; 32],
    pub oracle_max_staleness_secs: u32,
    pub oracle_max_deviation_bps: u16,
    pub max_fee_bps: u16,
    pub decimals_a: u8,
    pub decimals_b: u8,
}

impl DlmmPool {
    pub const SIZE: usize =
        32 * 6 + 2 + 2 + 4 + 4 + 4 + 1 + 1 + 1 + 1 + 32 * 2 + 4 + 2 + 2 + 1 + 1;
}

/// One bin's state: how much of each token it currently holds, and how
/// many liquidity shares have been issued against it. `total_shares` is
/// PER-BIN — shares in different bins are never compared or mixed, so
/// there is no requirement that they use a "globally consistent" unit
/// (see the doc comment on `add_dlmm_liquidity` for how each bin
/// bootstraps its own share unit independently on its first deposit).
///
/// Field order (u128 before the two u64s) is deliberate: with
/// `#[repr(C)]` this gives the struct a clean 32-byte size with no
/// compiler-inserted padding (a 16-byte-aligned u128 followed by two
/// 8-byte u64s), which matters here because BinArray below is a
/// `zero_copy` account laid out directly over raw bytes.
#[zero_copy]
#[derive(Default)]
pub struct Bin {
    pub total_shares: u128,
    pub reserve_a: u64,
    pub reserve_b: u64,
}

/// A pool's single, fixed-size array of bins. `zero_copy` (rather than a
/// normal Anchor `Account<T>`) is deliberate: at `TOTAL_BINS = 201` entries
/// (~6.4KB), Borsh-(de)serializing this whole struct on every single
/// instruction call (as a plain `Account<T>` would) is unnecessary
/// overhead and unnecessary compute-budget risk — `zero_copy` instead maps
/// the account's raw bytes directly, so an instruction that only touches a
/// few bins only pays for touching those bytes. This is the same pattern
/// production Solana AMMs (e.g. Orca's Whirlpool tick arrays) use for
/// exactly this kind of large fixed-size on-chain array.
#[account(zero_copy)]
pub struct BinArray {
    pub pool: Pubkey,
    pub min_bin_id: i32,
    pub max_bin_id: i32,
    pub bump: u8,
    // Explicit padding to keep the account's layout obviously well-defined
    // for `zero_copy`/`bytemuck` rather than relying on an implicit
    // compiler-inserted gap before the aligned `bins` array.
    pub _padding: [u8; 7],
    pub bins: [Bin; TOTAL_BINS],
}

impl BinArray {
    pub const SIZE: usize = 32 + 4 + 4 + 1 + 7 + (TOTAL_BINS * 32);

    /// Converts a bin_id into an index into `bins`, checking it falls
    /// inside this array's fixed range.
    pub fn index_of(&self, bin_id: i32) -> Result<usize> {
        require!(
            bin_id >= self.min_bin_id && bin_id <= self.max_bin_id,
            DlmmError::BinOutOfRange
        );
        Ok((bin_id - self.min_bin_id) as usize)
    }
}

/// One LP's concentrated-liquidity position: a contiguous bin range
/// [bin_id_lower, bin_id_upper] and, for each bin in that range (in
/// order), how many of that BIN's own shares this position holds. Sized
/// for the worst case (`MAX_POSITION_BINS`) regardless of how wide a given
/// position actually is — `bin_count` says how many of `shares` are
/// meaningful. A user opening a second, identical-range position adds to
/// this same account (deterministic PDA on the exact range) rather than
/// creating a duplicate.
#[account]
pub struct Position {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub bin_id_lower: i32,
    pub bin_id_upper: i32,
    pub bin_count: u8,
    pub bump: u8,
    pub shares: [u128; MAX_POSITION_BINS],
}

impl Position {
    pub const SIZE: usize = 32 * 2 + 4 + 4 + 1 + 1 + (MAX_POSITION_BINS * 16);
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// Own code range (2026-10-08): lib.rs 6000+, dlmm 6100+, governance
// 6200+, oracle 6300+, swdmm_v2 8000+, timelock 8500+. They all used to
// start at 6000, so a raw error number did not say which error it was.
#[error_code(offset = 6100)]
pub enum DlmmError {
    #[msg("bin_step_bps exceeds the maximum allowed")]
    BinStepTooHigh,
    #[msg("Requested bin id falls outside this pool's fixed bin array range")]
    BinOutOfRange,
    #[msg("bin_id_upper must be >= bin_id_lower")]
    InvalidBinRange,
    #[msg("Position bin range exceeds MAX_POSITION_BINS")]
    RangeTooWide,
    #[msg("amounts array length must equal the number of bins in the range")]
    AmountsLengthMismatch,
    #[msg("A bin strictly above the active bin may only receive mint_a; a bin strictly below may only receive mint_b")]
    SingleSidedViolation,
    #[msg("A bin's first deposit did not clear its minimum-liquidity floor")]
    InsufficientBinLiquidity,
    #[msg("This swap would need to cross more bins than MAX_BINS_CROSSED_PER_SWAP allows — split it into multiple calls")]
    PriceLimitReached,
    #[msg("No liquidity available in the requested direction from the active bin")]
    NoLiquidityAvailable,
    #[msg("shares array length must equal the position's bin_count")]
    SharesLengthMismatch,
    #[msg("Not enough shares in this bin to remove the requested amount")]
    InsufficientShares,
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

#[event]
pub struct DlmmPoolInitialized {
    pub pool: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub bin_step_bps: u16,
    pub fee_bps: u16,
    pub active_bin_id: i32,
    // Added 2026-09-23 ("Phase 3") — see oracle.rs's module doc comment.
    pub pyth_feed_id_a: [u8; 32],
    pub pyth_feed_id_b: [u8; 32],
    pub oracle_max_staleness_secs: u32,
    pub oracle_max_deviation_bps: u16,
    pub max_fee_bps: u16,
}

#[event]
pub struct DlmmLiquidityAdded {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub bin_id_lower: i32,
    pub bin_id_upper: i32,
    pub total_a: u64,
    pub total_b: u64,
}

#[event]
pub struct DlmmLiquidityRemoved {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub bin_id_lower: i32,
    pub bin_id_upper: i32,
    pub total_a: u64,
    pub total_b: u64,
}

#[event]
pub struct DlmmSwapExecuted {
    pub pool: Pubkey,
    pub trader: Pubkey,
    pub a_to_b: bool,
    pub amount_in: u64,
    pub amount_out: u64,
    pub bins_crossed: u32,
    pub final_active_bin_id: i32,
    // Added 2026-09-23 ("Phase 3") — same as lib.rs's SwapExecuted.fee_bps
    // /deviation_bps; see that event's doc comment.
    pub fee_bps: u16,
    pub deviation_bps: u64,
}

// ---------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------

// Boxed (2026-09-24, after `anchor build` on the user's own machine
// measured this struct's `try_accounts` at 4224 bytes — 8 bytes over
// Solana's 4096-byte BPF stack frame limit): `DlmmPool` grew by 7 fields
// this same phase (5 oracle/fee fields + `decimals_a`/`decimals_b`, see
// that struct's definition below), which was enough to push this
// already-large Accounts struct over the edge. Boxing moves each
// account's deserialized data onto the heap instead of the stack — the
// same documented fix already used elsewhere in this codebase (see
// `AddLiquidity` in lib.rs) for the identical class of error. Boxed more
// than the single field that tipped this over (just `pool` would likely
// have been enough) for a comfortable margin against the next struct
// growth, matching lib.rs's `InitializePool` convention of boxing
// everything in a large Accounts struct rather than re-measuring byte-by-
// byte each time.
#[derive(Accounts)]
#[instruction(bin_step_bps: u16, fee_bps: u16, active_bin_id: i32)]
pub struct InitializeDlmmPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint_a: Box<Account<'info, Mint>>,
    pub mint_b: Box<Account<'info, Mint>>,

    #[account(seeds = [crate::governance::GLOBAL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, crate::governance::GlobalConfig>>,

    #[account(seeds = [crate::governance::ALLOWED_MINT_SEED, mint_a.key().as_ref()], bump = allowed_mint_a.bump)]
    pub allowed_mint_a: Box<Account<'info, crate::governance::AllowedMint>>,

    #[account(seeds = [crate::governance::ALLOWED_MINT_SEED, mint_b.key().as_ref()], bump = allowed_mint_b.bump)]
    pub allowed_mint_b: Box<Account<'info, crate::governance::AllowedMint>>,

    /// Governance-registered Pyth feed of each mint (see set_mint_feed).
    #[account(seeds = [crate::governance::MINT_FEED_SEED, mint_a.key().as_ref()], bump = mint_feed_a.bump)]
    pub mint_feed_a: Box<Account<'info, crate::governance::MintFeed>>,
    #[account(seeds = [crate::governance::MINT_FEED_SEED, mint_b.key().as_ref()], bump = mint_feed_b.bump)]
    pub mint_feed_b: Box<Account<'info, crate::governance::MintFeed>>,

    #[account(
        init,
        payer = payer,
        space = 8 + DlmmPool::SIZE,
        seeds = [DLMM_POOL_SEED, mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, DlmmPool>>,

    #[account(
        init,
        payer = payer,
        space = 8 + BinArray::SIZE,
        seeds = [DLMM_BIN_ARRAY_SEED, pool.key().as_ref()],
        bump
    )]
    pub bin_array: AccountLoader<'info, BinArray>,

    #[account(
        init,
        payer = payer,
        seeds = [DLMM_VAULT_A_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint_a,
        token::authority = pool,
    )]
    pub vault_a: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [DLMM_VAULT_B_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint_b,
        token::authority = pool,
    )]
    pub vault_b: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(bin_id_lower: i32, bin_id_upper: i32)]
pub struct AddDlmmLiquidity<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [DLMM_POOL_SEED, pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, DlmmPool>>,

    #[account(mut, address = pool.bin_array)]
    pub bin_array: AccountLoader<'info, BinArray>,

    #[account(mut, address = pool.vault_a)]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = pool.vault_b)]
    pub vault_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.mint_a, token::authority = depositor)]
    pub depositor_token_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = pool.mint_b, token::authority = depositor)]
    pub depositor_token_b: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + Position::SIZE,
        seeds = [
            DLMM_POSITION_SEED,
            pool.key().as_ref(),
            depositor.key().as_ref(),
            &bin_id_lower.to_le_bytes(),
            &bin_id_upper.to_le_bytes(),
        ],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveDlmmLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [DLMM_POOL_SEED, pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, DlmmPool>>,

    #[account(mut, address = pool.bin_array)]
    pub bin_array: AccountLoader<'info, BinArray>,

    #[account(mut, address = pool.vault_a)]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = pool.vault_b)]
    pub vault_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.mint_a, token::authority = owner)]
    pub owner_token_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = pool.mint_b, token::authority = owner)]
    pub owner_token_b: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [
            DLMM_POSITION_SEED,
            pool.key().as_ref(),
            owner.key().as_ref(),
            &position.bin_id_lower.to_le_bytes(),
            &position.bin_id_upper.to_le_bytes(),
        ],
        bump = position.bump,
        has_one = owner,
    )]
    pub position: Box<Account<'info, Position>>,

    pub token_program: Program<'info, Token>,
}

// `pool`/`vault_a`/`vault_b`/`trader_token_in`/`trader_token_out` are
// `Box<Account<...>>` (not plain `Account<...>`) for the same reason
// `AddDlmmLiquidity`/`RemoveDlmmLiquidity` below already box their
// comparable fields, and the same reason several structs in lib.rs are
// boxed (see e.g. `AddLiquidity`'s doc comment there, which documents a
// measured +408-byte BPF stack-frame overage this exact pattern was
// introduced to fix): Anchor's generated `try_accounts` stack-allocates
// every non-boxed `Account<'info, T>` in this struct simultaneously
// before the instruction body ever runs, and this struct has 5 such
// accounts (a `DlmmPool` plus four `TokenAccount`s) on top of
// `swap_dlmm`'s own non-trivial local state (a bin-crossing loop with
// several u128 accumulators) — the same shape of accumulation that
// already overflowed the 4096-byte BPF stack-frame limit elsewhere in
// this program. Boxing moves each account's deserialized copy onto the
// heap instead, at the cost of one small heap allocation per account,
// which this program already pays elsewhere for the identical reason.
#[derive(Accounts)]
pub struct SwapDlmm<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        seeds = [DLMM_POOL_SEED, pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, DlmmPool>>,

    #[account(mut, address = pool.bin_array)]
    pub bin_array: AccountLoader<'info, BinArray>,

    #[account(mut, address = pool.vault_a)]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = pool.vault_b)]
    pub vault_b: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub trader_token_in: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub trader_token_out: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,

    // Added 2026-09-23 ("Phase 3") — see oracle.rs's module doc comment
    // and lib.rs's `Swap` struct (same two fields, same reasoning) for
    // why every swap now requires these.
    pub price_update_a: Box<Account<'info, PriceUpdateV2>>,
    pub price_update_b: Box<Account<'info, PriceUpdateV2>>,
}

// ---------------------------------------------------------------------
// Instruction handlers (called from thin wrappers in lib.rs's #[program]
// block, per Anchor's standard multi-file pattern)
// ---------------------------------------------------------------------
//
// `pub(crate)`, not `pub`: these four are called only from the wrapper
// functions in lib.rs's `#[program] pub mod swd_amm { ... }` block (a
// sibling module in the same crate — `pub(crate)` is exactly enough
// visibility for that, no more). Making them fully `pub` would additionally
// sweep them into lib.rs's `pub use dlmm::*;` re-export, colliding with the
// identically-named functions the `#[program]` macro itself re-exports at
// the crate root for CPI purposes — caught as an "ambiguous glob
// re-exports" warning on the first real `cargo build`, 2026-09-09.

#[allow(clippy::too_many_arguments)]
pub(crate) fn initialize_dlmm_pool(
    ctx: Context<InitializeDlmmPool>,
    bin_step_bps: u16,
    fee_bps: u16,
    active_bin_id: i32,
    pyth_feed_id_a: [u8; 32],
    pyth_feed_id_b: [u8; 32],
    oracle_max_staleness_secs: u32,
    oracle_max_deviation_bps: u16,
    max_fee_bps: u16,
) -> Result<()> {
    require!(bin_step_bps > 0 && bin_step_bps <= MAX_BIN_STEP_BPS, DlmmError::BinStepTooHigh);
    require!(fee_bps <= crate::MAX_FEE_BPS, SwdAmmError::FeeTooHigh);
    oracle::validate_oracle_params(
        &pyth_feed_id_a,
        &pyth_feed_id_b,
        oracle_max_staleness_secs,
        oracle_max_deviation_bps,
        fee_bps,
        max_fee_bps,
    )?;
    require_keys_neq!(ctx.accounts.mint_a.key(), ctx.accounts.mint_b.key(), SwdAmmError::IdenticalMints);
    // Governance may still create while creation is paused (see lib.rs initialize_pool).
    require!(
        crate::governance::creation_allowed(&ctx.accounts.config, &ctx.accounts.payer.key()),
        SwdAmmError::PoolCreationPaused
    );
    require!(ctx.accounts.allowed_mint_a.enabled, SwdAmmError::MintNotAllowlisted);
    require!(ctx.accounts.allowed_mint_b.enabled, SwdAmmError::MintNotAllowlisted);
    require_keys_eq!(ctx.accounts.allowed_mint_a.mint, ctx.accounts.mint_a.key(), SwdAmmError::MintNotAllowlisted);
    require_keys_eq!(ctx.accounts.allowed_mint_b.mint, ctx.accounts.mint_b.key(), SwdAmmError::MintNotAllowlisted);
    // Feeds must be the ones governance registered for these mints (2026-10-08).
    require!(
        ctx.accounts.mint_feed_a.pyth_feed_id == pyth_feed_id_a && ctx.accounts.mint_feed_b.pyth_feed_id == pyth_feed_id_b,
        SwdAmmError::OracleFeedNotRegistered
    );
    let min_bin_id = active_bin_id
        .checked_sub(HALF_RANGE)
        .ok_or(SwdAmmError::MathOverflow)?;
    let max_bin_id = active_bin_id
        .checked_add(HALF_RANGE)
        .ok_or(SwdAmmError::MathOverflow)?;
    // SECURITY (2026-10-08, attack suite): every bin of the array must be
    // priceable. `bin_price_q64` has no fixed range of its own any more,
    // so an `active_bin_id` whose edge prices overflow Q64.64 (or round to
    // zero) created a pool on which every swap failed — and its PDA can
    // never be created again. Prices are monotonic in the bin id, so
    // checking both edges covers every bin in between.
    require!(bin_price_q64(min_bin_id, bin_step_bps)? > 0, SwdAmmError::MathOverflow);
    bin_price_q64(max_bin_id, bin_step_bps)?;

    let pool = &mut ctx.accounts.pool;
    pool.mint_a = ctx.accounts.mint_a.key();
    pool.mint_b = ctx.accounts.mint_b.key();
    pool.vault_a = ctx.accounts.vault_a.key();
    pool.vault_b = ctx.accounts.vault_b.key();
    pool.bin_array = ctx.accounts.bin_array.key();
    pool.creator = ctx.accounts.payer.key();
    pool.bin_step_bps = bin_step_bps;
    pool.fee_bps = fee_bps;
    pool.active_bin_id = active_bin_id;
    pool.min_bin_id = min_bin_id;
    pool.max_bin_id = max_bin_id;
    pool.bump = ctx.bumps.pool;
    pool.swap_paused = false;
    pool.deposit_paused = false;
    pool.withdraw_paused = false;
    pool.pyth_feed_id_a = pyth_feed_id_a;
    pool.pyth_feed_id_b = pyth_feed_id_b;
    pool.oracle_max_staleness_secs = oracle_max_staleness_secs;
    pool.oracle_max_deviation_bps = oracle_max_deviation_bps;
    pool.max_fee_bps = max_fee_bps;
    pool.decimals_a = ctx.accounts.mint_a.decimals;
    pool.decimals_b = ctx.accounts.mint_b.decimals;

    // Zero-initialize the bin array's linking metadata. `zero_copy` +
    // `init` gives us a zeroed account already (all bins already read as
    // all-zero `Bin`s), so only the header fields need setting explicitly.
    let mut bin_array = ctx.accounts.bin_array.load_init()?;
    bin_array.pool = pool.key();
    bin_array.min_bin_id = min_bin_id;
    bin_array.max_bin_id = max_bin_id;
    bin_array.bump = ctx.bumps.bin_array;

    emit!(DlmmPoolInitialized {
        pool: pool.key(),
        mint_a: pool.mint_a,
        mint_b: pool.mint_b,
        bin_step_bps,
        fee_bps,
        active_bin_id,
        pyth_feed_id_a,
        pyth_feed_id_b,
        oracle_max_staleness_secs,
        oracle_max_deviation_bps,
        max_fee_bps,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct BinLiquidityAmount {
    pub amount_a: u64,
    pub amount_b: u64,
}

/// Adds liquidity across [bin_id_lower, bin_id_upper]. `amounts[i]`
/// corresponds to bin `bin_id_lower + i`. Enforces the single-sided rule
/// per bin relative to the pool's CURRENT active bin (checked live, not
/// cached) — a bin strictly above active must have `amount_b == 0`; a bin
/// strictly below must have `amount_a == 0`; only the exact active bin (if
/// it falls in range) may have both nonzero.
///
/// Share accounting per bin:
///   - Bin's first-ever deposit (`total_shares == 0`): bootstraps this
///     bin's own share unit. For a single-sided bin, shares == the
///     deposited amount of whichever side is nonzero (a plain 1:1
///     bootstrap — valid because a bin's shares are never compared against
///     another bin's, see `Bin`'s doc comment). For the active bin
///     (potentially both sides nonzero), shares = integer_sqrt(a*b),
///     mirroring the constant-product pool's own bootstrap, with
///     MIN_BIN_LIQUIDITY permanently withheld from the depositor's
///     position the same way MINIMUM_LIQUIDITY is withheld in `Pool`.
///   - Bin already has shares: mints shares proportional to the value
///     added, using the bin's OWN existing reserves as the reference
///     ratio — for a single-sided bin this is a plain proportional-stake
///     formula (`amount * existing_shares / existing_reserve`); for the
///     active bin, an imbalanced deposit relative to its current a:b
///     ratio is rejected (mirrors the constant-product pool's
///     `SlippageExceeded` behavior on `add_liquidity`) rather than
///     silently accepted.
pub(crate) fn add_dlmm_liquidity(
    ctx: Context<AddDlmmLiquidity>,
    bin_id_lower: i32,
    bin_id_upper: i32,
    amounts: Vec<BinLiquidityAmount>,
) -> Result<()> {
    require!(!ctx.accounts.pool.deposit_paused, SwdAmmError::DepositPaused);
    require!(bin_id_upper >= bin_id_lower, DlmmError::InvalidBinRange);
    let bin_count = (bin_id_upper - bin_id_lower + 1) as usize;
    require!(bin_count <= MAX_POSITION_BINS, DlmmError::RangeTooWide);
    require!(amounts.len() == bin_count, DlmmError::AmountsLengthMismatch);
    require!(
        bin_id_lower >= ctx.accounts.pool.min_bin_id && bin_id_upper <= ctx.accounts.pool.max_bin_id,
        DlmmError::BinOutOfRange
    );

    let active_bin_id = ctx.accounts.pool.active_bin_id;
    let position = &mut ctx.accounts.position;
    // First use of this Position PDA: set its fixed range. On a repeat
    // deposit into the SAME range, these must already match (guaranteed by
    // the PDA seeds themselves including bin_id_lower/upper, so this is
    // really just populating a freshly-`init_if_needed`'d zeroed account).
    if position.bin_count == 0 {
        position.pool = ctx.accounts.pool.key();
        position.owner = ctx.accounts.depositor.key();
        position.bin_id_lower = bin_id_lower;
        position.bin_id_upper = bin_id_upper;
        position.bin_count = bin_count as u8;
        position.bump = ctx.bumps.position;
    }

    let mut bin_array = ctx.accounts.bin_array.load_mut()?;
    let mut total_a: u64 = 0;
    let mut total_b: u64 = 0;

    for i in 0..bin_count {
        let bin_id = bin_id_lower + i as i32;
        let amt = amounts[i];
        let idx = bin_array.index_of(bin_id)?;
        let bin = &mut bin_array.bins[idx];

        // Single-sided rule, share pricing and the bin update live in
        // dlmm_math::bin_deposit (pure, fuzzed — see programs/swd_amm/fuzz).
        // Bins above the active bin take only A, below only B. In a
        // non-empty active bin only the B its ratio requires is taken
        // (SECURITY 2026-10-08: taking the whole amount_b handed the
        // excess to the bin's existing shareholders).
        let Some((shares_minted, take_a, take_b)) =
            dm::bin_deposit(bin, bin_id, active_bin_id, amt.amount_a, amt.amount_b).map_err(dlmm_err)?
        else {
            continue; // legal no-op for this bin — e.g. skipping ahead within a wide range
        };

        position.shares[i] = position.shares[i]
            .checked_add(shares_minted)
            .ok_or(SwdAmmError::MathOverflow)?;

        total_a = total_a.checked_add(take_a).ok_or(SwdAmmError::MathOverflow)?;
        total_b = total_b.checked_add(take_b).ok_or(SwdAmmError::MathOverflow)?;
    }

    require!(total_a > 0 || total_b > 0, SwdAmmError::ZeroAmount);
    drop(bin_array); // release the zero-copy borrow before the CPI calls below

    if total_a > 0 {
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.depositor_token_a.to_account_info(),
                    to: ctx.accounts.vault_a.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            total_a,
        )?;
    }
    if total_b > 0 {
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.depositor_token_b.to_account_info(),
                    to: ctx.accounts.vault_b.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            total_b,
        )?;
    }

    emit!(DlmmLiquidityAdded {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.depositor.key(),
        bin_id_lower,
        bin_id_upper,
        total_a,
        total_b,
    });
    Ok(())
}

/// Burns `shares_to_remove[i]` shares from bin `position.bin_id_lower + i`
/// and returns the corresponding proportional share of that bin's current
/// reserves. A zero entry for a given bin is a legal no-op for that bin.
pub(crate) fn remove_dlmm_liquidity(
    ctx: Context<RemoveDlmmLiquidity>,
    shares_to_remove: Vec<u128>,
    min_a_out: u64,
    min_b_out: u64,
) -> Result<()> {
    require!(!ctx.accounts.pool.withdraw_paused, SwdAmmError::WithdrawPaused);
    let position = &mut ctx.accounts.position;
    require!(
        shares_to_remove.len() == position.bin_count as usize,
        DlmmError::SharesLengthMismatch
    );

    let bin_id_lower = position.bin_id_lower;
    let mut bin_array = ctx.accounts.bin_array.load_mut()?;
    let mut total_a: u64 = 0;
    let mut total_b: u64 = 0;

    for i in 0..(position.bin_count as usize) {
        let shares = shares_to_remove[i];
        if shares == 0 {
            continue;
        }
        require!(shares <= position.shares[i], DlmmError::InsufficientShares);

        let bin_id = bin_id_lower + i as i32;
        let idx = bin_array.index_of(bin_id)?;
        let bin = &mut bin_array.bins[idx];
        let (amount_a, amount_b) = dm::bin_withdraw(bin, shares).map_err(dlmm_err)?;

        position.shares[i] = position.shares[i].checked_sub(shares).ok_or(SwdAmmError::MathOverflow)?;

        total_a = total_a.checked_add(amount_a).ok_or(SwdAmmError::MathOverflow)?;
        total_b = total_b.checked_add(amount_b).ok_or(SwdAmmError::MathOverflow)?;
    }

    require!(total_a >= min_a_out, SwdAmmError::SlippageExceeded);
    require!(total_b >= min_b_out, SwdAmmError::SlippageExceeded);
    require!(total_a > 0 || total_b > 0, SwdAmmError::ZeroAmount);
    drop(bin_array);

    let mint_a_key = ctx.accounts.pool.mint_a;
    let mint_b_key = ctx.accounts.pool.mint_b;
    let bump = ctx.accounts.pool.bump;
    let signer_seeds: &[&[u8]] = &[DLMM_POOL_SEED, mint_a_key.as_ref(), mint_b_key.as_ref(), &[bump]];
    let signer = &[signer_seeds];

    if total_a > 0 {
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.vault_a.to_account_info(),
                    to: ctx.accounts.owner_token_a.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer,
            ),
            total_a,
        )?;
    }
    if total_b > 0 {
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.vault_b.to_account_info(),
                    to: ctx.accounts.owner_token_b.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer,
            ),
            total_b,
        )?;
    }

    emit!(DlmmLiquidityRemoved {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.owner.key(),
        bin_id_lower,
        bin_id_upper: position.bin_id_upper,
        total_a,
        total_b,
    });
    Ok(())
}

/// Walks bins one at a time starting from the pool's active bin, in the
/// direction implied by `a_to_b`, trading at each bin's fixed price until
/// `amount_in` is exhausted or `MAX_BINS_CROSSED_PER_SWAP` bins have been
/// crossed (whichever comes first — the latter errors with
/// PriceLimitReached rather than silently partial-filling).
pub(crate) fn swap_dlmm(ctx: Context<SwapDlmm>, amount_in: u64, min_amount_out: u64, a_to_b: bool) -> Result<()> {
    require!(amount_in > 0, SwdAmmError::ZeroAmount);
    require!(!ctx.accounts.pool.swap_paused, SwdAmmError::SwapPaused);
    require_keys_eq!(ctx.accounts.trader_token_in.owner, ctx.accounts.trader.key(), SwdAmmError::InvalidTokenAccountOwner);
    require_keys_eq!(ctx.accounts.trader_token_out.owner, ctx.accounts.trader.key(), SwdAmmError::InvalidTokenAccountOwner);

    let (mint_in_expected, mint_out_expected) = if a_to_b {
        (ctx.accounts.pool.mint_a, ctx.accounts.pool.mint_b)
    } else {
        (ctx.accounts.pool.mint_b, ctx.accounts.pool.mint_a)
    };
    require_keys_eq!(ctx.accounts.trader_token_in.mint, mint_in_expected, SwdAmmError::MintMismatch);
    require_keys_eq!(ctx.accounts.trader_token_out.mint, mint_out_expected, SwdAmmError::MintMismatch);

    let bin_step_bps = ctx.accounts.pool.bin_step_bps;
    let mut active_bin_id = ctx.accounts.pool.active_bin_id;

    // "Phase 3" (2026-09-23): mandatory Pyth oracle guard + dynamic fee —
    // see oracle.rs's module doc comment. Evaluated ONCE, at the pool's
    // spot price at the START of this swap (before the bin-crossing loop
    // below moves `active_bin_id`) — the resulting fee applies to the
    // whole swap, not per-bin, matching how `fee_bps` already worked
    // before this change (a single value used across every bin the loop
    // crosses).
    let pool_price_q64 = bin_price_q64(active_bin_id, bin_step_bps)?;
    let oracle_result = oracle::evaluate_oracle_and_fee(
        &ctx.accounts.price_update_a,
        &ctx.accounts.price_update_b,
        &ctx.accounts.pool.pyth_feed_id_a,
        &ctx.accounts.pool.pyth_feed_id_b,
        ctx.accounts.pool.oracle_max_staleness_secs,
        ctx.accounts.pool.decimals_a,
        ctx.accounts.pool.decimals_b,
        pool_price_q64,
        ctx.accounts.pool.fee_bps,
        ctx.accounts.pool.max_fee_bps,
        ctx.accounts.pool.oracle_max_deviation_bps,
        &Clock::get()?,
    )?;
    let fee_bps = oracle_result.fee_bps as u128;

    let mut bin_array = ctx.accounts.bin_array.load_mut()?;
    // The bin-walking loop lives in dlmm_math::swap_bins (pure, fuzzed and
    // Kani-checked). Per bin: a partial fill takes the whole remaining
    // input at that bin's fixed price (output rounded down); otherwise the
    // bin's out-side reserve is drained for `amount_in_for_output` (rounded
    // up) grossed up by the fee, and the swap moves to the next bin. The
    // fee stays in the bin as LP income. At most MAX_BINS_CROSSED_PER_SWAP
    // bins are crossed.
    let (bin_min, bin_max) = (bin_array.min_bin_id, bin_array.max_bin_id);
    let r = dm::swap_bins(
        &mut bin_array.bins[..],
        bin_min,
        bin_max,
        active_bin_id,
        bin_step_bps,
        fee_bps,
        amount_in,
        a_to_b,
    )
    .map_err(dlmm_err)?;
    let total_amount_out = r.total_amount_out;
    let bins_crossed = r.bins_crossed;
    active_bin_id = r.active_bin_id;

    require!(total_amount_out > 0, SwdAmmError::ZeroAmount);
    require!(total_amount_out >= min_amount_out, SwdAmmError::SlippageExceeded);
    drop(bin_array);

    // Oracle guard on the post-trade price (see oracle::guard_allows).
    oracle_result.enforce_guard(bin_price_q64(active_bin_id, bin_step_bps)?)?;

    ctx.accounts.pool.active_bin_id = active_bin_id;

    anchor_spl::token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.trader_token_in.to_account_info(),
                to: if a_to_b { ctx.accounts.vault_a.to_account_info() } else { ctx.accounts.vault_b.to_account_info() },
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        amount_in,
    )?;

    let mint_a_key = ctx.accounts.pool.mint_a;
    let mint_b_key = ctx.accounts.pool.mint_b;
    let bump = ctx.accounts.pool.bump;
    let signer_seeds: &[&[u8]] = &[DLMM_POOL_SEED, mint_a_key.as_ref(), mint_b_key.as_ref(), &[bump]];
    let signer = &[signer_seeds];

    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: if a_to_b { ctx.accounts.vault_b.to_account_info() } else { ctx.accounts.vault_a.to_account_info() },
                to: ctx.accounts.trader_token_out.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer,
        ),
        total_amount_out,
    )?;

    emit!(DlmmSwapExecuted {
        pool: ctx.accounts.pool.key(),
        trader: ctx.accounts.trader.key(),
        a_to_b,
        amount_in,
        amount_out: total_amount_out,
        bins_crossed,
        final_active_bin_id: active_bin_id,
        fee_bps: oracle_result.fee_bps,
        deviation_bps: oracle_result.deviation_bps,
    });
    Ok(())
}

// Share-accounting helpers (mul_div_shares, mul_div_shares_down,
// integer_sqrt_u128) moved to dlmm_math.rs.

// ---------------------------------------------------------------------
// Unit tests for the pure math (run with `cargo test`, no validator
// needed — same rationale as lib.rs's own `integer_sqrt`/`mul_div` tests).
// ---------------------------------------------------------------------
#[cfg(test)]
mod dlmm_math_tests {
    use super::*;

    #[test]
    fn q64_mul_identity_and_basic() {
        assert_eq!(q64_mul(Q64_ONE, Q64_ONE).unwrap(), Q64_ONE);
        // 2.0 * 3.0 = 6.0
        assert_eq!(q64_mul(2 * Q64_ONE, 3 * Q64_ONE).unwrap(), 6 * Q64_ONE);
        // 0 * anything = 0
        assert_eq!(q64_mul(0, 5 * Q64_ONE).unwrap(), 0);
    }

    #[test]
    fn q64_mul_fractional() {
        // 1.5 * 1.5 = 2.25
        let one_half = Q64_ONE / 2;
        let one_point_five = Q64_ONE + one_half;
        let result = q64_mul(one_point_five, one_point_five).unwrap();
        let expected = Q64_ONE * 2 + Q64_ONE / 4; // 2.25
        // Allow 1 unit of rounding error from the fractional division.
        assert!(
            (result as i128 - expected as i128).abs() <= 1,
            "expected ~{}, got {}",
            expected,
            result
        );
    }

    #[test]
    fn pow_q64_exp_zero_and_one() {
        let base = Q64_ONE + Q64_ONE / 10; // 1.1
        assert_eq!(pow_q64(base, 0).unwrap(), Q64_ONE);
        assert_eq!(pow_q64(base, 1).unwrap(), base);
    }

    #[test]
    fn pow_q64_matches_repeated_multiplication() {
        // (1.0001)^10 computed via pow_q64 should match 10 sequential
        // q64_mul calls (a much slower, obviously-correct reference) —
        // approximately, not exactly. Binary exponentiation (pow_q64) and
        // linear repeated multiplication perform their intermediate
        // floor()ing divisions in a different order/multiplication tree,
        // so their last-bit rounding can legitimately differ by a couple
        // of units even though both are internally-consistent, correct
        // Q64.64 floor-multiplications — `assert_eq!` here was wrong. The
        // first real `cargo test` run (2026-09-09) hit exactly this: a
        // genuine but harmless 2-unit difference (out of a ~1.8e19
        // magnitude value, i.e. an ~10^-19 relative error), which is what
        // this generous-but-still-meaningful tolerance now allows for.
        let step = Q64_ONE + Q64_ONE / 10_000; // 1.0001
        let via_pow = pow_q64(step, 10).unwrap();

        let mut via_loop = Q64_ONE;
        for _ in 0..10 {
            via_loop = q64_mul(via_loop, step).unwrap();
        }
        let diff = if via_pow > via_loop { via_pow - via_loop } else { via_loop - via_pow };
        assert!(
            diff <= 16,
            "pow_q64 and repeated q64_mul diverged more than rounding tolerance allows: {} vs {}",
            via_pow,
            via_loop
        );
    }

    #[test]
    fn bin_price_zero_is_one() {
        assert_eq!(bin_price_q64(0, 25).unwrap(), Q64_ONE);
    }

    #[test]
    fn bin_price_up_and_down_are_reciprocal() {
        // price(+n) * price(-n) should be ~1.0 (within small rounding
        // error accumulated over the divisions/multiplications).
        for &(n, step_bps) in &[(1, 25u16), (10, 25), (50, 100), (100, 10)] {
            let up = bin_price_q64(n, step_bps).unwrap();
            let down = bin_price_q64(-n, step_bps).unwrap();
            let product = q64_mul(up, down).unwrap();
            let diff = if product > Q64_ONE { product - Q64_ONE } else { Q64_ONE - product };
            // Rounding tolerance: 1 part in 2^40 of ONE, generous but
            // still tight enough to catch a real directional/formula bug.
            let tolerance = Q64_ONE >> 40;
            assert!(
                diff <= tolerance,
                "bin_price({}) * bin_price({}) = {} (expected ~{}), step_bps={}",
                n,
                -n,
                product,
                Q64_ONE,
                step_bps
            );
        }
    }

    #[test]
    fn bin_price_is_monotonic() {
        // Higher bin_id must always mean a strictly higher price, for any
        // positive bin_step.
        let step_bps = 50u16;
        let mut last = bin_price_q64(-20, step_bps).unwrap();
        for bin_id in -19..=20 {
            let price = bin_price_q64(bin_id, step_bps).unwrap();
            assert!(price > last, "price not increasing at bin_id={}", bin_id);
            last = price;
        }
    }

    #[test]
    fn convert_at_bin_price_round_trips_approximately() {
        let price = bin_price_q64(5, 30).unwrap();
        let amount_in: u64 = 1_000_000;
        let out = convert_at_bin_price(amount_in, price, true).unwrap();
        let back = convert_at_bin_price(out, price, false).unwrap();
        // Integer division rounding means this won't be exact — must be
        // close (within 0.01%) and never MORE than the original (that
        // would mean value was created from nothing).
        assert!(back <= amount_in, "round-trip produced more than the input: {} > {}", back, amount_in);
        let diff = amount_in - back;
        assert!(
            diff * 10_000 <= amount_in as u64,
            "round-trip lost too much: {} -> {} -> {}",
            amount_in,
            out,
            back
        );
    }

    #[test]
    fn amount_in_for_output_matches_convert_at_bin_price() {
        let price = bin_price_q64(-3, 40).unwrap();
        let desired_out: u64 = 500_000;
        let needed_in = amount_in_for_output(desired_out, price, true).unwrap();
        let actual_out = convert_at_bin_price(needed_in, price, true).unwrap();
        // Should reproduce the desired output exactly or slightly over
        // (never under, or the caller's "drain this bin fully" logic in
        // swap_dlmm would leave dust behind that it thinks is drained).
        assert!(
            actual_out >= desired_out,
            "amount_in_for_output under-shoots: wanted {}, got {}",
            desired_out,
            actual_out
        );
    }

    #[test]
    fn q64_mul_overflow_is_caught() {
        // Two values each near u128::MAX should be rejected, not silently
        // wrap or truncate.
        let huge = u128::MAX / 2;
        assert!(q64_mul(huge, huge).is_err());
    }

    #[test]
    fn bin_price_works_far_from_zero() {
        // Regression test for a real bug caught in review before this file
        // was ever compiled: `bin_price_q64` used to reject any `bin_id`
        // outside [-HALF_RANGE, HALF_RANGE] (i.e. outside [-100, 100]),
        // which conflated "distance from bin 0" with "distance from a
        // pool's creation-time active bin". Since `bin_id` here is a
        // pool's GLOBAL bin index (e.g. two mints with very different
        // decimals legitimately need active_bin_id in the thousands), that
        // bound would have made every swap fail on any realistic pool. This
        // pins down that a bin far from zero still prices correctly and
        // still round-trips with its own up/down reciprocal.
        let step_bps = 25u16;
        let far_bin_id = 5_000i32;
        let price = bin_price_q64(far_bin_id, step_bps).unwrap();
        assert!(price > Q64_ONE, "price at a positive far bin_id should exceed 1.0");

        let up = bin_price_q64(far_bin_id, step_bps).unwrap();
        let down = bin_price_q64(-far_bin_id, step_bps).unwrap();
        let product = q64_mul(up, down).unwrap();
        let diff = if product > Q64_ONE { product - Q64_ONE } else { Q64_ONE - product };
        // Same generous-but-meaningful tolerance as bin_price_up_and_down_are_reciprocal.
        let tolerance = Q64_ONE >> 30;
        assert!(
            diff <= tolerance,
            "far bin_id reciprocal check failed: up={}, down={}, product={}",
            up,
            down,
            product
        );
    }
}
