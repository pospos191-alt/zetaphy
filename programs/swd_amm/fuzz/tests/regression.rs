//! Stable-toolchain regression suite for the fuzz harnesses (no libFuzzer,
//! no nightly). Runs in CI:
//!   1. the models' copies of program constants still match the program;
//!   2. every saved corpus input and crash reproducer replays cleanly;
//!   3. a fixed-seed batch of random inputs per target.
//!
//!   cargo test --release --manifest-path programs/swd_amm/fuzz/Cargo.toml
//!   SWD_FUZZ_CASES=200000 cargo test --release ...   (longer run)

use std::fs;
use std::path::{Path, PathBuf};

type Target = (&'static str, fn(&[u8]));
const TARGETS: &[Target] = &[
    ("math_units", swd_amm_fuzz::run_math_units),
    ("cp_sequence", swd_amm_fuzz::run_cp_sequence),
    ("dlmm_sequence", swd_amm_fuzz::run_dlmm_sequence),
    ("v2_sequence", swd_amm_fuzz::run_v2_sequence),
];

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn src(file: &str) -> String {
    fs::read_to_string(root().join("..").join("src").join(file)).unwrap()
}

#[test]
fn constants_match_program() {
    let lib = src("lib.rs");
    let dlmm = src("dlmm.rs");
    let v2 = src("swdmm_v2.rs");
    let tl = src("timelock.rs");
    let has = |s: &str, line: &str| assert!(s.contains(line), "program constant changed — update the fuzz model: {line}");
    use swd_amm_fuzz::{cp_model as c, dlmm_model as d, v2_model as v};
    has(&lib, &format!("pub const MINIMUM_LIQUIDITY: u64 = {};", fmt(c::MINIMUM_LIQUIDITY as u128)));
    has(&lib, &format!("pub const MIN_INITIAL_DEPOSIT: u64 = {};", fmt(c::MIN_INITIAL_DEPOSIT as u128)));
    has(&lib, &format!("pub const MAX_FEE_BPS: u16 = {};", fmt(c::MAX_FEE_BPS as u128)));
    assert_eq!(c::MAX_FEE_BPS, d::MAX_FEE_BPS);
    has(&dlmm, &format!("pub const HALF_RANGE: i32 = {};", d::HALF_RANGE));
    has(&dlmm, &format!("pub const MAX_POSITION_BINS: usize = {};", d::MAX_POSITION_BINS));
    has(&dlmm, &format!("pub const MAX_BIN_STEP_BPS: u16 = {};", fmt(d::MAX_BIN_STEP_BPS as u128)));
    has(&v2, &format!("pub const V2_MIN_INITIAL_DEPOSIT: u64 = {};", fmt(v::V2_MIN_INITIAL_DEPOSIT as u128)));
    has(&v2, &format!("pub const MAX_PRICE_IMPACT_BPS: u16 = {};", fmt(v::MAX_PRICE_IMPACT_BPS as u128)));
    has(&tl, &format!("pub const MAX_PROTOCOL_FEE_SHARE_BPS: u16 = {};", fmt(v::MAX_PROTOCOL_FEE_SHARE_BPS as u128)));
}

/// 1000000 -> "1_000_000" (the program's literal style)
fn fmt(v: u128) -> String {
    let s = v.to_string();
    if s.len() <= 3 {
        return s;
    }
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('_');
        }
        out.push(c);
    }
    out
}

fn replay_dir(dir: &Path, f: fn(&[u8])) -> usize {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    let mut n = 0;
    for e in rd.flatten() {
        let p = e.path();
        if p.is_file() {
            let data = fs::read(&p).unwrap();
            let r = std::panic::catch_unwind(|| f(&data));
            assert!(r.is_ok(), "regression input failed: {}", p.display());
            n += 1;
        }
    }
    n
}

#[test]
fn replay_corpus_and_reproducers() {
    for (name, f) in TARGETS {
        let a = replay_dir(&root().join("corpus").join(name), *f);
        let b = replay_dir(&root().join("regressions").join(name), *f);
        eprintln!("{name}: replayed {a} corpus + {b} reproducer inputs");
    }
}

struct XorShift(u64);
impl XorShift {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

#[test]
fn seeded_random_inputs() {
    let cases: usize = std::env::var("SWD_FUZZ_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(3_000);
    for (ti, (name, f)) in TARGETS.iter().enumerate() {
        let mut rng = XorShift(0x5eed_0000_0000_0001 ^ (ti as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
        for case in 0..cases {
            let len = (rng.next() % 3_000) as usize;
            let data: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
            let r = std::panic::catch_unwind(|| f(&data));
            if r.is_err() {
                let out = root().join("regressions").join(name);
                fs::create_dir_all(&out).unwrap();
                let p = out.join(format!("seeded-{case}"));
                fs::write(&p, &data).unwrap();
                panic!("{name}: seeded case {case} failed; input saved to {}", p.display());
            }
        }
        let (ok, rej) = swd_amm_fuzz::stats::snapshot();
        eprintln!("{name}: {cases} seeded inputs passed (cumulative ops ok={ok} rejected={rej}; ok by op code {:?})", swd_amm_fuzz::stats::by_op(ti));
    }
}
