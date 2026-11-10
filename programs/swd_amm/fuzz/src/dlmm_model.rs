//! Stateful model of the DLMM pool (dlmm.rs add_dlmm_liquidity /
//! remove_dlmm_liquidity / swap_dlmm), calling the program's own
//! dlmm_math::{bin_deposit, bin_withdraw, swap_bins}.
//!
//! Invariants checked after EVERY successful op:
//!   (a) solvency: vault_x >= sum of bin reserves_x
//!   (a) shares: every bin's total_shares == MIN_BIN_LIQUIDITY (locked)
//!       + sum of all positions' shares in it (or 0 if never used)
//!   (d) single-sided rule holds as a STATE invariant: every bin strictly
//!       above the active bin holds no B, every bin strictly below holds no
//!       A — after deposits AND swaps
//!   (d) a swap crosses at most MAX_BINS_CROSSED_PER_SWAP bins, credits
//!       every input unit to bins and debits exactly the output from bins
//!   (c) each bin's value at its own price never decreases on a swap, and
//!       value per share never decreases on deposit/withdraw/swap
//!   (b) round trips (deposit->withdraw, swap A->B->A) never profit
//!   (e) depositing into a bin someone else seeded loses only rounding
//!   (f) no panic anywhere

use crate::dlmm_math::{self as dm, BinMut, MAX_BINS_CROSSED_PER_SWAP, MIN_BIN_LIQUIDITY};
use crate::stats;
use crate::wide::{w, U512};
use crate::Gen;

/// dlmm.rs / lib.rs constants (kept in sync by tests/regression.rs).
pub const HALF_RANGE: i32 = 100;
pub const MAX_POSITION_BINS: usize = 20;
pub const MAX_BIN_STEP_BPS: u16 = 1_000;
pub const MAX_FEE_BPS: u64 = 1_000;
const ACTORS: usize = 4;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Bin {
    pub total_shares: u128,
    pub reserve_a: u64,
    pub reserve_b: u64,
}
impl BinMut for Bin {
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub owner: usize,
    pub lower: i32,
    pub upper: i32,
    pub shares: Vec<u128>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dlmm {
    pub bins: Vec<Bin>,
    pub min_id: i32,
    pub max_id: i32,
    pub active: i32,
    pub step: u16,
    pub vault_a: u128,
    pub vault_b: u128,
    pub positions: Vec<Position>,
}

type R<T> = Result<T, ()>;

impl Dlmm {
    pub fn new(active: i32, step: u16) -> Option<Self> {
        let min_id = active.checked_sub(HALF_RANGE)?;
        let max_id = active.checked_add(HALF_RANGE)?;
        if step == 0 || step > MAX_BIN_STEP_BPS {
            return None;
        }
        // initialize_dlmm_pool: both edge prices must be computable, min > 0.
        if dm::bin_price_q64(min_id, step)? == 0 {
            return None;
        }
        dm::bin_price_q64(max_id, step)?;
        Some(Dlmm {
            bins: vec![Bin::default(); (2 * HALF_RANGE + 1) as usize],
            min_id,
            max_id,
            active,
            step,
            vault_a: 0,
            vault_b: 0,
            positions: vec![],
        })
    }

    fn idx(&self, id: i32) -> usize {
        (id - self.min_id) as usize
    }

    /// add_dlmm_liquidity
    pub fn deposit(&mut self, owner: usize, lower: i32, upper: i32, amounts: &[(u64, u64)]) -> R<(u64, u64)> {
        if upper < lower {
            return Err(());
        }
        let count = (upper - lower + 1) as usize;
        if count > MAX_POSITION_BINS || amounts.len() != count || lower < self.min_id || upper > self.max_id {
            return Err(());
        }
        let mut next = self.clone();
        let pi = match next.positions.iter().position(|p| p.owner == owner && p.lower == lower && p.upper == upper) {
            Some(i) => i,
            None => {
                next.positions.push(Position { owner, lower, upper, shares: vec![0; count] });
                next.positions.len() - 1
            }
        };
        let (mut ta, mut tb) = (0u64, 0u64);
        for (i, &(a, b)) in amounts.iter().enumerate() {
            let id = lower + i as i32;
            let ix = next.idx(id);
            let active = next.active;
            let Some((sh, take_a, take_b)) = dm::bin_deposit(&mut next.bins[ix], id, active, a, b).map_err(|_| ())? else {
                continue;
            };
            next.positions[pi].shares[i] = next.positions[pi].shares[i].checked_add(sh).ok_or(())?;
            ta = ta.checked_add(take_a).ok_or(())?;
            tb = tb.checked_add(take_b).ok_or(())?;
        }
        if ta == 0 && tb == 0 {
            return Err(());
        }
        next.vault_a += ta as u128;
        next.vault_b += tb as u128;
        if next.vault_a > u64::MAX as u128 || next.vault_b > u64::MAX as u128 {
            return Err(()); // token account balance overflow → transfer fails
        }
        *self = next;
        Ok((ta, tb))
    }

    /// remove_dlmm_liquidity (min_out = 0)
    pub fn withdraw(&mut self, pi: usize, shares: &[u128]) -> R<(u64, u64)> {
        let mut next = self.clone();
        let pos = next.positions.get(pi).ok_or(())?.clone();
        if shares.len() != pos.shares.len() {
            return Err(());
        }
        let (mut ta, mut tb) = (0u64, 0u64);
        let mut new_shares = pos.shares.clone();
        for (i, &s) in shares.iter().enumerate() {
            if s == 0 {
                continue;
            }
            if s > pos.shares[i] {
                return Err(());
            }
            let ix = next.idx(pos.lower + i as i32);
            let (a, b) = dm::bin_withdraw(&mut next.bins[ix], s).map_err(|_| ())?;
            new_shares[i] -= s;
            ta = ta.checked_add(a).ok_or(())?;
            tb = tb.checked_add(b).ok_or(())?;
        }
        if ta == 0 && tb == 0 {
            return Err(());
        }
        assert!(next.vault_a >= ta as u128 && next.vault_b >= tb as u128, "DLMM vault cannot pay a withdrawal");
        next.vault_a -= ta as u128;
        next.vault_b -= tb as u128;
        next.positions[pi].shares = new_shares;
        *self = next;
        Ok((ta, tb))
    }

    /// swap_dlmm
    pub fn swap(&mut self, amount_in: u64, a_to_b: bool, fee_bps: u128) -> R<u64> {
        if amount_in == 0 {
            return Err(());
        }
        let mut next = self.clone();
        let (min_id, max_id) = (next.min_id, next.max_id);
        let r = dm::swap_bins(&mut next.bins[..], min_id, max_id, next.active, next.step, fee_bps, amount_in, a_to_b)
            .map_err(|_| ())?;
        if r.total_amount_out == 0 {
            return Err(());
        }
        assert!(r.bins_crossed <= MAX_BINS_CROSSED_PER_SWAP, "crossed too many bins");
        assert!(r.active_bin_id >= min_id && r.active_bin_id <= max_id, "active bin left the array");
        // Conservation: in-side reserves grew by exactly amount_in; out-side
        // shrank by exactly total_amount_out; no other bin field changed.
        let sum = |d: &Dlmm, a: bool| -> u128 {
            d.bins.iter().map(|b| if a { b.reserve_a as u128 } else { b.reserve_b as u128 }).sum()
        };
        let (in_before, out_before) = (sum(self, a_to_b), sum(self, !a_to_b));
        let (in_after, out_after) = (sum(&next, a_to_b), sum(&next, !a_to_b));
        assert_eq!(in_after, in_before + amount_in as u128, "swap input not fully credited to bins");
        assert_eq!(out_before - out_after, r.total_amount_out as u128, "swap output != bin debits");
        for (i, (b0, b1)) in self.bins.iter().zip(next.bins.iter()).enumerate() {
            assert_eq!(b0.total_shares, b1.total_shares, "swap changed shares");
            if b0 != b1 {
                // (c) value at the bin's own price never decreases.
                let id = self.min_id + i as i32;
                let p = dm::bin_price_q64(id, self.step).unwrap();
                assert!(bin_value(b1, p) >= bin_value(b0, p), "swap lowered bin {id}'s value at its own price");
            }
        }
        // vault: in += amount_in (u64 balance), out -= amount_out
        let (vi, vo) = if a_to_b { (&mut next.vault_a, &mut next.vault_b) } else { (&mut next.vault_b, &mut next.vault_a) };
        *vi += amount_in as u128;
        if *vi > u64::MAX as u128 {
            return Err(());
        }
        assert!(*vo >= r.total_amount_out as u128, "DLMM vault cannot pay a swap");
        *vo -= r.total_amount_out as u128;
        next.active = r.active_bin_id;
        *self = next;
        Ok(r.total_amount_out)
    }

    pub fn check(&self) {
        let sa: u128 = self.bins.iter().map(|b| b.reserve_a as u128).sum();
        let sb: u128 = self.bins.iter().map(|b| b.reserve_b as u128).sum();
        assert!(self.vault_a >= sa, "DLMM insolvent in A");
        assert!(self.vault_b >= sb, "DLMM insolvent in B");
        for (i, b) in self.bins.iter().enumerate() {
            let id = self.min_id + i as i32;
            if id > self.active {
                assert_eq!(b.reserve_b, 0, "bin {id} above active {} holds B", self.active);
            }
            if id < self.active {
                assert_eq!(b.reserve_a, 0, "bin {id} below active {} holds A", self.active);
            }
            let owned: u128 = self
                .positions
                .iter()
                .filter(|p| id >= p.lower && id <= p.upper)
                .map(|p| p.shares[(id - p.lower) as usize])
                .sum();
            if b.total_shares == 0 {
                assert_eq!(owned, 0);
                assert!(b.reserve_a == 0 && b.reserve_b == 0, "unowned bin {id} holds tokens");
            } else {
                assert_eq!(b.total_shares, owned + MIN_BIN_LIQUIDITY, "bin {id} share accounting broken");
            }
        }
    }
}

/// Bin value in B units scaled by 2^64: reserve_a * price + reserve_b * 2^64.
pub fn bin_value(b: &Bin, p: u128) -> U512 {
    w(b.reserve_a as u128) * w(p) + w(b.reserve_b as u128) * (w(1u128 << 64))
}

fn fee(g: &mut Gen) -> u128 {
    match g.byte() % 4 {
        0 => 0,
        1 => g.range(0, MAX_FEE_BPS) as u128,
        2 => 25,
        _ => g.range(0, 10_001) as u128,
    }
}

fn amounts_for(g: &mut Gen, d: &Dlmm, lower: i32, count: usize, legal: bool) -> Vec<(u64, u64)> {
    (0..count)
        .map(|i| {
            let id = lower + i as i32;
            let (a, b) = (g.amount(), g.amount());
            if !legal {
                (a, b)
            } else if id > d.active {
                (a, 0)
            } else if id < d.active {
                (0, b)
            } else {
                (a, b)
            }
        })
        .collect()
}

pub fn run(g: &mut Gen) {
    let step = match g.byte() % 4 {
        0 => 1,
        1 => MAX_BIN_STEP_BPS,
        _ => g.range(1, MAX_BIN_STEP_BPS as u64) as u16,
    };
    let active = match g.byte() % 4 {
        0 => 0,
        1 => g.irange(-300, 300) as i32,
        _ => g.irange(-30_000, 30_000) as i32,
    };
    let Some(mut d) = Dlmm::new(active, step) else { return };
    let mut steps = 0;
    while !g.done() && steps < 300 {
        steps += 1;
        let before = d.clone();
        let who = (g.byte() as usize) % ACTORS;
        let op = g.byte() % 10;
        let res: R<()> = match op {
            0..=2 => {
                let lower = d.active + g.irange(-25, 25) as i32;
                let count = g.range(1, 22) as usize;
                let upper = lower + count as i32 - 1;
                let legal = g.byte() % 8 != 0;
                let am = amounts_for(g, &d, lower, count, legal);
                d.deposit(who, lower, upper, &am).map(|_| ())
            }
            3 => {
                if d.positions.is_empty() {
                    Err(())
                } else {
                    let pi = (g.byte() as usize) % d.positions.len();
                    let sh: Vec<u128> = d.positions[pi].shares.clone().iter().map(|&s| g.part(s)).collect();
                    d.withdraw(pi, &sh).map(|_| ())
                }
            }
            4..=6 => {
                let amt = g.amount();
                let dir = g.bool();
                let f = fee(g);
                d.swap(amt, dir, f).map(|_| ())
            }
            7 => {
                let amt = g.amount();
                let dir = g.bool();
                let f = fee(g);
                match d.swap(amt, dir, f) {
                    Ok(out) => {
                        if let Ok(back) = d.swap(out, !dir, f) {
                            assert!(back <= amt, "DLMM round trip profit: in {amt} back {back}");
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
            8 => {
                let (a, b) = (g.amount() as u128, g.amount() as u128);
                if d.vault_a + a <= u64::MAX as u128 && d.vault_b + b <= u64::MAX as u128 {
                    d.vault_a += a;
                    d.vault_b += b;
                    Ok(())
                } else {
                    Err(())
                }
            }
            _ => {
                // Deposit into ONE bin, then withdraw exactly the shares just minted.
                let id = d.active + g.irange(-3, 3) as i32;
                let am = amounts_for(g, &d, id, 1, true);
                if id < d.min_id || id > d.max_id {
                    Err(())
                } else {
                    let ix = d.idx(id);
                    let b0 = d.bins[ix];
                    let had = d.positions.iter().position(|p| p.owner == who && p.lower == id && p.upper == id);
                    let old = had.map(|i| d.positions[i].shares[0]).unwrap_or(0);
                    match d.deposit(who, id, id, &am) {
                        Ok((pa, pb)) => {
                            let pi = d.positions.iter().position(|p| p.owner == who && p.lower == id && p.upper == id).unwrap();
                            let minted = d.positions[pi].shares[0] - old;
                            let b1 = d.bins[ix];
                            if let Ok((ga, gb)) = d.withdraw(pi, &[minted]) {
                                assert!(ga <= pa && gb <= pb, "DLMM deposit->withdraw profit");
                                if b0.total_shares > 0 {
                                    // (e) loss bounded by rounding: one share's worth
                                    // (of the post-deposit bin) + 1 raw unit per side,
                                    // + the active-bin floor on required_b (worth
                                    // ra/rb A, i.e. 1 B).
                                    let s1 = b1.total_shares;
                                    let la = (pa - ga) as u128;
                                    let lb = (pb - gb) as u128;
                                    let one_share_a = (b1.reserve_a as u128).div_ceil(s1);
                                    let one_share_b = (b1.reserve_b as u128).div_ceil(s1);
                                    let ratio = if b0.reserve_b > 0 { (b0.reserve_a as u128).div_ceil(b0.reserve_b as u128) } else { 0 };
                                    assert!(la <= 2 * one_share_a + ratio + 2, "DLMM depositor lost {la} A > rounding");
                                    assert!(lb <= 2 * one_share_b + 2, "DLMM depositor lost {lb} B > rounding");
                                }
                            }
                            Ok(())
                        }
                        Err(e) => Err(e),
                    }
                }
            }
        };
        match res {
            Ok(()) => stats::ok_op(2, op),
            Err(()) => {
                stats::rejected();
                if op < 7 {
                    assert_eq!(d, before, "rejected op mutated state");
                }
            }
        }
        d.check();
        // value per share never decreases, for every bin with shares
        for (i, (b0, b1)) in before.bins.iter().zip(d.bins.iter()).enumerate() {
            if b0.total_shares > 0 && b1.total_shares > 0 {
                let p = dm::bin_price_q64(d.min_id + i as i32, d.step).unwrap();
                assert!(
                    bin_value(b1, p) * w(b0.total_shares) >= bin_value(b0, p) * w(b1.total_shares),
                    "bin {} value per share decreased (op {op})",
                    d.min_id + i as i32
                );
            }
        }
    }
    // Every position can fully exit.
    for pi in 0..d.positions.len() {
        let sh = d.positions[pi].shares.clone();
        if sh.iter().any(|&s| s > 0) {
            let _ = d.withdraw(pi, &sh);
        }
        d.check();
    }
}
