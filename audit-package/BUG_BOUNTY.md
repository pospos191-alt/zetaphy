**English** | [ภาษาไทย (สรุป)](BUG_BOUNTY.th.md)

# SWD AMM bug bounty — program draft (Immunefi style)

> **DRAFT — not live.** Nothing on this page is a promise to pay until the owner (a) fills in every `____` below,
> (b) funds the reward pool, held by the Squads multisig, and (c) publishes this file as live, either on
> Immunefi or in this repository, with the date. Until then the program pays credit only (Hall of Fame,
> named in the advisory), as [`docs/BUG_BOUNTY.md`](../docs/BUG_BOUNTY.md) says for the rest of ZETAPHY.
> This page covers **SAWASDEE COIN (SWD) / SWD AMM**. The ZETAPHY chain, bridge and EVM contracts have their own
> program in `docs/BUG_BOUNTY.md`.

| | |
|---|---|
| Project | SWD AMM: SWDMM v2 pools + Squads-governed, timelocked administration on Solana (Anchor 0.31.1) |
| Status | Not audited. Devnet: `3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL`. Mainnet: not deployed yet (the id will be added here) |
| Live since | `____-__-__` (not live) |
| Reward pool | `____` USDC, held by the Squads vault `________________________________` |
| Max payout per report | `____` USD (the cap: Critical is never more than this, however large the TVL) |
| Triage | the SWD team, plus the auditor of record for disputed severity |
| Payment | USDC on Solana, within 14 days of the fix being deployed. KYC is required above `____` USD. |

## Scope

### In scope

| Asset | What | Where |
|---|---|---|
| **Smart contract (primary)** | `swd_amm` Solana program, **mainnet build** `--features mainnet,v2-only`: SWDMM v2 pools and positions, governance and timelock, emergency pause, Pyth oracle guard, Token-2022 gate | `programs/swd_amm/`; deployed binary = the `swd_amm-mainnet.so` of the matching `program-v*` GitHub Release (check with `bash scripts/rollback-program.sh status`) |
| Smart contract (devnet only) | CP and DLMM pool types (default build). Not on mainnet, so they pay **one level lower** than the table | `programs/swd_amm/src/cp*.rs`, `dlmm*.rs` |
| Deployment / upgrade path | Verifiable build, release and rollback tooling, on-chain watch: a way to get **code that is not a published release** deployed, or to make a check report a tampered program as genuine | `scripts/verified-build.sh`, `scripts/rollback-program.sh`, `scripts/program-watch.mjs`, `.github/workflows/verifiable-build.yml`, `program-watch.yml` |
| **Web app** | the SWD swap / pool UI and its API routes (wallet-safety checks, transaction building) | `test-ui/` (as deployed at `https://swd-zetaphy.sawasdeecoin.com`) |
| Integrations | SDKs and adapters that build SWD AMM transactions for users or aggregators | `integrations/swd-sdk-js`, `swd-sdk-rust`, `jupiter-amm-swd`, `solana-agent-kit-plugin-swd`, `chrome-swd-guard`, `woocommerce-swd-pay` |
| Ops scripts | governance CLI and Squads helpers, where a bug makes members sign something other than what is shown | `scripts/governance.ts`, `scripts/squads-setup.ts`, `scripts/deploy-mainnet.sh` |

**Primacy of impact:** a critical impact in an asset that is not listed is still considered, at the team's discretion,
if it hurts SWD AMM users or funds.

### Out of scope

- Everything in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) (K-1 … K-21) and the accepted findings in
  [`PRIOR_FINDINGS.md`](PRIOR_FINDINGS.md), unless you show a **new** impact beyond what they describe.
- Acting as a privileged role: a malicious or compromised **upgrade authority / Squads vault**, governance or
  emergency key (TRUST_MODEL.md). *In* scope: any way to **gain** such a role or bypass its checks (M-of-N, timelock,
  two-step rotation).
- Third-party code and services: Solana runtime and loaders, Anchor, SPL Token / Token-2022, Pyth, Squads, wallets,
  RPC providers, Vercel / Cloudflare / GitHub. Exception: a bug in **how we use** them.
- Mint issuers freezing, blacklisting or rebasing their own tokens (K-1), and price moves of the assets themselves.
- MEV and sandwiching within the slippage limits the user signed. Front-running a pool's first deposit or its fee tier (K-5).
- Volumetric DoS, spam, rate limits, RPC load. Missing best-practice HTTP headers with no exploit.
  Clickjacking on pages with no sensitive action. Self-XSS. Reports from scanners with no working proof.
- Social engineering or phishing of the team or users, physical attacks, leaked keys from devices.
- Testing on **mainnet**, or with other people's funds or positions. Testing on public devnet pools you did not create.

## Severity and rewards

Classification: **Immunefi Vulnerability Severity Classification System v2.3**, judged by the **real, reproducible
impact on the mainnet build**. Rewards for Critical **scale with what is at risk, up to the cap**. "Funds at risk" means
the value in USD, at the time of the report, that the bug could take or freeze in one attack. Count only TVL that is
really reachable, not the whole protocol.

| Level | Smart contract examples | Web app / integrations examples | Reward (owner fills in) |
|---|---|---|---|
| **Critical** | Direct theft of pool reserves, LP positions or unclaimed fees. Permanent freezing of funds. Minting or inflating LP shares or liquidity. Insolvency (vault < owed). Gaining the governance, emergency or upgrade role, or bypassing the timelock, the M-of-N check or the two-step rotation. Getting unpublished code deployed past the verify / rollback tooling | Making the UI or an SDK build or sign a transaction that drains the user (e.g. a swapped destination or authority, a hidden `approve` or `setAuthority`). XSS or supply-chain injection that reaches signing on the production site | **10 % of funds at risk**, minimum `____` USD, **maximum `____` USD (cap)** |
| **High** | Theft or freezing of **protocol** fees or treasury. **Temporary** freezing of user funds (> 1 h) by a non-privileged user. Pausing / unpausing without the right role. Oracle guard bypass that makes a guarded pool trade far from the real price | Showing users false data that leads them to lose funds (wrong price, slippage or token identity in the confirmation). Persistent XSS with no signing | `____` USD (suggested 10–20 % of the cap) |
| **Medium** | Griefing with no profit: making a pool or instruction unusable, blocking LP withdrawals for < 1 h, rent or compute exhaustion that blocks other users. Fee or rounding theft above dust | Bypassing a wallet-safety warning (`wallet-safety.js`, `sol-safety.js`, the token audit). Reflected XSS | `____` USD (suggested 2–5 % of the cap) |
| **Low** | A function that does not do what its docs say, with no loss of value. Events or logs that mislead indexers | UI or SDK errors that confuse but cannot lose funds | `____` USD (suggested 0.5–1 % of the cap) |

Suggested scale (owner's choice, Immunefi practice): cap = **10 % of the TVL** you want to protect, never above the funded
pool. For example: TVL $500k → cap $50k, Critical minimum $10k.

- One root cause = one report, paid once, at the highest level it reaches. Duplicates: the first complete report wins.
- Testnet-only code (CP / DLMM, `devnet` features) pays one level lower. On devnet, before mainnet, the program pays credit only.
- No reward if you exploit the bug beyond a minimal proof, take or move funds that are not yours, or disclose it before the fix.
- People paid by the project, and auditors during their engagement, get credit, not money.
- Rewards are subject to the law of your country (tax, sanctions). KYC is required above the threshold in the table.

## Rules

1. Prove it **locally**: `anchor test`, `solana-test-validator`, LiteSVM, or the fuzz harness. A good proof is a test
   that fails on the reported commit (see `AUDIT_README.md`, "Build, test, fuzz"). You may use devnet pools that you created.
2. **Never** test against mainnet or against other people's funds, positions or pools.
3. Name the commit or `program-v*` release, the build features, the exact steps, and the impact in funds.
4. Give us time to fix the bug. Keep it private until the agreed disclosure date (timeline below).
5. No DoS, spam, social engineering, or access to personal data. Do not pivot into our infrastructure or accounts.
6. One problem per report. If you are not sure whether something is in scope, ask before you test.

## Safe harbor

If you act in good faith and follow these rules:
- we consider your research authorized. We will not take legal action, file a complaint, or ask a provider to close
  your accounts;
- if a third party takes action against you over research done under these rules, we will say that we authorized it;
- we waive the parts of our terms that would forbid this research.

This binds only the SWD AMM / ZETAPHY maintainers. It does not bind third parties, and it is not legal advice
(`docs/LEGAL.md`). When the program goes live on Immunefi, the [Immunefi Safe Harbor](https://immunefi.com/safe-harbor/)
terms are adopted as well.

## How to report

**Never open a public issue for a vulnerability.**

1. **GitHub private vulnerability reporting (main channel):** `pospos191-alt/zetaphy` → **Security** →
   **Report a vulnerability**. The owner turns this on under Settings → Code security.
2. **E-mail:** the program's on-chain `security.txt` lists **`security@sawasdeecoin.com`**. **The mailbox is not set up
   yet (TBD by the owner)**. Until this line says otherwise, use channel 1. Once it is monitored, add a PGP key here.
3. **Immunefi:** once the program is listed there, the Immunefi dashboard (link TBD).

The channels are the same as those in `SECURITY.md` and in the program's embedded `security.txt`
(`contacts: email:security@sawasdeecoin.com, link:https://github.com/pospos191-alt/zetaphy/security`).
If a channel changes, update all three (`security.txt` changes only in a new, audited release).

## Timeline and our response

| When | What |
|---|---|
| 24 h (Critical) / 3 business days (others) | We acknowledge the report |
| at once, if funds are at risk on mainnet | The emergency key pauses the affected pools, then the team assesses (`docs/PROGRAM_ROLLBACK.md`) |
| 10 business days | Reproduced; severity agreed (if we disagree, the auditor of record decides) |
| fix | A fix branch, a fix review by the auditor, a new verified `program-v*` release, and an upgrade through Squads (with its time lock) |
| payment | ≤ 14 days after the fixed release is live |
| disclosure | After the fix is live, or 90 days after the report, whichever comes first. The date is agreed with you. A GitHub advisory credits you |

## Hall of Fame

(none yet)
