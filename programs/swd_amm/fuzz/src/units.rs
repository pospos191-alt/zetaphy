//! Single-call properties of every pure math function, checked EXACTLY
//! against 512-bit reference arithmetic. Covers invariants (c) rounding
//! direction and (f) "checked arithmetic never panics, only errors" for
//! every input, plus the per-swap halves of (b) and (d).

use crate::cp_math as cp;
use crate::dlmm_math as dm;
use crate::swdmm_math as sm;
use crate::wide::{w, U512};
use crate::Gen;

const Q64: u128 = 1u128 << 64;

fn floor_div(n: U512, d: U512) -> U512 {
    n / d
}
fn ceil_div(n: U512, d: U512) -> U512 {
    (n + d - U512::one()) / d
}
fn fits_u64(v: U512) -> bool {
    v <= w(u64::MAX as u128)
}
fn fits_u128(v: U512) -> bool {
    v <= w(u128::MAX)
}
fn as_u128(v: U512) -> u128 {
    v.low_u128()
}

pub fn run(g: &mut Gen) {
    // Several independent checks per input, chosen by the first byte.
    while !g.done() {
        match g.byte() % 12 {
            0 => cp_mul_div_and_sqrt(g),
            1 | 2 => cp_swap(g),
            3 => cp_liquidity(g),
            4 => q64_ops(g),
            5 => bin_prices(g),
            6 => bin_conversions(g),
            7 => share_helpers(g),
            8 => v2_helpers(g),
            9 | 10 => v2_swap(g),
            _ => v2_fees_and_schedule(g),
        }
    }
}

fn cp_mul_div_and_sqrt(g: &mut Gen) {
    let (a, b, d) = (g.amount(), g.amount(), g.amount());
    let r = cp::mul_div(a, b, d);
    if d == 0 {
        assert_eq!(r, None);
    } else {
        let exact = floor_div(w(a as u128) * w(b as u128), w(d as u128));
        assert_eq!(r, if fits_u64(exact) { Some(as_u128(exact) as u64) } else { None });
    }
    for v in [g.u128_raw(), (g.amount() as u128) * (g.amount() as u128), u128::MAX, g.u128_raw() >> g.range(0, 127)] {
        for s in [cp::integer_sqrt(v), dm::integer_sqrt_u128(v), sm::isqrt(v)] {
            assert!(w(s) * w(s) <= w(v), "isqrt too big: {v}");
            assert!((w(s) + 1) * (w(s) + 1) > w(v), "isqrt too small: {v}");
        }
    }
}

/// CP swap (cp.rs `swap`): output < reserve, output <= the exact
/// constant-product output (rounded in the pool's favour), k never
/// decreases, the fee never exceeds the input, and every error is a clean
/// Err — never a panic.
fn cp_swap(g: &mut Gen) {
    let r_in = g.amount();
    let r_out = g.amount();
    let net = g.amount();
    let fee: u128 = match g.byte() % 4 {
        0 => g.range(0, 1_000) as u128,   // MAX_FEE_BPS
        1 => g.range(0, 10_000) as u128,
        2 => g.u16() as u128,             // includes > 10_000 (must Err)
        _ => 0,
    };
    let r = cp::swap_out(r_in, r_out, net, fee);
    if fee > 10_000 {
        assert_eq!(r, Err(cp::CpSwapError::MathOverflow));
        return;
    }
    let Ok(out) = r else { return };
    if r_in == 0 || r_out == 0 {
        // The handler refuses empty pools before calling swap_out.
        return;
    }
    let x = (net as u128) * (10_000 - fee) / 10_000;
    // Fee never exceeds the input, and is rounded up (x rounded down).
    assert!(x <= net as u128);
    assert!(w(x) * w(10_000) <= w(net as u128) * w(10_000 - fee));
    // Output strictly below the out-side reserve (handler also requires it).
    assert!(out < r_out, "out {out} >= reserve_out {r_out}");
    // Output <= exact x * R_out / (R_in + x)  (rounding favours the pool).
    let ideal_floor = floor_div(w(x) * w(r_out as u128), w(r_in as u128) + w(x));
    assert!(w(out as u128) <= ideal_floor, "cp payout rounded up");
    // k never decreases, even if the fee were zero and only the curve
    // input stayed in the pool.
    let k0 = w(r_in as u128) * w(r_out as u128);
    assert!((w(r_in as u128) + w(x)) * w((r_out - out) as u128) >= k0, "k decreased (curve part)");
    assert!((w(r_in as u128) + w(net as u128)) * w((r_out - out) as u128) >= k0, "k decreased");
    // Price-impact cap respected.
    assert!(w(x) * w(10_000) / (w(r_in as u128) + w(x)) <= w(cp::CP_MAX_PRICE_IMPACT_BPS));
    // Round trip: swapping the output straight back (same fee) never
    // returns more than was put in.
    let new_in = (r_in as u128) + net as u128;
    if new_in <= u64::MAX as u128 {
        if let Ok(back) = cp::swap_out(r_out - out, new_in as u64, out, fee) {
            assert!(back <= net, "CP round trip A->B->A profit: in {net} back {back}");
        }
    }
}

/// CP add/remove liquidity helpers (cp.rs add_liquidity/remove_liquidity).
fn cp_liquidity(g: &mut Gen) {
    let (ra, rb) = (g.amount().max(1), g.amount().max(1));
    let s = g.amount().max(1);
    let a = g.amount();
    // add_liquidity: required_b = floor(a * rb / ra), then lp = min(...)
    let Some(b) = cp::mul_div(a, rb, ra) else { return };
    if let Some(lp) = cp::lp_for_deposit(a, b, s, ra, rb) {
        // Never mints more than either side pays for.
        assert!(w(lp as u128) * w(ra as u128) <= w(a as u128) * w(s as u128), "over-issued vs A");
        assert!(w(lp as u128) * w(rb as u128) <= w(b as u128) * w(s as u128), "over-issued vs B");
        // Immediate withdraw of what was minted returns <= what was paid.
        if let (Some(ra2), Some(rb2), Some(s2)) = (ra.checked_add(a), rb.checked_add(b), s.checked_add(lp)) {
            if let Some((wa, wb)) = cp::withdraw_amounts(lp, ra2, rb2, s2) {
                assert!(wa <= a && wb <= b, "CP deposit->withdraw profit");
            }
        }
    }
    let lp = (g.part(s as u128)) as u64;
    if let Some((wa, wb)) = cp::withdraw_amounts(lp, ra, rb, s) {
        assert!(w(wa as u128) * w(s as u128) <= w(lp as u128) * w(ra as u128));
        assert!(w(wb as u128) * w(s as u128) <= w(lp as u128) * w(rb as u128));
        assert!(wa <= ra && wb <= rb);
    }
}

fn q64_ops(g: &mut Gen) {
    let a = if g.bool() { g.u128_raw() } else { g.amount() as u128 };
    let b = if g.bool() { g.u128_raw() >> g.range(0, 127) } else { g.amount() as u128 };
    let exact = w(a) * w(b);
    let fl = floor_div(exact, w(Q64));
    let ce = ceil_div(exact, w(Q64));
    assert_eq!(dm::q64_mul(a, b), if fits_u128(fl) { Some(as_u128(fl)) } else { None }, "q64_mul {a} {b}");
    // ceil may legitimately fail where floor fits only if ceil overflows.
    assert_eq!(dm::q64_mul_ceil(a, b), if fits_u128(ce) { Some(as_u128(ce)) } else { None }, "q64_mul_ceil {a} {b}");
    let amt = g.amount();
    let p = if g.bool() { g.u128_raw() } else { g.amount() as u128 };
    if p == 0 {
        assert_eq!(dm::q64_div_amount(amt, p), None);
        assert_eq!(dm::q64_div_amount_ceil(amt, p), None);
    } else {
        let n = w(amt as u128) * w(Q64);
        assert_eq!(dm::q64_div_amount(amt, p), Some(as_u128(floor_div(n, w(p)))));
        assert_eq!(dm::q64_div_amount_ceil(amt, p), Some(as_u128(ceil_div(n, w(p)))));
    }
    let _ = dm::pow_q64(g.u128_raw(), g.u64_raw() as u32);
    let _ = sm::pow_q64(g.u128_raw() >> 60, g.u64_raw());
}

fn bin_prices(g: &mut Gen) {
    let step = g.range(1, 1_000) as u16; // MAX_BIN_STEP_BPS
    let id = g.irange(-20_000, 20_000) as i32;
    let p0 = dm::bin_price_q64(id, step);
    let p1 = dm::bin_price_q64(id + 1, step);
    assert_eq!(dm::bin_price_q64(0, step), Some(Q64));
    if let (Some(p0), Some(p1)) = (p0, p1) {
        // Never decreasing in bin id; strictly increasing while the price
        // keeps enough precision (far below 1.0 the Q64.64 value runs out
        // of bits and neighbouring bins can share the same raw price —
        // harmless: such bins convert everything to 0 and swaps refuse).
        assert!(p1 >= p0, "bin price decreasing at id {id} step {step}: {p0} {p1}");
        if p0 >= 1u128 << 40 {
            assert!(p1 > p0, "bin price not increasing at id {id} step {step}: {p0} {p1}");
        }
    }
    // Arbitrary step (incl. 0 and > MAX) and id: never panics.
    let _ = dm::bin_price_q64(g.u64_raw() as i32, g.u16());
}

fn bin_conversions(g: &mut Gen) {
    let p = match g.byte() % 3 {
        0 => {
            let step = g.range(1, 1_000) as u16;
            let id = g.irange(-400, 400) as i32;
            match dm::bin_price_q64(id, step) {
                Some(p) => p,
                None => return,
            }
        }
        1 => g.u128_raw() >> g.range(0, 127),
        _ => g.amount() as u128,
    };
    let a_to_b = g.bool();
    let x = g.amount();
    // convert_at_bin_price: output rounded DOWN vs the exact price.
    if let Some(out) = dm::convert_at_bin_price(x, p, a_to_b) {
        let ideal = if a_to_b {
            floor_div(w(x as u128) * w(p), w(Q64))
        } else {
            floor_div(w(x as u128) * w(Q64), w(p))
        };
        assert_eq!(w(out as u128), ideal);
    }
    // amount_in_for_output: input rounded UP, and paying it always buys at
    // least the requested output.
    let out = g.amount();
    if let Some(inp) = dm::amount_in_for_output(out, p, a_to_b) {
        let ideal = if a_to_b {
            ceil_div(w(out as u128) * w(Q64), w(p))
        } else {
            ceil_div(w(out as u128) * w(p), w(Q64))
        };
        assert_eq!(w(inp as u128), ideal);
        if let Some(back) = dm::convert_at_bin_price(inp, p, a_to_b) {
            assert!(back >= out, "paying amount_in_for_output bought less than asked");
        }
    }
}

fn share_helpers(g: &mut Gen) {
    let (amt, s, r) = (g.amount(), g.u128_raw() >> g.range(0, 127), g.amount());
    match dm::mul_div_shares(amt, s, r) {
        None => assert!(r == 0 || (amt as u128).checked_mul(s).is_none()),
        Some(v) => assert_eq!(w(v), floor_div(w(amt as u128) * w(s), w(r as u128))),
    }
    let sh = g.part(s);
    match dm::mul_div_shares_down(r, sh, s) {
        None => {}
        Some(v) => {
            assert_eq!(w(v as u128), floor_div(w(r as u128) * w(sh), w(s)));
            assert!(v <= r, "withdrew more than the bin holds");
        }
    }
    let (a, b, d) = (g.amount(), g.amount(), g.amount());
    assert_eq!(dm::mul_div_u64(a, b, d), cp::mul_div(a, b, d));
}

fn v2_helpers(g: &mut Gen) {
    let (a, b, d) = (g.u128_raw() >> g.range(0, 127), g.u128_raw() >> g.range(0, 127), g.u128_raw() >> g.range(0, 127));
    let e = w(a) * w(b);
    match sm::mul_div_floor(a, b, d) {
        None => assert!(d == 0 || a.checked_mul(b).is_none()),
        Some(v) => assert_eq!(w(v), floor_div(e, w(d))),
    }
    match sm::mul_div_ceil(a, b, d) {
        None => assert!(d == 0 || a.checked_mul(b).is_none() || !fits_u128(ceil_div(e, w(d)))),
        Some(v) => assert_eq!(w(v), ceil_div(e, w(d))),
    }
    let (amt, fee) = (g.amount(), g.range(0, 10_000));
    let f = sm::fee_amount(amt, fee).expect("fee_amount fits");
    assert!(f <= amt, "fee > amount");
    assert_eq!(w(f as u128), ceil_div(w(amt as u128) * w(fee as u128), w(10_000)), "fee not rounded up");
    // price helpers never panic
    let (pa, pb) = (g.u128_raw(), g.u128_raw());
    let _ = sm::price_change_bps(pa, pb);
    if let Some(r) = sm::ratio_q64(pa, pb) {
        assert!(r <= Q64, "ratio > 1.0");
    }
    let _ = sm::slot_impact_allows(pa, pb, g.u128_raw(), g.range(0, 20_000));
    let _ = sm::price_q64(g.amount(), g.amount());
    let _ = sm::impact_bps(g.amount(), g.amount());
}

/// SWDMM v2 swap (swdmm_math::swap): conservation, k non-decreasing, fee
/// split exact, output < reserve, round trip never profits.
fn v2_swap(g: &mut Gen) {
    let ra = g.amount();
    let rb = g.amount();
    let x = g.amount();
    let a_to_b = g.bool();
    let fee = g.range(0, sm::MAX_TOTAL_FEE_BPS + 2);
    let share = g.range(0, 10_001);
    let mode = g.byte() % 4;
    let Some(s) = sm::swap(ra, rb, x, a_to_b, fee, share, mode) else { return };
    assert!(fee <= sm::MAX_TOTAL_FEE_BPS && share <= 10_000 && mode <= 2);
    let k0 = w(ra as u128) * w(rb as u128);
    let k1 = w(s.new_reserve_a as u128) * w(s.new_reserve_b as u128);
    assert!(k1 >= k0, "v2 k decreased");
    assert_eq!(s.lp_fee as u128 + s.protocol_fee as u128, s.fee as u128);
    let (in0, out0, in1, out1) =
        if a_to_b { (ra, rb, s.new_reserve_a, s.new_reserve_b) } else { (rb, ra, s.new_reserve_b, s.new_reserve_a) };
    assert!(s.amount_out < out0);
    let kept = if s.compounded { s.protocol_fee } else { s.fee } as u128;
    let fee_on_input = mode == sm::COLLECT_FEE_BOTH || !a_to_b;
    if fee_on_input {
        assert_eq!(in1 as u128 + kept, in0 as u128 + x as u128, "input not conserved");
        assert_eq!(out1 as u128 + s.amount_out as u128, out0 as u128, "output not conserved");
        assert!(s.fee <= x);
    } else {
        assert_eq!(in1 as u128, in0 as u128 + x as u128);
        assert_eq!(out1 as u128 + s.amount_out as u128 + kept, out0 as u128);
    }
    assert!(s.price_impact_bps <= 10_000);
    // Round trip at the same fee never returns more than was put in.
    if let Some(back) = sm::swap(s.new_reserve_a, s.new_reserve_b, s.amount_out, !a_to_b, fee, share, mode) {
        // In QUOTE modes the fee token differs by direction; the trader
        // still can't get more of the original token back.
        assert!(back.amount_out <= x, "v2 round trip profit: in {x} back {}", back.amount_out);
    }
}

fn v2_fees_and_schedule(g: &mut Gen) {
    // fee_growth / pending_fee: what positions can claim never exceeds the
    // fee that was credited, for any split of the liquidity.
    let total = (g.u128_raw() >> g.range(0, 127)).max(1);
    let fee = g.amount();
    if let Some(gr) = sm::fee_growth(fee, total) {
        let part = g.part(total);
        let base = g.u128_raw();
        if let Some(g2) = base.checked_add(gr) {
            let a = sm::pending_fee(g2, base, part);
            let b = sm::pending_fee(g2, base, total - part);
            if let (Some(a), Some(b)) = (a, b) {
                assert!(a as u128 + b as u128 <= fee as u128, "fees over-paid");
            }
            // pending_fee is exactly floor(delta * L / 2^64).
            if let Some(a) = a {
                assert_eq!(w(a as u128), floor_div(w(gr) * w(part), w(Q64)));
            }
        }
    }
    // Arbitrary checkpoint pairs: never panics, Err if checkpoint > global.
    let (gq, cq, l) = (g.u128_raw(), g.u128_raw(), g.u128_raw());
    let r = sm::pending_fee(gq, cq, l);
    if cq > gq {
        assert_eq!(r, None);
    }
    // Base fee scheduler: validated configs stay within [floor, cliff] and
    // never rise with more periods.
    let c = sm::BaseFeeConfig {
        mode: g.byte() % 4,
        decay: g.byte() % 3,
        cliff_fee_bps: g.u16() % 10_500,
        floor_fee_bps: g.u16() % 1_200,
        number_of_periods: g.u16(),
        period_frequency: g.amount(),
        reduction_factor: g.amount() % 12_000,
    };
    if sm::validate_base_fee(&c) {
        let n = g.amount();
        let f = sm::scheduled_fee_bps(&c, n).expect("validated scheduler never overflows");
        let f2 = sm::scheduled_fee_bps(&c, n.saturating_add(1)).unwrap();
        assert!(f >= c.floor_fee_bps as u64 && f <= c.cliff_fee_bps as u64);
        assert!(f2 <= f);
        let act = g.irange(0, i64::MAX / 2);
        let now = g.irange(0, i64::MAX / 2);
        let _ = sm::scheduler_periods(&c, now, act, g.u128_raw(), g.u128_raw());
    }
    let d = sm::DynamicFeeConfig {
        enabled: g.bool(),
        max_dynamic_fee_bps: g.u16(),
        variable_fee_control: g.u64_raw() as u32,
        filter_period: g.u64_raw() as u32,
        decay_period: g.u64_raw() as u32,
        reduction_factor: g.u16(),
        max_volatility_accumulator: g.amount(),
    };
    let mut s = sm::VolatilityState {
        volatility_accumulator: g.amount(),
        volatility_reference: g.amount(),
        price_reference_q64: g.u128_raw(),
        last_update_ts: g.irange(i64::MIN, i64::MAX),
    };
    let now = g.irange(i64::MIN, i64::MAX);
    sm::update_references(&d, &mut s, now, g.u128_raw());
    sm::accumulate(&d, &mut s, g.u128_raw(), now);
    let v = sm::variable_fee_bps(&d, &s);
    if sm::validate_dynamic_fee(&d) && d.enabled {
        assert!(v <= d.max_dynamic_fee_bps as u64);
    }
    assert!(sm::total_fee_bps(g.amount(), v) <= sm::MAX_TOTAL_FEE_BPS);
    let _ = sm::can_enable_dynamic_fee(&d);
}
