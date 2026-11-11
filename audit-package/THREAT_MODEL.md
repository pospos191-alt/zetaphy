# Threat model

## Assets

1. LP reserves and unclaimed LP fees in pool vaults (largest).
2. Accrued protocol fees (`protocol_fee_a/b`) in the same vaults.
3. Pool integrity: price, fee schedule, pause flags, liquidity accounting.
4. Governance state: `GlobalConfig`, `GovernanceSettings`, pending actions, mint policies, feed registry.
5. Availability of swaps, deposits and withdrawals.

## Adversaries and what we want you to try

| Adversary | Capabilities | Goals to test |
|---|---|---|
| **Anonymous trader / LP** (main threat) | Any instruction with any accounts; multiple instructions per transaction; any number of transactions per slot; flash-loaned capital from other venues; can create mints, token accounts and pools; can post genuine Pyth updates. | Drain or skew a pool via rounding, ordering, fake / substituted accounts (wrong vault, mint, token program, position, pool, Pyth account), re-initialisation, PDA collisions, first-deposit manipulation, donation tricks, fee-growth or settle bugs, overflow / panic, dynamic-fee or scheduler gaming, same-slot multi-swap, sandwiching beyond slippage limits, griefing (DoS of a pool or a user's position). |
| **Malicious pool creator** | Chooses all pool parameters. | Parameters that break invariants for later LPs (fees, activation, compounding mode, impact cap, oracle settings), first-deposit price games, pools that trap deposits. |
| **Malicious mint issuer** | Owns a mint that governance admitted. | Token-2022 extension tricks (close + re-create, hooks, delegates, transfer fees, default frozen state), freeze authority (K-1), decimals. |
| **Compromised emergency key** | Pause any pool; cancel pending unpauses. | Anything beyond griefing would be a finding. |
| **Compromised / careless governance** | Instant admin ops; timelocked ops after 24 h. | Any path from governance to LP funds; bypassing the timelock or its bounds; replaying / re-targeting a pending action; executing an expired or cancelled one. |
| **Front-runner at deploy** | Watches mempool / chain during deployment. | Take over `GlobalConfig` or settings before handover (A-1 fixed). |
| **Oracle-level adversary** | Selects among genuine Pyth updates; cannot forge signatures. | Bypass or abuse the deviation guard (K-2). |

## Out of the model

- Solana validator / consensus attacks, SPL Token or Token-2022 bugs, Squads or Pyth
  program bugs, Anchor framework bugs (please do tell us if you notice one).
- Social engineering of multisig members; key management off-chain (covered by the
  runbook, not the code).
- Market risk (impermanent loss, token price crashes).

## Highest-value review targets (our view)

1. Account validation in every `#[derive(Accounts)]` of swdmm_v2.rs / timelock.rs —
   especially `SwapV2` (optional Pyth accounts), `ModifyV2Liquidity`,
   `ExecuteWithdrawProtocolFees` (treasury token accounts) and `ExecuteV2PoolAction`.
2. `swdmm_math::swap` and the fee bookkeeping in `swap_v2` across the three
   collect modes, protocol share, compounding and `fee_per_liquidity` growth with
   locked liquidity.
3. Position `settle()` ordering in add / remove / lock / claim / close.
4. Timelock state machine (`take_ready`, `validate_action`, expiry, emergency cancel).
5. The hand-written Pyth reader and the deviation guard maths (`oracle.rs`).
6. Token-2022 admission (`check_mint_policy`, `assert_mint_extensions_safe`,
   `assert_no_transfer_fee`) and the effect of each *allowed* extension.
7. That `--features mainnet,v2-only` leaves no reachable CP / DLMM path.
