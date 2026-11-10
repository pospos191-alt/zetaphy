// DLMM — pure math (no Anchor, no Solana types). 2026-11-10.
//
// Moved verbatim out of dlmm.rs so the exact code the program runs can be
// fuzzed (programs/swd_amm/fuzz) and model-checked with Kani
// (programs/swd_amm/kani) without compiling Anchor. dlmm.rs keeps thin
// wrappers with the original names that map `None` to
// `SwdAmmError::MathOverflow` (every error these helpers used to return was
// MathOverflow) and `DlmmMathError` to the original Anchor errors, so the
// program's behaviour, error codes and check order are unchanged.
//
// This file must stay free of `crate::` / anchor imports: the Kani and fuzz
// crates include it with `#[path = ...]`.

/// See dlmm.rs (same constant, re-exported there).
pub const MAX_BINS_CROSSED_PER_SWAP: u32 = 30;
/// See dlmm.rs (same constant, re-exported there).
pub const MIN_BIN_LIQUIDITY: u128 = 10;

// ---------------------------------------------------------------------
// Fixed-point (Q64.64) math
// ---------------------------------------------------------------------
//
// A Q64.64 value `v: u128` represents the real number `v as f64 / 2^64`.
// Using u128 (not a general u256 big-integer library) keeps every
// operation inside native Rust integer types, at the cost of every
// multiply needing the manual split-multiply technique below instead of a
// plain `a * b` (which would overflow u128 for two full-magnitude Q64.64
// operands). This is the same class of technique production Solana AMMs
// (Orca Whirlpools, Raydium CLMM) use for their own tick/price math.

pub const Q64_ONE: u128 = 1u128 << 64;

/// Computes floor(a * b / 2^64) without ever overflowing u128, by manually
/// splitting both operands into high/low 64-bit halves and combining the
/// four partial products with their correct place values. Used both for
/// Q64.64 * Q64.64 -> Q64.64 (inside `pow_q64`) and for
/// plain_u64_amount * Q64.64_price -> plain_u64_amount (inside the amount
/// conversion helpers below) — the operation is identical either way; only
/// the caller's interpretation of the inputs/output differs.
///
/// Errors (rather than silently wrapping or truncating) if the true result
/// would not fit in u128 — see the derivation in the comment above the
/// `checked_add` calls below for why that's exactly what the checks here
/// catch.
/// Shared implementation behind `q64_mul` (floors, `round_up = false`) and
/// `q64_mul_ceil` (ceilings, `round_up = true`) — both need the identical
/// split-multiply decomposition, differing only in how the one place that
/// actually discards bits (`lo_lo`'s low 64 bits, folded into `term3`) is
/// rounded. Pulling the shared logic into one function keeps the two
/// public entry points from drifting out of sync with each other.
fn q64_mul_impl(a: u128, b: u128, round_up: bool) -> Option<u128> {
    let a_hi = (a >> 64) as u64;
    let a_lo = a as u64;
    let b_hi = (b >> 64) as u64;
    let b_lo = b as u64;

    // a*b = a_hi*b_hi*2^128 + (a_hi*b_lo + a_lo*b_hi)*2^64 + a_lo*b_lo
    // floor(a*b / 2^64) = a_hi*b_hi*2^64 + (a_hi*b_lo + a_lo*b_hi) + floor(a_lo*b_lo / 2^64)
    //
    // Each `checked_add`/`checked_mul`/`checked_shl` below can fail only
    // when the TRUE mathematical result would exceed u128::MAX — i.e. a
    // failure here means "this Q64.64 multiplication's result genuinely
    // does not fit in 128 bits", not an artifact of how the calculation is
    // decomposed. That is exactly the MathOverflow this function should
    // report.
    let hi_hi = (a_hi as u128)
        .checked_mul(b_hi as u128)?;
    if !(hi_hi <= u64::MAX as u128) {
        return None;
    }
    let term1 = hi_hi.checked_shl(64)?;

    let cross1 = (a_hi as u128)
        .checked_mul(b_lo as u128)?;
    let cross2 = (a_lo as u128)
        .checked_mul(b_hi as u128)?;
    let cross_sum = cross1.checked_add(cross2)?;

    let lo_lo = (a_lo as u128)
        .checked_mul(b_lo as u128)?;
    let term3_floor = lo_lo >> 64;
    let term3 = if round_up && (lo_lo & (u64::MAX as u128) != 0) {
        term3_floor.checked_add(1)?
    } else {
        term3_floor
    };

    term1
        .checked_add(cross_sum)?
        .checked_add(term3)
}

/// floor(a * b / 2^64) — see `q64_mul_impl` for the split-multiply
/// technique. This is the version used everywhere a Q64.64 product is
/// computed with no particular rounding-direction requirement (pricing,
/// `pow_q64`, etc.).
pub fn q64_mul(a: u128, b: u128) -> Option<u128> {
    q64_mul_impl(a, b, false)
}

/// ceil(a * b / 2^64) — same as `q64_mul` but rounds the discarded
/// fractional remainder UP instead of truncating it. Needed by
/// `amount_in_for_output`: when solving "what input, once multiplied by
/// the price, produces AT LEAST this output", flooring the input
/// (equivalently, flooring this multiplication) can under-shoot the target
/// by 1 raw unit — caught by `amount_in_for_output_matches_convert_at_bin_price`'s
/// `cargo test` run, 2026-09-09 (see that test's comment and
/// SECURITY.md).
pub fn q64_mul_ceil(a: u128, b: u128) -> Option<u128> {
    q64_mul_impl(a, b, true)
}

/// Computes floor((amount << 64) / price_q64) — dividing a PLAIN u64
/// amount by a Q64.64 price, yielding a plain amount. `amount << 64`
/// always fits in u128 exactly (a u64 shifted left 64 uses exactly the 128
/// bits available), so this is a single ordinary (checked) u128 division,
/// no split-multiply trick needed.
pub fn q64_div_amount(amount: u64, price_q64: u128) -> Option<u128> {
    if !(price_q64 > 0) {
        return None;
    }
    let numerator = (amount as u128)
        .checked_shl(64)?;
    Some(numerator / price_q64)
}

/// ceil((amount << 64) / price_q64) — same as `q64_div_amount` but rounds
/// up. Same rationale/caller as `q64_mul_ceil` above.
pub fn q64_div_amount_ceil(amount: u64, price_q64: u128) -> Option<u128> {
    if !(price_q64 > 0) {
        return None;
    }
    let numerator = (amount as u128)
        .checked_shl(64)?;
    let quotient = numerator / price_q64;
    if numerator % price_q64 == 0 {
        Some(quotient)
    } else {
        quotient.checked_add(1)
    }
}

/// Binary exponentiation: computes base_q64^exp as a Q64.64 value, using
/// O(log exp) calls to `q64_mul` instead of `exp` sequential
/// multiplications. Errors out (via `q64_mul`'s own overflow checks) once
/// `exp` is large enough that the result would no longer fit u128 — this
/// is the real, load-bearing safety bound on how far from the active bin a
/// price can be computed, rather than a separate hand-derived limit on
/// `bin_id` alone (which would depend on `bin_step_bps` too).
pub fn pow_q64(mut base: u128, mut exp: u32) -> Option<u128> {
    let mut result = Q64_ONE;
    while exp > 0 {
        if exp & 1 == 1 {
            result = q64_mul(result, base)?;
        }
        exp >>= 1;
        if exp > 0 {
            base = q64_mul(base, base)?;
        }
    }
    Some(result)
}

/// Price (in Q64.64, "amount of mint_b per 1 whole unit-equivalent of
/// mint_a's raw amount" — i.e. purely a ratio of raw token amounts, this
/// program has no notion of mint decimals) of the given bin, relative to
/// bin 0, for a pool with the given bin step. `bin_id` may be negative.
///
/// IMPORTANT: `bin_id` here is a pool's GLOBAL/ABSOLUTE bin index (e.g.
/// `pool.active_bin_id`), not an offset relative to that pool's own
/// creation-time active bin. Real pools routinely need `active_bin_id` far
/// from 0 — e.g. two mints with very different decimals need a bin index in
/// the thousands just to represent their raw-amount price ratio — so this
/// function must NOT bound `bin_id` against `HALF_RANGE` (an earlier draft
/// did exactly that, which would have made every swap on any realistic pool
/// fail with MathOverflow the moment `active_bin_id` wasn't within 100 of
/// zero). The bound that actually matters — "is this bin_id inside the
/// range this pool's BinArray actually allocated" — is enforced separately
/// and correctly by `BinArray::index_of` (which checks against
/// `pool.min_bin_id`/`max_bin_id`, i.e. `active_bin_id ± HALF_RANGE`, the
/// pool's own creation-time window). The only safety net this function
/// needs is `pow_q64`'s own checked-arithmetic overflow detection below,
/// which already rejects any `bin_id`/`bin_step_bps` combination whose true
/// result wouldn't fit in u128 — and since `pow_q64` is O(log |bin_id|),
/// even a huge |bin_id| is cheap to attempt and fail fast on.
///
/// Implementation note: rather than computing (1+s)^bin_id directly for
/// negative bin_id via a general Q64.64 reciprocal (which — for an
/// arbitrary large Q64.64 number — needs genuine u256 division), this
/// precomputes the single-step-DOWN ratio `1/(1+s)` directly via one
/// ordinary, small-magnitude division (`10000 / (10000+bin_step_bps)`,
/// scaled into Q64.64), then reuses the exact same `pow_q64` for negative
/// exponents too. This sidesteps ever needing a general large-number
/// reciprocal while still being mathematically exact.
pub fn bin_price_q64(bin_id: i32, bin_step_bps: u16) -> Option<u128> {
    if bin_id == 0 {
        return Some(Q64_ONE);
    }

    let step_bps = bin_step_bps as u128;
    if bin_id > 0 {
        // (1 + bin_step_bps/10000) in Q64.64 = ONE + ONE*step_bps/10000.
        let up_step = Q64_ONE
            .checked_add(mul_div_u128(Q64_ONE, step_bps, 10_000)?)?;
        pow_q64(up_step, bin_id as u32)
    } else {
        // 1 / (1 + bin_step_bps/10000) in Q64.64 = ONE*10000/(10000+step_bps).
        let denom = 10_000u128
            .checked_add(step_bps)?;
        let down_step = mul_div_u128(Q64_ONE, 10_000, denom)?;
        pow_q64(down_step, (-bin_id) as u32)
    }
}

/// Small helper for the two `bin_price_q64` divisions above — both
/// operands stay tiny (Q64_ONE and values under ~11_000), nowhere near
/// u128's ceiling, so a plain checked mul-then-div is safe without the
/// split-multiply technique `q64_mul` needs for full-magnitude operands.
pub fn mul_div_u128(a: u128, b: u128, denom: u128) -> Option<u128> {
    if !(denom > 0) {
        return None;
    }
    a.checked_mul(b)?.checked_div(denom)
}

/// Converts an input amount of one side into the output amount of the
/// other, at a single bin's fixed price, BEFORE any fee is applied (the
/// caller applies the fee to `amount_in` first). `a_to_b = true` means
/// "amount_in is mint_a, compute the mint_b amount out" (out = in * price);
/// otherwise "amount_in is mint_b, compute the mint_a amount out"
/// (out = in / price).
pub fn convert_at_bin_price(amount_in_after_fee: u64, price_q64: u128, a_to_b: bool) -> Option<u64> {
    let out_u128 = if a_to_b {
        q64_mul(amount_in_after_fee as u128, price_q64)?
    } else {
        q64_div_amount(amount_in_after_fee, price_q64)?
    };
    u64::try_from(out_u128).ok()
}

/// Inverse of `convert_at_bin_price`: given a desired OUTPUT amount at a
/// bin's fixed price, computes the (pre-fee) input amount that would
/// produce it — used by `swap_dlmm` to figure out exactly how much input
/// is needed to fully drain a bin's remaining output-side reserve.
pub fn amount_in_for_output(amount_out: u64, price_q64: u128, a_to_b: bool) -> Option<u64> {
    // Both branches round UP (the `_ceil` variants), not down. This
    // function's whole contract is "never under-shoot the requested
    // output" (see the doc comment above and `swap_dlmm`'s "fully drain
    // this bin" logic, which relies on that guarantee) — using the plain
    // floor()ing `q64_div_amount`/`q64_mul` here under-shot by 1 raw unit
    // in the round-trip case, caught by
    // `amount_in_for_output_matches_convert_at_bin_price`'s `cargo test`
    // run, 2026-09-09. Rounding up here means the pool asks for very
    // slightly MORE input than a floor calculation would when justifying
    // a full-bin drain — conservative in the LP's favor, never the
    // trader's, and off by at most 1 raw unit either way.
    let in_u128 = if a_to_b {
        // out = in * price  =>  in = out / price
        q64_div_amount_ceil(amount_out, price_q64)?
    } else {
        // out = in / price  =>  in = out * price
        q64_mul_ceil(amount_out as u128, price_q64)?
    };
    u64::try_from(in_u128).ok()
}

// ---------------------------------------------------------------------
// Share accounting (u128-shares versions of lib.rs's u64 `mul_div`)
// ---------------------------------------------------------------------

/// floor(amount * shares_supply / reserve). None if reserve == 0 or overflow.
pub fn mul_div_shares(amount: u64, shares_supply: u128, reserve: u64) -> Option<u128> {
    if reserve == 0 {
        return None;
    }
    (amount as u128).checked_mul(shares_supply)?.checked_div(reserve as u128)
}

/// floor(reserve * shares / shares_supply). None if supply == 0, overflow,
/// or the result does not fit u64.
pub fn mul_div_shares_down(reserve: u64, shares: u128, shares_supply: u128) -> Option<u64> {
    if shares_supply == 0 {
        return None;
    }
    let result = (reserve as u128).checked_mul(shares)?.checked_div(shares_supply)?;
    u64::try_from(result).ok()
}

/// floor(sqrt(value)), safe for value == u128::MAX.
pub fn integer_sqrt_u128(value: u128) -> u128 {
    if value == 0 {
        return 0;
    }
    let mut x = value;
    let mut y = x / 2 + (x % 2);
    while y < x {
        x = y;
        y = (x + value / x) / 2;
    }
    x
}

/// floor(a * b / denom) on u64 — identical to lib.rs's `mul_div`.
pub fn mul_div_u64(a: u64, b: u64, denom: u64) -> Option<u64> {
    if denom == 0 {
        return None;
    }
    u64::try_from((a as u128).checked_mul(b as u128)?.checked_div(denom as u128)?).ok()
}

// ---------------------------------------------------------------------
// Bin state transitions (deposit into one bin, swap across bins)
// ---------------------------------------------------------------------

/// Errors from the bin state transitions; dlmm.rs maps each one to the
/// Anchor error the handler used to raise at that point.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DlmmMathError {
    MathOverflow,
    SingleSidedViolation,
    InsufficientBinLiquidity,
    NoLiquidityAvailable,
    SlippageExceeded,
    ZeroAmount,
    InvariantViolation,
    PriceLimitReached,
    InsufficientShares,
}

/// The three fields of a bin. Implemented by dlmm.rs's zero-copy `Bin` and
/// by the fuzz/Kani models.
pub trait BinMut {
    fn total_shares(&mut self) -> &mut u128;
    fn reserve_a(&mut self) -> &mut u64;
    fn reserve_b(&mut self) -> &mut u64;
}

fn ov<T>(v: Option<T>) -> Result<T, DlmmMathError> {
    v.ok_or(DlmmMathError::MathOverflow)
}

/// Deposit (amount_a, amount_b) into one bin. Returns `Ok(None)` for the
/// legal (0, 0) no-op, else `Ok(Some((shares_minted, take_a, take_b)))`.
/// Mutates the bin exactly as add_dlmm_liquidity's loop body did.
///
/// Single-sided rule: bins above the active bin take only A, bins below
/// only B; only the active bin takes both (at its current ratio).
pub fn bin_deposit<B: BinMut>(
    bin: &mut B,
    bin_id: i32,
    active_bin_id: i32,
    amount_a: u64,
    amount_b: u64,
) -> Result<Option<(u128, u64, u64)>, DlmmMathError> {
    let is_active = bin_id == active_bin_id;
    if bin_id > active_bin_id {
        if amount_b != 0 {
            return Err(DlmmMathError::SingleSidedViolation);
        }
    } else if bin_id < active_bin_id && amount_a != 0 {
        return Err(DlmmMathError::SingleSidedViolation);
    }

    if amount_a == 0 && amount_b == 0 {
        return Ok(None);
    }

    let take_a = amount_a;
    let mut take_b = amount_b;
    let shares_minted: u128 = if *bin.total_shares() == 0 {
        let raw_shares = if is_active {
            integer_sqrt_u128(ov((amount_a as u128).checked_mul(amount_b as u128))?)
        } else if amount_a > 0 {
            amount_a as u128
        } else {
            amount_b as u128
        };
        if raw_shares <= MIN_BIN_LIQUIDITY {
            return Err(DlmmMathError::InsufficientBinLiquidity);
        }
        *bin.total_shares() = MIN_BIN_LIQUIDITY; // permanently-locked portion, credited to no position
        raw_shares - MIN_BIN_LIQUIDITY
    } else if is_active {
        let (ra, rb, ts) = (*bin.reserve_a(), *bin.reserve_b(), *bin.total_shares());
        if !(ra > 0 && rb > 0) {
            return Err(DlmmMathError::NoLiquidityAvailable);
        }
        let required_b = ov(mul_div_u64(amount_a, rb, ra))?;
        if required_b > amount_b {
            return Err(DlmmMathError::SlippageExceeded);
        }
        let shares_from_a = ov(mul_div_shares(amount_a, ts, ra))?;
        let shares_from_b = ov(mul_div_shares(required_b, ts, rb))?;
        take_b = required_b;
        shares_from_a.min(shares_from_b)
    } else if amount_a > 0 {
        let (ra, ts) = (*bin.reserve_a(), *bin.total_shares());
        if ra == 0 {
            return Err(DlmmMathError::NoLiquidityAvailable);
        }
        ov(mul_div_shares(amount_a, ts, ra))?
    } else {
        let (rb, ts) = (*bin.reserve_b(), *bin.total_shares());
        if rb == 0 {
            return Err(DlmmMathError::NoLiquidityAvailable);
        }
        ov(mul_div_shares(amount_b, ts, rb))?
    };
    if shares_minted == 0 {
        return Err(DlmmMathError::InsufficientBinLiquidity);
    }

    *bin.total_shares() = ov(bin.total_shares().checked_add(shares_minted))?;
    *bin.reserve_a() = ov(bin.reserve_a().checked_add(take_a))?;
    *bin.reserve_b() = ov(bin.reserve_b().checked_add(take_b))?;
    Ok(Some((shares_minted, take_a, take_b)))
}

/// Burn `shares` of one bin; returns (amount_a, amount_b), rounded down.
/// Caller has already checked `shares <= position.shares[i]`.
pub fn bin_withdraw<B: BinMut>(bin: &mut B, shares: u128) -> Result<(u64, u64), DlmmMathError> {
    let ts = *bin.total_shares();
    if shares > ts {
        return Err(DlmmMathError::InsufficientShares);
    }
    let amount_a = ov(mul_div_shares_down(*bin.reserve_a(), shares, ts))?;
    let amount_b = ov(mul_div_shares_down(*bin.reserve_b(), shares, ts))?;
    *bin.total_shares() = ov(ts.checked_sub(shares))?;
    *bin.reserve_a() = ov(bin.reserve_a().checked_sub(amount_a))?;
    *bin.reserve_b() = ov(bin.reserve_b().checked_sub(amount_b))?;
    Ok((amount_a, amount_b))
}

/// Result of a swap across bins.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BinSwapResult {
    pub total_amount_out: u64,
    pub active_bin_id: i32,
    pub bins_crossed: u32,
}

/// The swap_dlmm loop. `bins[i]` is bin id `array_min_bin_id + i`; the
/// array covers `array_min_bin_id..=array_max_bin_id`. Every unit of
/// `amount_in` (fee included) is credited to the bins it crossed; the fee
/// stays in the bin as LP income. Bounded: at most
/// MAX_BINS_CROSSED_PER_SWAP + 1 iterations.
#[allow(clippy::too_many_arguments)]
pub fn swap_bins<B: BinMut>(
    bins: &mut [B],
    array_min_bin_id: i32,
    array_max_bin_id: i32,
    mut active_bin_id: i32,
    bin_step_bps: u16,
    fee_bps: u128,
    amount_in: u64,
    a_to_b: bool,
) -> Result<BinSwapResult, DlmmMathError> {
    let mut amount_in_remaining = amount_in;
    let mut total_amount_out: u64 = 0;
    let mut bins_crossed: u32 = 0;

    loop {
        if !(active_bin_id >= array_min_bin_id && active_bin_id <= array_max_bin_id) {
            return Err(DlmmMathError::NoLiquidityAvailable);
        }
        let idx = (active_bin_id - array_min_bin_id) as usize;
        let price_q64 = ov(bin_price_q64(active_bin_id, bin_step_bps))?;
        let bin = bins.get_mut(idx).ok_or(DlmmMathError::NoLiquidityAvailable)?;

        let bin_reserve_out = if a_to_b { *bin.reserve_b() } else { *bin.reserve_a() };

        if bin_reserve_out == 0 || amount_in_remaining == 0 {
            if amount_in_remaining == 0 {
                break;
            }
            active_bin_id = if a_to_b { active_bin_id - 1 } else { active_bin_id + 1 };
            bins_crossed = ov(bins_crossed.checked_add(1))?;
            if bins_crossed > MAX_BINS_CROSSED_PER_SWAP {
                return Err(DlmmMathError::PriceLimitReached);
            }
            continue;
        }

        let fee_multiplier = ov(10_000u128.checked_sub(fee_bps))?;
        let amount_in_after_fee_full =
            (ov((amount_in_remaining as u128).checked_mul(fee_multiplier))? / 10_000) as u64;

        let in_needed_to_drain = ov(amount_in_for_output(bin_reserve_out, price_q64, a_to_b))?;

        if amount_in_after_fee_full < in_needed_to_drain || in_needed_to_drain == 0 {
            // Partial fill: this bin absorbs the whole remaining input.
            let amount_out = ov(convert_at_bin_price(amount_in_after_fee_full, price_q64, a_to_b))?;
            if amount_out == 0 {
                return Err(DlmmMathError::ZeroAmount);
            }
            if amount_out > bin_reserve_out {
                return Err(DlmmMathError::InvariantViolation);
            }
            if a_to_b {
                *bin.reserve_a() = ov(bin.reserve_a().checked_add(amount_in_remaining))?;
                *bin.reserve_b() = ov(bin.reserve_b().checked_sub(amount_out))?;
            } else {
                *bin.reserve_b() = ov(bin.reserve_b().checked_add(amount_in_remaining))?;
                *bin.reserve_a() = ov(bin.reserve_a().checked_sub(amount_out))?;
            }
            total_amount_out = ov(total_amount_out.checked_add(amount_out))?;
            break;
        } else {
            // Drain this bin's out-side reserve completely and move on.
            let gross_in_this_step = ov((in_needed_to_drain as u128).checked_mul(10_000))?;
            let gross_in_this_step = ov(gross_in_this_step.checked_div(fee_multiplier))?;
            let gross_in_this_step = ov(u64::try_from(gross_in_this_step).ok())?;
            let gross_in_this_step = gross_in_this_step.min(amount_in_remaining);

            if a_to_b {
                *bin.reserve_a() = ov(bin.reserve_a().checked_add(gross_in_this_step))?;
                *bin.reserve_b() = 0;
            } else {
                *bin.reserve_b() = ov(bin.reserve_b().checked_add(gross_in_this_step))?;
                *bin.reserve_a() = 0;
            }
            total_amount_out = ov(total_amount_out.checked_add(bin_reserve_out))?;
            amount_in_remaining = ov(amount_in_remaining.checked_sub(gross_in_this_step))?;

            let next_bin_id = if a_to_b { active_bin_id - 1 } else { active_bin_id + 1 };
            let next_in_range = next_bin_id >= array_min_bin_id && next_bin_id <= array_max_bin_id;
            if amount_in_remaining == 0 {
                if next_in_range {
                    active_bin_id = next_bin_id;
                }
                break;
            }
            if !next_in_range {
                return Err(DlmmMathError::NoLiquidityAvailable);
            }
            active_bin_id = next_bin_id;
            bins_crossed = ov(bins_crossed.checked_add(1))?;
            if bins_crossed > MAX_BINS_CROSSED_PER_SWAP {
                return Err(DlmmMathError::PriceLimitReached);
            }
        }
    }
    Ok(BinSwapResult { total_amount_out, active_bin_id, bins_crossed })
}
