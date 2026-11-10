# SWD AMM web app (`test-ui/`)

Live at **https://swd-amm.sawasdeecoin.com/** (Vercel project `test-ui`, root directory `test-ui/`).
ภาษาไทย: [README.th.md](README.th.md)

## What it is

A web page for the SWD AMM Solana program (`programs/swd_amm`): swap, add / remove liquidity
and see your positions in constant-product pools, DLMM (concentrated) pools and SWDMM v2 pools,
with price charts, limit / DCA helpers and a devnet SOL faucet. It talks to the chain directly
from the browser; the only server code is the devnet faucet (`api/devnet-faucet.js`).

Today it runs on **devnet** (test tokens, no value). **Mainnet is switched off** until the program has
passed an independent security audit and been deployed to mainnet.

Built-in safety:
- **Network badge + banner**: which network you are on, "test tokens, no value" on devnet.
- **Check this app** (shield in the top bar, banner link, footer): reads from the chain who can change
  the program (immutable / Squads multisig / one key), the program's SHA-256 fingerprint, security.txt,
  whether pool creation is paused, the governance timelock and the audit status.
- **Token safety**: the public SWD Audit API rates each token under the swap / create-pool forms and in
  the summary before signing. If the API is down the page says so and does not block you.
- **Summary before signing**: amount, estimated output, minimum received, pool fee, price impact, network.
- Program errors are shown in plain language (all 93 error codes, `program-errors.js`).
- 8 languages: Thai, English, Chinese, Japanese, Korean, Vietnamese, Spanish, Russian.

## Files

| File | What |
|---|---|
| `index.html` | the app (one page; the program IDL is embedded as `const IDL`) |
| `config.js` | **networks** (devnet / mainnet / localnet) and project facts for the Trust panel |
| `i18n.js`, `i18n/<lang>.js` | UI text, one file per language (only English + the visitor's language are downloaded) |
| `trust.js` | Trust panel: reads and decodes the program / governance accounts |
| `token-audit.js` | SWD Audit API client (timeout, cache, never throws) |
| `program-errors.js` | generated from `programs/swd_amm/src` by `tests/gen-program-errors.mjs` |
| `sol-safety.js`, `wallet-safety*.{js,css}` | wallet safety (summary before signing, idle disconnect, hardware-wallet help) |
| `api/devnet-faucet.js` | Vercel function: devnet SOL faucet (rate-limited) |
| `vercel.json` | CSP + security headers, `/zetaphy` redirect, no deploys from `claude/**` branches |

## Switching to mainnet (later)

Only after **all** of these are done:

1. **Independent audit** passed and its report published (see `docs/DEFI_LISTING.md`, `docs/MAINNET_RUNBOOK.md`).
2. **Deploy** with `scripts/deploy-mainnet.sh` (dry run first, then `--execute`; it is on the
   `claude/defi-listing` branch until merged). It prints the new **mainnet program id** and, at
   `handover`, moves the upgrade authority to your **Squads** vault.
3. Edit **`test-ui/config.js`**:

   ```js
   mainnet: {
     enabled: true,
     cluster: "mainnet-beta",
     rpc: "https://<your mainnet RPC URL for browsers>",   // e.g. a Helius / Triton / QuickNode URL
     programId: "<mainnet program id from deploy-mainnet.sh>", // NOT the devnet id
     faucet: false,
     testTokens: false,
     squadsMultisig: "<Squads multisig account>",         // the multisig, not the vault
     squadsVaultIndex: 0,
   },
   ```
   and in `PROJECT.audit`:
   ```js
   audit: { status: "passed", auditor: "<firm>", reportUrl: "https://…", programSha256: "<sha256 of the audited .so>" },
   ```
   - The RPC URL is public (anyone can read the page). Use a key that the provider lets you restrict to
     the domain `swd-amm.sawasdeecoin.com`. `api.mainnet-beta.solana.com` is not suitable (rate limits).
   - Mainnet appears in the Network menu only when `enabled` is true **and** `programId` and `rpc` are set.
4. Commit, push, merge → Vercel redeploys (when the team's Vercel billing is active again).
5. Open the site, pick **Mainnet**, open **Check this app**: the upgrade authority must read
   "Squads multisig vault" and the fingerprint "Matches the audited build".

If the program's instructions or errors change: rebuild the IDL (`anchor build`), paste it into
`const IDL` in `index.html`, and run `node test-ui/tests/gen-program-errors.mjs`.

## Tests

```
cd test-ui/tests && npm install && npx playwright install chromium
node check-syntax.mjs                   # inline script + every module file + vercel.json
node --test sol-safety.test.mjs i18n.test.mjs trust.test.mjs
node gen-program-errors.mjs --check     # program-errors.js matches the Rust source
node smoke.mjs                          # page starts, tabs / popups / language / network work
node safety.mjs                         # wallet safety features
LAYOUT_ALL=1 node layout.mjs            # th+ru at 360/1366 px (+6 languages at 360): no sideways scroll,
                                        # trust panel, token check (API up and down), swap summary
node faucet-attacks.mjs                 # faucet function abuse cases
```
The browser tests need no network: the Solana libraries are replaced by `tests/stubs/` and every chain
and API answer is mocked. CI runs all of them (`.github/workflows/security.yml`, job `test-ui`).

Local preview: `python3 serve.py` → http://127.0.0.1:5500/index.html (uses localnet by default).
