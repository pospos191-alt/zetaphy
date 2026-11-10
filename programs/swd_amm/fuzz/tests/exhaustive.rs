//! Exhaustive small-domain checks (2026-11-10): EVERY input combination in
//! a small range, for the properties whose Kani harnesses (marked SLOW in
//! programs/swd_amm/kani/src/lib.rs) did not finish under CBMC. Same
//! assertions as those harnesses; smaller domains, but nothing sampled.
//!
//!   cargo test --release --manifest-path programs/swd_amm/fuzz/Cargo.toml --test exhaustive

use swd_amm_fuzz::cp_math as cp;
use swd_amm_fuzz::dlmm_math::{self as dm, BinMut};
use swd_amm_fuzz::swdmm_math as sm;

const Q64: u128 = 1u128 << 64;
const FEES: [u128; 11] = [0, 1, 25, 30, 100, 999, 1_000, 5_000, 9_999, 10_000, 10_001];

#[test]
fn cp_swap_out_all_small_inputs() {
    let mut n = 0u64;
    for r_in in 1u64..=48 {
        for r_out in 1u64..=48 {
            for net in 0u64..=300 {
                for &fee in &FEES {
                    n += 1;
                    let r = cp::swap_out(r_in, r_out, net, fee);
                    if fee > 10_000 {
                        assert_eq!(r, Err(cp::CpSwapError::MathOverflow));
                        continue;
                    }
                    let Ok(out) = r else { continue };
                    let x = (net as u128) * (10_000 - fee) / 10_000;
                    assert!(x <= net as u128);
                    assert!(out < r_out);
                    assert!((out as u128) * (r_in as u128 + x) <= x * (r_out as u128));
                    let k0 = (r_in as u128) * (r_out as u128);
                    assert!((r_in as u128 + x) * ((r_out - out) as u128) >= k0);
                    assert!(x * 10_000 / (r_in as u128 + x) <= cp::CP_MAX_PRICE_IMPACT_BPS);
                }
            }
        }
    }
    eprintln!("cp_swap_out: {n} combinations");
}

#[test]
fn cp_lp_mint_and_burn_all_small_inputs() {
    for s in 1u64..=20 {
        for ra in 1u64..=20 {
            for rb in 1u64..=20 {
                for a in 0u64..=20 {
                    for b in 0u64..=20 {
                        if let Some(lp) = cp::lp_for_deposit(a, b, s, ra, rb) {
                            assert!((lp as u128) * (ra as u128) <= (a as u128) * (s as u128));
                            assert!((lp as u128) * (rb as u128) <= (b as u128) * (s as u128));
                        }
                    }
                    let lp = a.min(s);
                    let (wa, wb) = cp::withdraw_amounts(lp, ra, rb, s).unwrap();
                    assert!((wa as u128) * (s as u128) <= (lp as u128) * (ra as u128));
                    assert!((wb as u128) * (s as u128) <= (lp as u128) * (rb as u128));
                    assert!(wa <= ra && wb <= rb);
                }
            }
        }
    }
}

#[test]
fn mul_div_all_bytes_and_edges() {
    for a in 0u64..=255 {
        for b in 0u64..=255 {
            for d in 0u64..=255 {
                let r = cp::mul_div(a, b, d);
                assert_eq!(r, if d == 0 { None } else { Some(a * b / d) });
                assert_eq!(dm::mul_div_u64(a, b, d), r);
            }
        }
    }
    let edges = [0u64, 1, 2, 3, u32::MAX as u64, u64::MAX / 2, u64::MAX - 1, u64::MAX];
    for &a in &edges {
        for &b in &edges {
            for &d in &edges {
                let exact = if d == 0 { None } else { u64::try_from((a as u128) * (b as u128) / (d as u128)).ok() };
                assert_eq!(cp::mul_div(a, b, d), exact);
            }
        }
    }
}

#[test]
fn v2_fee_amount_all_small_inputs() {
    for amount in 0u64..=3_000 {
        for bps in 0u64..=10_000 {
            let f = sm::fee_amount(amount, bps).unwrap();
            assert!(f <= amount);
            let p = (amount as u128) * (bps as u128);
            assert!((f as u128) * 10_000 >= p && (f as u128) * 10_000 < p + 10_000);
        }
    }
}

#[test]
fn v2_swap_all_small_inputs() {
    let fees = [0u64, 1, 30, 100, 1_000, 5_000, 9_900, 9_901];
    let shares = [0u64, 1_000, 2_000, 5_000, 10_000, 10_001];
    for ra in 1u64..=24 {
        for rb in 1u64..=24 {
            for x in 1u64..=60 {
                for a_to_b in [false, true] {
                    for &fee in &fees {
                        for &share in &shares {
                            for mode in 0u8..=3 {
                                let Some(s) = sm::swap(ra, rb, x, a_to_b, fee, share, mode) else { continue };
                                assert!(fee <= sm::MAX_TOTAL_FEE_BPS && share <= 10_000 && mode <= 2);
                                let k0 = (ra as u128) * (rb as u128);
                                assert!((s.new_reserve_a as u128) * (s.new_reserve_b as u128) >= k0);
                                assert_eq!(s.lp_fee + s.protocol_fee, s.fee);
                                let (in0, out0, in1, out1) = if a_to_b {
                                    (ra, rb, s.new_reserve_a, s.new_reserve_b)
                                } else {
                                    (rb, ra, s.new_reserve_b, s.new_reserve_a)
                                };
                                assert!(s.amount_out < out0);
                                let kept = if s.compounded { s.protocol_fee } else { s.fee } as u128;
                                if mode == sm::COLLECT_FEE_BOTH || !a_to_b {
                                    assert_eq!(in1 as u128 + kept, in0 as u128 + x as u128);
                                    assert_eq!(out1 as u128 + s.amount_out as u128, out0 as u128);
                                } else {
                                    assert_eq!(in1 as u128, in0 as u128 + x as u128);
                                    assert_eq!(out1 as u128 + s.amount_out as u128 + kept, out0 as u128);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn v2_liquidity_quotes_all_small_inputs() {
    for ra in 0u64..=16 {
        for rb in 0u64..=16 {
            for l in 0u128..=16 {
                for ma in 0u64..=16 {
                    for mb in 0u64..=16 {
                        if let Some((liq, a, b)) = sm::deposit_quote(ra, rb, l, ma, mb) {
                            assert!(a <= ma && b <= mb);
                            assert!(liq * (ra as u128) <= (a as u128) * l);
                            assert!(liq * (rb as u128) <= (b as u128) * l);
                        }
                    }
                }
                for burn in 0u128..=17 {
                    if let Some((a, b)) = sm::withdraw_quote(ra, rb, l, burn) {
                        assert!((a as u128) * l <= burn * (ra as u128));
                        assert!((b as u128) * l <= burn * (rb as u128));
                    }
                }
            }
        }
    }
}

#[test]
fn v2_fee_growth_split_all_small_inputs() {
    for fee in 0u64..=500 {
        for total in 1u128..=64 {
            let g = sm::fee_growth(fee, total).unwrap();
            for part in 0..=total {
                let a = sm::pending_fee(g, 0, part).unwrap() as u128;
                let b = sm::pending_fee(g, 0, total - part).unwrap() as u128;
                assert!(a + b <= fee as u128);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct B {
    s: u128,
    a: u64,
    b: u64,
}
impl BinMut for B {
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

#[test]
fn dlmm_bin_withdraw_all_small_inputs() {
    for s in 0u128..=40 {
        for a in 0u64..=40 {
            for b in 0u64..=40 {
                for sh in 0u128..=41 {
                    let mut bin = B { s, a, b };
                    if let Ok((wa, wb)) = dm::bin_withdraw(&mut bin, sh) {
                        assert!(sh <= s);
                        assert!((wa as u128) * s <= sh * (a as u128));
                        assert!((wb as u128) * s <= sh * (b as u128));
                        assert_eq!(bin, B { s: s - sh, a: a - wa, b: b - wb });
                    }
                }
            }
        }
    }
}

#[test]
fn dlmm_bin_deposit_all_small_inputs() {
    for s in 0u128..=15 {
        for ra in 0u64..=15 {
            for rb in 0u64..=15 {
                for amt_a in 0u64..=15 {
                    for amt_b in 0u64..=15 {
                        for (id, active) in [(1, 0), (0, 0), (-1, 0)] {
                            let before = B { s, a: ra, b: rb };
                            let mut bin = before;
                            let r = dm::bin_deposit(&mut bin, id, active, amt_a, amt_b);
                            if id > active && amt_b != 0 || id < active && amt_a != 0 {
                                assert_eq!(r, Err(dm::DlmmMathError::SingleSidedViolation));
                            }
                            if let Ok(Some((sh, ta, tb))) = r {
                                assert!(ta == amt_a && tb <= amt_b);
                                assert!(bin.a == ra + ta && bin.b == rb + tb);
                                if s > 0 {
                                    assert_eq!(bin.s, s + sh);
                                    if ta > 0 {
                                        assert!(sh * (ra as u128) <= (ta as u128) * s);
                                    }
                                    if tb > 0 {
                                        assert!(sh * (rb as u128) <= (tb as u128) * s);
                                    }
                                } else {
                                    assert_eq!(bin.s, sh + dm::MIN_BIN_LIQUIDITY);
                                }
                            } else {
                                assert_eq!(bin.a, ra, "a failed deposit changed reserves");
                                assert_eq!(bin.b, rb, "a failed deposit changed reserves");
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn dlmm_swap_bins_three_bins_all_small_inputs() {
    let mut swaps = 0u64;
    for b0b in 0u64..=7 {
        for b1a in 0u64..=7 {
            for b1b in 0u64..=7 {
                for b2a in 0u64..=7 {
                    let start = [B { s: 0, a: 0, b: b0b }, B { s: 0, a: b1a, b: b1b }, B { s: 0, a: b2a, b: 0 }];
                    for step in [1u16, 25, 100, 1_000] {
                        let prices: Vec<u128> = (-1..=1).map(|id| dm::bin_price_q64(id, step).unwrap()).collect();
                        for fee in [0u128, 25, 1_000, 10_000] {
                            for amount in 1u64..=64 {
                                for a_to_b in [false, true] {
                                    let mut bins = start;
                                    let Ok(r) = dm::swap_bins(&mut bins[..], -1, 1, 0, step, fee, amount, a_to_b) else { continue };
                                    swaps += 1;
                                    assert!(r.active_bin_id >= -1 && r.active_bin_id <= 1);
                                    assert!(r.bins_crossed <= dm::MAX_BINS_CROSSED_PER_SWAP);
                                    let sum = |bs: &[B; 3], a: bool| -> u128 { bs.iter().map(|b| if a { b.a as u128 } else { b.b as u128 }).sum() };
                                    assert_eq!(sum(&bins, a_to_b), sum(&start, a_to_b) + amount as u128);
                                    assert_eq!(sum(&start, !a_to_b) - sum(&bins, !a_to_b), r.total_amount_out as u128);
                                    for i in 0..3 {
                                        let p = prices[i];
                                        let v0 = (start[i].a as u128) * p + ((start[i].b as u128) << 64);
                                        let v1 = (bins[i].a as u128) * p + ((bins[i].b as u128) << 64);
                                        assert!(v1 >= v0, "bin value fell");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    eprintln!("swap_bins: {swaps} successful swaps checked");
    assert!(swaps > 100_000);
}

#[test]
fn dlmm_conversions_and_prices_all_small_inputs() {
    for step in [1u16, 10, 25, 100, 1_000] {
        let mut prev: Option<u128> = None;
        for id in -400..=400 {
            let p = dm::bin_price_q64(id, step).unwrap();
            if let Some(q) = prev {
                assert!(p >= q, "bin price fell at {id} step {step}");
            }
            prev = Some(p);
            if !(-50..=50).contains(&id) || p == 0 {
                continue;
            }
            for x in 0u64..=2_000 {
                for a_to_b in [false, true] {
                    if let Some(out) = dm::convert_at_bin_price(x, p, a_to_b) {
                        let ideal = if a_to_b { ((x as u128) * p) >> 64 } else { ((x as u128) << 64) / p };
                        assert_eq!(out as u128, ideal);
                    }
                    if let Some(inp) = dm::amount_in_for_output(x, p, a_to_b) {
                        if let Some(back) = dm::convert_at_bin_price(inp, p, a_to_b) {
                            assert!(back >= x);
                        }
                    }
                }
            }
        }
        assert_eq!(dm::bin_price_q64(0, step), Some(Q64));
    }
}

#[test]
fn dlmm_bin_price_never_panics_wide_id_range() {
    for step in [1u16, 1_000, u16::MAX] {
        for id in (-(1i32 << 20)..=(1 << 20)).step_by(7) {
            let _ = dm::bin_price_q64(id, step);
        }
        for id in [i32::MIN, i32::MIN + 1, i32::MIN + 100, -1, 0, 1, i32::MAX - 100, i32::MAX] {
            let _ = dm::bin_price_q64(id, step);
        }
    }
}
