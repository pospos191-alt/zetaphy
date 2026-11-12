# SWDMM v2 — Mainnet Runbook

This is the ordered checklist for taking swd-amm (constant-product, DLMM and
SWDMM v2 pools) to mainnet. Every gate must be ticked, in order, by the
people named in each step. Nothing here is automated on purpose: the CI
workflow never deploys to mainnet.

Status on 2026-09-29: gates 1–3 are done for the code in this repository
(Gate 3 extended on 2026-11-11 with the freeze-authority check);
gates 4–9 are not started. Gate 10 (DeFi listings) is prepared, not started.

## Gate 1 — Tests (done, keep green)

- `cargo test -p swd_amm` — unit tests plus the proptest property suite
  (`programs/swd_amm/tests/proptest_math.rs`, 4 invariants × 20,000 cases).
- `anchor test` — full localnet suite (46 tests, including
  `tests/swdmm_v2.ts` and the live Squads clone tests).
- `test-ui/tests/smoke.mjs` — page smoke test.
- CI runs all three plus `cargo audit` on every push.

## Gate 2 — Dependency review (done, repeat before release)

- `cargo audit`: 0 vulnerabilities; 3 advisory warnings on transitive
  Solana/Anchor crates (bincode and libsecp256k1 unmaintained, a rand
  soundness note). None is reachable from program logic; re-check on the
  release commit.
- Pin the toolchain used for the audited build (Anchor 0.31.1, Solana
  3.1.10, Rust stable of the audit date) and record `sha256sum
  target/deploy/swd_amm.so` of the audited build.

## Gate 3 — Token-2022 policy (done)

- SWDMM v2 pools only accept mints that governance enabled with
  `set_mint_policy`. A Token-2022 mint additionally needs the explicit
  `token_2022_reviewed` flag, passes the extension gate
  (`assert_mint_extensions_safe`: no TransferHook, PermanentDelegate,
  ConfidentialTransfer, NonTransferable, MintCloseAuthority, and no
  extension type this build does not know) and must not carry a
  TransferFeeConfig (SWDMM v2 books nominal amounts).
- Freeze authority (2026-11-11, KNOWN_ISSUES K-1): a frozen vault makes
  every withdrawal of that pool fail (both sides). `set_mint_policy`
  refuses a mint that has a freeze authority (`FreezeAuthorityNotTrusted`)
  unless governance passes `trust_freeze_authority` (`yarn governance
  set-mint-policy <mint> true trust-freeze`) — only for issuers governance
  trusts (Gate 8). Pool creation also refuses a vault that is born frozen
  (Token-2022 `DefaultAccountState = Frozen`, `VaultFrozen`).
- Negative tests: `tests/swdmm_v2.ts` ("mint policy" cases) and
  `tests/swd_amm.ts` (Token-2022 extension cases).

## Gate 4 — Independent audit (NOT started)

- Hand the audit package (`AUDIT_README.md`, `audit-package/`) to at least
  one independent Solana auditor; RFP emails and the firm list are in
  `audit-package/rfp/`, the owner's Thai guide in `audit-package/README.th.md`.
  Scope = the `mainnet,v2-only` build (~2.5k nSLOC).
- Fix every critical/high finding, re-run gates 1–3, get the fixes
  re-reviewed, and publish the report.
- Freeze the audited commit hash here: `________`.

## Gate 5 — Fresh keys (NOT started)

Do not reuse any key that has touched devnet, CI secrets, a WSL file or a
browser wallet used for testing (in particular not 3sny8… and not the
devnet deployer secret).

| Role | Holder | Storage |
|---|---|---|
| Squads member 1 | person A | hardware wallet |
| Squads member 2 | person B | hardware wallet |
| Squads member 3 | person C | hardware wallet |
| Emergency authority | on-call person D (not a Squads member) | hardware wallet |
| Mainnet deployer | used once, then retired | hardware wallet / offline |
| Treasury | Squads vault (recommended) or a separate multisig | — |

## Gate 6 — Build for mainnet

```bash
anchor build -- --features mainnet,v2-only   # timelock must be 24h–48h; CP + DLMM compiled out
sha256sum target/deploy/swd_amm.so           # must match the audited build
```

`v2-only` is the reduced scope the audit covers (AUDIT_README.md): SWDMM v2 +
governance + timelock + oracle reader; the constant-product and DLMM pool
types are not in the binary. `scripts/deploy-mainnet.sh` builds this by
default; `--all-pools` (= `--features mainnet`) only if those were audited too.

The `mainnet` feature is what makes `initialize_governance_settings` and
`propose SetTimelockDelay` refuse anything outside 24–48 hours. A build
without it allows 5 seconds — never deploy that to mainnet.
`GovernanceSettingsInitialized.mainnet_build` in the init transaction's
logs must read `true`.

## Gate 7 — Deploy and hand over to the multisig

Use a private RPC (Helius / Triton / QuickNode) for every mainnet step.

`scripts/deploy-mainnet.sh` runs gates 7 and 7b in the right order (preflight → verified build → cost estimate →
deploy → IDL init → verify PDA + OtterSec job → governance bootstrap → hand IDL, governance and upgrade authority to
the Squads vault → check). Dry run by default; `--execute` asks before every transaction. Cost from the current
`mainnet,v2-only` build (806,640-byte .so, 2026-11-11): ~5.62 SOL program rent locked, the same again as a temporary
buffer during deploy, ~0.10 SOL IDL — have ≥ ~11.4 SOL in the deployer (~5.76 SOL stays locked/spent). The full
build (`--all-pools`, 1,294,360 bytes) needs ~18.1 SOL. (`scripts/deploy-mainnet.sh estimate` recomputes this from the
real .so.) Before running it, the `#[cfg(feature = "mainnet")] declare_id!` in
`lib.rs` and `[programs.mainnet]` in `Anchor.toml` must hold the fresh program id, committed and pushed
(set 2026-11-11: `3acaVErTYMArMbfXwMTEQiefUHBZgAkPuVaBgo1ptkc4`; the keypair stays on the owner's machine). The manual equivalent:

```bash
# 1. deploy with the one-time deployer key
solana program deploy target/deploy/swd_amm.so --program-id <PROGRAM_KEYPAIR> \
  --keypair <DEPLOYER> --url <MAINNET_RPC>

# 2. create the Squads 2-of-3 (or 3-of-5) multisig
ANCHOR_PROVIDER_URL=<MAINNET_RPC> ANCHOR_WALLET=<DEPLOYER> \
  yarn ts-node --transpile-only scripts/squads-setup.ts create 2 <M1> <M2> <M3> --yes

# 3. bootstrap governance (deployer is governance until the vault accepts in step 5)
yarn governance init-global-config <DEPLOYER_PUBKEY> <EMERGENCY> --yes
yarn governance init-settings 86400 1000 <VAULT_PDA> --yes   # 24h, 10%, treasury = vault

# 4. propose the vault as governance (two-step rotation, K-3) and hand over upgrades + IDL now
yarn governance propose-governance-authority <VAULT_PDA> --yes   # note the action id N it prints
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <VAULT_PDA> \
  --skip-new-upgrade-authority-signer-check --keypair <DEPLOYER> --url <MAINNET_RPC>

# 5. after the 24 h timelock (and within 7 days): the VAULT accepts, through a Squads proposal
solana transfer <VAULT_PDA> 0.02 --allow-unfunded-recipient   # rent for actions the vault proposes later
yarn governance accept-authority <N>   # wallet is not the vault -> prints the instruction, sends nothing
#   Squads app: new transaction -> add that instruction (program id, 3 accounts, data; the vault is the
#   only signer) -> propose -> 2 of 3 approve -> execute.

# 6. prove it on-chain
yarn governance status                                 # governance_authority == VAULT_PDA
yarn governance verify-multisig <MULTISIG_PDA> 0       # prints threshold 2 of 3
yarn governance settings                               # nothing else pending from the deployer
solana program show <PROGRAM_ID> --url <MAINNET_RPC>   # authority == VAULT_PDA
```

Between steps 4 and 5 the deployer is still the governance authority (it can
no longer upgrade the program). Keep its key offline and do not destroy it
before step 6: if the 7-day accept window is missed, the deployer proposes again.
Rotations later on work the same way: governance proposes
(`propose-governance-authority`, timelocked, or `propose-emergency-authority`,
no delay) and the new key signs `accept-authority <id>` (a vault through Squads;
a new emergency key with its own wallet, which pays the fee). `cancel <id>`
withdraws a pending rotation. A rotation can only be accepted while its
proposer is still governance.

From here on every governance instruction (mint policy, proposals,
cancellations) is created as a Squads proposal and approved by 2 of 3
members. Timelocked actions can be executed by anyone once they are ready.

## Gate 7b — Verified build (free)

So anyone can check that the program on mainnet is exactly this repository's audited commit:

```bash
bash scripts/verified-build.sh build                      # before deploy: deterministic Docker build, prints the hash
bash scripts/verified-build.sh verify <PROGRAM_ID> <RPC>   # after deploy: on-chain hash must equal the build hash
KEYPAIR=<upgrade-authority keypair> bash scripts/verified-build.sh upload <PROGRAM_ID> <RPC>   # verify PDA + OtterSec job
```

solana-verify 0.5.x removed `verify-from-repo --remote`: the upload step now writes the verify PDA, then runs
`solana-verify remote submit-job --program-id <ID> --uploader <AUTHORITY>`. Do it while the deployer is still the
upgrade authority (the deploy script does); afterwards it needs `solana-verify export-pda-tx` + a Squads proposal.
Also publish the IDL (`anchor idl init`, then `anchor idl set-authority -n <VAULT_PDA>`) so explorers decode the
instructions.

Deploy the `.so` produced by `solana-verify build` (not a plain `anchor build`), or the hashes will not match. Once
the upgrade authority is the Squads vault, the `upload` step's verify-PDA write is a Squads proposal (2-of-3).

Releases (2026-11-11): tag the audited commit `program-vX.Y.Z`; `.github/workflows/verifiable-build.yml` publishes
`swd_amm-mainnet.so` with its hashes, IDL and provenance. Deploy that file, set the repository variables
`MAINNET_PROGRAM_ID` / `EXPECTED_AUTHORITY_MAINNET` (= vault) so `program-watch` checks it hourly, and keep
`docs/PROGRAM_ROLLBACK.md` (pause → rollback through Squads → verify → unpause) with the incident contacts.
`bash scripts/verified-build.sh verify-command <ID> mainnet <COMMIT>` prints the Squads `export-pda-tx` route.

## Gate 8 — Launch configuration

- Allow the launch mints (`set-mint-policy <mint> true`, as Squads
  proposals; `--print-ix` prints the instruction). Allow wSOL
  (`So11111111111111111111111111111111111111112`, no freeze authority) if
  SOL pairs are wanted.
- Mints with a freeze authority (K-1) need `trust-freeze`. Pass it only for
  issuers governance trusts not to freeze pool vaults; record each decision.
  The two expected ones are classic SPL Token mints (6 decimals) whose
  issuers hold a freeze authority:

  | Token | Mainnet mint |
  |---|---|
  | USDC (Circle) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
  | USDT (Tether) | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

  Before the proposal, check on-chain that the address is the issuer's
  (`spl-token display <mint> --url <MAINNET_RPC>`: owner = Token program,
  decimals 6, a freeze authority set) and compare with the issuer's own
  documentation (circle.com, tether.to). Beware look-alike addresses with
  the same prefix (e.g. `Es9vMFrz…Y2HbFzAu1cuN6pS` is **not** the USDT
  mint). Not re-checked on-chain when this was written (2026-11-11, no
  mainnet RPC in the build environment). The dry run of
  `set-mint-policy` prints the freeze authority it found.
- Pool creation (K-5): on the `mainnet` build only the governance authority
  can create SWDMM v2 pools (`GovernanceOnlyPoolCreation`), so the vault
  creates every launch pool through a Squads proposal. The creator also makes
  the first, price-setting deposit, so the vault must hold that initial
  liquidity (both tokens) and do the first `add_v2_liquidity` the same way;
  its position can later be transferred (`transfer_v2_position`) or locked.
  `set-pool-creation-paused` no longer matters for v2 on mainnet.
- Point test-ui (or the production UI) at the mainnet RPC and the mainnet
  program id; remove the devnet banner only after gates 4–7.

## Gate 9 — Operations

- Monitoring: alert on `V2PoolPaused`, `GovActionProposed`,
  `GovActionExecuted`, large `V2Swapped` price impact, and upgrade-authority
  changes.
- Lost or compromised emergency key: governance proposes
  `propose-emergency-authority <NEW>` (no delay) and the new key runs
  `accept-authority <id>` at once; meanwhile cancel any unpause the old key
  might block.
- Incident: the emergency authority pauses (`emergency-pause-v2-pool`,
  `emergency-pause-pool`); only the multisig can unpause, and only after
  the timelock (`propose-unpause-*` → wait → `execute`). Execution is
  permissionless: on a new incident the emergency authority also runs
  `emergency-cancel-unpause <id>` for every pending unpause of that pool
  (`yarn governance settings` lists them). A matured action expires 7 days
  after `execute_after`.
- Bug bounty and a published `security.txt` contact. The program embeds a `security.txt` (2026-11-08,
  `solana-security-txt`, see `lib.rs`): its contact `security@sawasdeecoin.com` is a placeholder — create that
  mailbox or change it before the mainnet build, and set `auditors` once a report is public.

## Gate 10 — DeFi listings (Jupiter, DefiLlama, Solscan)

After gates 4–8 and real liquidity. Full path, in Thai: `docs/DEFI_LISTING.th.md`.

- Jupiter: SDK in `integrations/jupiter-amm-swd/` (jupiter-amm-interface 0.6.1, SWDMM v2 pools; quotes tested
  against the built program in LiteSVM). Apply through Jupiter's DEX-integration page.
- DefiLlama: TVL adapter in `integrations/defillama/swd-amm/` (set the mainnet program id, then a PR to
  DefiLlama-Adapters as `projects/swd-amm/index.js`).
- Solscan: verified build + on-chain IDL + security.txt are what Solscan reads itself; the request to appear in
  its DeFi menu goes through Solscan's contact channel (no public listing form found).
