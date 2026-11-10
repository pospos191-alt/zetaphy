//! Fuzz / property harnesses for swd_amm's pure math (2026-11-10).
//!
//! The three math modules below are the program's OWN source files,
//! included by path — not copies — so whatever is fuzzed here is exactly
//! what `anchor build` compiles into the program.
//!
//! Each `run_*` entry point takes arbitrary bytes, turns them into a pool
//! configuration plus a sequence of operations by several actors, applies
//! them to a model of the on-chain state that calls the real math, and
//! `panic!`s (= a fuzzer crash) the moment an invariant breaks. An
//! operation the program would reject (error) is simply skipped, exactly
//! like a failed transaction that leaves state untouched.
//!
//! What the models mirror (and what they do not) is spelled out in
//! docs/FUZZING_FORMAL.md. In short: cp_math / dlmm_math / swdmm_math are
//! the real code; the few lines of per-handler bookkeeping around them
//! (reserve += amount, position.shares[i] += ..., vault transfers) are
//! re-stated in the models from cp.rs / lib.rs / dlmm.rs / swdmm_v2.rs.

#![allow(clippy::too_many_arguments)]

#[path = "../../src/cp_math.rs"]
pub mod cp_math;
#[path = "../../src/dlmm_math.rs"]
pub mod dlmm_math;
#[allow(dead_code)]
#[path = "../../src/swdmm_math.rs"]
pub mod swdmm_math;

pub mod cp_model;
pub mod dlmm_model;
pub mod units;
pub mod v2_model;

use arbitrary::Unstructured;

#[allow(clippy::manual_div_ceil)]
pub mod wide {
    uint::construct_uint! {
        /// 512-bit unsigned integer, used only to CHECK invariants exactly
        /// (the program itself never needs more than u128).
        pub struct U512(8);
    }
    pub fn w(v: u128) -> U512 {
        U512::from(v)
    }
}

/// Byte-driven generator with distributions that hit edge cases often
/// (0, 1, powers of two, u64::MAX) as well as "normal" sizes.
pub struct Gen<'a> {
    pub u: Unstructured<'a>,
}

impl<'a> Gen<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Gen { u: Unstructured::new(data) }
    }
    pub fn done(&self) -> bool {
        self.u.is_empty()
    }
    pub fn byte(&mut self) -> u8 {
        self.u.arbitrary::<u8>().unwrap_or(0)
    }
    pub fn bool(&mut self) -> bool {
        self.byte() & 1 == 1
    }
    pub fn u16(&mut self) -> u16 {
        self.u.arbitrary::<u16>().unwrap_or(0)
    }
    pub fn u64_raw(&mut self) -> u64 {
        self.u.arbitrary::<u64>().unwrap_or(0)
    }
    pub fn u128_raw(&mut self) -> u128 {
        self.u.arbitrary::<u128>().unwrap_or(0)
    }
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        self.u.int_in_range(lo..=hi).unwrap_or(lo)
    }
    pub fn irange(&mut self, lo: i64, hi: i64) -> i64 {
        self.u.int_in_range(lo..=hi).unwrap_or(lo)
    }
    /// A token amount: log-uniform bit width, then a value of that width,
    /// with special values mixed in.
    pub fn amount(&mut self) -> u64 {
        match self.byte() % 16 {
            0 => 0,
            1 => 1,
            2 => u64::MAX,
            3 => 1u64 << self.range(0, 63),
            4 => (1u64 << self.range(1, 63)) - 1,
            _ => {
                let bits = self.range(1, 64) as u32;
                let v = self.u64_raw();
                if bits == 64 {
                    v
                } else {
                    v & ((1u64 << bits) - 1)
                }
            }
        }
    }
    /// An amount in [lo, hi], log-ish distributed.
    pub fn amount_in(&mut self, lo: u64, hi: u64) -> u64 {
        let a = self.amount();
        if hi <= lo {
            return lo;
        }
        lo + a % (hi - lo + 1).max(1)
    }
    /// A fraction of `of` (0..=of), with 0, all, and halves likely.
    pub fn part(&mut self, of: u128) -> u128 {
        match self.byte() % 8 {
            0 => 0,
            1 => of,
            2 => of / 2,
            3 => of.min(1),
            _ => {
                let n = self.u64_raw() as u128;
                if of == 0 {
                    0
                } else {
                    (n % of) + 1
                }
            }
        }
    }
}

pub fn run_math_units(data: &[u8]) {
    units::run(&mut Gen::new(data));
}
pub fn run_cp_sequence(data: &[u8]) {
    cp_model::run(&mut Gen::new(data));
}
pub fn run_dlmm_sequence(data: &[u8]) {
    dlmm_model::run(&mut Gen::new(data));
}
pub fn run_v2_sequence(data: &[u8]) {
    v2_model::run(&mut Gen::new(data));
}

/// Operation counters, so a run can report how many ops actually
/// succeeded (a harness that only ever hits error paths proves nothing).
pub mod stats {
    use std::sync::atomic::{AtomicU64, Ordering};
    pub static OK_OPS: AtomicU64 = AtomicU64::new(0);
    pub static REJECTED_OPS: AtomicU64 = AtomicU64::new(0);
    /// Per-(model, op code) success counters: index model*16 + op.
    pub static OK_BY_OP: [AtomicU64; 64] = [const { AtomicU64::new(0) }; 64];
    pub fn ok() {
        OK_OPS.fetch_add(1, Ordering::Relaxed);
    }
    pub fn ok_op(model: usize, op: u8) {
        OK_OPS.fetch_add(1, Ordering::Relaxed);
        OK_BY_OP[model * 16 + (op as usize % 16)].fetch_add(1, Ordering::Relaxed);
    }
    pub fn rejected() {
        REJECTED_OPS.fetch_add(1, Ordering::Relaxed);
    }
    pub fn snapshot() -> (u64, u64) {
        (OK_OPS.load(Ordering::Relaxed), REJECTED_OPS.load(Ordering::Relaxed))
    }
    pub fn by_op(model: usize) -> Vec<u64> {
        (0..16).map(|i| OK_BY_OP[model * 16 + i].load(Ordering::Relaxed)).collect()
    }
}
