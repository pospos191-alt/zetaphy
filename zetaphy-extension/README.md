# Neuro Guard by ZETAPHY (browser extension)

See what a token's contract allows **before** you buy it. On a token or pool page of DEX Screener, GeckoTerminal,
PancakeSwap, Uniswap, Etherscan, BscScan, BaseScan or Arbiscan, a small card (bottom-right) shows Neuro's result
for that token: the risk level, the main findings, the date of the check, and links to the full report and a live
check. When Neuro has no report for the token yet, the card offers "Check now" (the live checker).

Chrome and Firefox (Manifest V3), plain JavaScript, no build step, no dependencies, no remote code.
ภาษาไทย: [README.th.md](README.th.md) · [PRIVACY.md](PRIVACY.md)

## Where the result comes from

Neuro's public token reports (`zetaphy-neuro/scripts/build-reports.js`, every 6 hours): the static file
`https://neuro.sawasdeecoin.com/reports/<chain>/<address>/summary.json`. On a pool page (DEX Screener,
GeckoTerminal) the pool's token is first named by that site's public API (`api.dexscreener.com`, then
`api.geckoterminal.com`). The card shows only a `summary.json` that matches the token asked for, with a known level
and bounded text; its links are built by the extension, never taken from the file.

Chains: Ethereum, BNB Chain, Base, Arbitrum.

## Permissions (and why)

| Permission | Why |
| --- | --- |
| `host_permissions`: `neuro.sawasdeecoin.com`, `api.dexscreener.com`, `api.geckoterminal.com` | the result, and a pool's token |
| content script on the 8 sites above | to read the page address and draw the card |

No API permissions at all (no `tabs`, `storage`, `cookies`, `webRequest`, `history`, `<all_urls>`), no optional
hosts, no external messaging, no web-accessible resources. The card lives in a closed Shadow DOM and every string is
set with `textContent` (`scripts/check.mjs` refuses `eval`, `new Function`, `innerHTML` and unexpected URLs).

## Files

```
manifest.json          MV3 (Chrome service worker + Firefox background scripts)
src/detect.js          pure: page URL -> token or pool, pool API answer -> token, summary.json validation, card words (9 languages)
src/background.js      the only network code (10-minute memory cache)
src/content.js         the card
scripts/check.mjs      static checks;  scripts/zip.sh  the store upload (dist/neuro-guard-<version>.zip)
test/extension.test.mjs  unit tests (the service worker in a VM with a fake chrome and fetch)
test/e2e.playwright.mjs  the unpacked extension in Chromium with the sites and summary.json served locally
```

```
npm test                 # check + unit tests
npm run test:browser     # Chromium (CHROMIUM_PATH optional)
npm run zip              # dist/neuro-guard-0.1.0.zip for the Chrome Web Store / Firefox Add-ons
```

## Publishing (the owner)

- **Firefox Add-ons:** free. addons.mozilla.org -> Developer Hub -> Submit a New Add-on -> upload the zip.
- **Chrome Web Store:** a one-time $5 developer registration, then upload the zip. The privacy policy URL is the
  public copy of [PRIVACY.md](PRIVACY.md); the single purpose: "shows Neuro's token check on token pages".
- **Edge Add-ons:** free, accepts the same zip.
