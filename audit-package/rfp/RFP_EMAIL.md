# Request for proposal — generic email (English)

Fill the `[…]` fields, then send the same text to every firm (or paste it into
their intake form). Attach nothing: everything is in the public repository.

---

**Subject:** Audit request — SWD AMM (Solana, Anchor 0.31.1), ~2.5k nSLOC, SWDMM v2 pools + timelocked governance

Hello [firm name] team,

We would like a quote for a security audit of **SWD AMM**, the on-chain AMM of the
SAWASDEE COIN (SWD) project, before its Solana mainnet launch.

**Code.** Public repository https://github.com/pospos191-alt/zetaphy, program
`programs/swd_amm`. Audit package (scope, architecture, trust model, invariants,
known issues, prior findings, questions): `AUDIT_README.md` at the repository root.
The commit will be frozen when we book (we will tag it `audit-freeze-v1`).

**Scope.** The mainnet build only (`anchor build -- --features mainnet,v2-only`):
6 Rust files, **2,600 nSLOC**, 23 instructions. Anchor 0.31.1, Solana 3.1.10.
- SWDMM v2 pools (full-range constant product, Meteora-DAMM-v2-style fee
  schedulers, dynamic fee, three fee-collection modes, LP positions with
  claimable fees and permanent locks, per-swap and per-slot impact caps) — 1,361 nSLOC
  incl. pure math;
- governance: Squads v4 vault authority, separate pause-only emergency key,
  24–48 h timelock with permissionless execution and expiry, protocol-fee
  withdrawal, per-mint policy with a Token-2022 extension gate — ~700 nSLOC;
- a hand-written Pyth `PriceUpdateV2` reader and deviation guard (optional per pool) — 280 nSLOC.
The constant-product and DLMM pool types in the same crate are compiled out of the
mainnet binary and are **not** in scope.

**Existing assurance.** Internal security review with attack tests (6 findings,
fixed), libFuzzer + model fuzzing (~4.6 M executions), differential stateful fuzzing
of the built `.so` in LiteSVM, 6 Kani proofs, CI on every push. Details in
`docs/FUZZING_FORMAL.md`. This is not a substitute for your review.

**Please quote:**
1. Price, engineer-weeks and number of auditors.
2. Earliest start date and report delivery date.
3. Whether a **fix review** is included (how many rounds) and its cost if not.
4. Whether the final report can be **public** (we will link it from the program's
   `security.txt`, our website, DefiLlama and Jupiter).
5. Payment terms and accepted currencies (USDC on Solana is easiest for us).
6. Optional items, priced separately:
   a) our Jupiter quoting crate `integrations/jupiter-amm-swd` (quote vs. execution parity);
   b) the deployment / authority-handover script `scripts/deploy-mainnet.sh`.
7. Relevant prior Solana AMM / DEX audits (links to public reports).

One design question we want answered in any case: `swap_v2` requires the trader to
own the destination token account — is that compatible with aggregator (Jupiter)
routing, and is relaxing it safe? (`audit-package/QUESTIONS.md` Q1.)

We are a small team; budget matters, and we are open to a shorter engagement focused
on the highest-risk parts if you think that is sensible. We also plan to apply to the
Solana audit subsidy program — please tell us if you participate in it.

Thank you,
[name], [role], SAWASDEE COIN
[email] · [Telegram / X handle] · Time zone: Asia/Bangkok (UTC+7)
