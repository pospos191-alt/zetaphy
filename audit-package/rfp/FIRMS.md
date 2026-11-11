# Audit firms — where to send the request, and a short tailored note

Researched 2026-11-11 with web search only. **"Verified"** means the contact route was
found in the firm's own published material (its website, its own GitHub, or its own
audit reports) as quoted by search results; the firm websites themselves could not be
opened from our research environment, so **open each site and check the route before
sending**. **"Unverified"** means only third-party pages mention it. Nobody publishes
prices — all price figures in `README.th.md` are rough market estimates, not quotes.

How to use: paste the generic email (`RFP_EMAIL.md`) and add the 2–3 tailored lines
below as the first paragraph. Send to 4–6 firms in the same week so quotes are
comparable.

| # | Firm | Solana track record (public) | Intake route | Status |
|---|---|---|---|---|
| 1 | **OtterSec** | Leading Solana auditor; audit partner listed by Metaplex; runs the `solana-verify` / verified-builds service our deploy uses | Contact form on https://osec.io ("Get in touch" / Contact); email `contact@osec.io` printed in OtterSec audit reports | Email: verified (in their reports). Form: unverified |
| 2 | **Neodyme** | Audited Squads v4, Token-2022, P-Token, Marinade, Firedancer; founding member of Solana's SIRN incident network | https://neodyme.io/blockchain/ says "contact us for a quote"; email `contact@neodyme.io` in their reports | Verified (site text + reports) |
| 3 | **Sec3** (ex-Soteria) | Solana-native; audit partner listed by Metaplex; X-Ray scanner (free for Solana per the Foundation) | https://www.sec3.dev/audits (audit page / contact) | Unverified (third-party directory) |
| 4 | **Zellic** | Many Solana audits; reports at github.com/Zellic/publications; owns Code4rena | Quote form https://www.zellic.io/contact ("free quote … schedule a call") | Verified (own site, via search) |
| 5 | **Accretion** | Solana-only firm (Anchor, Pinocchio, native); audit partner listed by Metaplex | Submit at https://accretion.xyz or email `contact@accretion.xyz` ("we respond within 24 hours") | Verified (own GitHub README) |
| 6 | **Offside Labs** | Audited Jupiter Lend (vaults, liquidity) and Fluid on Solana | https://offside.io, X `@offside_labs`; no public email found | Unverified |
| 7 | **Ackee Blockchain Security** | 200+ audits; Solana Foundation educational partner; makers of the Trident Solana fuzzer | Contact page on https://ackee.xyz | Unverified (URL of the form not seen) |
| 8 | **Halborn** | Lists Solana as a specialty; 40+ Solana assessments claimed | "Contact" on https://www.halborn.com (smart-contract audits page) | Unverified (form not seen) |
| 9 | **MadShield** | Solana audits and bounties; audit partner listed by Metaplex | https://madshield.xyz, X `@madshield_xyz` (from a 2023 Solfate podcast page) | Unverified |

Larger / pricier options if budget allows: Trail of Bits, OpenZeppelin (Solana work),
Certora (formal verification). Not contacted in this plan.

## Suggested first wave (send this week)

Accretion, Neodyme, Zellic, OtterSec, Sec3 — then Offside Labs / Ackee / MadShield if
the first quotes are too high or too late. Halborn tends to be enterprise-priced.

## Tailored opening lines

**OtterSec** — *"We already plan to use your verified-build service (`solana-verify`
remote job) for this program, so a report and a Verified badge from the same team
would be ideal. Scope is small (2.5k nSLOC); we can be flexible on dates."*

**Neodyme** — *"You audited Squads v4 and Token-2022, which are exactly our trust
anchors: governance is a Squads v4 vault (we parse the Multisig account to verify it
on-chain) and we admit Token-2022 mints behind an extension gate."*

**Sec3** — *"We would like a manual audit and are interested in combining it with your
X-Ray scanning; please also tell us whether you participate in the Solana audit
subsidy program."*

**Zellic** — *"If a full audit is not a fit for your schedule, we would also consider
a Code4rena competition for the same scope — happy to hear your recommendation."*

**Accretion** — *"Solana-only, Anchor 0.31.1, 2.5k nSLOC, DAMM-v2-style AMM. We value
your 24-hour response; we can start as soon as you have a slot."*

**Offside Labs** — *"You reviewed Jupiter Lend; we are preparing a Jupiter AMM
integration and want an expert opinion on aggregator routing constraints in our swap
instruction (`QUESTIONS.md` Q1)."*

**Ackee Blockchain Security** — *"We already have libFuzzer, LiteSVM differential and
Kani harnesses and would welcome Trident-based fuzzing as part of the engagement."*

**Halborn** — *"Small, well-documented scope (2.5k nSLOC) with a full audit package;
please quote a fixed price including a fix review and a public report."*

**MadShield** — *"Small Solana AMM, budget-conscious team; interested in an audit and,
afterwards, help setting up a bug bounty."*

## What to ask every firm (same list → comparable quotes)

1. Price (fixed, in USD/USDC), engineer-weeks, number of auditors.
2. Earliest start, report date.
3. Fix review included? How many rounds? Turnaround?
4. Public report allowed? Can we name you in `security.txt`?
5. Prior Solana AMM/DEX reports (links).
6. Will you cover: Token-2022 extensions, the hand-written Pyth reader, Squads parsing,
   the `v2-only` feature gating, and Q1 (Jupiter routing)?
7. Do you take part in the Solana audit subsidy (Areta / Superteam) program?

Sources (search results, 2026-11-11): neodyme.io/blockchain, neodyme.io/reports/*,
zellic.io/contact, raw.githubusercontent.com/accretion-xyz/audit-reports/main/README.md,
metaplex.com/docs/security, solanacompass.com/projects/{ottersec,neodyme,zellic,halborn},
dev.jup.ag (Offside Labs Jupiter Lend reports), halborn.com/services/smart-contract-audits,
solana.com/podcasts/solfate (MadShield), madeonsol.com (third-party summaries).
