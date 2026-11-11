# Audit contests and subsidy / grant programs (Solana)

Researched 2026-11-11 by web search; terms change often — **confirm on each official
page before applying**. Contest platforms are a good *second* layer after (or instead
of a second) private audit; they are not a replacement for one firm owning the review.

## Contest / crowd-audit platforms

| Platform | What it is | How to start | Notes | Status |
|---|---|---|---|---|
| **Code4rena** (owned by Zellic) | Time-boxed public competition; many wardens; judged findings; public report | Sponsor request form linked from https://docs.code4rena.com/sponsors, or their Discord ("want to sponsor an audit") | Has run Solana / Anchor contests (Solana Foundation Aug–Sep 2025; Jupiter Lend Feb 2026). Fees: the platform says zero platform fee, a third-party wiki says otherwise — ask. | Verified (own docs) |
| **Sherlock** | Contest or collaborative audit, optional coverage | Intake form on the Sherlock contact page (docs: https://docs.sherlock.xyz/audits/protocols) | Docs: can often start within ~3 days of agreement; quote by duration; **25% refundable deposit** to hold the slot; final commit due 3 days before start. Has run Solana contests. | Verified (own docs) |
| **Cantina** (Spearbit) | Managed reviews and competitions | Quote request at https://cantina.xyz/contact ("select the service you'd like a quote for") | For competitions the prize pot must be paid ≥ 48 h before start (Cantina terms). Has run Rust/Solana competitions. | Verified (own site/terms) |

Rough guide (unverified, varies widely): a small contest pot for ~2.5k nSLOC is often
in the low tens of thousands of USD; competitions find more breadth, private audits more
depth and accountability.

## Subsidies and grants

| Program | What it offers | How to apply | Status |
|---|---|---|---|
| **Solana Audit Subsidy Program** (Areta Market with Superteam, MonkeDAO, Jito; listed participants include Certora) | A ~US$1M "virtual pool": participating audit firms give discounts; reported coverage **up to ~30% of the audit cost**; 15 audit providers listed; Colosseum accelerator teams fast-tracked | Apply through the Solana Audit Marketplace / Areta Market (application form, plus Superteam Earn according to a cohort page). A "Cohort V" page exists; we could not confirm whether a cohort is open now. | Partly verified (news: solanafloor.com, Colosseum blog); cohort status unverified |
| **Solana Foundation grants** | General ecosystem grants (not audit-specific). Superteam regional chapters recommend applicants for small grants (reported US$1k–10k range). | solana.org/grants; or through Superteam (Thailand chapter if active, else Superteam Earn) | Unverified for audit use |
| **Solana Foundation STRIDE** (with Asymmetric Research, April 2026) | Security evaluation for DeFi protocols; foundation-funded ongoing opsec/monitoring for protocols above **$10M TVL**, formal verification above **$100M TVL**; free 45-minute security consultations; free tools (e.g. Sec3 X-Ray, Range) | Through the Solana Foundation / Asymmetric Research (STRIDE framework page) | Verified (solana.com news, CoinDesk); **not for us at launch** (TVL thresholds), but the free consultation is worth booking |
| **Superteam Earn** | Bounties and grants; ran security-related bounties in 2026 | https://earn.superteam.fun | Not an audit subsidy for our own code |

Not Solana: the Ethereum Foundation's 2026 audit subsidy (also via Areta) — do not
confuse the two.

## Bug bounty (after the audit)

Immunefi, Sherlock or Cantina bug-bounty programs, sized to TVL. Our policy draft is
`docs/BUG_BOUNTY.md`; real rewards need funding before mainnet.

Sources: docs.code4rena.com/sponsors, code4rena.com/reports/2025-08-solana-foundation,
github.com/code-423n4/2026-02-jupiter-lend, docs.sherlock.xyz/audits/protocols/how-it-works-for-protocols,
cantina.xyz/contact, cantina.xyz/terms/competitions,
solanafloor.com (Areta $1M Solana audit subsidy), blog.colosseum.com (Audit Subsidy Program),
solana.com/news/solana-ecosystem-security (STRIDE), coindesk.com 2026-04-07,
superteamdao.notion.site (Solana Foundation grants via Superteam).
