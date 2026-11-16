# Trust model and privileged roles

## Roles

| Role | Holder (planned, `docs/MAINNET_RUNBOOK.md` Gate 5) | Can | Cannot |
|---|---|---|---|
| **Upgrade authority** | Squads v4 vault (after handover) | Replace the program code (BPF upgradeable loader). This is the strongest power in the system; it can do anything the code could. | — (only Squads' M-of-N and its own time lock, if configured in Squads, constrain it) |
| **Governance authority** (`GlobalConfig.governance_authority`) | the same Squads vault, 2-of-3 members on hardware wallets | Instantly: enable/disable mints (`set_mint_policy`, including the explicit `trust_freeze_authority` decision for mints with a freeze authority, K-1), register Pyth feeds (`set_mint_feed`), pause/unpause **new pool creation**, propose / cancel timelocked actions, propose a new emergency key (no delay; the new key must accept), **create v2 pools** (on a `mainnet` build only governance can, K-5; elsewhere also while creation is paused). Through the timelock: propose a new governance key (the new key must sign `accept_authority`, K-3), unpause pools, change protocol fee share (≤ 20% of fees), timelock delay (24–48 h), treasury, a pool's impact cap / dynamic-fee switch, withdraw accrued **protocol** fees to the treasury. | Move LP reserves or unclaimed LP fees; change a pool's fee schedule, fee mode, oracle feeds or mints after creation; unpause instantly; bypass the 24 h minimum delay on a `mainnet` build; hand an authority to a key that does not sign the accept. |
| **Emergency authority** (`GlobalConfig.emergency_authority`) | one on-call person, hardware wallet, **not** a Squads member; must differ from governance | Instantly pause swap / deposit / withdraw (any combination) on any v2 pool, or on many pools in one transaction (`emergency_pause_v2_pools`); cancel a pending **unpause** action. | Unpause, change any parameter, cancel non-unpause actions, propose rotations, move funds. Governance can replace it without a delay (two-step). |
| **Treasury** (`GovernanceSettings.treasury`) | Squads vault (recommended) | Receives protocol fees via a matured `WithdrawV2ProtocolFees`. | Anything else; it has no signing role in the program. |
| **Pool creator** | `mainnet` build: the governance authority only (K-5). Devnet / localnet builds: anyone (unless creation is paused) | Choose the fee schedule, dynamic-fee params, collect mode, activation time (≤ 30 days ahead), impact cap, optional oracle guard (feeds must equal governance's `MintFeed`). Make the **first, price-setting deposit** (only the creator may). | Anything after creation that other LPs can't do. Creator is informational afterwards. |
| **Position owner** | any LP | Add / remove / claim / lock / transfer / close its own position. | Touch other positions; withdraw locked liquidity (ever). |
| **Executor** | anyone | Execute a matured timelocked action (permissionless, within 7 days). | Change what the action does or its target account. |
| **Deployer** | one-time key, retired after handover | Until handover: everything above (it is upgrade authority and initial governance). The upgrade authority moves at once; governance moves when the vault accepts the timelocked rotation (≥ 24 h later, K-9). | After the vault accepted: nothing. |

## Trusted external components

| Component | Trust assumption |
|---|---|
| Solana runtime, BPF upgradeable loader | Correct. `initialize_global_config` reads `ProgramData.upgrade_authority_address`. |
| Anchor 0.31.1 (`anchor-lang`, `anchor-spl`) | Account deserialisation, discriminators, `seeds`/`bump`, `address`, `token::*` and `init` constraints behave as documented. |
| SPL Token and Token-2022 programs | Correct; `transfer_checked` moves exactly `amount` for every mint the policy admits (transfer-fee mints are refused for v2). |
| Mint issuers | **Partially trusted.** Governance reviews each mint's mint authority and (Token-2022) extensions before `set_mint_policy`. A mint with a **freeze authority** is refused unless governance explicitly trusts its issuer (`trust_freeze_authority`, e.g. USDC / USDT); such a trusted issuer can still freeze a pool vault (KNOWN_ISSUES K-1). |
| Pyth receiver program (`rec5EKMG…`) and Pyth price publishers | Only for pools with the oracle guard on. Price accounts must be owned by the receiver and `Full`-verified; within the staleness window any posted update is accepted (K-2). |
| Squads v4 | The vault really enforces M-of-N. `verify_governance_multisig` lets anyone check the binding on-chain; the program itself only checks the vault's signature. |
| Off-chain: the web app, `scripts/governance.ts`, Jupiter crate | Not trusted for safety: every check that protects funds must be on-chain. |

## Centralisation summary (for users)

- Funds in a pool can only leave to the position owner (`remove_v2_liquidity`,
  `claim_v2_fees`), to a trader (`swap_v2`, priced by the curve), or — protocol
  fees only — to the treasury after a public 24 h+ timelock.
- Governance can **stop new pools**, and the emergency key can **freeze trading /
  deposits / withdrawals of an existing pool** indefinitely (unpausing needs the
  multisig plus 24 h). A malicious or lost emergency key can therefore grief
  but not steal; a compromised multisig can re-enable a policy for a bad mint
  (new pools only) and, through the **upgrade authority**, replace the code.
- The upgrade authority is the real trust anchor. The plan is to keep it on the
  Squads vault (optionally with a Squads time lock) — the program does not limit it.
