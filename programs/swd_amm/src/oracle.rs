// Pyth pull-oracle reader, deviation guard and oracle dynamic fee.
//
// Who uses it
// - SWDMM v2 (swdmm_v2.rs): OPTIONAL per pool (`oracle.enabled`); when on,
//   the feed ids must equal the ones governance registered with
//   `set_mint_feed`, and every swap checks the post-trade price against the
//   oracle (`evaluate_oracle_and_fee` + `enforce_guard`).
// - CP and DLMM (full build only): MANDATORY; feed ids and bounds are fixed
//   at pool creation, and the oracle dynamic fee scales the swap fee from
//   `fee_bps` to `max_fee_bps` with the deviation.
//
// Mechanics
// - Two USD feeds (one per mint); price of A in B = price_a / price_b,
//   rescaled for exponents and mint decimals into the same Q64.64
//   "raw units of B per raw unit of A" the pools use (`oracle_price_q64`).
// - Guard: a swap is refused (PriceDeviationTooLarge) when the post-trade
//   pool price deviates from the oracle by more than `max_deviation_bps`,
//   unless it moves the price back toward the oracle (`guard_allows`), so
//   one large swap cannot freeze a pool.
// - Staleness: `publish_time` may be at most `max_staleness_secs`
//   (<= MAX_ORACLE_STALENESS_SECS) behind the cluster clock; a publish_time
//   AHEAD of the clock counts as age 0 (validator clock skew), like the
//   official SDK. Confidence must be <= MAX_ORACLE_CONF_BPS of the price;
//   only VerificationLevel::Full is accepted; the account must be owned by
//   the Pyth receiver program. Any Full-verified update inside the window
//   is accepted, so a trader can pick among several recent prices (pull
//   oracle property; see the audit package's known issues).
//
// Why `PriceUpdateV2` is hand-implemented here (not pyth-solana-receiver-sdk)
// Every published version of the official SDK conflicts with anchor-lang
// 0.31.1 (it needs anchor-lang 1.x, or pythnet-sdk >= 2.3.1 built on borsh
// 1.x while anchor-lang 0.31.1 needs borsh 0.10). So the account type
// implements Owner (= PYTH_RECEIVER_PROGRAM_ID), Discriminator and
// Account(De)Serialize by hand, mirroring the SDK's byte layout
// (discriminator, write_authority, verification_level, PriceFeedMessage,
// posted_slot). This trades reuse of Pyth's audited code for no dependency
// conflict: a Pyth layout change must be mirrored here by hand. The test
// fixtures (scripts/gen-pyth-fixtures.js) are written with the same layout.

use anchor_lang::prelude::*;
use std::io::Write;

/// Hand-implemented mirror of `pyth_solana_receiver_sdk::price_update::
/// VerificationLevel` — see this module's header comment for why this is
/// hand-rolled instead of imported. Borsh enum tag order matches
/// declaration order (`Partial` = 0, `Full` = 1), cross-checked against
/// `scripts/gen-pyth-fixtures.js`'s own fixture-writing code, which must
/// stay in lockstep with this.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

/// Hand-implemented mirror of `pythnet_sdk::messages::PriceFeedMessage`'s
/// field order — see this module's header comment.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

/// Hand-implemented mirror of `pyth_solana_receiver_sdk::price_update::
/// PriceUpdateV2` — the on-chain account type Pyth's Receiver program
/// posts. Field order/types match `scripts/gen-pyth-fixtures.js`'s
/// `serializePriceUpdateV2` exactly (that script's own comments document
/// the cross-check against Pyth's published crate docs). `write_authority`
/// is carried for layout fidelity only — this program never checks it,
/// same as the official SDK's own guidance for a plain price read.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

/// Anchor account discriminator for `PriceUpdateV2`: `sha256("account:
/// PriceUpdateV2")[0..8]`, computed once out-of-band (Node's `crypto`
/// module, see `scripts/gen-pyth-fixtures.js`'s `ANCHOR_DISCRIMINATOR`)
/// rather than at compile time, since anchor-lang 0.31.1 has no public
/// const-sha256 helper this crate can call from a `const` context. This
/// exact byte sequence is also what that fixture script writes as the
/// first 8 bytes of each localnet test account, and its own header
/// comment documents the same derivation.
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

impl anchor_lang::Discriminator for PriceUpdateV2 {
    const DISCRIMINATOR: &'static [u8] = &PRICE_UPDATE_V2_DISCRIMINATOR;
}

/// Deliberately NOT derived from `crate::ID` (which is what the `#[account]`
/// macro would generate, and would be wrong here — see this module's
/// header comment) — `PriceUpdateV2` accounts are owned by Pyth's Receiver
/// program, not this one.
impl anchor_lang::Owner for PriceUpdateV2 {
    fn owner() -> Pubkey {
        PYTH_RECEIVER_PROGRAM_ID
    }
}

impl anchor_lang::AccountSerialize for PriceUpdateV2 {
    fn try_serialize<W: Write>(&self, writer: &mut W) -> Result<()> {
        // Mirrors the `#[account]` macro's own generated `try_serialize`
        // exactly (verified against anchor-lang 0.31.1's macro-codegen
        // source, docs.rs, 2026-09-24). This program never actually
        // constructs or writes a `PriceUpdateV2` on-chain (it only reads
        // ones Pyth's Receiver program already posted), so this impl only
        // exists to satisfy `Account<'info, T>`'s trait bounds.
        if writer.write_all(<Self as anchor_lang::Discriminator>::DISCRIMINATOR).is_err() {
            return Err(anchor_lang::error::ErrorCode::AccountDidNotSerialize.into());
        }
        if AnchorSerialize::serialize(self, writer).is_err() {
            return Err(anchor_lang::error::ErrorCode::AccountDidNotSerialize.into());
        }
        Ok(())
    }
}

impl anchor_lang::AccountDeserialize for PriceUpdateV2 {
    /// Checks the discriminator, like the `#[account]` macro's generated
    /// impl does. (Fixed 2026-10-08: the trait's DEFAULT `try_deserialize`
    /// does NOT check it — it just calls `try_deserialize_unchecked` — so
    /// before this only the owner check stood between a swap and any other
    /// account type the Pyth receiver owns.)
    fn try_deserialize(buf: &mut &[u8]) -> Result<Self> {
        let disc = <Self as anchor_lang::Discriminator>::DISCRIMINATOR;
        if buf.len() < disc.len() {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
        }
        if &buf[..disc.len()] != disc {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
        }
        Self::try_deserialize_unchecked(buf)
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        // Strip the discriminator prefix, then Borsh-decode the rest.
        let disc_len = <Self as anchor_lang::Discriminator>::DISCRIMINATOR.len();
        if buf.len() < disc_len {
            return Err(anchor_lang::error::ErrorCode::AccountDidNotDeserialize.into());
        }
        let mut data: &[u8] = &buf[disc_len..];
        AnchorDeserialize::deserialize(&mut data)
            .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotDeserialize.into())
    }
}

/// Minimal mirror of `pyth_sdk::Price` — just the four fields
/// `evaluate_oracle_and_fee` below actually reads.
#[derive(Clone, Copy, Debug)]
pub struct Price {
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

impl PriceUpdateV2 {
    /// Hand-implemented mirror of the official SDK's
    /// `get_price_no_older_than`: requires `VerificationLevel::Full` (pull
    /// oracle guidance is that a `Partial` update should never be trusted
    /// for a price used to guard real funds — same rule this module's
    /// header comment already documents), requires the feed id to match
    /// exactly, and requires the price to be no older than `maximum_age`
    /// seconds relative to `clock`. Deliberately tolerant of a
    /// publish_time slightly in the FUTURE relative to `clock` (clock
    /// skew between validators is real and not this program's problem to
    /// police) — only "too old" is rejected, matching the official SDK's
    /// own documented behavior.
    pub fn get_price_no_older_than(
        &self,
        clock: &Clock,
        maximum_age: u64,
        feed_id: &[u8; 32],
    ) -> Result<Price> {
        // 2026-09-24: split what used to be three checks collapsed into a
        // single `PriceUnavailable` into three distinct error codes. The
        // first real `anchor test` run against these hand-rolled fixtures
        // hit `PriceUnavailable` on every swap and, with all three checks
        // reporting the exact same code, there was no way to tell from
        // the AnchorError alone which of the three had actually failed —
        // this makes that diagnosable from the error code itself instead
        // of needing to add temporary logging. `PriceUnavailable` itself
        // stays defined (see the enum below) since it's still a
        // reasonable top-level description of "this price can't be
        // used"; these three are the specific reasons why.
        require!(
            self.verification_level == VerificationLevel::Full,
            OracleError::PriceVerificationNotFull
        );
        require!(
            self.price_message.feed_id == *feed_id,
            OracleError::PriceFeedMismatch
        );
        // Real bug found 2026-09-24 via the first end-to-end `anchor test`
        // run against these fixtures: this used to be
        // `age >= 0 && (age as u64) <= maximum_age`, which treated ANY
        // publish_time in the future relative to `clock` (a negative
        // `age`) as failing the `age >= 0` half — i.e. REJECTED as
        // PriceTooStale. That is the exact opposite of this method's own
        // doc comment above ("Deliberately tolerant of a publish_time
        // slightly in the FUTURE... only 'too old' is rejected"), and it
        // is what made every oracle-guarded swap fail immediately: a
        // freshly (re)started local validator's on-chain Clock can easily
        // sit BEHIND the fixture's real-wall-clock publish_time (its
        // genesis time does not track real time while the validator is
        // stopped between `anchor test` runs against the same
        // `.anchor/test-ledger`), which is precisely "publish_time in the
        // future relative to clock". A future publish_time is now
        // tolerated outright (age treated as 0); only a publish_time
        // decisively in the PAST beyond `maximum_age` is rejected.
        let age: u64 = if self.price_message.publish_time > clock.unix_timestamp {
            0
        } else {
            clock
                .unix_timestamp
                .checked_sub(self.price_message.publish_time)
                .ok_or(OracleError::MathOverflow)? as u64
        };
        require!(age <= maximum_age, OracleError::PriceTooStale);
        Ok(Price {
            price: self.price_message.price,
            conf: self.price_message.conf,
            exponent: self.price_message.exponent,
            publish_time: self.price_message.publish_time,
        })
    }
}

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

/// The Pyth Receiver program's real Solana mainnet address (also used on
/// devnet/testnet — Pyth deploys the same program id across clusters).
/// `Account<'info, PriceUpdateV2>`'s generated `Owner` impl already
/// enforces this — this constant is not used as a manual owner check
/// anywhere in this module, it is only here (a) for `Anchor.toml`'s
/// localnet `[[test.validator.account]]` entries to reference in this
/// module's own doc comment / the fixture script, and (b) as a single
/// place future code can reference it from, rather than restating the
/// base58 string in multiple places.
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Hard ceiling on `oracle_max_deviation_bps` a pool can be created with —
/// prevents a pool creator from setting the guard so loose (e.g. 100%)
/// that it never actually fires. 5,000 bps = 50%.
pub const MAX_ORACLE_DEVIATION_GUARD_BPS: u16 = 5_000;

/// Hard ceiling on `oracle_max_staleness_secs` a pool can be created
/// with — prevents a pool creator from accepting a Pyth price so old it's
/// no longer meaningfully protective. 3,600s = 1 hour.
pub const MAX_ORACLE_STALENESS_SECS: u32 = 3_600;

/// Widest Pyth confidence interval a price may have to be used, as a share
/// of the price (2026-10-08). Pyth's guidance is to refuse prices whose
/// `conf` is large relative to `price` — in a fast or illiquid market the
/// "price" is then mostly noise.
pub const MAX_ORACLE_CONF_BPS: u128 = 200; // 2%

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// Own code range (2026-10-08): lib.rs 6000+, dlmm 6100+, governance
// 6200+, oracle 6300+, swdmm_v2 8000+, timelock 8500+. They all used to
// start at 6000, so a raw error number did not say which error it was.
#[error_code(offset = 6300)]
pub enum OracleError {
    #[msg("Pyth price is missing, for the wrong feed, or older than this pool's configured maximum staleness")]
    PriceUnavailable,
    #[msg("Pyth price update's verification_level is not Full (Partial updates are not trusted for guarding real funds)")]
    PriceVerificationNotFull,
    #[msg("Pyth price update's feed_id does not match this pool's configured pyth_feed_id_a/pyth_feed_id_b")]
    PriceFeedMismatch,
    #[msg("Pyth price update is older than this pool's configured oracle_max_staleness_secs")]
    PriceTooStale,
    #[msg("Pyth reported a zero or negative price — cannot be used")]
    InvalidOraclePrice,
    #[msg("This pool's spot price deviates from the oracle price by more than the pool's configured guard threshold")]
    PriceDeviationTooLarge,
    #[msg("oracle_max_deviation_bps must be > 0 and <= MAX_ORACLE_DEVIATION_GUARD_BPS")]
    InvalidDeviationGuard,
    #[msg("oracle_max_staleness_secs must be > 0 and <= MAX_ORACLE_STALENESS_SECS")]
    InvalidStalenessBound,
    #[msg("max_fee_bps must be >= fee_bps and <= MAX_FEE_BPS")]
    InvalidMaxFee,
    #[msg("pyth_feed_id_a and pyth_feed_id_b must be different feeds")]
    IdenticalFeeds,
    #[msg("Math overflow in oracle price/fee computation")]
    MathOverflow,
    #[msg("Oracle price confidence interval is too wide to use")]
    PriceConfidenceTooWide,
}

// ---------------------------------------------------------------------
// Pool-creation-time parameter validation
// ---------------------------------------------------------------------

/// Shared by `initialize_pool` and `initialize_dlmm_pool` — validates the
/// five new oracle/dynamic-fee parameters together, once, so both pool
/// types apply exactly the same bounds. Does not touch any account data;
/// pure validation only.
pub fn validate_oracle_params(
    pyth_feed_id_a: &[u8; 32],
    pyth_feed_id_b: &[u8; 32],
    oracle_max_staleness_secs: u32,
    oracle_max_deviation_bps: u16,
    fee_bps: u16,
    max_fee_bps: u16,
) -> Result<()> {
    require!(pyth_feed_id_a != pyth_feed_id_b, OracleError::IdenticalFeeds);
    require!(
        oracle_max_staleness_secs > 0 && oracle_max_staleness_secs <= MAX_ORACLE_STALENESS_SECS,
        OracleError::InvalidStalenessBound
    );
    require!(
        oracle_max_deviation_bps > 0 && oracle_max_deviation_bps <= MAX_ORACLE_DEVIATION_GUARD_BPS,
        OracleError::InvalidDeviationGuard
    );
    require!(
        max_fee_bps >= fee_bps && max_fee_bps <= crate::MAX_FEE_BPS,
        OracleError::InvalidMaxFee
    );
    Ok(())
}

// ---------------------------------------------------------------------
// Price math (pure — no Account<>/Clock access, so these are exercised
// directly by `cargo test`'s host-side `tests` module without needing a
// Solana runtime at all, same pattern as dlmm.rs's `dlmm_math_tests`)
// ---------------------------------------------------------------------

/// Computes the oracle-implied price, as a Q64.64 "raw units of mint_b
/// per 1 raw unit of mint_a" ratio (see this module's doc comment), from
/// each side's raw Pyth price/exponent and each mint's decimals.
///
/// Derivation: the USD value of ONE RAW UNIT of mint_a is
/// `price_a * 10^expo_a / 10^decimals_a`, and likewise for mint_b. Their
/// ratio (a's raw-unit USD value divided by b's) is the number of raw
/// mint_b units one raw mint_a unit is worth — exactly the quantity
/// this program's Q64.64 price values represent everywhere else:
///   ratio = (price_a / price_b) * 10^((expo_a - decimals_a) - (expo_b - decimals_b))
pub fn oracle_price_q64(
    price_a: i64,
    expo_a: i32,
    decimals_a: u8,
    price_b: i64,
    expo_b: i32,
    decimals_b: u8,
) -> Result<u128> {
    require!(price_a > 0 && price_b > 0, OracleError::InvalidOraclePrice);

    let net_exp = (expo_a as i64 - decimals_a as i64) - (expo_b as i64 - decimals_b as i64);

    // A u64-range price shifted left 64 bits always fits u128 losslessly
    // (u64::MAX << 64 < u128::MAX) — same fact `dlmm.rs`'s `q64_div_amount`
    // relies on — so this base ratio can never overflow on its own; only
    // the subsequent power-of-ten scale-up (for a large positive
    // `net_exp`) can.
    let mut ratio_q64 = (price_a as u128)
        .checked_shl(64)
        .ok_or(OracleError::MathOverflow)?
        .checked_div(price_b as u128)
        .ok_or(OracleError::MathOverflow)?;

    if net_exp > 0 {
        let scale = 10u128
            .checked_pow(u32::try_from(net_exp).map_err(|_| OracleError::MathOverflow)?)
            .ok_or(OracleError::MathOverflow)?;
        ratio_q64 = ratio_q64.checked_mul(scale).ok_or(OracleError::MathOverflow)?;
    } else if net_exp < 0 {
        let scale = 10u128
            .checked_pow(u32::try_from(-net_exp).map_err(|_| OracleError::MathOverflow)?)
            .ok_or(OracleError::MathOverflow)?;
        require!(scale > 0, OracleError::MathOverflow);
        ratio_q64 = ratio_q64.checked_div(scale).ok_or(OracleError::MathOverflow)?;
    }

    require!(ratio_q64 > 0, OracleError::InvalidOraclePrice);
    Ok(ratio_q64)
}

/// Absolute deviation between two Q64.64 prices, in basis points of the
/// oracle price. Both inputs are already in the same Q64.64 scale, so
/// that scale cancels out of the ratio — this works directly on the raw
/// u128 values with no unscaling step.
pub fn deviation_bps(pool_price_q64: u128, oracle_price_q64: u128) -> Result<u64> {
    require!(oracle_price_q64 > 0, OracleError::InvalidOraclePrice);
    let diff = pool_price_q64.abs_diff(oracle_price_q64);
    let bps = diff
        .checked_mul(10_000)
        .ok_or(OracleError::MathOverflow)?
        .checked_div(oracle_price_q64)
        .ok_or(OracleError::MathOverflow)?;
    u64::try_from(bps).map_err(|_| OracleError::MathOverflow.into())
}

/// Linearly scales this swap's fee from `base_fee_bps` (at zero
/// deviation) up to `max_fee_bps` (at `max_deviation_bps` deviation —
/// the guard threshold itself). Beyond the threshold it returns
/// `max_fee_bps`: such a swap is only allowed when it moves the price
/// back toward the oracle (see `guard_allows`), and it pays the maximum
/// fee to do so.
pub fn dynamic_fee_bps(
    base_fee_bps: u16,
    max_fee_bps: u16,
    deviation_bps: u64,
    max_deviation_bps: u16,
) -> Result<u16> {
    require!(max_deviation_bps > 0, OracleError::InvalidDeviationGuard);
    require!(max_fee_bps >= base_fee_bps, OracleError::InvalidMaxFee);
    if deviation_bps >= max_deviation_bps as u64 {
        return Ok(max_fee_bps);
    }
    let range = (max_fee_bps - base_fee_bps) as u64;
    let extra = range
        .checked_mul(deviation_bps)
        .ok_or(OracleError::MathOverflow)?
        .checked_div(max_deviation_bps as u64)
        .ok_or(OracleError::MathOverflow)?;
    let fee = (base_fee_bps as u64)
        .checked_add(extra)
        .ok_or(OracleError::MathOverflow)?;
    u16::try_from(fee).map_err(|_| OracleError::MathOverflow.into())
}

// ---------------------------------------------------------------------
// Account-facing entry point — called from lib.rs's `swap` and dlmm.rs's
// `swap_dlmm`, once each, before either pool's own fee/output math runs.
// ---------------------------------------------------------------------

/// `conf <= price * MAX_ORACLE_CONF_BPS / 10_000` (and a positive price).
pub fn confidence_ok(p: &Price) -> bool {
    p.price > 0 && (p.conf as u128) * 10_000 <= (p.price as u128) * MAX_ORACLE_CONF_BPS
}

pub struct OracleFeeResult {
    pub fee_bps: u16,
    /// Deviation of the pool's PRE-trade price from the oracle.
    pub deviation_bps: u64,
    pub oracle_price_q64: u128,
    pub max_deviation_bps: u16,
}

/// The guard rule. A swap is allowed when the pool's POST-trade price is
/// within the guard, OR when it moves the price strictly closer to the
/// oracle (so arbitrage can always pull a pool that is outside the guard
/// back, e.g. after the oracle itself jumped).
///
/// History: until 2026-10-07 only the pre-trade price was checked, so one
/// large swap could push a pool past the guard and every later swap —
/// including the arbitrage back — was rejected. The 2026-10-07 fix then
/// allowed any swap that STARTED inside the guard, which let a single swap
/// end arbitrarily far outside it (found 2026-10-08 by the attack suite,
/// `security/attack-tests`, attack_price_manipulation_beyond_oracle_guard).
pub fn guard_allows(pre_deviation_bps: u64, post_deviation_bps: u64, max_deviation_bps: u16) -> bool {
    post_deviation_bps <= max_deviation_bps as u64 || post_deviation_bps < pre_deviation_bps
}

impl OracleFeeResult {
    /// Enforces the guard once the swap's POST-trade pool price is known
    /// (see `guard_allows`). Must be called by every swap path after it
    /// has computed the new price and before it returns.
    pub fn enforce_guard(&self, post_pool_price_q64: u128) -> Result<()> {
        let post = deviation_bps(post_pool_price_q64, self.oracle_price_q64)?;
        require!(
            guard_allows(self.deviation_bps, post, self.max_deviation_bps),
            OracleError::PriceDeviationTooLarge
        );
        Ok(())
    }
}

/// Reads and validates both Pyth price updates, computes the oracle
/// price and this pool's deviation from it, and returns the fee this
/// swap should use (`max_fee_bps` when the pool is outside the guard).
/// It does NOT reject on deviation by itself: the caller must call
/// `OracleFeeResult::enforce_guard` with the post-trade price.
/// `pool_price_q64` is the
/// caller's own pool-type-specific spot price (constant-product:
/// `reserve_b/reserve_a`; DLMM: `bin_price_q64(active_bin_id,
/// bin_step_bps)`), already in this module's shared Q64.64 convention —
/// see the module doc comment.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_oracle_and_fee(
    price_update_a: &Account<PriceUpdateV2>,
    price_update_b: &Account<PriceUpdateV2>,
    pyth_feed_id_a: &[u8; 32],
    pyth_feed_id_b: &[u8; 32],
    oracle_max_staleness_secs: u32,
    decimals_a: u8,
    decimals_b: u8,
    pool_price_q64: u128,
    base_fee_bps: u16,
    max_fee_bps: u16,
    oracle_max_deviation_bps: u16,
    clock: &Clock,
) -> Result<OracleFeeResult> {
    // No `.map_err(...)` collapsing here (2026-09-24) — let the specific
    // PriceVerificationNotFull/PriceFeedMismatch/PriceTooStale/MathOverflow
    // error from `get_price_no_older_than` propagate as-is; see that
    // method's own comment for why.
    let price_a =
        price_update_a.get_price_no_older_than(clock, oracle_max_staleness_secs as u64, pyth_feed_id_a)?;
    let price_b =
        price_update_b.get_price_no_older_than(clock, oracle_max_staleness_secs as u64, pyth_feed_id_b)?;
    require!(confidence_ok(&price_a) && confidence_ok(&price_b), OracleError::PriceConfidenceTooWide);

    let oracle_q64 = oracle_price_q64(
        price_a.price,
        price_a.exponent,
        decimals_a,
        price_b.price,
        price_b.exponent,
        decimals_b,
    )?;
    let dev_bps = deviation_bps(pool_price_q64, oracle_q64)?;
    let fee_bps = dynamic_fee_bps(base_fee_bps, max_fee_bps, dev_bps, oracle_max_deviation_bps)?;

    Ok(OracleFeeResult {
        fee_bps,
        deviation_bps: dev_bps,
        oracle_price_q64: oracle_q64,
        max_deviation_bps: oracle_max_deviation_bps,
    })
}

// ---------------------------------------------------------------------
// Pure-math unit tests — host-side, no Solana runtime, run by
// `cargo test -p swd_amm` exactly like dlmm.rs's `dlmm_math_tests`.
// ---------------------------------------------------------------------

#[cfg(test)]
mod oracle_math_tests {
    use super::*;

    // Two mints at 6 decimals each, both priced at exactly $1.00 with
    // Pyth exponent -8 (price = 1_00000000). Oracle ratio should come
    // out to exactly 1 raw-b-per-raw-a, i.e. Q64_ONE.
    const Q64_ONE: u128 = 1u128 << 64;

    #[test]
    fn oracle_price_q64_equal_prices_equal_decimals_is_one() {
        let ratio = oracle_price_q64(1_00000000, -8, 6, 1_00000000, -8, 6).unwrap();
        assert_eq!(ratio, Q64_ONE);
    }

    #[test]
    fn oracle_price_q64_handles_decimals_mismatch() {
        // mint_a: 9 decimals (e.g. SOL-like), priced $200.
        // mint_b: 6 decimals (e.g. USDC-like), priced $1.
        // 1 raw unit of a = 200 / 1e9 USD. 1 raw unit of b = 1 / 1e6 USD.
        // ratio (raw b per raw a) = (200/1e9) / (1/1e6) = 200 * 1e6 / 1e9 = 0.2
        let ratio = oracle_price_q64(200_00000000, -8, 9, 1_00000000, -8, 6).unwrap();
        let expected = Q64_ONE / 5; // 0.2 in Q64.64
        // Integer division introduces at most a few ULPs of Q64.64
        // rounding error — assert closeness, not bit-exact equality.
        let diff = if ratio > expected { ratio - expected } else { expected - ratio };
        assert!(diff < 1_000_000, "ratio {} not close enough to expected {}", ratio, expected);
    }

    #[test]
    fn oracle_price_q64_rejects_nonpositive_price() {
        assert!(oracle_price_q64(0, -8, 6, 1_00000000, -8, 6).is_err());
        assert!(oracle_price_q64(1_00000000, -8, 6, -1, -8, 6).is_err());
    }

    #[test]
    fn deviation_bps_zero_when_equal() {
        assert_eq!(deviation_bps(Q64_ONE, Q64_ONE).unwrap(), 0);
    }

    #[test]
    fn deviation_bps_symmetric_above_and_below() {
        // pool price ~1% above oracle, and ~1% below — should report the
        // SAME deviation either way (symmetry is the actual property this
        // test checks — see below for why that number isn't a clean 100).
        //
        // FIXED 2026-09-24 (first real `cargo test -p swd_amm` run on the
        // user's own machine caught this): `Q64_ONE / 100` itself already
        // floors (2^64 isn't divisible by 100), so `above`/`below` are each
        // off Q64_ONE by that same floored amount — call it D. `dev_above`
        // then does a SECOND floor: `(D * 10_000) / Q64_ONE`, which lands
        // one bps short of the "clean" 100 (confirmed: 99, not 100).
        // `dev_below` computes the exact same `D` as its diff (`Q64_ONE -
        // below == D` exactly, by construction), so it floors to the same
        // 99 — genuinely symmetric, just not equal to the round number the
        // original comment assumed. The assertions below were changed from
        // a hardcoded `100` to `dev_above` (i.e. "whatever above computes
        // to, below must match exactly") so this test keeps checking real
        // symmetry without depending on an integer-division coincidence.
        let above = Q64_ONE + Q64_ONE / 100;
        let below = Q64_ONE - Q64_ONE / 100;
        let dev_above = deviation_bps(above, Q64_ONE).unwrap();
        let dev_below = deviation_bps(below, Q64_ONE).unwrap();
        assert_eq!(dev_above, 99, "sanity check on the expected floored value — if this changes, the comment above needs updating too");
        assert_eq!(dev_below, dev_above, "above/below deviation must be exactly symmetric");
    }

    #[test]
    fn dynamic_fee_bps_at_zero_deviation_is_base_fee() {
        assert_eq!(dynamic_fee_bps(30, 300, 0, 500).unwrap(), 30);
    }

    #[test]
    fn dynamic_fee_bps_at_guard_threshold_is_max_fee() {
        assert_eq!(dynamic_fee_bps(30, 300, 500, 500).unwrap(), 300);
    }

    #[test]
    fn dynamic_fee_bps_beyond_guard_threshold_still_clamps_to_max_fee() {
        // A pool outside the guard pays the max fee on the swap that
        // brings it back (see `guard_allows`).
        assert_eq!(dynamic_fee_bps(30, 300, 10_000, 500).unwrap(), 300);
    }

    #[test]
    fn guard_inside_allows_swaps_that_stay_inside() {
        assert!(guard_allows(0, 0, 500));
        assert!(guard_allows(100, 500, 500));
        assert!(!guard_allows(500, 900, 500), "a swap may not push the pool out of the guard");
        assert!(!guard_allows(0, 2_000, 500));
    }

    #[test]
    fn guard_outside_only_allows_moving_toward_the_oracle() {
        // Pool stuck at 20% off the oracle with a 5% guard.
        assert!(guard_allows(2_000, 1_500, 500), "a swap back toward the oracle must be allowed");
        assert!(guard_allows(2_000, 100, 500));
        assert!(!guard_allows(2_000, 2_000, 500), "no improvement");
        assert!(!guard_allows(2_000, 2_500, 500), "a swap further away must be rejected");
    }

    #[test]
    fn enforce_guard_uses_post_trade_price() {
        let oracle = Q64_ONE;
        let stuck = OracleFeeResult { fee_bps: 300, deviation_bps: 2_000, oracle_price_q64: oracle, max_deviation_bps: 500 };
        // post price 10% above oracle: closer than 20% -> allowed
        assert!(stuck.enforce_guard(Q64_ONE + Q64_ONE / 10).is_ok());
        // post price 30% above: further -> rejected
        assert!(stuck.enforce_guard(Q64_ONE + Q64_ONE * 3 / 10).is_err());
        // overshooting to 25% below is still further than 20% -> rejected
        assert!(stuck.enforce_guard(Q64_ONE - Q64_ONE / 4).is_err());
        let inside = OracleFeeResult { deviation_bps: 100, ..stuck };
        assert!(inside.enforce_guard(Q64_ONE + Q64_ONE / 50).is_ok(), "stays inside the 5% guard");
        assert!(inside.enforce_guard(Q64_ONE * 2).is_err(), "may not push the pool out of the guard");
    }

    #[test]
    fn dynamic_fee_bps_scales_linearly_at_midpoint() {
        // Halfway to the guard threshold should be halfway between base
        // and max fee.
        assert_eq!(dynamic_fee_bps(30, 330, 250, 500).unwrap(), 180);
    }

    #[test]
    fn validate_oracle_params_rejects_identical_feeds() {
        let feed = [7u8; 32];
        assert!(validate_oracle_params(&feed, &feed, 60, 500, 30, 300).is_err());
    }

    #[test]
    fn validate_oracle_params_rejects_out_of_bound_staleness() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        assert!(validate_oracle_params(&a, &b, 0, 500, 30, 300).is_err());
        assert!(validate_oracle_params(&a, &b, MAX_ORACLE_STALENESS_SECS + 1, 500, 30, 300).is_err());
        assert!(validate_oracle_params(&a, &b, 60, 500, 30, 300).is_ok());
    }

    #[test]
    fn validate_oracle_params_rejects_out_of_bound_deviation_guard() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        assert!(validate_oracle_params(&a, &b, 60, 0, 30, 300).is_err());
        assert!(validate_oracle_params(&a, &b, 60, MAX_ORACLE_DEVIATION_GUARD_BPS + 1, 30, 300).is_err());
    }

    #[test]
    fn validate_oracle_params_rejects_max_fee_below_base_fee() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        assert!(validate_oracle_params(&a, &b, 60, 500, 300, 30).is_err());
        assert!(validate_oracle_params(&a, &b, 60, 500, 30, crate::MAX_FEE_BPS + 1).is_err());
        assert!(validate_oracle_params(&a, &b, 60, 500, 30, 300).is_ok());
    }
}
