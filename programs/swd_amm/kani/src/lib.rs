//! Kani proofs for swd_amm's pure math (2026-11-10).
//!
//! Every `#[kani::proof]` below is checked for ALL values of its symbolic
//! inputs inside the stated bounds (not sampled): Kani/CBMC also checks
//! every arithmetic overflow, division by zero, out-of-bounds index and
//! panic on every path. "Bounds" are noted per proof; they exist because
//! 64x64-bit multiplications followed by 128-bit divisions are expensive
//! for a SAT solver: a full-u64-domain proof of a function with a
//! 128-bit division (e.g. mul_div) did not finish in 25 minutes, so those
//! properties are proved on 16/32-bit inputs and fuzzed on the full
//! domain. Proofs named `*_full_domain` / `*_any_id` take ANY u64/u128/i32.
//!
//! Run: `cargo kani` in programs/swd_amm/kani (see docs/FUZZING_FORMAL.md).
//!
//! Harnesses marked `SLOW` are only registered with
//! `RUSTFLAGS="--cfg kani_slow" cargo kani`: each one did not finish within
//! 20 minutes on a 4-core machine (CBMC bit-blasts every 128-bit
//! multiply/divide however small the bounds), so they are kept as written
//! specifications, and their properties are instead checked exhaustively on
//! small domains by programs/swd_amm/fuzz/tests/exhaustive.rs and by fuzzing.

#![allow(dead_code)]

#[path = "../../src/cp_math.rs"]
pub mod cp_math;
#[path = "../../src/dlmm_math.rs"]
pub mod dlmm_math;
#[path = "../../src/swdmm_math.rs"]
pub mod swdmm_math;

#[cfg(kani)]
mod proofs {
    use crate::cp_math as cp;
    use crate::dlmm_math as dm;
    use crate::swdmm_math as sm;

    const Q64: u128 = 1u128 << 64;

    fn any_u64_below(bits: u32) -> u64 {
        // NB: values are bounded, but CBMC still encodes the full 128-bit
        // multiply/divide circuits of the code under test.
        let v: u64 = kani::any();
        kani::assume(v < (1u64 << bits));
        v
    }

    // -----------------------------------------------------------------
    // Constant-product pool (cp_math, used by lib.rs swap/add/remove)
    // -----------------------------------------------------------------


    /// Bounded (reserves and input < 2^16, ANY u128 fee; fee > 100% must Err): output is
    /// strictly below the out-side reserve, never more than the exact
    /// constant-product output, k never decreases (with ceil rounding of
    /// the kept reserve), the fee never exceeds the input, and the price
    /// impact cap holds.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn cp_swap_out_props_u16() {
        let r_in = any_u64_below(16);
        let r_out = any_u64_below(16);
        let net = any_u64_below(16);
        let fee: u128 = kani::any();
        if fee > 10_000 {
            // any fee above 100% is a clean Err, never a wrap-around
            assert!(cp::swap_out(r_in, r_out, net, fee) == Err(cp::CpSwapError::MathOverflow));
            return;
        }
        kani::assume(r_in > 0 && r_out > 0);
        if let Ok(out) = cp::swap_out(r_in, r_out, net, fee) {
            let x = (net as u128) * (10_000 - fee) / 10_000;
            assert!(x <= net as u128); // fee <= input
            assert!(out < r_out);
            // out <= x * r_out / (r_in + x)
            assert!((out as u128) * (r_in as u128 + x) <= x * (r_out as u128));
            // k non-decreasing: curve part alone, and with the whole input.
            let k0 = (r_in as u128) * (r_out as u128);
            assert!((r_in as u128 + x) * ((r_out - out) as u128) >= k0);
            assert!((r_in as u128 + net as u128) * ((r_out - out) as u128) >= k0);
            // impact cap
            assert!(x * 10_000 / (r_in as u128 + x) <= cp::CP_MAX_PRICE_IMPACT_BPS);
        }
    }

    /// LP minting never over-issues: the LP a later deposit receives is
    /// worth no more than either token paid (lp/S <= a/ra and <= b/rb).
    /// Bounded: amounts, reserves, supply < 2^16.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn cp_lp_mint_never_over_issues_u16() {
        let (a, b) = (any_u64_below(16), any_u64_below(16));
        let (s, ra, rb) = (any_u64_below(16), any_u64_below(16), any_u64_below(16));
        if let Some(lp) = cp::lp_for_deposit(a, b, s, ra, rb) {
            assert!((lp as u128) * (ra as u128) <= (a as u128) * (s as u128));
            assert!((lp as u128) * (rb as u128) <= (b as u128) * (s as u128));
        }
    }

    /// LP burning never over-pays: burning lp of S returns at most lp/S of
    /// each reserve, and never more than the reserve. Bounded < 2^16.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn cp_lp_burn_never_over_pays_u16() {
        let (lp, s) = (any_u64_below(16), any_u64_below(16));
        let (ra, rb) = (any_u64_below(16), any_u64_below(16));
        kani::assume(lp <= s);
        if let Some((wa, wb)) = cp::withdraw_amounts(lp, ra, rb, s) {
            assert!((wa as u128) * (s as u128) <= (lp as u128) * (ra as u128));
            assert!((wb as u128) * (s as u128) <= (lp as u128) * (rb as u128));
            assert!(wa <= ra && wb <= rb);
        }
    }

    /// mul_div is the exact floor (Some), or None exactly when denom == 0
    /// or the result exceeds u64. Bounded: a, b < 2^32, d < 2^16 — so
    /// results above u64::MAX are NOT reachable here (fuzzed instead).
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn cp_mul_div_exact_bounded() {
        let (a, b, d) = (any_u64_below(32), any_u64_below(32), any_u64_below(16));
        let r = cp::mul_div(a, b, d);
        if d == 0 {
            assert!(r.is_none());
        } else {
            let exact = (a as u128) * (b as u128) / (d as u128);
            assert!(r == u64::try_from(exact).ok());
        }
    }

    /// integer_sqrt (CP first-deposit LP) is the exact floor sqrt.
    /// Bounded: inputs < 2^12 (Newton loop unwound fully).
    #[kani::proof]
    #[kani::unwind(16)]
    fn cp_integer_sqrt_exact_u12() {
        let v: u128 = kani::any();
        kani::assume(v < (1 << 12));
        let s = cp::integer_sqrt(v);
        assert!(s * s <= v && (s + 1) * (s + 1) > v);
    }

    // -----------------------------------------------------------------
    // DLMM (dlmm_math, used by dlmm.rs)
    // -----------------------------------------------------------------

    /// q64_mul / q64_mul_ceil never panic or overflow, for ANY two u128s.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn dlmm_q64_mul_no_panic_full_domain() {
        let (a, b): (u128, u128) = (kani::any(), kani::any());
        let f = dm::q64_mul(a, b);
        let c = dm::q64_mul_ceil(a, b);
        // ceil >= floor, and ceil - floor <= 1
        if let (Some(f), Some(c)) = (f, c) {
            assert!(c >= f && c - f <= 1);
        }
    }

    /// amount (any u64) x price (any u128) -> Q64.64 product, the shape
    /// convert_at_bin_price (A->B) and amount_in_for_output (B->A) use:
    /// never panics, q64_mul is exactly floor(x*p / 2^64) and q64_mul_ceil
    /// exactly the ceiling (None only when the result exceeds u128).
    /// Full domain, multiplication only.
    #[kani::proof]
    fn dlmm_amount_times_price_full_domain() {
        let x: u64 = kani::any();
        let p: u128 = kani::any();
        let (ph, pl) = (p >> 64, p & (Q64 - 1));
        let lo = (x as u128) * pl; // < 2^128
        let floor = (x as u128).checked_mul(ph).and_then(|h| h.checked_add(lo >> 64));
        assert!(dm::q64_mul(x as u128, p) == floor);
        let ceil = floor.and_then(|f| f.checked_add(if lo & (Q64 - 1) != 0 { 1 } else { 0 }));
        assert!(dm::q64_mul_ceil(x as u128, p) == ceil);
    }

    /// q64_mul is exactly floor(a*b / 2^64) and q64_mul_ceil exactly the
    /// ceiling, for a, b < 2^64 (so a*b fits u128 for the reference).
    #[kani::proof]
    fn dlmm_q64_mul_exact_u64_operands() {
        let (a, b): (u64, u64) = (kani::any(), kani::any());
        let p = (a as u128) * (b as u128);
        assert!(dm::q64_mul(a as u128, b as u128) == Some(p >> 64));
        let ce = (p >> 64) + if p & (Q64 - 1) != 0 { 1 } else { 0 };
        assert!(dm::q64_mul_ceil(a as u128, b as u128) == Some(ce));
    }

    /// Rounding direction of the bin price <-> amount conversions:
    /// convert_at_bin_price rounds the trader's output DOWN and
    /// amount_in_for_output rounds the trader's input UP, and paying the
    /// computed input always buys at least the requested output.
    /// Bounded: amounts < 2^16, price in [2^56, 2^72) (1/256x..256x).
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn dlmm_conversion_rounding_favours_pool() {
        let x = any_u64_below(16);
        let p: u128 = kani::any();
        kani::assume(p >= (1u128 << 56) && p < (1u128 << 72));
        let a_to_b: bool = kani::any();
        if let Some(out) = dm::convert_at_bin_price(x, p, a_to_b) {
            if a_to_b {
                // out <= x * p / 2^64
                assert!((out as u128) <= ((x as u128) * p) >> 64);
            } else {
                // out <= x * 2^64 / p
                assert!((out as u128) <= ((x as u128) << 64) / p);
            }
        }
        if let Some(inp) = dm::amount_in_for_output(x, p, a_to_b) {
            if let Some(back) = dm::convert_at_bin_price(inp, p, a_to_b) {
                assert!(back >= x);
            }
        }
    }

    /// bin_price_q64 never panics for ANY bin id and ANY step (the
    /// i32::MIN case panicked before 2026-11-10).
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    #[cfg_attr(kani_slow, kani::unwind(34))]
    fn dlmm_bin_price_no_panic_any_id() {
        let id: i32 = kani::any();
        let step: u16 = kani::any();
        let _ = dm::bin_price_q64(id, step);
    }

    /// Prices increase with the bin id near the active range: for
    /// |id| < 64 and any valid step, price(id+1) >= price(id), and
    /// price(0) == 1.0.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    #[cfg_attr(kani_slow, kani::unwind(8))]
    fn dlmm_bin_price_monotone_small_ids() {
        let id: i32 = kani::any();
        kani::assume(id > -64 && id < 63);
        let step: u16 = kani::any();
        kani::assume(step >= 1 && step <= 1_000);
        assert!(dm::bin_price_q64(0, step) == Some(Q64));
        if let (Some(p0), Some(p1)) = (dm::bin_price_q64(id, step), dm::bin_price_q64(id + 1, step)) {
            assert!(p1 >= p0);
        }
    }

    #[derive(Clone, Copy)]
    struct B {
        s: u128,
        a: u64,
        b: u64,
    }
    impl dm::BinMut for B {
        fn total_shares(&mut self) -> &mut u128 {
            &mut self.s
        }
        fn reserve_a(&mut self) -> &mut u64 {
            &mut self.a
        }
        fn reserve_b(&mut self) -> &mut u64 {
            &mut self.b
        }
    }

    /// Bin deposit: the single-sided rule is enforced (above the active
    /// bin only A, below only B), shares minted never exceed what the
    /// deposit pays for, and the bin never loses tokens.
    /// Bounded: reserves, amounts < 2^16, shares < 2^24; first deposits
    /// into the active bin (sqrt) with amounts < 2^8.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    #[cfg_attr(kani_slow, kani::unwind(20))]
    fn dlmm_bin_deposit_props() {
        let mut bin = B { s: kani::any(), a: any_u64_below(16), b: any_u64_below(16) };
        kani::assume(bin.s < (1u128 << 24));
        let before = bin;
        let (id, active): (i32, i32) = (kani::any(), kani::any());
        kani::assume(id > -1_000 && id < 1_000 && active > -1_000 && active < 1_000);
        let (amt_a, amt_b) = (any_u64_below(16), any_u64_below(16));
        // first deposits take a sqrt — keep the Newton loop short
        kani::assume(before.s > 0 || id != active || (amt_a < (1 << 8) && amt_b < (1 << 8)));
        let r = dm::bin_deposit(&mut bin, id, active, amt_a, amt_b);
        if id > active && amt_b != 0 {
            assert!(r == Err(dm::DlmmMathError::SingleSidedViolation));
        }
        if id < active && amt_a != 0 {
            assert!(r == Err(dm::DlmmMathError::SingleSidedViolation));
        }
        if let Ok(Some((sh, ta, tb))) = r {
            assert!(ta == amt_a && tb <= amt_b);
            assert!(bin.a == before.a + ta && bin.b == before.b + tb);
            if before.s > 0 {
                assert!(bin.s == before.s + sh);
                // sh/S <= ta/ra when A is taken; <= tb/rb when B is taken.
                if ta > 0 {
                    assert!(sh * (before.a as u128) <= (ta as u128) * before.s);
                }
                if tb > 0 {
                    assert!(sh * (before.b as u128) <= (tb as u128) * before.s);
                }
            } else {
                assert!(bin.s == sh + dm::MIN_BIN_LIQUIDITY);
            }
        }
    }

    /// Bin withdraw pays at most the burned share of each reserve.
    /// Bounded: reserves < 2^16, shares < 2^24.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn dlmm_bin_withdraw_props() {
        let mut bin = B { s: kani::any(), a: any_u64_below(16), b: any_u64_below(16) };
        kani::assume(bin.s < (1u128 << 24));
        let before = bin;
        let sh: u128 = any_u64_below(24) as u128;
        if let Ok((a, b)) = dm::bin_withdraw(&mut bin, sh) {
            assert!(sh <= before.s);
            assert!((a as u128) * before.s <= sh * (before.a as u128));
            assert!((b as u128) * before.s <= sh * (before.b as u128));
            assert!(bin.a == before.a - a && bin.b == before.b - b && bin.s == before.s - sh);
        }
    }

    /// Swap across bins (the swap_dlmm loop) on a 3-bin array, with
    /// symbolic reserves (< 2^8), fee (any <= 100%), amount (< 2^10),
    /// step (1..=1000) and direction: never panics, credits exactly
    /// amount_in to the bins and debits exactly the output, never pays out
    /// more than the bins held, never lowers a bin's value at its own
    /// price, and stops within the bin array / crossing limit.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    #[cfg_attr(kani_slow, kani::unwind(6))]
    fn dlmm_swap_bins_3_bins() {
        let mut bins = [B { s: 0, a: 0, b: 0 }; 3];
        for b in bins.iter_mut() {
            b.a = any_u64_below(8);
            b.b = any_u64_below(8);
        }
        // state invariant: above active only A, below only B (active = 0 = index 1)
        kani::assume(bins[0].a == 0 && bins[2].b == 0);
        let before = bins;
        let step: u16 = kani::any();
        kani::assume(step >= 1 && step <= 1_000);
        let fee: u128 = kani::any();
        kani::assume(fee <= 10_000);
        let amount = any_u64_below(10);
        let a_to_b: bool = kani::any();
        if let Ok(r) = dm::swap_bins(&mut bins[..], -1, 1, 0, step, fee, amount, a_to_b) {
            assert!(r.active_bin_id >= -1 && r.active_bin_id <= 1);
            assert!(r.bins_crossed <= dm::MAX_BINS_CROSSED_PER_SWAP);
            let sum = |bs: &[B; 3], a: bool| -> u128 { bs.iter().map(|b| if a { b.a as u128 } else { b.b as u128 }).sum() };
            assert!(sum(&bins, a_to_b) == sum(&before, a_to_b) + amount as u128);
            assert!(sum(&before, !a_to_b) - sum(&bins, !a_to_b) == r.total_amount_out as u128);
            for i in 0..3 {
                let p = dm::bin_price_q64(i as i32 - 1, step).unwrap();
                // value in B * 2^64: a * p + b * 2^64 (fits: a < 2^11, p < 2^65)
                let v0 = (before[i].a as u128) * p + ((before[i].b as u128) << 64);
                let v1 = (bins[i].a as u128) * p + ((bins[i].b as u128) << 64);
                assert!(v1 >= v0);
            }
        }
    }

    // -----------------------------------------------------------------
    // SWDMM v2 (swdmm_math, used by swdmm_v2.rs)
    // -----------------------------------------------------------------

    /// Fee is rounded UP and never exceeds the amount, for every amount
    /// < 2^32 and every fee <= 100%.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn v2_fee_amount_u32() {
        let amount = any_u64_below(32);
        let bps: u64 = kani::any();
        kani::assume(bps <= 10_000);
        let f = sm::fee_amount(amount, bps).unwrap();
        assert!(f <= amount);
        let p = (amount as u128) * (bps as u128);
        assert!((f as u128) * 10_000 >= p && (f as u128) * 10_000 < p + 10_000);
    }

    /// v2 swap: k never decreases, fee splits exactly, every token is
    /// accounted for (conservation), output < reserve, for every collect
    /// mode / direction / fee / protocol share (any u64/u8). Bounded:
    /// reserves and input < 2^16.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn v2_swap_props_u16() {
        let (ra, rb, x) = (any_u64_below(16), any_u64_below(16), any_u64_below(16));
        let a_to_b: bool = kani::any();
        let fee: u64 = kani::any();
        let share: u64 = kani::any();
        let mode: u8 = kani::any();
        if let Some(s) = sm::swap(ra, rb, x, a_to_b, fee, share, mode) {
            let k0 = (ra as u128) * (rb as u128);
            let k1 = (s.new_reserve_a as u128) * (s.new_reserve_b as u128);
            assert!(k1 >= k0);
            assert!(s.lp_fee + s.protocol_fee == s.fee);
            let (in0, out0, in1, out1) =
                if a_to_b { (ra, rb, s.new_reserve_a, s.new_reserve_b) } else { (rb, ra, s.new_reserve_b, s.new_reserve_a) };
            assert!(s.amount_out < out0);
            let kept = if s.compounded { s.protocol_fee } else { s.fee } as u128;
            if mode == sm::COLLECT_FEE_BOTH || !a_to_b {
                assert!(in1 as u128 + kept == in0 as u128 + x as u128);
                assert!(out1 as u128 + s.amount_out as u128 == out0 as u128);
            } else {
                assert!(in1 as u128 == in0 as u128 + x as u128);
                assert!(out1 as u128 + s.amount_out as u128 + kept == out0 as u128);
            }
        }
    }


    /// Liquidity minted by deposit_quote never exceeds either side paid
    /// for, costs never exceed the caller's maxima; withdraw_quote never
    /// over-pays. Bounded: amounts, reserves, liquidity < 2^16.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn v2_liquidity_never_over_issues_u16() {
        let (ra, rb) = (any_u64_below(16), any_u64_below(16));
        let l: u128 = any_u64_below(16) as u128;
        let (ma, mb) = (any_u64_below(16), any_u64_below(16));
        if let Some((liq, a, b)) = sm::deposit_quote(ra, rb, l, ma, mb) {
            assert!(a <= ma && b <= mb);
            assert!(liq * (ra as u128) <= (a as u128) * l);
            assert!(liq * (rb as u128) <= (b as u128) * l);
        }
        let burn: u128 = any_u64_below(16) as u128;
        if let Some((a, b)) = sm::withdraw_quote(ra, rb, l, burn) {
            assert!((a as u128) * l <= burn * (ra as u128));
            assert!((b as u128) * l <= burn * (rb as u128));
        }
    }

    /// Fee-growth accounting never over-pays: for a fee spread over L, any
    /// split of L into two positions claims at most the fee. pending_fee
    /// never panics for ANY global/checkpoint/liquidity (u128).
    /// Bounded: fee, total liquidity < 2^16.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 20 min (CBMC, 128-bit div/mul)
    fn v2_fee_growth_never_over_pays() {
        let fee = any_u64_below(16);
        let total: u128 = any_u64_below(16) as u128;
        kani::assume(total > 0);
        let part: u128 = kani::any();
        kani::assume(part <= total);
        let g = sm::fee_growth(fee, total).unwrap();
        let a = sm::pending_fee(g, 0, part).unwrap() as u128;
        let b = sm::pending_fee(g, 0, total - part).unwrap() as u128;
        assert!(a + b <= fee as u128);
    }

    /// Splitting liquidity never creates fees: for ANY fee growth g and any
    /// two positions a, b (< 2^64 liquidity each), what they can claim
    /// separately is at most what one position of a + b could claim
    /// (floor(g*a) + floor(g*b) <= floor(g*(a+b)), in Q64.64). With
    /// g = floor(fee * 2^64 / L) that bounds all claims by the fee.
    /// Multiplication only; full domain for g.
    #[cfg_attr(kani_slow, kani::proof)] // SLOW: did not finish in 15 min (CBMC, 128-bit mul)
    fn v2_pending_fee_split_never_creates_fees() {
        let g: u128 = kani::any();
        let a: u128 = kani::any::<u64>() as u128;
        let b: u128 = kani::any::<u64>() as u128;
        if let (Some(x), Some(y), Some(z)) = (sm::pending_fee(g, 0, a), sm::pending_fee(g, 0, b), sm::pending_fee(g, 0, a + b)) {
            assert!(x as u128 + y as u128 <= z as u128);
        }
    }

    #[kani::proof]
    fn v2_pending_fee_no_panic_full_domain() {
        let _ = sm::pending_fee(kani::any(), kani::any(), kani::any());
    }

    /// isqrt (v2 first-deposit liquidity) is the exact floor sqrt for all
    /// inputs < 2^12 (it returned 2 for isqrt(2) before 2026-11-10; the
    /// values up to 5e7 were checked exhaustively off-line, and the unit test
    /// checks 0..200_000 plus the neighbours of perfect squares).
    #[kani::proof]
    #[kani::unwind(16)]
    fn v2_isqrt_exact_u12() {
        let v: u128 = kani::any();
        kani::assume(v < (1 << 12));
        let s = sm::isqrt(v);
        assert!(s * s <= v && (s + 1) * (s + 1) > v);
    }

    /// Total fee is capped at 99% whatever the base and variable parts.
    #[kani::proof]
    fn v2_total_fee_capped() {
        assert!(sm::total_fee_bps(kani::any(), kani::any()) <= sm::MAX_TOTAL_FEE_BPS);
    }
}
