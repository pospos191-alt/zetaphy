# Invariants and the evidence behind each

Legend for evidence: **U** = Rust unit test (`cargo test -p swd_amm`), **P** =
proptest (`programs/swd_amm/tests/proptest_math.rs`, 20,000 cases each), **F** =
libFuzzer / seeded model fuzzing (`programs/swd_amm/fuzz`, target `v2_sequence` or
`math_units`), **E** = exhaustive small-domain check (`fuzz/tests/exhaustive.rs`),
**K** = Kani proof (`programs/swd_amm/kani`), **S** = stateful differential fuzz of the
built `.so` in LiteSVM (`programs/swd_amm/litesvm/tests/v2_stateful.rs`), **T** =
TypeScript localnet test (`tests/*.ts`). Details and run budgets:
`docs/FUZZING_FORMAL.md`.

> Evidence is evidence, not proof. Fuzzing and the LiteSVM run use well-formed
> accounts only; account validation, signer checks, PDA derivation and CPI safety are
> covered only by the TS attack tests and code review. That is where we most want the
> audit's attention.

## Solvency and value

| # | Invariant | Evidence |
|---|---|---|
| I-1 | Per token: `vault.amount >= reserve + protocol_fee + Σ unclaimed LP fees of all positions` after every instruction (donations only add surplus). | F (`v2_sequence`, after every step), S (from on-chain accounts, every tx), T (`swdmm_v2.ts`) |
| I-2 | `k = reserve_a · reserve_b` never decreases across a swap, in every fee-collection mode. | P (`swap_invariants`), U (`swap_matches_constant_product_and_never_loses_k`), F, E, S |
| I-3 | `k / L²` (value per liquidity unit) never decreases on any operation. | F (`v2_sequence`) |
| I-4 | Deposit followed by withdraw of the same liquidity never returns more than was paid; a swap round trip A→B→A never profits. | P (`deposit_withdraw_never_profits`), U, F, E, S |
| I-5 | Σ claimable fees over all positions ≤ fees collected; `fee_per_liquidity_*` is monotone; settling never overflows silently. | P (`fees_never_overpaid`), U (`fee_growth_distributes_without_overpaying`), F, K (`v2_pending_fee_no_panic_full_domain`) |
| I-6 | Token conservation: across actors, vaults and treasury no token is created or destroyed by the program. | S |
| I-7 | Rounding: user outputs round down, user inputs and fees round up (`mul_div_floor` / `mul_div_ceil`, `fee_amount`). | F (`math_units`, 512-bit reference), E, K (`v2_isqrt_exact_u12`) |

## Liquidity and positions

| # | Invariant | Evidence |
|---|---|---|
| I-8 | `pool.liquidity == Σ position.(liquidity + locked_liquidity) + MINIMUM_LIQUIDITY`. | F, S (differential: every pool and position field equals the model's) |
| I-9 | Locked liquidity (the dead `MINIMUM_LIQUIDITY` share and `lock_v2_liquidity`) can never be withdrawn; locked liquidity keeps earning fees. | T (`swdmm_v2.ts` "permanent lock"), F, S |
| I-10 | Only the pool creator can make the first, price-setting deposit. | T (`swdmm_v2.ts` "only the creator can make the first deposit") |
| I-11 | Every owner-gated instruction checks `position.owner == signer` and `position.pool == pool`; position seeds are `[pool, index]` with `index` bound to the owner at creation. | Code (`ModifyV2Liquidity`, `LockV2Liquidity`, `OwnV2Position`, `CloseV2Position`), T ("ownership can be transferred; the old owner loses control") |
| I-12 | A position can only be closed when it holds no liquidity, no locked liquidity and no pending fees. | Code (`close_v2_position`), T |
| I-13 | Liveness: at any time every position can withdraw its unlocked liquidity and claim its fees (unless paused). | F, S (checked at the end of every run) |

## Fees and limits

| # | Invariant | Evidence |
|---|---|---|
| I-14 | Scheduled base fee stays within `[floor, cliff]`, is non-increasing over time / market cap, and total fee (base + dynamic) ≤ 99%. | P (`scheduler_monotone_and_bounded`), U, K (`v2_total_fee_capped`) |
| I-15 | A swap's price impact ≤ `max_price_impact_bps` (≤ 50%), and the cumulative impact of all swaps in one slot ≤ the same cap. | U (`price_impact`), F, T ("enforces slippage and the price-impact cap") |
| I-16 | Protocol fee share ≤ 20% of the fee; protocol fees leave the vault only to the treasury through a matured `WithdrawV2ProtocolFees`. | Code (`MAX_PROTOCOL_FEE_SHARE_BPS`, `execute_withdraw_protocol_fees`), F, S, T |

## Governance

| # | Invariant | Evidence |
|---|---|---|
| I-17 | A timelocked action executes at most once, only when `execute_after ≤ now ≤ execute_after + 7 days`, and only against the account named in the action. | U (`attack_stale_timelock_action_expires`), S (9,300 executed actions), T (`swdmm_v2.ts` governance tests, `security-review.ts` F-2) |
| I-18 | On a `mainnet` build the timelock delay is always within 24 h–48 h (init and `SetTimelockDelay`). | Code (`validate_delay`), T (`v2-only.ts` with `SWD_MAINNET_BUILD=1`: a 5 s delay is refused) |
| I-19 | Only the upgrade authority can initialise `GlobalConfig`; neither authority can ever be the default key; governance ≠ emergency (at init, and at propose **and** accept of every rotation). | U (`attack_authority_rotation_bad_keys`), T (`governance.ts`, `security-review.ts` F-4) |
| I-20 | The emergency authority can pause and cancel pending unpauses, and nothing else. | T (`swdmm_v2.ts`, `security-review.ts` F-2, `v2-only.ts`) |
| I-21 | A `v2-only` binary contains no CP / DLMM instruction (IDL and dispatcher) and refuses to propose CP / DLMM unpauses. | T (`v2-only.ts`), CI IDL check |
| I-24 | An authority changes only through `accept_authority`, signed by the new key named in a matured `SetGovernanceAuthority` / `SetEmergencyAuthority` action proposed by the **current** governance; a governance rotation waits for the timelock (24–48 h on `mainnet`), an emergency rotation does not; no `execute_*` instruction can apply a rotation. | U (`authority_rotation_delays`, `gov_action_layout_is_backward_compatible`), T (`security-review.ts` K-3 ×4, `v2-only.ts` K-3 incl. `mainnet` build, `z-squads-live-verification.ts`: a real Squads vault accepts) |
| I-25 | On a `mainnet` build only the governance authority can create a SWDMM v2 pool. | U (`attack_v2_pool_squatting_mainnet_is_governance_only`), T (`v2-only.ts` K-5 with `SWD_MAINNET_BUILD=1`) |

## Token admission

| # | Invariant | Evidence |
|---|---|---|
| I-22 | A v2 pool can only be created for two different mints that each have an enabled `MintPolicy` pinned to the mint's actual token program. | Code (`check_mint_policy`), T ("mint policy" cases) |
| I-23 | A Token-2022 mint needs `token_2022_reviewed` and must not carry TransferHook, PermanentDelegate, ConfidentialTransferMint, NonTransferable, MintCloseAuthority, TransferFeeConfig, or any extension type this build does not know (fail closed). | U (`extension_gate_*`, `attack_extension_gate_refuses_mint_close_authority`), T (`security-review.ts` F-1) |
| I-26 | A mint with a freeze authority can only be enabled (`MintPolicy`, and `AllowedMint` in the full build) with an explicit `trust_freeze_authority`; no pool is created with a vault that is already frozen. | U (`attack_freeze_authority_needs_explicit_trust`, `attack_frozen_vault_refuses_pool`), T (`security-review.ts` K-1 ×2) |

## How to re-check everything

```bash
bash audit-package/tools/verify-all.sh          # see AUDIT_README.md for what it runs
```
