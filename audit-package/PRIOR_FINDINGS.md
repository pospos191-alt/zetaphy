# Prior internal findings and their fixes

All of these came from **internal** work (the team plus AI-assisted review, attack
tests and fuzzing). None of it is an independent audit. Each fix has a regression
test that fails on the old code.

## 1. Security review, 2026-11-10 (PR #142, commit `2f68b63`)

Attack tests: `tests/security-review.ts` (F-1..F-5) and `lib.rs` `tests::attack_*`.
The review numbered six changes F-1..F-6; the repository does not keep the review
text itself, so the mapping below is reconstructed from the commit and the tests.

| ID | Finding | Fix | In mainnet build? |
|---|---|---|---|
| F-1 | **Token-2022 `MintCloseAuthority`.** A mint with supply 0 could be closed and re-created at the same address with a `PermanentDelegate` / `TransferHook` after passing the one-time extension gate (policy or pool creation), letting the delegate drain vaults. | `assert_mint_extensions_safe` refuses `MintCloseAuthority`; unknown extension types fail closed (now tested). | Yes |
| F-2 | **Stale unpause proposals.** Execution is permissionless and actions never expired, so a matured, forgotten `Unpause*` could be executed seconds after a *new* emergency pause, undoing it mid-incident. | Actions expire 7 days after `execute_after` (`EXECUTION_GRACE_SECS`, `ActionExpired`); new `emergency_cancel_unpause` lets the emergency key cancel pending unpauses (only those). | Yes |
| F-3 | **Pool squatting while creation is paused.** Governance itself was blocked by the pause, so "pause, then create the canonical pools" (runbook Gate 8) was impossible. | `creation_allowed`: governance may create pools while creation is paused. | Yes |
| F-4 | **Bricking governance with the default key.** `set_authorities` / `initialize_global_config` accepted `Pubkey::default()` (no private key). | Both refuse the default key (`InvalidAuthority`). | Yes |
| F-5 | **CP slippage vs. transfer-fee mints.** CP `swap` / `remove_liquidity` checked `min_out` against the amount sent, not the amount the user received after a Token-2022 transfer fee. | Checked against the received amount. | No (CP compiled out; v2 refuses transfer-fee mints) |
| F-6 | **Dead code.** A never-compiled `src/lib-1.rs` sat next to the program source (audit confusion). | Removed. | — |

## 2. Fuzzing and formal work, 2026-11-10 (PR #151, commit `2674781`)

Details: `docs/FUZZING_FORMAL.md`.

| ID | Bug | Fix | In mainnet build? |
|---|---|---|---|
| FZ-1 | `swdmm_math::isqrt(2)` returned 2 (Newton start value `v/2+1 == v` for v = 2). Latent: `initial_liquidity` needs sqrt > 1000. | Fixed; regression `isqrt_small_and_near_squares_exact`; Kani `v2_isqrt_exact_u12`. | Yes (fixed) |
| FZ-2 | `dlmm_math::bin_price_q64(i32::MIN, _)` panicked (`(-bin_id) as u32` overflow); reachable from `initialize_dlmm_pool`. A panic reverts, no funds at risk. | `unsigned_abs()`; regression `bin_price_extreme_ids_do_not_panic`. | No (DLMM compiled out) |

## 3. Attack suite and hardening, 2026-10-07 / 10-08 (commits `aac55ec`, `2482ca2`, `368cba2`, `93732d1`)

An attack suite (`security/attack-tests`, solana-program-test, 47 attack tests) ran
against the real program. It now lives in the team's **private** repository; we can
share it with the auditor on request.

| ID | Finding | Fix | In mainnet build? |
|---|---|---|---|
| A-1 | **Deploy front-run of `initialize_global_config`.** Anyone could initialise governance first. | Payer must be the program's upgrade authority (`ProgramData` check). | Yes |
| A-2 | **Oracle guard checked only the pre-trade price**, then (first fix) froze pools pushed out of the band. | Guard on the post-trade price; a swap that moves the price back toward the oracle is always allowed (`guard_allows`). | Yes (v2 optional guard) |
| A-3 | **`PriceUpdateV2` deserialisation skipped the discriminator** (trait default `try_deserialize`); any receiver-owned account type could be passed. | Discriminator + length checked. | Yes |
| A-4 | **v2 fee claims ignored `withdraw_paused`.** | Claims stop when withdrawals are paused. | Yes |
| A-5 | **v2 position-index griefing.** Index = `position_count`, so anyone could take an honest user's next index. | Index = `sha256("swdmm_v2_position_index" ‖ owner ‖ nonce)[..8]`. | Yes |
| A-6 | **v2 price-impact cap was per instruction**; several swaps in one tx/slot were unbounded. | Per-slot reference price and cumulative cap. | Yes |
| A-7 | **Oracle confidence not checked.** | `conf` > 2% of price refused (`PriceConfidenceTooWide`). | Yes |
| A-8 | **Pool tied to an arbitrary Pyth feed** (feed ids only checked to differ). | Governance `set_mint_feed` registry; oracle-guarded pools must use the registered feeds. | Yes |
| A-9 | **Enabling the dynamic fee via `SetV2PoolParams` skipped validation** (e.g. `max_dynamic_fee_bps = 65535`). | `can_enable_dynamic_fee` + volatility state reset. | Yes |
| A-10 | **Error codes collided** (four enums at 6000). | Offsets 6000 / 6100 / 6200 / 6300 / 8000 / 8500. | Yes |
| A-11 | CP payout rounded up (dust swaps drained LPs); DLMM active-bin deposit and edge-bin DoS. | Fixed. | No (CP / DLMM compiled out) |

## 4. This audit-prep pass, 2026-11-11 (branch `claude/audit-ready`)

No behaviour change in the default build (IDL identical apart from doc strings).

- `v2-only` feature; CP handlers moved verbatim into `cp.rs` so the feature can drop
  whole files.
- Clippy: `abs_diff` instead of manual absolute difference (`swdmm_math::price_change_bps`,
  `oracle::deviation_bps`; identical semantics, fuzz + Kani re-run), `&InterfaceAccount`
  instead of `&Box<InterfaceAccount>` in `withdraw_protocol_fees`.
- Module doc comments rewritten where they contradicted the code (governance.rs said
  unpause was instant and there was no oracle / Token-2022 support; oracle.rs said every
  pool must have an oracle).
