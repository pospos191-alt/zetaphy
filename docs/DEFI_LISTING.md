# Path to Solscan's DeFi menu (listed next to Raydium, Orca, Meteora)

This guide is for the project owner (no programming needed). It lists every step from today until SWD AMM appears
in Solscan's DeFi menu, and says plainly which facts are **confirmed** and which are **unverified**
(research done on 8 Nov 2026). Thai version: `docs/DEFI_LISTING.th.md`.

> **Status today:** the swd_amm program is written and passes its tests, but it is **not audited and not on mainnet**.
> No step in this guide has been done on mainnet, and no real money has been spent.
> Never give a private key or seed phrase to anyone (including AI tools, developers, auditors, or the Jupiter/Solscan
> teams). Every signature happens on your own computer with a keypair file, or through Squads.

## The 10 steps at a glance

| # | Step | Who | Approx. cost | Status |
|---|---|---|---|---|
| 1 | External audit | auditor + developer fixes | the largest cost (see 1) | ❌ not started |
| 2 | New keys + mainnet program id | owner | hardware wallets | ❌ |
| 3 | Verified build + deploy | owner (runs the script) | ~11.2 SOL needed in the wallet, ~5.7 SOL spent/locked (v2-only build; full build ~17.9 / ~9.04) | ❌ |
| 4 | Upload the IDL on-chain | script | ~0.18 SOL | ❌ |
| 5 | "Verified" status with OtterSec | script | free (small fees) | ❌ |
| 6 | Hand all authorities to the Squads multisig | script + Squads members | small | ❌ |
| 7 | First pools + liquidity | owner / team | the project's liquidity capital | ❌ |
| 8 | Apply for Jupiter integration | owner | free (per Jupiter's docs) | SDK ✅ ready |
| 9 | Submit the TVL adapter to DefiLlama | owner (GitHub PR) | free | adapter ✅ ready |
| 10 | Contact Solscan about the DeFi menu | owner | unknown (see 10) | ❌ |

Already prepared in the repo:

- `security.txt` embedded in the program (Solscan / Solana Explorer show it in the Security tab) — see 5.1
- `scripts/deploy-mainnet.sh` — runs steps 3–6 (default is a rehearsal that sends nothing)
- `integrations/jupiter-amm-swd/` — the Jupiter SDK (step 8)
- `integrations/defillama/swd-amm/` — the DefiLlama adapter (step 9)

---

## 1. Audit (must come first)

> **Update 2026-11-11 — the audit package is ready:** `AUDIT_README.md` and `audit-package/` (scope, architecture,
> trust model, invariants, known issues, questions), RFP emails and firm list in `audit-package/rfp/`, owner's guide
> in Thai in `audit-package/README.th.md`. The "SWDMM v2 only" option below is now done: the Cargo feature `v2-only`
> compiles CP and DLMM out, and the mainnet build (`--features mainnet,v2-only`, what `scripts/deploy-mainnet.sh`
> builds) is **2,531 nSLOC** (full program 4,745). The numbers in 1.1–1.2 below are the earlier estimate.

Why: Jupiter says DEXes that don't use a standard audited program need their own audit, DefiLlama has a field for the
audit link, and users and Solscan look at it. An AMM holds users' money — one bug can drain a pool permanently.

### 1.1 Scope (send to auditors together with `docs/AUDIT_SCOPE.md`)

Line counts measured on 8 Nov 2026 (excluding blank lines, comments and test code):

| File | Total lines | Code (approx.) | Contents |
|---|---|---|---|
| `lib.rs` | 1,921 | ~1,010 | constant-product pool, entry points, Token-2022 filter |
| `dlmm.rs` | 1,641 | ~890 | DLMM (bin) pool |
| `swdmm_v2.rs` | 1,189 | ~970 | SWDMM v2 pool (the one the website uses) |
| `swdmm_math.rs` | 737 | ~385 | v2 math |
| `timelock.rs` | 580 | ~455 | timelock, protocol fees, mint policy |
| `governance.rs` | 858 | ~440 | admin authority, pause, Squads checks |
| `oracle.rs` | 781 | ~285 | Pyth price reader (hand-written, not Pyth's SDK) |
| **Total** | **7,707** | **~4,430** | |

Cheaper option: ship only SWDMM v2 on mainnet (remove CP and DLMM first). Scope then drops to about
**~2,600–3,000 lines** (v2 + math + timelock + governance + oracle + the shared part of lib.rs). The developer must
actually remove the code and rebuild before the audit, not just "not use" it.

Also send the auditor: the commit hash to audit, `docs/AUDIT_SCOPE.md`, `docs/SWDMM_V2.md`, `docs/MAINNET_RUNBOOK.md`,
test results (`cargo test -p swd_amm`, `anchor test`), and the `audit/` folder (internal review notes).

### 1.2 RFP — request-for-quote email (copy and send)

> Subject: Audit request — SWD AMM (Solana, Anchor 0.31.1), ~4.4k nSLOC
>
> We are looking for a security review of SWD AMM, an open-source Solana AMM program
> (https://github.com/pospos191-alt/zetaphy, `programs/swd_amm`). Anchor 0.31.1, Solana 3.1.10,
> ~4,430 lines of non-test Rust (or ~2,600–3,000 if we ship SWDMM v2 only). Scope document: `docs/AUDIT_SCOPE.md`.
> Pool types: constant-product, DLMM (bins), SWDMM v2 (Meteora-DAMM-v2-style: fee schedulers, dynamic fee,
> positions, permanent locks); Token-2022 support with an extension allowlist; hand-written Pyth PriceUpdateV2
> reader; Squads-multisig governance with a 24–48h timelock.
> Please quote: (1) price and number of engineer-weeks, (2) earliest start date, (3) whether a fix review is
> included, (4) whether the final report is public and can be linked from our site, DefiLlama and Jupiter,
> (5) any reduced-scope option. We also ask you to check our Jupiter integration crate
> (`integrations/jupiter-amm-swd`) for quote/execution mismatches as an optional item.

### 1.3 Questions to ask each auditor

1. Price, engineer-weeks, earliest start date
2. Is a fix review included? (It should be.)
3. Can the report be public? (Jupiter, DefiLlama and users need to see it.)
4. Have they audited AMM / CLMM / DLMM programs on Solana before? (Ask for report links.)
5. Will they cover the Token-2022 extensions and the hand-written Pyth reader?
6. Recommendations on admin powers (Squads, timelock, emergency pause)
7. Does the "destination accounts must be owned by the signer" rule in swap_v2 conflict with Jupiter routing?
   (See item 2 of the jupiter-amm-swd README.)

### 1.4 Rough prices (**unverified** — most firms don't publish prices; you must ask for a quote)

Figures from third-party articles (some are written by firms that sell audits, so they may not be neutral):

- Small/simple Solana program: about **$7,000–$20,000**
- Typical Solana DeFi protocol: about **$60,000–$130,000**; very complex: **$180,000+**
- Solana audits are often ~20–30% more expensive than an Ethereum audit of the same size
- Large firms (e.g. OtterSec) often have waiting lists of weeks to months

At ~4.4k lines with 3 pool types, expect the middle-to-upper part of "typical DeFi"; cutting down to v2 only should be
noticeably cheaper. Extras (not a replacement for the main audit): an **audit contest** (Code4rena, Sherlock, Cantina)
and a **bug bounty** (Immunefi) after launch.

### 1.5 Audit firms known for Solana work (from research — check their sites and past work yourself)

OtterSec, Neodyme, Sec3, Zellic, Halborn, Trail of Bits, Ackee Blockchain, Accretion, Offside Labs, MadShield, Certora
(several have audited Raydium/Orca/Meteora/Jupiter — ask each for real report links).

After the audit: fix every critical/high finding → have the auditor re-check → publish the report → change `auditors`
in security.txt (`programs/swd_amm/src/lib.rs`) from "None yet" to the firm's name → record the audited commit in
`docs/MAINNET_RUNBOOK.md` Gate 4.

---

## 2. New keys + mainnet program id

Follow `docs/MAINNET_RUNBOOK.md` Gate 5 (3 Squads members, each on their own hardware wallet; a separate emergency
authority; a one-time deployer).

For the program id (on your own computer; keep the file **outside** the repo folder):

```bash
solana-keygen new -o ~/swd-keys/swd_amm-program.json     # new program id (keep this file safe, never share it)
solana-keygen pubkey ~/swd-keys/swd_amm-program.json     # ← this public number can be given to the developer
```

The developer sets `declare_id!` in `programs/swd_amm/src/lib.rs` and adds `[programs.mainnet]` in `Anchor.toml` with
this id, then commits and pushes (pushing is required because OtterSec rebuilds from GitHub). Do this on the audited
commit; if only the id changed, tell the auditor that this line is the only difference from the audited commit.

---

## 3–6. Build, deploy, IDL, verify, hand over to Squads — use `scripts/deploy-mainnet.sh`

Install on your computer: Solana CLI 3.1.10, Anchor 0.31.1, Docker, `cargo install solana-verify`, Node + yarn
(`yarn install` in the repo), and a private mainnet RPC (Helius / Triton / QuickNode). Public RPCs often fail halfway
through deploying a large program.

**Rehearse first (sends nothing):**

```bash
export RPC=https://<your private rpc>
export DEPLOYER_KEYPAIR=~/swd-keys/deployer.json
export PROGRAM_KEYPAIR=~/swd-keys/swd_amm-program.json
export SQUADS_VAULT=<vault PDA from scripts/squads-setup.ts>
export EMERGENCY_AUTHORITY=<pubkey of the pause authority>
bash scripts/deploy-mainnet.sh all          # prints every command it would run + the cost estimate
```

**For real:** `bash scripts/deploy-mainnet.sh all --execute`. Every command that spends money or changes the chain asks
you to type `yes` first. You can also run one step at a time: `preflight`, `build`, `estimate`, `deploy`, `idl`,
`verify`, `governance`, `handover`, `check`.

What the script does, in order (the order matters):

1. **preflight** — checks the tools; checks the RPC really is mainnet (genesis hash); keypair files are outside the
   repo; `declare_id!` matches the program keypair; git is clean and pushed; shows the deployer's SOL balance
2. **build** — `solana-verify build` (Docker build, so every machine gets the same file) with `--features mainnet,v2-only`
   (24–48h timelock) and prints the hash; if `AUDITED_SHA256` is set, it refuses to continue when the hash doesn't match
   the audited build
3. **estimate** — computes the cost from the real `.so` size
4. **deploy** — deploys with the new program keypair (the deployer is the temporary upgrade authority)
5. **idl** — `anchor idl init` puts the IDL on-chain, so Solscan can show the program's instructions and accounts in
   readable form
6. **verify** — writes the "verify PDA" and submits a job for OtterSec to rebuild from GitHub, so Solscan / Solana
   Explorer show the **Verified** badge (done while the deployer still has authority, so no Squads proposal is needed)
7. **governance** — sets up GlobalConfig + GovernanceSettings (the program only lets the upgrade authority do this, so
   it must come before the handover)
8. **handover** — transfers governance, IDL authority and program upgrade authority to the Squads vault (**last step**)
9. **check** — verifies: authority == vault, on-chain hash == built hash, IDL exists on-chain

### Costs (v2-only mainnet build 2026-11-11: 793,096 bytes → ~11.2 SOL needed, ~5.66 SOL locked/spent; the table below is the earlier full build: 1,266,528 bytes — the real mainnet build may differ slightly; the script recomputes)

| Item | SOL |
|---|---|
| Rent for the program data account — locked while the program exists | ~8.82 |
| Program account | ~0.001 |
| Temporary deploy buffer — refunded when done, but must be in the wallet during deploy | ~8.82 |
| IDL account (approx.) | ~0.18 |
| Fees for ~1,250 transactions (priority fee 50,000 micro-lamports/CU) | ≤ ~0.02 |
| Verify PDA, governance, other | ~0.02 |
| **Needed in the deployer before starting** | **≥ ~17.9** |
| **Actually spent/locked when done** | **~9.04** |

Rent formula: (size + 128) × 6,960 lamports (Solana's current rate — the script asks the RPC first when it can).
If a deploy stops halfway: rerun with the `--buffer` the CLI prints, or close the buffer to get the SOL back
(`solana program close --buffers`).

### 5.1 security.txt (already in the code)

Embedded in the program: name "SWD AMM", website https://swd-zetaphy.sawasdeecoin.com, vulnerability contacts
`security@sawasdeecoin.com` + https://github.com/pospos191-alt/zetaphy/security, policy = SECURITY.md, source code = the
zetaphy repo, auditors = "None yet".

**To do:** `security@sawasdeecoin.com` is a placeholder. Create this mailbox for real (with someone reading it) **or**
have the developer change it **before** the mainnet build (changing it after deploy needs a program upgrade, i.e. a
Squads proposal). Also turn on GitHub → Settings → Code security → Private vulnerability reporting.

---

## 7. First pools and liquidity

Follow `docs/MAINNET_RUNBOOK.md` Gate 8 (allow the mint through a Squads proposal), then create pools on the website
(SWDMM v2).

- Pairs to have: **SWD/SOL** and/or **SWD/USDC** — aggregators and DefiLlama can price a pool when the other side has a
  market price
- Jupiter states a minimum of **$500 per pool** (per its docs as of 1 Jan 2025 — **may have changed**). In practice you
  want much more, or prices won't be good enough for Jupiter to route through you
- Consider **permanently locking** the pool creator's liquidity (the Permanently lock function) — it builds trust
- A low fee tier (0.25–0.3%) competes better on Jupiter; a higher fee suits the launch period (time scheduler)
- After the handover, every governance setting is a Squads proposal that needs 2 of 3 approvals

---

## 8. Jupiter

Details: `integrations/jupiter-amm-swd/README.md`.
Summary: the SDK is ready and tested against the real program in a simulator. What Jupiter asks for (from its docs —
**unverified**): an open-source SDK, an audit plus their own security/code-health review, traction, minimum liquidity per
pool, and (ideally) a pool-list API. Contact them through the "DEX Integration" page of Jupiter's docs (dev.jup.ag) or
Jupiter's Discord.

Why it matters: most volume on Solana comes through Jupiter — a DEX that Jupiter doesn't route to has almost no volume
for Solscan to see.

---

## 9. DefiLlama

Step-by-step: `integrations/defillama/swd-amm/README.th.md`.
Summary: set PROGRAM_ID to the mainnet id → fork DefiLlama-Adapters → put the file at `projects/swd-amm/index.js` →
`node test.js projects/swd-amm/index.js` → open a PR and fill in the template. Only possible once there are real pools
and money on mainnet. (Showing volume as well needs a separate adapter in `DefiLlama/dimension-adapters` — not done yet.)

---

## 10. Solscan

What Solscan "sees" on its own once steps 3–6 are done: the Verified badge, the IDL (instructions shown as a table),
and security.txt.

**How to ask for the DeFi menu — unverified:** no public form for "add a protocol to the DeFi menu" was found
(Solscan's documentation site could not be opened from the machine that prepared this work, so only search results
were checked). What was found:

- Solscan's DeFi menu shows volume and trading share for the main DEXes/protocols (per Solscan's docs)
- There is an official **Token Update** form (for token info — the SWD token's logo, website and socials), and
  Solscan says it only accepts updates through that form. It is for tokens, not protocols
- The Solscan site has **Contact Us** and a **Priority Support** service at the bottom of the page; the
  "Solscan Integration Guideline" (about 3 years old) says to get in touch through **Discord**
- Solscan was acquired by Etherscan (2024 — from prior knowledge, not re-checked)

Recommended approach: go to solscan.io → scroll to the bottom → **Contact Us**, pick the closest topic (labeling /
DeFi / partnership) and send: project name, program id, links to the Verified program and IDL on Solscan, the audit
report link, the DefiLlama link, the Jupiter integration, TVL / volume / user numbers, and the logo — and ask for a
program label and a place in the DeFi menu. If they ask for payment (e.g. Priority Support or ads), ask exactly what it
pays for — paying should not be a shortcut instead of an audit.

### Numbers that usually get looked at (general industry experience, not criteria Solscan has published)

- **TVL** (from DefiLlama) and a steady trend, not a one-day spike
- 24h / 7d **volume** and **number of transactions / unique traders** (wash trading is easy to detect — don't)
- Number of pools with real liquidity, and whether Jupiter routes to them
- Trust signals: public audit, Verified build, multisig + timelock, security.txt, bug bounty
- How long the project has run on mainnet without a security incident

---

## What is still uncertain (plainly)

1. There is **no guarantee** that Solscan will add SWD AMM to the DeFi menu even if every step is done — it is
   Solscan's decision and no published criteria were found
2. Audit prices and waiting times are figures from articles; you need real quotes
3. Jupiter's requirements ($500/pool minimum, free) come from docs that may be outdated
4. DefiLlama's PR template fields and RPC variable names may change — fill in what you actually see
5. The Pyth price account address (only used by pools with the oracle guard on) follows Pyth's SDK method — re-check
   before use
6. The deploy steps in the script have never run on mainnet (dry-run rehearsed, commands checked against the CLI
   versions used)
7. Jupiter may ask for a program change about swap destination accounts (see the SDK README), and that change would
   need auditing too — asking before the audit saves the most money

Sources (searched 8 Nov 2026): Jupiter DEX Integration docs (dev.jup.ag, station.jup.ag, hub.jup.ag),
docs.solscan.io (DeFi dashboard, integration guideline, anchor verified programs), kb.solscan.io (Token Update
guideline), audit-pricing articles from zealynx.io, softstack.io, sherlock.xyz, docs.llama.fi
