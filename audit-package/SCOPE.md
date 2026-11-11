# Audit scope — SWD AMM, mainnet build (`--features mainnet,v2-only`)

| | |
|---|---|
| Repository | https://github.com/pospos191-alt/zetaphy (public) |
| Program | `programs/swd_amm` (crate `swd_amm`), one Anchor program |
| **Frozen commit** | `________________________________________` *(filled in when the engagement is booked; the tag `audit-freeze-v1` will point at it)* |
| Toolchain | Anchor 0.31.1, Solana / Agave CLI 3.1.10 (its platform-tools for the SBF build), Rust stable for host tests |
| Build audited | `anchor build -- --features mainnet,v2-only` (what `scripts/deploy-mainnet.sh` deploys) |
| Program size | 806,640-byte `.so`, sha256 `e6e3921713380585…3c423651f` (local `anchor build -- --features mainnet,v2-only`, 2026-11-11, after the pre-audit hardening; the reproducible Docker `solana-verify build` hash is recorded at freeze) |
| Instructions | 23 (list: [INSTRUCTIONS.md](INSTRUCTIONS.md)) |
| **nSLOC in scope** | **2,600** |

nSLOC = non-blank, non-comment Rust lines, `#[cfg(test)]` modules excluded, items
compiled out by `v2-only` excluded. Reproduce with
`python3 audit-package/tools/nsloc.py --v2-only` (and without the flag for the full
program).

## Why "v2-only"

The program has three pool types. Only SWDMM v2 will run on mainnet, so the
constant-product (CP) and DLMM pool types are **compiled out** of the mainnet
binary by the Cargo feature `v2-only` (not just "unused"):

| | Full build (default) | Mainnet build (`mainnet,v2-only`) |
|---|---|---|
| nSLOC | 4,820 | **2,600** (−46%) |
| Instructions | 38 | 23 |
| Account types (IDL) | 13 | 8 |
| Events | 32 | 19 |
| `.so` size | 1,294,360 B | 806,640 B |
| Files compiled | 10 | 6 |

The feature removes `cp.rs`, `cp_math.rs`, `dlmm.rs`, `dlmm_math.rs` and, from the
shared files, the CP/DLMM pause / unpause / allowlist instructions, their account
structs and events. The `GovAction` enum and every `#[error_code]` enum are kept
identical in both builds (stable Borsh layout and error numbers); a `v2-only` build
refuses to *propose* `UnpauseCpPool` / `UnpauseDlmmPool` (`WrongActionKind`). CI
builds both feature sets and runs the v2 / governance / security suites against the
`v2-only` binary, and checks the `mainnet,v2-only` IDL has exactly 23 instructions
(`.github/workflows/security.yml`, job `program`; `tests/v2-only.ts`).

## Files in scope

| File | nSLOC | Contents |
|---|---|---|
| `programs/swd_amm/src/swdmm_v2.rs` | 983 | SWDMM v2 pools: `SwdmmV2Pool` / `SwdmmV2Position` state, 10 instruction handlers, account validation, token CPIs (`transfer_checked`, PDA-signed outflows), mint-policy check, transfer-fee refusal, governance-only creation on `mainnet` (`check_v2_creator`) |
| `programs/swd_amm/src/timelock.rs` | 517 | `GovernanceSettings`, `PendingAction` / `GovAction` (propose → delay → permissionless execute within 7 days; cancel; emergency cancel of unpauses), two-step authority rotation (`accept_authority`), protocol-fee withdrawal, `MintPolicy` (`set_mint_policy`, freeze-authority trust), 24–48 h bound under `mainnet` |
| `programs/swd_amm/src/swdmm_math.rs` | 387 | Pure integer math (no Anchor): mul-div floor/ceil, isqrt, Q64.64 price, fee schedulers (time / market cap, linear / exponential), dynamic (volatility) fee, swap with three fee-collection modes and protocol share, deposit / withdraw quotes, fee growth, pending fee, impact caps |
| `programs/swd_amm/src/oracle.rs` | 280 | Hand-written Pyth `PriceUpdateV2` account type (owner, discriminator, Borsh layout), staleness / confidence / verification checks, oracle price in Q64.64, deviation guard (optional for v2 pools) |
| `programs/swd_amm/src/governance.rs` | 231 | `GlobalConfig` (governance + emergency authority, pool-creation pause), `initialize_global_config` (upgrade-authority gated), `set_mint_feed` / `MintFeed`, `verify_governance_multisig` (Squads v4 account parsing at fixed offsets) |
| `programs/swd_amm/src/lib.rs` | 202 | `#[program]` entry points (thin wrappers), `SwdAmmError`, Token-2022 extension gate `assert_mint_extensions_safe`, freeze checks `assert_freeze_authority_trusted` / `assert_vault_not_frozen`, embedded `security.txt`, `declare_id!` |
| **Total** | **2,600** | |

Also in scope (small, configuration):

- `programs/swd_amm/Cargo.toml` — features (`mainnet`, `v2-only`), dependency pins; `Cargo.lock`.
- The **feature gating itself**: that `--features mainnet,v2-only` really removes every CP/DLMM path and leaves nothing that still depends on removed state.

### Functions and types in scope

- **lib.rs** — entry points: `initialize_global_config`, `accept_authority`, `set_pool_creation_paused`, `set_mint_feed`, `verify_governance_multisig`, `initialize_governance_settings`, `propose_gov_action`, `cancel_gov_action`, `emergency_cancel_unpause`, `execute_v2_pool_action`, `execute_settings_action`, `execute_withdraw_protocol_fees`, `set_mint_policy`, `initialize_v2_pool`, `create_v2_position`, `add_v2_liquidity`, `remove_v2_liquidity`, `claim_v2_fees`, `lock_v2_liquidity`, `transfer_v2_position`, `close_v2_position`, `swap_v2`, `emergency_pause_v2_pool`; helpers `assert_mint_extensions_safe`, `assert_freeze_authority_trusted`, `assert_vault_not_frozen`; `SwdAmmError`.
- **governance.rs** — `initialize_global_config`, `creation_allowed`, `set_pool_creation_paused`, `set_mint_feed`, `verify_governance_multisig`, `read_squads_multisig_summary`, `derive_squads_vault_pda`; accounts `InitializeGlobalConfig`, `GovernanceOnly`, `SetMintFeed`, `VerifyGovernanceMultisig`; state `GlobalConfig`, `MintFeed`; `GovernanceError`.
- **timelock.rs** — `initialize_governance_settings`, `propose_action`, `cancel_action`, `emergency_cancel_unpause`, `take_ready`, `execute_v2_pool_action`, `execute_settings_action`, `execute_withdraw_protocol_fees`, `accept_authority`, `set_mint_policy`, `check_execution_window`, `check_authority_change`, `action_delay`, `validate_delay`, `validate_action`, `is_mainnet_build`; accounts `InitializeGovernanceSettings`, `ProposeAction`, `CancelAction`, `EmergencyCancelUnpause`, `ExecuteV2PoolAction`, `ExecuteSettingsAction`, `ExecuteWithdrawProtocolFees`, `AcceptAuthority`, `SetMintPolicy`; state `GovernanceSettings`, `GovAction`, `PendingAction`, `MintPolicy`; `TimelockError`.
- **oracle.rs** — `PriceUpdateV2` (`Owner`, `Discriminator`, `AccountSerialize`, `AccountDeserialize`, `get_price_no_older_than`), `validate_oracle_params`, `oracle_price_q64`, `deviation_bps`, `dynamic_fee_bps`, `confidence_ok`, `guard_allows`, `OracleFeeResult::enforce_guard`, `evaluate_oracle_and_fee`; `OracleError`.
- **swdmm_v2.rs** — `initialize_v2_pool`, `v2_position_index`, `create_v2_position`, `add_v2_liquidity`, `remove_v2_liquidity`, `claim_v2_fees`, `lock_v2_liquidity`, `transfer_v2_position`, `close_v2_position`, `swap_v2`, `emergency_pause_v2_pool`, `withdraw_protocol_fees`, `check_v2_creator`, `check_mint_policy`, `assert_no_transfer_fee`, `transfer_in`, `transfer_out`, `SwdmmV2Pool::{signer_seeds, vol_state, set_vol_state, current_base_fee_bps}`, `SwdmmV2Position::settle`; 8 Accounts structs; `SwdmmV2Error`.
- **swdmm_math.rs** — every `pub fn` (27 functions, listed in the file).

## Out of scope

| Path | Why |
|---|---|
| `programs/swd_amm/src/cp.rs`, `cp_math.rs`, `dlmm.rs`, `dlmm_math.rs` | Compiled out of the mainnet binary (`v2-only`). Not deployed. |
| `#[cfg(test)]` modules, `programs/swd_amm/tests/`, `fuzz/`, `kani/`, `litesvm/`, `tests/*.ts` | Test code (useful as evidence and harnesses, not audited). |
| `integrations/jupiter-amm-swd/` | Off-chain Jupiter quoting crate. **Optional add-on** item (quote vs. execution parity), see [QUESTIONS.md](QUESTIONS.md) Q1. |
| `scripts/` (`deploy-mainnet.sh`, `governance.ts`, `verified-build.sh`, …) | Operational tooling; reviewing the deploy/handover order is welcome as an optional item. |
| `test-ui/`, `integrations/` (other), `zetaphy-*` directories, `cloudflare/`, `deploy/` | Other products in the same repository (web app, EVM chain, wallets). Unrelated to the Solana program. |
| Anchor, SPL Token / Token-2022, Squads v4, Pyth receiver programs | Third-party programs, trusted (see [TRUST_MODEL.md](TRUST_MODEL.md)). |
| Economic design (fee levels, market-cap scheduler parameters) | In scope only where it creates an exploit, not as tokenomics advice. |

## Reading order

1. [ARCHITECTURE.md](ARCHITECTURE.md) — accounts, PDAs, flows (diagrams)
2. [TRUST_MODEL.md](TRUST_MODEL.md) — roles and what each can do
3. [INVARIANTS.md](INVARIANTS.md) — what must always hold, with evidence
4. [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — please do not re-report these (but do tell us if we under-rated one)
5. [THREAT_MODEL.md](THREAT_MODEL.md), [PRIOR_FINDINGS.md](PRIOR_FINDINGS.md), [QUESTIONS.md](QUESTIONS.md)
6. Reference: [INSTRUCTIONS.md](INSTRUCTIONS.md), [ERROR_CODES.md](ERROR_CODES.md), `docs/SWDMM_V2.md` (product spec), `docs/FUZZING_FORMAL.md`
