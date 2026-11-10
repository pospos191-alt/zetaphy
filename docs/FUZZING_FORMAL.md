# swd_amm — fuzzing and formal verification

*2026-11-10, branch `claude/amm-fuzz` (on top of the security-review fixes
F-1..F-6). Thai version for the owner: [FUZZING_FORMAL.th.md](FUZZING_FORMAL.th.md).*

This page says what was fuzzed and proved, for how long, what that
guarantees and — just as important — what it does **not** guarantee.

**Short version.** Three kinds of automated checks now run against the
AMM's math and against the built program. They found **two real bugs**.
Neither could lose funds, and both are fixed with regression tests. No
invariant was broken in about **4.6 million fuzz executions** or in
**400,000 random operations against the built program** (each one or two
transactions). **6 Kani proofs** completed. A further 14 Kani harnesses are
written but did not finish under CBMC; their properties are instead checked
exhaustively on small input ranges (§5). None of this is an audit. Fuzzing finds bugs;
it does not prove there are none. The Kani proofs only cover the functions
and input ranges listed below.

## 1. What changed in the program

| Commit | Change | Behaviour change? |
|---|---|---|
| refactor | The CP and DLMM math that the handlers ran inline moved into `src/cp_math.rs` and `src/dlmm_math.rs`: the CP swap curve and price-impact cap, LP mint/burn, the DLMM Q64.64 helpers, per-bin deposit/withdraw and the bin-walking swap loop. These files import nothing from Anchor, so the fuzz and Kani crates include **the program's own source file** (`#[path]`), not a copy. The handlers call them and map errors to the same Anchor error codes, in the same order. | None. All 53 unit tests, the proptests and `anchor build` pass. The `.so` shrank by 2 KB. |
| **fix 1** | `swdmm_math::isqrt(2)` returned **2** instead of 1. Newton's start value `v/2+1` equals `v` when `v = 2`, so the loop never ran. Only `v = 2` was wrong (checked exhaustively up to 5·10⁷). | Not reachable today: `initial_liquidity` needs sqrt > 1000. It is a latent bug. Regression test: `isqrt_small_and_near_squares_exact`. |
| **fix 2** | `bin_price_q64(i32::MIN, _)` **panicked**. `(-bin_id) as u32` overflows, and overflow checks are on in release. `initialize_dlmm_pool` with `active_bin_id = i32::MIN + 100` reached it. Now uses `unsigned_abs()`, and that pool is refused by the existing "min price > 0" check. | The transaction used to abort with a panic and now gets a clean error. No funds were at risk, because a panic reverts. Regression test: `bin_price_extreme_ids_do_not_panic`. |

Both fixes came from the `math_units` fuzz target in its first minutes. Their
inputs are saved in `programs/swd_amm/fuzz/regressions/math_units/`.

## 2. Tools: what worked

| Tool | Status |
|---|---|
| **cargo-fuzz 0.13.2 / libFuzzer** (nightly) | Works. Four targets, run with coverage guidance, overflow checks and debug assertions. |
| **Stable seeded replay** (`cargo test` in `fuzz/`) | Works. It replays the saved corpus and crash reproducers, plus 3,000 fixed-seed inputs per target. CI runs it on every PR. |
| **LiteSVM 0.18.2** (the real SBF VM and SPL Token, no validator) | Works with the built `target/deploy/swd_amm.so`. It needs rustc ≥ 1.97.1: CI's `stable` is fine, and locally use `cargo +nightly`. |
| **Kani 0.68.0** (CBMC 6.11, CaDiCaL) | Installs from crates.io (the bundle is about 0.5 GB). It completes the 6 proofs in §5, but proofs that pass values through 128-bit division did not finish in 15 to 25 minutes, even with 16-bit inputs (§5). |
| Trident | Not tried, because LiteSVM did the job. |

## 3. Fuzz targets and invariants (`programs/swd_amm/fuzz`)

Every target turns bytes into a pool config plus a sequence of operations by
up to four actors. It applies them to a model of the on-chain state that
**calls the program's real math**, and it panics the moment an invariant
breaks. An operation the program would reject is skipped and must leave no
trace, just like a reverted transaction. All arithmetic is checked: overflow
checks are on, and the invariants are compared exactly with 512-bit
integers.

| Target | Covers | Invariants checked after every step |
|---|---|---|
| `math_units` | Every pure function in `cp_math`, `dlmm_math` and `swdmm_math`, one call at a time, on the full u64/u128 domain with edge values | (c) Each function matches an exact 512-bit reference floor/ceil. User outputs round **down** and user inputs and fees round **up**. (d) The CP swap gives `out < reserve_out`, `out ≤ x·R_out/(R_in+x)`, and k never decreases. The v2 swap conserves every token and splits the fee exactly. (b) A swap round trip at the same fee never profits. LP minting never over-issues. Bin prices are monotone. Fee growth never over-pays. (f) Nothing panics, on any input. |
| `cp_sequence` | CP pool: deposit (including the first deposit and the `MINIMUM_LIQUIDITY` lock), withdraw, swap at any oracle fee, direct donations to the vault, and round trips | (a) `vault ≥ reserve` per token, and LP supply equals the sum of balances plus the lock. (d) k never decreases. (b/e) **Value per LP share (k/S²) never decreases** on any operation, so donations can't move reserves or supply. Deposit→withdraw and A→B→A never profit. (e) A later depositor's immediate deposit→withdraw loss stays within a rounding bound, whatever the first depositor did. (Liveness) Every LP can exit at the end. |
| `dlmm_sequence` | DLMM, 201 bins, with random bin step (1–1000 bps) and centre bin (±30,000): multi-bin deposits (legal and illegal), partial withdrawals, swaps that cross bins at any fee, round trips and donations | (a) `vault ≥ Σ bin reserves`, and every bin's shares equal the locked 10 plus the sum of the positions' shares. (d) **The single-sided rule holds as a state invariant**: no B above the active bin and no A below it, after swaps too. A swap crosses at most 30 bins, credits every input unit to bins and debits exactly the output. (c) A bin's value at its own price never decreases on a swap, and value per share never decreases on any operation. (b) Round trips never profit. (e) A deposit into a bin seeded by someone else loses at most about one share plus one unit per side. |
| `v2_sequence` | SWDMM v2: all three fee-collect modes, the time and market-cap fee schedulers, the dynamic fee, the per-swap and per-slot impact caps, positions, lock, claim, and the governance actions (`SetV2PoolParams`, pause/unpause, protocol-share change, protocol-fee withdrawal), with time and slots passing | (a) `vault ≥ reserve + protocol fee + every position's unclaimed fees` per token, and the pool's liquidity equals the sum over positions plus `MINIMUM_LIQUIDITY`. (d) k never decreases. **k/L² never decreases.** `fee_per_liquidity` is monotone, and each position's unclaimed fee still fits a u64, so `settle()` can never brick a position. (b) Round trips never profit. (Liveness) At the end, every position can withdraw and claim. |

> "SWDMM v2" is a full-range constant-product pool with DAMM-v2-style
> fees and positions. It has no tick-based concentrated liquidity, so the
> "liquidity/price monotonicity" checks are the k and k/L² invariants above.

### Run budget (libFuzzer, one core each, `-max_len=4096`)

| Target | Time | Executions | Crashes |
|---|---|---|---|
| `math_units` | 5 min | 2,419,888 | 0 (the `bin_price_q64` panic was found in an earlier 30-second smoke run and fixed) |
| `cp_sequence` | 5 min | 767,278 | 0 |
| `dlmm_sequence` | 15 min | 809,541 | 0 |
| `v2_sequence` | 15 min | 635,566 | 0 |
| **total** | **40 CPU-min** | **≈ 4.6 M** | |

On top of this, 3,000 fixed-seed inputs per target run on every CI build.
The `isqrt(2)` bug was found by the stable seeded run, before libFuzzer
started. The minimised corpus (`cargo fuzz cmin`: 3,198 inputs, about 12 MB in
`fuzz/corpus/<target>`) and every crash reproducer
(`fuzz/regressions/<target>`) are committed and replayed on every PR, along
with 30,000 seeded inputs per target.

## 4. Stateful sequence fuzzing of the built program (`programs/swd_amm/litesvm`)

For each seed, the harness:

1. Deploys the real `target/deploy/swd_amm.so` as an upgradeable program.
2. Runs the real bootstrap: global config (upgrade-authority gated),
   governance settings with a 5-second timelock, and mint policies.
3. Creates a SWDMM v2 pool with a random fee configuration.
4. Applies random operations by three actors: create position, add, remove
   and lock liquidity, claim, swap, swap round trip, donation, guardian
   pause, and timelocked governance (unpause, `SetV2PoolParams`,
   `SetProtocolFeeShare`, `WithdrawV2ProtocolFees`). Time and slots pass
   in between.

After every transaction, it checks **from on-chain accounts**:

- solvency per token;
- conservation of each token across actors, vaults and the treasury;
- that k never decreases;
- that a completed swap round trip never profits;
- liveness: at the end, every position can withdraw and claim.

It is also **differential**. The `v2_sequence` model runs alongside, and its
accept/reject decision and **every** pool and position field must equal the
chain's after every step. That ties the millions of fast model executions
back to the real program. It found one gap in the model, never in the
program: enabling the dynamic fee resets the volatility state on chain. The
model was fixed to match.

Run: **2 × 1,000 seeds × 200 steps**, i.e. 400,000 operations in about 4
minutes. Of these, 2 × ~25,000 swaps succeeded, 7,100 swap round trips
completed both legs, 9,300 governance actions were executed through the
timelock, and 28,000 adds and 6,400 removes succeeded; a further ~200,000
operations were rejected by the chain AND the model. One run used the `.so`
built before fix 2, and one used the final `.so`. No invariant violation
and no divergence. CI runs 150 seeds × 150 steps.

**Not covered on chain:** CP and DLMM pools need Pyth `PriceUpdateV2`
accounts on every swap, and this harness does not create them. Their math
is covered by the `cp_sequence`/`dlmm_sequence` models, which call the same
`cp_math`/`dlmm_math` code the program runs. The TS localnet suites
(`tests/*.ts`) remain the end-to-end tests for those pools.

## 5. Kani proofs (`programs/swd_amm/kani`)

Each proof holds **for every input inside its bounds**; the inputs are not
sampled. Kani also checks every overflow, division by zero and panic on
every path. "Full" means any u64/u128 value. The bounds exist because
64×64-bit multiplications followed by 128-bit divisions are expensive for a
SAT solver.

| Proof | Property | Bounds | Result |
|---|---|---|---|
| `cp_integer_sqrt_exact_u12` | CP first-deposit `integer_sqrt` is the exact floor square root | v < 2¹² | ✅ 111 s |
| `v2_isqrt_exact_u12` | v2 `isqrt` is the exact floor square root (catches the isqrt(2) bug) | v < 2¹² | ✅ 92 s |
| `dlmm_q64_mul_exact_u64_operands` | `q64_mul` = ⌊a·b/2⁶⁴⌋ and `q64_mul_ceil` = ⌈a·b/2⁶⁴⌉ exactly | a, b any u64 | ✅ 87 s |
| `dlmm_amount_times_price_full_domain` | For **any** amount and **any** Q64.64 price: no panic; floor and ceil are exact; `None` only when the result exceeds u128. This is the multiplication behind A→B outputs (rounded down) and B→A required inputs (rounded up). | **full** (u64 × u128) | ✅ 90 s |
| `v2_pending_fee_no_panic_full_domain` | Settling fees never panics or overflows silently | **full** (3 × u128) | ✅ 0.6 s |
| `v2_total_fee_capped` | Base + dynamic fee is always ≤ 99% | **full** | ✅ 0.03 s |

`cargo kani` runs these six in **6 min 21 s**.

**Written but not completed (SLOW).** These are registered only with
`RUSTFLAGS="--cfg kani_slow"`. Each one ran for 15 to 25 minutes without
finishing, even on 16-bit inputs, because CBMC turns every 128-bit multiply
or divide in the code into a circuit, however small the inputs:

- CP swap: `out < reserve`, `out ≤` the exact output, k not decreasing,
  fee ≤ input, impact cap;
- CP LP mint never over-issues, and LP burn never over-pays;
- `mul_div` exactness (also tried on the full u64 domain: >25 min);
- v2 `fee_amount` rounds up and stays ≤ the amount;
- v2 swap conservation and k;
- v2 deposit and withdraw quotes;
- fee growth: split claims ≤ the fee;
- DLMM bin deposit (single-sided rule, shares ≤ paid) and bin withdraw;
- the 3-bin `swap_bins` loop;
- DLMM conversion rounding;
- bin-price monotonicity, and no panic for any bin id;
- `q64_mul` with no panic on two full u128 operands.

**Next-best evidence for exactly these properties:**
`fuzz/tests/exhaustive.rs` uses the same assertions and checks **every
combination** in small ranges, plus the fuzzing on the full range in §3.
Examples:

- CP swap: all r_in, r_out ≤ 48, input ≤ 300 and 11 fees, including > 100%
  (7.6 M cases);
- `mul_div`: all a, b, d ≤ 255, plus every combination of the u64 edge
  values;
- v2 swap: all reserves ≤ 24, input ≤ 60, every mode, direction, fee and
  share;
- bin deposit and withdraw: every state ≤ 15 and ≤ 40;
- `swap_bins`: every 3-bin state ≤ 7, amount ≤ 64, 4 steps and 4 fees
  (573 k successful swaps);
- bin prices: every id in ±400 for 5 steps, and no panic across ±2²⁰ and at
  the i32 extremes.

The suite takes under 2 s. Small ranges are where rounding bugs show up, but
this is still not a proof for large values.

## 6. What this guarantees, and what it does NOT

It **does** give strong evidence that:

- within the explored and proved ranges, the pool math rounds in the pool's
  favour, never pays out more than it holds, never lets k or the value of an
  LP share go down, and never lets a round trip or a first-depositor or
  donation trick extract value;
- no math function panics on any input that was tried or proved (two did,
  and both are fixed);
- on the real `.so`, random v2 sequences that include governance keep the
  vaults solvent and the model and chain in exact agreement.

It **does not**:

- **Prove there are no bugs.** Fuzzing only explores what it reaches. Kani
  proofs only cover the listed functions, within the listed bounds.
- **Check account validation, signer or owner checks, PDA seeds, or CPI
  safety.** Those are Anchor constraints in the handlers. The models skip
  them, and the LiteSVM run uses only well-formed accounts. That is what the
  security review and the TS attack tests are for.
- **Cover the oracle** (`oracle.rs`, the Pyth price checks, dynamic fee),
  Token-2022 extensions, or CP/DLMM swaps on chain (see §4).
- **Model compute-unit limits.** LiteSVM ran with a 1.4M CU budget.
- **Cover economic or MEV attacks** that need a real external market (oracle
  manipulation, sandwiching against other venues). The models only show
  that the pool itself cannot be drained by its own rounding or accounting.
- **Replace an independent audit.** SECURITY.md's mainnet checklist still
  applies.

### Observations (not bugs, worth knowing)

- **DLMM drain step.** The input charged is
  `floor(in_needed·10000/(10000−fee))`, so the fee can be up to 1 raw unit
  below nominal. The bin still receives at least `in_needed`, so its value
  never drops; proved and fuzzed.
- **Bin prices far below 1.0** run out of Q64.64 precision, so neighbouring
  bins can share a raw price. Swaps there convert to 0 and are refused.
- **`add_dlmm_liquidity` has no min-shares argument.** The fuzzer bounds a
  depositor's loss to rounding, about one share plus one unit per side.
- **v2 `fee_per_liquidity` (u128)** could overflow only after more than
  ~2⁶⁴·L raw units of LP fees have been paid into the pool. The checked add
  would then refuse swaps rather than corrupt state. This is not reachable in
  practice.

## 7. How to re-run

```bash
# per-PR regression (stable, ~2 min)
cargo test --release --manifest-path programs/swd_amm/fuzz/Cargo.toml -- --nocapture
SWD_FUZZ_CASES=200000 cargo test --release --manifest-path programs/swd_amm/fuzz/Cargo.toml   # longer

# libFuzzer (nightly)
cargo install cargo-fuzz
cd programs/swd_amm
cargo +nightly fuzz run --fuzz-dir fuzz -O -a v2_sequence -- -max_total_time=600 -max_len=4096
#   a crash → copy fuzz/artifacts/<target>/crash-* to fuzz/regressions/<target>/ with the fix

# on-chain sequences (needs the built program)
anchor build -p swd_amm
SWD_SVM_SEEDS=500 SWD_SVM_STEPS=200 cargo +nightly test --release \
  --manifest-path programs/swd_amm/litesvm/Cargo.toml -- --nocapture

# Kani
cargo install --locked kani-verifier && cargo kani setup
cd programs/swd_amm/kani && cargo kani                       # the 6 completing proofs (~6 min)
RUSTFLAGS="--cfg kani_slow" cargo kani --harness proofs::cp_swap_out_props_u16 --exact   # a SLOW one (hours?)
cargo kani --harness proofs::dlmm_amount_times_price_full_domain --exact   # one proof
cargo test --release --manifest-path ../fuzz/Cargo.toml --test exhaustive  # small-domain exhaustive checks
```

CI: `security.yml` runs the stable replay on every PR (job `amm-fuzz`) and
the LiteSVM run inside the `program` job, after `anchor build`.
`amm-formal.yml` runs libFuzzer (600 s per target) and every Kani proof,
manually and weekly. If a model constant drifts from the program,
`constants_match_program` fails.
