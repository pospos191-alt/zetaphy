# jupiter-amm-swd

Jupiter routing SDK for **SWD AMM** — an implementation of
[`jupiter-amm-interface`](https://crates.io/crates/jupiter-amm-interface) **0.6.1**
(`Amm` trait) for the `SwdmmV2Pool` accounts of the `swd_amm` Solana program
(`programs/swd_amm` in this repository). Thai version: [README.th.md](README.th.md).

Status: the program is **not on mainnet and not audited**. This crate is ready
for Jupiter's review once both are true.

## What it covers

| | |
|---|---|
| Pool type | SWDMM v2 (`SwdmmV2Pool`): full-range constant product, scheduled base fee (fixed / time / market-cap, linear or exponential), optional volatility fee, three fee-collection modes, activation time, per-swap and per-slot price-impact caps, optional Pyth guard |
| Not covered | legacy constant-product `Pool` (mandatory oracle) and DLMM pools |
| Swap modes | ExactIn only (the program has no exact-out instruction) |
| Accounts to update | pool, `GovernanceSettings` PDA (`["gov_settings"]`); plus both Pyth price-feed accounts and both mints when the pool's oracle guard is on |
| Swap accounts | 13, in `SwapV2` order (see `get_swap_and_account_metas`) |
| Instruction | `swap_v2(amount_in u64, min_amount_out u64, a_to_b bool)`, Anchor discriminator `[43,4,237,11,26,201,30,98]`; `swap_v2_ix_data()` builds it |
| Program id | taken from the pool account's owner (`SWD_AMM_PROGRAM_ID` is the devnet id until mainnet) |

### How the quote stays exact

- `src/swdmm_math.rs` is not a copy: it is the program's own
  `programs/swd_amm/src/swdmm_math.rs`, compiled in with `#[path]`.
- `src/quote.rs` replays `swap_v2` in the same order (pause, activation,
  per-slot reference, oracle, base fee, volatility fee, `swdmm_math::swap`,
  impact cap, per-slot cap, oracle guard). The four oracle helpers are small
  ports of `oracle.rs` (which needs Anchor).
- `src/state.rs` decodes the Anchor accounts by hand (no Anchor dependency at
  runtime).

## Tests

```bash
cd integrations/jupiter-amm-swd
cargo test
```

| Suite | What it proves |
|---|---|
| `tests/quote_fixtures.rs` (14) | hand-computed quotes for all fee modes and directions; dust rounding; zero / empty / paused / not-yet-active pools; price-impact and per-slot caps; time scheduler; dynamic fee; Pyth guard (fresh, stale, partial verification, moving toward/away from the oracle); account-meta order; instruction data equals the program's own `instruction::SwapV2` |
| `tests/program_parity.rs` (5) | links the program crate (`no-entrypoint`): the decoders read the program's own Anchor serialisation field by field; base-fee scheduler = `SwdmmV2Pool::current_base_fee_bps` (20k random configs); oracle helpers = the program's (20k cases); quote = program math (30k random pools) |
| `tests/onchain_svm.rs` (1) | runs the **built** `target/deploy/swd_amm.so` in LiteSVM: 400 random pools, `swap_v2` sent with this crate's account metas; output amount and post-swap reserves equal the quote in every successful case, and the chain rejects exactly the swaps the quote rejects. Skipped when the .so is missing (`anchor build` at the repo root first, or `SWD_AMM_SO=…`) |
| `swdmm_math` unit tests (11) | the program's own tests, run again in this build |

Last run (2026-11-08, rustc 1.97, Anchor 0.31.1 build): 31 passed; on-chain
parity 339 swaps matched exactly, 61 rejected by both.

`Cargo.lock` is committed: it keeps `jupiter-amm-interface`'s open `>=2`
Solana requirements on the 2.x crates (same line as Anchor 0.31.1) —
`solana-account-decoder` 4.x needs a newer rustc.

## Open items for Jupiter

1. **`Swap` variant.** `jupiter-amm-interface` has no variant for SWD AMM;
   Jupiter adds one, and the CPI encoding, in its router. Until then
   `get_swap_and_account_metas` returns the placeholder `PLACEHOLDER_SWAP`
   (`Swap::TokenSwap`). Nothing else changes.
2. **Trader = token-account authority.** `SwapV2` requires
   `trader_token_a/b` to be owned by the signer (`token_transfer_authority`),
   for both the source and the destination account. If Jupiter's router uses
   a destination account owned by someone else, the program needs a change
   (e.g. drop the `token::authority` constraint on the output account).
3. **Pyth feed accounts.** Pools with the oracle guard on use the Pyth
   push-oracle sponsored feeds (PDA of `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`,
   seeds `[shard 0 u16 LE, feed_id]`). Derivation taken from
   pyth-solana-receiver-sdk; re-check before mainnet. Pools without the
   guard (the default for memecoins) need no oracle accounts.
4. **Interface 1.0.** `jupiter-amm-interface 1.0.0-beta.0` (April 2026)
   moves to the Solana 3.x crates, makes `get_accounts_len` required (already
   implemented here) and adds `get_rewards`. Porting is a dependency bump.
5. A markets endpoint listing pools (Jupiter asks DEXes for one so new pools
   are picked up automatically) is not built yet; pools can be found with
   `getProgramAccounts` on the program with a memcmp on the `SwdmmV2Pool`
   discriminator `3c6f01cf3a1e13d7` (base58 `B7HM5JaZuSn`).

## Jupiter's onboarding requirements (research, 2026-11-08 — not verified with Jupiter)

From Jupiter's public DEX-integration docs (dev.jup.ag / station.jup.ag /
hub.jup.ag "DEX Integration"; pages vary in age, the docs site could not be
fetched directly from the build environment):

- An open-source SDK implementing the Jupiter AMM interface (Rust) — this crate.
- Security: the program should be audited (a DEX not built on the audited SPL
  token-swap program is expected to have its own audit); Jupiter also runs
  "security and code health" checks.
- Traction: Jupiter looks at traction, team and backers before integrating.
- Liquidity: each market needs a minimum liquidity to be routed — **$500 per
  market** was the figure stated "as of 1 January 2025"; may have changed.
- Integration is free; contact is through Jupiter's Discord / the form
  linked from the docs (check the current page).

Sources: [dev.jup.ag DEX integration](https://dev.jup.ag/docs/routing/dex-integration),
[station.jup.ag DEX integration](https://station.jup.ag/docs/dex-integration),
[integration guidelines](https://station.jup.ag/docs/projects-and-dexes/integration-guidelines),
[hub.jup.ag](https://hub.jup.ag/docs/dex-integration).
