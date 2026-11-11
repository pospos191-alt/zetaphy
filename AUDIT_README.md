# SWD AMM — audit package

**For security auditors.** Everything needed to quote, run and review the Solana
program `programs/swd_amm` (SAWASDEE COIN / SWD). Owner's guide in Thai:
[`audit-package/README.th.md`](audit-package/README.th.md).

| | |
|---|---|
| What | SWDMM v2 — a full-range constant-product AMM with Meteora-DAMM-v2-style fees and LP positions — plus Squads-governed, timelocked administration and an optional Pyth guard. Anchor 0.31.1 / Solana 3.1.10. |
| Scope | The **mainnet build** `--features mainnet,v2-only`: 6 files, **2,644 nSLOC**, 24 instructions. Constant-product and DLMM pool types are compiled out (the full program is 4,868 nSLOC). → [SCOPE.md](audit-package/SCOPE.md) |
| Frozen commit | `________________________________________` (set when the engagement is booked) |
| Status | Not audited. Not on mainnet. Internal review, attack tests, fuzzing and 6 Kani proofs done (below). Pre-audit hardening 2026-11-11: freeze-authority allowlist (K-1), two-step authority rotation (K-3), governance-only v2 pool creation on mainnet (K-5) — [PRIOR_FINDINGS.md](audit-package/PRIOR_FINDINGS.md) §4. |
| Contact | GitHub private vulnerability reporting on `pospos191-alt/zetaphy`; engagement contact in the RFP email. |

## Package contents

| File | |
|---|---|
| [SCOPE.md](audit-package/SCOPE.md) | Frozen scope: files, functions, nSLOC (before / after `v2-only`), out-of-scope list |
| [ARCHITECTURE.md](audit-package/ARCHITECTURE.md) | Accounts, PDAs, swap / pool / governance flows (Mermaid diagrams), deployment & handover |
| [TRUST_MODEL.md](audit-package/TRUST_MODEL.md) | Privileged roles: upgrade authority, governance (Squads), emergency key, timelock, treasury |
| [INVARIANTS.md](audit-package/INVARIANTS.md) | 26 invariants, each linked to its fuzz / Kani / test evidence |
| [KNOWN_ISSUES.md](audit-package/KNOWN_ISSUES.md) | Known issues and accepted risks (K-1..K-21; K-1, K-3, K-5 now resolved / mitigated) — please don't re-report |
| [THREAT_MODEL.md](audit-package/THREAT_MODEL.md) | Assets, adversaries, highest-value review targets |
| [PRIOR_FINDINGS.md](audit-package/PRIOR_FINDINGS.md) | Internal findings F-1..F-6, fuzz bugs, earlier attack-suite fixes, pre-audit hardening H-1..H-3 |
| [QUESTIONS.md](audit-package/QUESTIONS.md) | Questions we want answered (incl. Jupiter routing / destination-account ownership) |
| [INSTRUCTIONS.md](audit-package/INSTRUCTIONS.md), [ERROR_CODES.md](audit-package/ERROR_CODES.md) | Generated reference tables (the Anchor IDL lists only one error enum) |
| `docs/SWDMM_V2.md`, `docs/FUZZING_FORMAL.md`, `docs/MAINNET_RUNBOOK.md` | Product spec, fuzz / formal methods report, deployment runbook |
| `audit-package/rfp/` | Our request-for-quote emails (for the team; not needed by auditors) |

## Build, test, fuzz — one command each

Prerequisites: Solana CLI 3.1.10, Anchor 0.31.1 (`avm use 0.31.1`), Rust stable
(≥ 1.97.1 for the LiteSVM crate), Node 20 + yarn, a keypair at
`~/.config/solana/id.json` (`solana-keygen new`). No mainnet RPC needed.

```bash
bash audit-package/tools/verify-all.sh build   # the audited binary: anchor build -- --features mainnet,v2-only, sha256, IDL check
bash audit-package/tools/verify-all.sh test    # cargo tests (both feature sets) + localnet TS suites against the v2-only binaries
bash audit-package/tools/verify-all.sh fuzz    # fuzz corpus/regressions + exhaustive checks + LiteSVM stateful run
bash audit-package/tools/verify-all.sh kani    # 6 Kani proofs (~6 min)
python3 audit-package/tools/nsloc.py --v2-only # nSLOC of the scope (drop the flag for the full program)
```

Full program (all three pool types) and its complete suite:
`anchor build && yarn test` (needs a mainnet RPC for the Squads clone; CI does this).
libFuzzer runs: `docs/FUZZING_FORMAL.md` §7.

Results on the prepared branch (2026-11-11, local, after the pre-audit hardening):

| Check | Result |
|---|---|
| `cargo test -p swd_amm` (full / `v2-only` / `mainnet,v2-only`) | 62+4 / 43+4 / 43+4 passed (lib re-run after the internal-review fixes; the localnet, fuzz, LiteSVM and Kani rows below were NOT re-run after them) |
| `cargo clippy -p swd_amm --features v2-only` | clean except one warning inside Anchor-generated code (K-21) |
| TS localnet, full build (8 suites) | 55 passed, 6 skipped (v2-only checks) |
| TS localnet, `v2-only` build (`v2-only.ts`, `swdmm_v2.ts`, `security-review.ts`) | 27 passed, 1 skipped (CP-only F-5) |
| TS localnet, `mainnet,v2-only` build (`v2-only.ts`) | 6 passed (5 s timelock refused, 24 h governance rotation, governance-only pool creation) |
| `tests/z-squads-live-verification.ts` (needs the mainnet Squads clone) | rewritten for the two-step handover; not re-run locally (no mainnet RPC) — CI / `anchor test` |
| Fuzz regression (stable) | 28 passed |
| LiteSVM stateful differential, `v2-only` and full `.so` | 60 seeds × 150 steps each, no violation |
| Kani | 6 of 6 completing harnesses verified (14 SLOW harnesses not run — see FUZZING_FORMAL §5) |
| `cargo audit` (cargo-audit 0.23.0, 1,446 advisories) | 0 vulnerabilities; 3 warnings on transitive Solana/Anchor crates (bincode 1.3.3 and libsecp256k1 0.6.0 unmaintained, rand 0.7.3 unsound-with-custom-logger) — not reachable from program logic. CI runs it on every push. |

## Ground rules we ask for

- Please report criticals immediately (don't wait for the report).
- We fix on a branch and ask for a **fix review** against a new frozen commit.
- We want to publish the final report and list you in the program's on-chain
  `security.txt` (`auditors` field).
