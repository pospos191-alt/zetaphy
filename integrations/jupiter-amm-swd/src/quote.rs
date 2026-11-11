//! Off-chain replay of `swd_amm::swdmm_v2::swap_v2` (exact-in).
//!
//! Every check and every number below follows `swap_v2` in
//! `programs/swd_amm/src/swdmm_v2.rs`, in the same order, using the
//! program's own math file (`swdmm_math.rs`, compiled into this crate via
//! `#[path]`, see lib.rs). The oracle helpers at the bottom are ports of
//! the four small functions in `programs/swd_amm/src/oracle.rs` the guard
//! uses (oracle.rs itself depends on Anchor, so it is not included
//! directly); `tests/program_parity.rs` checks them against the program.
//!
//! If `swap_v2` changes, this file must change with it — and the parity
//! tests are what tell you.

use anyhow::{anyhow, bail, ensure, Result};

use crate::state::{PriceUpdate, SwdmmV2Pool};
use crate::swdmm_math as m;

/// Mirrors `oracle::MAX_ORACLE_CONF_BPS`.
pub const MAX_ORACLE_CONF_BPS: u128 = 200;

/// What the chain would do right now, as far as the quote can know.
#[derive(Clone, Copy, Debug)]
pub struct QuoteEnv {
    pub now: i64,
    pub slot: u64,
    pub protocol_fee_share_bps: u64,
}

/// Oracle inputs, needed only when `pool.oracle.enabled`.
#[derive(Clone, Copy, Debug)]
pub struct OracleInputs {
    pub price_a: PriceUpdate,
    pub price_b: PriceUpdate,
    pub decimals_a: u8,
    pub decimals_b: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SwapQuote {
    pub amount_out: u64,
    pub fee: u64,
    pub fee_in_b: bool,
    pub fee_bps: u64,
    pub base_fee_bps: u64,
    pub price_impact_bps: u64,
    pub new_reserve_a: u64,
    pub new_reserve_b: u64,
}

/// `SwdmmV2Pool::current_base_fee_bps`.
pub fn current_base_fee_bps(pool: &SwdmmV2Pool, now: i64) -> Result<u64> {
    let price = m::price_q64(pool.reserve_a, pool.reserve_b).ok_or_else(|| anyhow!("MathOverflow"))?;
    let cfg = pool.base_fee.to_math();
    let n = m::scheduler_periods(&cfg, now, pool.activation_ts, price, pool.init_price_q64)
        .ok_or_else(|| anyhow!("MathOverflow"))?;
    m::scheduled_fee_bps(&cfg, n).ok_or_else(|| anyhow!("MathOverflow"))
}

/// Exact-in quote. `Err` wherever `swap_v2` would fail (except the
/// trader-side checks: token accounts, balances, `min_amount_out`).
pub fn quote_exact_in(
    pool: &SwdmmV2Pool,
    env: &QuoteEnv,
    oracle: Option<&OracleInputs>,
    amount_in: u64,
    a_to_b: bool,
) -> Result<SwapQuote> {
    let now = env.now;
    ensure!(!pool.swap_paused, "SwapPaused");
    ensure!(now >= pool.activation_ts, "NotActivated");
    ensure!(amount_in > 0, "ZeroAmount");
    ensure!(pool.reserve_a > 0 && pool.reserve_b > 0, "EmptyPool");

    let price_before = m::price_q64(pool.reserve_a, pool.reserve_b).ok_or_else(|| anyhow!("MathOverflow"))?;

    // Per-slot impact cap: same bookkeeping as swap_v2 (without writing).
    let same_slot = pool.impact_slot == env.slot && pool.impact_ref_price_q64 > 0;
    let impact_ref = if same_slot { pool.impact_ref_price_q64 } else { price_before };

    // Optional Pyth guard (base/max fee 0, so it never changes the fee).
    let oracle_q64 = if pool.oracle.enabled {
        let o = oracle.ok_or_else(|| anyhow!("OracleAccountsMissing"))?;
        let pa = price_no_older_than(&o.price_a, now, pool.oracle.max_staleness_secs as u64, &pool.oracle.pyth_feed_id_a)?;
        let pb = price_no_older_than(&o.price_b, now, pool.oracle.max_staleness_secs as u64, &pool.oracle.pyth_feed_id_b)?;
        ensure!(confidence_ok(&pa) && confidence_ok(&pb), "PriceConfidenceTooWide");
        let q = oracle_price_q64(pa.price, pa.exponent, o.decimals_a, pb.price, pb.exponent, o.decimals_b)?;
        let dev = deviation_bps(price_before, q)?;
        // dynamic_fee_bps(0, 0, dev, max) only validates max_deviation > 0.
        ensure!(pool.oracle.max_deviation_bps > 0, "InvalidDeviationGuard");
        Some((q, dev))
    } else {
        None
    };

    // Fee = scheduled base fee + volatility fee.
    let base_bps = current_base_fee_bps(pool, now)?;
    let dyn_cfg = pool.dynamic_fee.to_math();
    let mut vol = pool.vol_state();
    if dyn_cfg.enabled {
        m::update_references(&dyn_cfg, &mut vol, now, price_before);
        m::accumulate(&dyn_cfg, &mut vol, price_before, now);
    }
    let var_bps = m::variable_fee_bps(&dyn_cfg, &vol);
    let fee_bps = m::total_fee_bps(base_bps, var_bps);

    let r = m::swap(
        pool.reserve_a,
        pool.reserve_b,
        amount_in,
        a_to_b,
        fee_bps,
        env.protocol_fee_share_bps,
        pool.collect_fee_mode,
    )
    .ok_or_else(|| anyhow!("SwapTooLarge"))?;
    ensure!(r.price_impact_bps <= pool.max_price_impact_bps as u64, "PriceImpactTooHigh");

    let price_after = m::price_q64(r.new_reserve_a, r.new_reserve_b).ok_or_else(|| anyhow!("MathOverflow"))?;
    if same_slot {
        ensure!(
            m::slot_impact_allows(impact_ref, price_before, price_after, pool.max_price_impact_bps as u64),
            "PriceImpactTooHigh (per-slot cap)"
        );
    }
    if let Some((q, pre_dev)) = oracle_q64 {
        let post = deviation_bps(price_after, q)?;
        ensure!(guard_allows(pre_dev, post, pool.oracle.max_deviation_bps), "PriceDeviationTooLarge");
    }

    Ok(SwapQuote {
        amount_out: r.amount_out,
        fee: r.fee,
        fee_in_b: r.fee_in_b,
        fee_bps,
        base_fee_bps: base_bps,
        price_impact_bps: r.price_impact_bps,
        new_reserve_a: r.new_reserve_a,
        new_reserve_b: r.new_reserve_b,
    })
}

// ---------------------------------------------------------------------
// Ports of programs/swd_amm/src/oracle.rs
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Price {
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
}

/// `PriceUpdateV2::get_price_no_older_than`.
pub fn price_no_older_than(p: &PriceUpdate, now: i64, maximum_age: u64, feed_id: &[u8; 32]) -> Result<Price> {
    ensure!(p.verification_full, "PriceVerificationNotFull");
    ensure!(p.feed_id == *feed_id, "PriceFeedMismatch");
    let age: u64 = if p.publish_time > now {
        0
    } else {
        now.checked_sub(p.publish_time).ok_or_else(|| anyhow!("MathOverflow"))? as u64
    };
    ensure!(age <= maximum_age, "PriceTooStale");
    Ok(Price { price: p.price, conf: p.conf, exponent: p.exponent })
}

/// `oracle::confidence_ok`.
pub fn confidence_ok(p: &Price) -> bool {
    p.price > 0 && (p.conf as u128) * 10_000 <= (p.price as u128) * MAX_ORACLE_CONF_BPS
}

/// `oracle::oracle_price_q64`.
pub fn oracle_price_q64(price_a: i64, expo_a: i32, decimals_a: u8, price_b: i64, expo_b: i32, decimals_b: u8) -> Result<u128> {
    ensure!(price_a > 0 && price_b > 0, "InvalidOraclePrice");
    let net_exp = (expo_a as i64 - decimals_a as i64) - (expo_b as i64 - decimals_b as i64);
    let mut ratio = (price_a as u128)
        .checked_shl(64)
        .ok_or_else(|| anyhow!("MathOverflow"))?
        .checked_div(price_b as u128)
        .ok_or_else(|| anyhow!("MathOverflow"))?;
    if net_exp > 0 {
        let scale = 10u128.checked_pow(u32::try_from(net_exp)?).ok_or_else(|| anyhow!("MathOverflow"))?;
        ratio = ratio.checked_mul(scale).ok_or_else(|| anyhow!("MathOverflow"))?;
    } else if net_exp < 0 {
        let scale = 10u128.checked_pow(u32::try_from(-net_exp)?).ok_or_else(|| anyhow!("MathOverflow"))?;
        ratio = ratio.checked_div(scale).ok_or_else(|| anyhow!("MathOverflow"))?;
    }
    if ratio == 0 {
        bail!("InvalidOraclePrice");
    }
    Ok(ratio)
}

/// `oracle::deviation_bps`.
pub fn deviation_bps(pool_price_q64: u128, oracle_price_q64: u128) -> Result<u64> {
    ensure!(oracle_price_q64 > 0, "InvalidOraclePrice");
    let diff = pool_price_q64.abs_diff(oracle_price_q64);
    let bps = diff
        .checked_mul(10_000)
        .ok_or_else(|| anyhow!("MathOverflow"))?
        / oracle_price_q64;
    Ok(u64::try_from(bps)?)
}

/// `oracle::guard_allows`.
pub fn guard_allows(pre_deviation_bps: u64, post_deviation_bps: u64, max_deviation_bps: u16) -> bool {
    post_deviation_bps <= max_deviation_bps as u64 || post_deviation_bps < pre_deviation_bps
}
