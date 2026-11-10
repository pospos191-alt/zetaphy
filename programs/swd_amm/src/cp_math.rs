// Constant-product (CP) pool — pure math (no Anchor, no Solana types).
// 2026-11-10.
//
// Moved verbatim out of lib.rs's add_liquidity / remove_liquidity / swap
// handlers so the exact code the program runs can be fuzzed
// (programs/swd_amm/fuzz) and model-checked with Kani
// (programs/swd_amm/kani) without compiling Anchor. lib.rs maps `None` to
// `SwdAmmError::MathOverflow` and `CpSwapError` to the Anchor error the
// handler used to raise at that point, in the same order, so the program's
// behaviour and error codes are unchanged.
//
// Rounding: everything a user receives rounds down; the swap's new
// out-side reserve rounds UP (so the output rounds down), and the fee is
// taken by rounding the after-fee input DOWN.
//
// This file must stay free of `crate::` / anchor imports: the Kani and fuzz
// crates include it with `#[path = ...]`.

/// Same value as lib.rs's `CP_MAX_PRICE_IMPACT_BPS`.
pub const CP_MAX_PRICE_IMPACT_BPS: u128 = 5_000;

/// floor(a * b / denom) with a u128 intermediate. None if denom == 0 or the
/// result does not fit u64.
pub fn mul_div(a: u64, b: u64, denom: u64) -> Option<u64> {
    if denom == 0 {
        return None;
    }
    let result = (a as u128).checked_mul(b as u128)?.checked_div(denom as u128)?;
    u64::try_from(result).ok()
}

/// floor(sqrt(value)) — Babylonian method, safe for value == u128::MAX
/// (see the history comment on lib.rs's `integer_sqrt`).
pub fn integer_sqrt(value: u128) -> u128 {
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

/// LP minted on a later deposit: min of the two pro-rata shares (each
/// rounded down), so a deposit can never buy more than either side pays for.
pub fn lp_for_deposit(amount_a: u64, amount_b: u64, lp_supply: u64, reserve_a: u64, reserve_b: u64) -> Option<u64> {
    let lp_from_a = mul_div(amount_a, lp_supply, reserve_a)?;
    let lp_from_b = mul_div(amount_b, lp_supply, reserve_b)?;
    Some(lp_from_a.min(lp_from_b))
}

/// Tokens returned for burning `lp_amount` (each rounded down).
pub fn withdraw_amounts(lp_amount: u64, reserve_a: u64, reserve_b: u64, lp_supply: u64) -> Option<(u64, u64)> {
    Some((mul_div(lp_amount, reserve_a, lp_supply)?, mul_div(lp_amount, reserve_b, lp_supply)?))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CpSwapError {
    MathOverflow,
    PriceImpactTooHigh,
}

/// Output of a CP swap of `amount_in_net` (what actually reached the
/// vault) at `fee_bps`:
///   x   = floor(amount_in_net * (10_000 - fee_bps) / 10_000)
///   out = reserve_out - ceil(reserve_in * reserve_out / (reserve_in + x))
/// Refuses a swap whose curve input moves more than
/// CP_MAX_PRICE_IMPACT_BPS of the in-side reserve. The handler then
/// requires out > 0, out >= min_amount_out and out < reserve_out, and adds
/// the whole `amount_in_net` (fee included) to the in-side reserve.
pub fn swap_out(reserve_in: u64, reserve_out: u64, amount_in_net: u64, fee_bps: u128) -> Result<u64, CpSwapError> {
    use CpSwapError::MathOverflow as O;
    let fee_multiplier = 10_000u128.checked_sub(fee_bps).ok_or(O)?;
    let amount_in_after_fee = (amount_in_net as u128)
        .checked_mul(fee_multiplier)
        .ok_or(O)?
        .checked_div(10_000)
        .ok_or(O)?;

    let impact_bps = amount_in_after_fee
        .checked_mul(10_000)
        .ok_or(O)?
        .checked_div((reserve_in as u128).checked_add(amount_in_after_fee).ok_or(O)?)
        .ok_or(O)?;
    if impact_bps > CP_MAX_PRICE_IMPACT_BPS {
        return Err(CpSwapError::PriceImpactTooHigh);
    }

    let k = (reserve_in as u128).checked_mul(reserve_out as u128).ok_or(O)?;
    let new_reserve_in = (reserve_in as u128).checked_add(amount_in_after_fee).ok_or(O)?;
    if new_reserve_in == 0 {
        return Err(O);
    }
    let new_reserve_out_ceil = k.checked_add(new_reserve_in - 1).ok_or(O)?.checked_div(new_reserve_in).ok_or(O)?;
    let amount_out_u128 = (reserve_out as u128).checked_sub(new_reserve_out_ceil).ok_or(O)?;
    u64::try_from(amount_out_u128).map_err(|_| O)
}
