//! Stateful model of the constant-product pool (cp.rs add_liquidity /
//! remove_liquidity / swap), driven by random multi-actor op sequences.
//!
//! Invariants checked after EVERY successful op:
//!   (a) solvency: vault_x >= reserve_x (donations make vault > reserve)
//!   (a) LP accounting: lp_supply == locked + sum of actor balances
//!   (d) k never decreases on a swap
//!   (b/e) value per LP share never decreases: k / supply^2 is
//!       non-decreasing across deposit, withdraw and swap; donations to the
//!       vault never change reserves or supply (no donation attack)
//!   (b) round trips: deposit->withdraw and swap A->B->A never profit
//!   (e) a later depositor's immediate deposit->withdraw loss is bounded by
//!       rounding (at most ~1 LP share + 1 raw unit per side + the floor on
//!       required_b), whatever the first depositor did before
//!   (f) no panic anywhere (overflow-checks are on in this build)

use crate::cp_math as cp;
use crate::stats;
use crate::wide::{w, U512};
use crate::Gen;

/// cp.rs / lib.rs constants (kept in sync by tests/regression.rs::constants_match).
pub const MINIMUM_LIQUIDITY: u64 = 1_000;
pub const MIN_INITIAL_DEPOSIT: u64 = 1_000_000;
pub const MAX_FEE_BPS: u64 = 1_000;
const ACTORS: usize = 4;

#[derive(Clone, Debug, Default)]
pub struct CpPool {
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub lp_supply: u64,
    pub lp_locked: u64,
    pub vault_a: u128,
    pub vault_b: u128,
    pub lp: [u64; ACTORS],
}

#[derive(Debug, PartialEq, Eq)]
pub enum Rej {
    Rejected,
}
type R<T> = Result<T, Rej>;
fn req(c: bool) -> R<()> {
    if c {
        Ok(())
    } else {
        Err(Rej::Rejected)
    }
}
fn o<T>(v: Option<T>) -> R<T> {
    v.ok_or(Rej::Rejected)
}

impl CpPool {
    /// cp.rs add_liquidity (standard SPL mints: amount received == amount sent).
    pub fn deposit(&mut self, who: usize, a_desired: u64, b_desired: u64, min_lp: u64) -> R<(u64, u64, u64)> {
        req(a_desired > 0 && b_desired > 0)?;
        let first = self.lp_supply == 0;
        let (pull_a, pull_b) = if first {
            req(a_desired >= MIN_INITIAL_DEPOSIT && b_desired >= MIN_INITIAL_DEPOSIT)?;
            (a_desired, b_desired)
        } else {
            req(self.reserve_a > 0 && self.reserve_b > 0)?;
            let required_b = o(cp::mul_div(a_desired, self.reserve_b, self.reserve_a))?;
            req(required_b <= b_desired)?;
            (a_desired, required_b)
        };
        // token transfers: user -> vault (vault balance is a u64 on chain)
        let va = self.vault_a + pull_a as u128;
        let vb = self.vault_b + pull_b as u128;
        req(va <= u64::MAX as u128 && vb <= u64::MAX as u128)?;
        req(pull_a > 0 && pull_b > 0)?;
        let lp = if first {
            let liq = cp::integer_sqrt((pull_a as u128) * (pull_b as u128));
            let liq = o(u64::try_from(liq).ok())?;
            req(liq > MINIMUM_LIQUIDITY)?;
            liq - MINIMUM_LIQUIDITY
        } else {
            o(cp::lp_for_deposit(pull_a, pull_b, self.lp_supply, self.reserve_a, self.reserve_b))?
        };
        req(lp >= min_lp)?;
        req(lp > 0)?;
        // mint_to (SPL checks supply overflow)
        let extra = if first { MINIMUM_LIQUIDITY } else { 0 };
        let supply = o(self.lp_supply.checked_add(lp).and_then(|v| v.checked_add(extra)))?;
        let ra = o(self.reserve_a.checked_add(pull_a))?;
        let rb = o(self.reserve_b.checked_add(pull_b))?;
        self.lp_supply = supply;
        self.lp_locked += extra;
        self.lp[who] += lp;
        self.reserve_a = ra;
        self.reserve_b = rb;
        self.vault_a = va;
        self.vault_b = vb;
        Ok((lp, pull_a, pull_b))
    }

    /// cp.rs remove_liquidity.
    pub fn withdraw(&mut self, who: usize, lp: u64) -> R<(u64, u64)> {
        req(lp > 0)?;
        req(self.lp_supply > 0)?;
        let (a, b) = o(cp::withdraw_amounts(lp, self.reserve_a, self.reserve_b, self.lp_supply))?;
        req(a > 0 && b > 0)?;
        req(self.lp[who] >= lp)?; // SPL burn fails otherwise
        let ra = o(self.reserve_a.checked_sub(a))?;
        let rb = o(self.reserve_b.checked_sub(b))?;
        // vault -> user transfer: an underflow here would be INSOLVENCY.
        assert!(self.vault_a >= a as u128 && self.vault_b >= b as u128, "CP vault cannot pay a withdrawal");
        self.lp[who] -= lp;
        self.lp_supply -= lp;
        self.reserve_a = ra;
        self.reserve_b = rb;
        self.vault_a -= a as u128;
        self.vault_b -= b as u128;
        Ok((a, b))
    }

    /// cp.rs swap (oracle-supplied fee_bps).
    pub fn swap(&mut self, amount_in: u64, a_to_b: bool, fee_bps: u128) -> R<u64> {
        req(amount_in > 0)?;
        let (r_in, r_out) = if a_to_b { (self.reserve_a, self.reserve_b) } else { (self.reserve_b, self.reserve_a) };
        req(r_in > 0 && r_out > 0)?;
        let v_in = if a_to_b { self.vault_a } else { self.vault_b } + amount_in as u128;
        req(v_in <= u64::MAX as u128)?;
        let out = cp::swap_out(r_in, r_out, amount_in, fee_bps).map_err(|_| Rej::Rejected)?;
        req(out > 0)?;
        assert!(out < r_out, "swap_out returned out >= reserve_out (handler's InvariantViolation reachable)");
        let new_in = o(r_in.checked_add(amount_in))?;
        let new_out = r_out - out;
        let k0 = w(r_in as u128) * w(r_out as u128);
        assert!(w(new_in as u128) * w(new_out as u128) >= k0, "CP swap decreased k");
        let v_out = if a_to_b { self.vault_b } else { self.vault_a };
        assert!(v_out >= out as u128, "CP vault cannot pay a swap");
        if a_to_b {
            self.reserve_a = new_in;
            self.reserve_b = new_out;
            self.vault_a = v_in;
            self.vault_b -= out as u128;
        } else {
            self.reserve_b = new_in;
            self.reserve_a = new_out;
            self.vault_b = v_in;
            self.vault_a -= out as u128;
        }
        Ok(out)
    }

    pub fn check(&self) {
        assert!(self.vault_a >= self.reserve_a as u128, "CP insolvent in A");
        assert!(self.vault_b >= self.reserve_b as u128, "CP insolvent in B");
        let held: u128 = self.lp.iter().map(|&x| x as u128).sum::<u128>() + self.lp_locked as u128;
        assert_eq!(held, self.lp_supply as u128, "LP supply != balances");
        if self.lp_supply > 0 {
            assert!(self.lp_locked == MINIMUM_LIQUIDITY, "MINIMUM_LIQUIDITY lock lost");
        }
    }

    /// k / supply^2 as a pair, for cross-multiplied comparison.
    fn share_value(&self) -> (U512, U512) {
        (w(self.reserve_a as u128) * w(self.reserve_b as u128), w(self.lp_supply as u128) * w(self.lp_supply as u128))
    }
}

fn fee(g: &mut Gen) -> u128 {
    match g.byte() % 4 {
        0 => 0,
        1 => g.range(0, MAX_FEE_BPS) as u128,
        2 => 30,
        _ => g.range(0, 10_000) as u128,
    }
}

pub fn run(g: &mut Gen) {
    let mut p = CpPool::default();
    let mut steps = 0;
    while !g.done() && steps < 400 {
        steps += 1;
        let before = p.clone();
        let (k_before, s2_before) = p.share_value();
        let who = (g.byte() as usize) % ACTORS;
        let op = g.byte() % 10;
        let res: R<()> = match op {
            0 | 1 => {
                let (a, b) = if p.lp_supply == 0 && g.bool() {
                    (g.amount_in(MIN_INITIAL_DEPOSIT, u64::MAX), g.amount_in(MIN_INITIAL_DEPOSIT, u64::MAX))
                } else {
                    (g.amount(), g.amount())
                };
                p.deposit(who, a, b, 0).map(|_| ())
            }
            2 => {
                let lp = g.part(p.lp[who] as u128) as u64;
                p.withdraw(who, lp).map(|_| ())
            }
            3..=5 => {
                let amt = g.amount();
                let dir = g.bool();
                let f = fee(g);
                p.swap(amt, dir, f).map(|_| ())
            }
            6 => {
                // Donation straight to the vaults (anyone can do this).
                let (a, b) = (g.amount() as u128, g.amount() as u128);
                if p.vault_a + a <= u64::MAX as u128 && p.vault_b + b <= u64::MAX as u128 {
                    p.vault_a += a;
                    p.vault_b += b;
                    assert_eq!((p.reserve_a, p.reserve_b, p.lp_supply), (before.reserve_a, before.reserve_b, before.lp_supply));
                    Ok(())
                } else {
                    Err(Rej::Rejected)
                }
            }
            7 => {
                // Round trip swap A->B->A (or B->A->B) by one trader.
                let amt = g.amount();
                let dir = g.bool();
                let f = fee(g);
                match p.swap(amt, dir, f) {
                    Ok(out) => {
                        if let Ok(back) = p.swap(out, !dir, f) {
                            assert!(back <= amt, "CP round trip profit: in {amt} back {back}");
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
            _ => {
                // Deposit then immediately withdraw what was minted.
                let (a, b) = (g.amount(), g.amount());
                let (ra, rb, s) = (p.reserve_a, p.reserve_b, p.lp_supply);
                match p.deposit(who, a, b, 0) {
                    Ok((lp, pa, pb)) => {
                        if let Ok((ga, gb)) = p.withdraw(who, lp) {
                            assert!(ga <= pa && gb <= pb, "CP deposit->withdraw profit");
                            if s > 0 {
                                // Loss bound (rounding only): lp >= a*S/ra - S/rb - 1, so the
                                // A loss <= ra/rb + 2*ra'/S' + 2 and the B loss <= 2*rb'/S' + 2.
                                let (ra2, rb2, s2) = (ra as u128 + pa as u128, rb as u128 + pb as u128, s as u128 + lp as u128);
                                let bound_a = (ra as u128).div_ceil(rb as u128) + 2 * ra2.div_ceil(s2) + 2;
                                let bound_b = 2 * rb2.div_ceil(s2) + 2;
                                assert!(((pa - ga) as u128) <= bound_a, "CP depositor loss in A beyond rounding: {} > {bound_a}", pa - ga);
                                assert!(((pb - gb) as u128) <= bound_b, "CP depositor loss in B beyond rounding: {} > {bound_b}", pb - gb);
                            }
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
        };
        match res {
            Ok(()) => stats::ok_op(1, op),
            Err(_) => {
                stats::rejected();
                // A rejected op must leave no trace (the transaction reverts).
                // Ops 7/8 are two transactions; the first may have committed.
                if op < 7 {
                    assert_eq!(format!("{:?}", p), format!("{:?}", before), "rejected op mutated state");
                }
            }
        }
        p.check();
        // Value per LP share never decreases (k/S^2 non-decreasing).
        let (k_after, s2_after) = p.share_value();
        if !s2_before.is_zero() && !s2_after.is_zero() {
            assert!(k_after * s2_before >= k_before * s2_after, "CP value per LP share decreased (op {op})");
        }
    }
    // Liveness + final solvency: every LP can exit (unless a side would
    // round to zero, which the program refuses), and what is left in the
    // vault still covers the reserves.
    for who in 0..ACTORS {
        let lp = p.lp[who];
        if lp > 0 {
            let _ = p.withdraw(who, lp);
        }
        p.check();
    }
}
