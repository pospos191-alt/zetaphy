# Neuro Guard — Privacy policy

_Last updated: 2026-11-28_ · Published by ZETAPHY (https://app.sawasdeecoin.com) · Contact: zetaphy.chain@sawasdeecoin.com

Neuro Guard is built to collect as little as possible.

**What leaves your browser**

- On a token or pool page of dexscreener.com, geckoterminal.com, pancakeswap.finance, app.uniswap.org,
  etherscan.io, bscscan.com, basescan.org or arbiscan.io, Neuro Guard requests the public file of **that token**
  from `https://neuro.sawasdeecoin.com` (`/reports/<chain>/<address>/summary.json`).
- On a pool page it first asks that site's public API (`api.dexscreener.com` or `api.geckoterminal.com`) which token
  the pool trades, sending **the pool address**.
- The requests carry no cookies and no identifier. Like any web server, these servers see your IP address.

**What Neuro Guard never does**

- It never reads, stores or sends wallet contents, seed phrases, private keys, passwords, form data, cookies or your
  browsing history. It reads only the address of the page it runs on, on the eight sites above.
- It has no analytics, no ads and no tracking, and it does not sell or share data.
- It loads no code from the internet; all of its code is in the package you install.

**Stored on your device**

Nothing persistent: a 10-minute in-memory cache of results, gone when the browser closes the extension's worker.

**Results**

Neuro's results are automated, reproducible code analysis, not an accusation against any person or project, and not
investment advice. A contract owner can respond or request a correction: https://neuro.sawasdeecoin.com/web/legal.html
