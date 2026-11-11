# Questions for the auditors

Answers to these are as valuable to us as findings. Please mark which ones are
inside the quoted scope.

## Design

**Q1 — Aggregator routing (Jupiter).** `SwapV2` requires both `trader_token_a` and
`trader_token_b` to have `token::authority = trader` (the signer), for the source and
the **destination**. Our Jupiter integration crate (`integrations/jupiter-amm-swd`,
README item 2) assumes Jupiter's router passes a user-owned destination. If an
aggregator routes the output to an account owned by someone else (an intermediate
or program-owned account), the swap fails. Should we drop the authority constraint
on the **output** account only (keeping `token::mint` and the pool's token program)?
Does that open any attack (e.g. paying out to an attacker-chosen account is fine
because the signer chose it — or are there CPI/ownership subtleties)? Optional
add-on: check `integrations/jupiter-amm-swd/src/quote.rs` matches `swap_v2` exactly
(quote vs. execution mismatch).

**Q2 — Authority rotation.** *Changed before the audit (PRIOR_FINDINGS H-2):* rotation
is now propose → `accept_authority` signed by the new key; governance rotation is
timelocked, emergency rotation is not (the emergency key can only grief, and a
compromised one must be replaceable fast). Is that split right, and is the stale-proposal
rule (proposer must still be governance at accept) sufficient?

**Q3 — Instant admin operations.** Is it acceptable that `set_mint_policy`,
`set_mint_feed` and `set_pool_creation_paused` are instant (K-4), given they only
affect new pools?

**Q4 — Pyth.** Is the hand-written `PriceUpdateV2` reader (owner, discriminator,
layout, `Full` verification, staleness with future `publish_time` treated as age 0,
2% confidence cap) sound? Are Pyth push-oracle sponsored feed accounts
(`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` PDAs) owned by the receiver program
`rec5EKMG…` as our owner check assumes? Would you bound the staleness window lower
than 3,600 s on-chain (K-2)?

**Q5 — Token-2022.** Which *allowed* extensions (not on the block list) could still
break v2 accounting or liveness — e.g. `DefaultAccountState`, `InterestBearingConfig`,
`MemoTransfer` on the user's account, `CpiGuard`, `GroupPointer`? Should the gate be an
allow-list instead of a block-list?

**Q6 — Freeze authority.** *Changed before the audit (H-1):* mints with a freeze
authority need `trust_freeze_authority`, checked once at `set_mint_policy` (we argue the
property cannot change afterwards — see `assert_freeze_authority_trusted`), and pools
refuse born-frozen vaults. Does the "checked once" argument hold for both token programs?

**Q7 — Fee-tier squatting.** *Changed before the audit (H-3):* v2 pool creation is
governance-only on `mainnet` builds. Anything left that a non-governance actor can fix
for good about a pool?

**Q8 — Dynamic fee and market-cap scheduler.** Can either be gamed beyond what K-6
and K-7 describe (e.g. combining the per-slot impact reference with the volatility
reference across slots)?

## Implementation

**Q9 — Feature gating.** Please confirm that `--features mainnet,v2-only` leaves no
reachable CP / DLMM code path, no dangling account type, and that keeping the full
`GovAction` enum (with CP / DLMM variants refused at proposal) is safe.

**Q10 — State written before CPIs.** `swap_v2` and `remove_v2_liquidity` update
reserves before the `transfer_checked` CPIs (atomic transaction, no re-entrancy into
our program through SPL Token). Any concern with Token-2022 extensions admitted by the
policy?

**Q11 — Compute budget.** Is the worst-case `swap_v2` (oracle on, dynamic fee on,
exponential scheduler) within the default 200 k CU (K-17)?

**Q12 — Rounding.** With locked liquidity, compounding mode and protocol share, can
any sequence make `Σ pending fees` exceed what the vault holds (I-1, I-5)?

**Q13 — Upgrade path.** We will deploy upgradeable (Squads vault). Anything in the
account layouts (`_reserved` bytes, `impact_*` fields carved from reserved space)
that would make a future migration unsafe?

## Engagement

- Is a **fix review** included, and how many rounds?
- Can the final report be **public** (linked from security.txt, our site, DefiLlama,
  Jupiter)?
- Will you sign off on a specific **verified-build hash** (`solana-verify`) of the
  frozen commit?
