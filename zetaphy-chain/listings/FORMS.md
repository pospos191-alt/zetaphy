**English** | [ภาษาไทย](FORMS.th.md)

# Wallet listing forms (filled in by the owner)

Ready-to-paste answers for wallets that take a new chain through a form or a business contact, not a GitHub pull
request. The registries that do take a pull request (chainlist, Keplr, Cosmos chain registry, TokenPocket,
Cosmostation, Ping.pub) are in [README.md](README.md).

**Where to submit.** A submit place is given only when it could be checked on the vendor's own site or GitHub.
When these files were prepared (2026-11-14), the vendors' websites could not be opened from the build machine, so most
of them say **not verified**: find the form yourself on the vendor's official site (reach it by typing the address,
not through a search ad or a DM), and never pay anyone who contacts you first offering a listing.

## Common answers

Use these for every form below. Copy them exactly.

| Field | Answer |
| --- | --- |
| Chain / network name | ZETAPHY |
| Chain type | EVM-compatible Layer 1 (Cosmos SDK with cosmos/evm, CometBFT consensus) |
| EVM chain id | 3659 (hex `0xe4b`) |
| Cosmos chain id | `zetaphy_3659-1` |
| Native coin | name ZETAPHY, symbol ZTPHY, 18 decimals (base denom `azetaphy`) |
| Address format | EVM `0x…`; the same account in Cosmos format is `zetaphy1…` (bech32 prefix `zetaphy`) |
| Coin type (slip44) | 60, key algorithm `eth_secp256k1` |
| EVM RPC (HTTPS) | https://rpc.sawasdeecoin.com |
| EVM websocket | none public |
| CometBFT RPC / websocket | https://rpc.sawasdeecoin.com/rpc, wss://rpc.sawasdeecoin.com/rpc/websocket |
| Cosmos REST | https://rpc.sawasdeecoin.com/rest |
| gRPC | none public |
| Block explorer | https://explorer.sawasdeecoin.com/?network=mainnet (transaction page: `…/?network=mainnet#/tx/<hash>`, address page: `…/?network=mainnet#/address/<address>`) |
| Website | https://app.sawasdeecoin.com |
| Faucet | https://app.sawasdeecoin.com/?tab=earn |
| Source code | https://github.com/pospos191-alt/zetaphy |
| Genesis | 2026-11-13 14:00 UTC, sha256 `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667` |
| Validators | 1, run by the ZETAPHY project |
| Security audit | none yet (no independent external audit has been completed) |
| CoinGecko / CoinMarketCap | not listed |
| Contact e-mail | sawasdeecoin@gmail.com (the address already in the Keplr listing) |
| Social accounts | `<X account>`, `<Telegram>`, `<Discord>`: none yet; leave blank or fill in once they exist |
| Other listings | chainlist.org (`chainlist/eip155-3659.json`), Keplr, Cosmos chain registry: prepared in this folder; say "submitted" or "listed" only once that is true |

**Logo to attach**

- PNG 256x256: `zetaphy-hub/zetaphy-256.png` in this repo, also at
  https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-hub/zetaphy-256.png and
  https://app.sawasdeecoin.com/zetaphy-256.png
- SVG: `zetaphy-hub/logo.svg`
- IPFS: `ipfs://bafkreiazxgczetev7j2mxdv4i5htnbhyx4fhtmngspqao4mit22o667giq`

If a form asks for another size, scale the SVG; do not stretch the PNG.

**Short description (up to about 160 characters)**

> ZETAPHY: an EVM Layer 1 on the Cosmos SDK with post-quantum signatures and Neuro scam protection. Single project-run validator; not yet audited.

**Long description (paste whole; it carries the risk notice)**

> ZETAPHY is an EVM-compatible Layer 1 built on the Cosmos SDK with cosmos/evm and CometBFT. Besides normal
> eth_secp256k1 keys, accounts and validator votes can use post-quantum ML-DSA-44 signatures, and Neuro scam protection
> checks contracts and publishes its findings on chain in a ThreatRegistry that the ZETAPHY wallet reads before you sign.
> The native coin is ZTPHY (18 decimals). ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY
> project, and its code has not yet completed an independent external audit. Until more independent validators join and
> the audit is published, the project can halt or change the chain. Use it only with amounts you can afford to lose.

## Rabby / DeBank: "add chain" request

- **Where:** not verified. RabbyHub/Rabby on GitHub has no chain-request template or instructions (checked: its README
  and `.github/`). The rabby.io and debank.com sites could not be opened from the build machine.
- **Fields:** the common answers above. Expect: chain name, chain id, native token symbol and decimals, RPC URL,
  explorer URL, logo, website, contact.
- **Logo:** the 256x256 PNG.
- **What the listing gets:** ZETAPHY in Rabby's built-in network list, so users can switch to it without typing an RPC,
  and (if DeBank indexes the chain) balances in the Rabby and DeBank portfolio views.
- **What it does not get:** no price for ZTPHY (there is no market price source), no DeBank protocol pages for the
  ZETAPHY apps (those are a separate integration), and no endorsement. Until then, users can add ZETAPHY themselves
  as a custom network with the RPC and chain id above.

## OKX Web3 Wallet listing

- **Where:** not verified. The okx GitHub organisation's wallet SDK README only names a security-bug channel
  (HackerOne / OKX feedback page), which is not a listing route. web3.okx.com could not be opened from the build machine.
- **Fields:** the common answers above, plus usually: project stage (mainnet live since 2026-11-13), number of
  validators (1), audit status (none yet), daily users or transactions (give the real number from the explorer on the
  day you apply, or leave blank), and a contact person.
- **Logo:** the 256x256 PNG; also the SVG if the form takes it.
- **What the listing gets:** ZETAPHY as a supported network in OKX Wallet (send, receive, balance; maybe the in-app
  explorer view), so OKX Wallet users see ZTPHY and its logo without adding a custom network.
- **What it does not get:** no OKX exchange listing (a different team and process), no swap routes or price unless
  OKX's DEX aggregator adds ZETAPHY separately, and no guarantee of review: large wallets usually ask for many users
  and an audit first.

## Bitget Wallet listing

- **Where:** not verified. Bitget's own site could not be opened from the build machine; no Bitget Wallet listing
  repository was found on GitHub. Bitget's "application for listing" page is for the **Bitget exchange**, not for
  Bitget Wallet networks: do not use it for this.
- **Fields:** the common answers above, plus usually: project stage, audit status (none yet), community size (real
  numbers only), and a contact person.
- **Logo:** the 256x256 PNG.
- **What the listing gets:** ZETAPHY as a supported network in Bitget Wallet (balances, send and receive of ZTPHY with
  its logo).
- **What it does not get:** no Bitget exchange listing, no price or swap support unless added separately, and no
  launchpad or promotion.

## SafePal chain request

- **Where (chain):** not verified. SafePal's documentation repository on GitHub (SafePalWallet/safepal-docs) has no
  chain-request page.
- **Where (apps, verified):** that repository's `docs/Connect-wallet/apply-list-for-dapp.md` links SafePal's **dApp**
  listing form, https://forms.gle/Tqxy6dHhhhR6CvS9A. It lists a dApp (for example the hub at
  https://app.sawasdeecoin.com) in SafePal's dApp browser; it does not add the ZETAPHY network. A dApp on a chain that
  SafePal does not support may be turned down.
- **Fields:** the common answers above. For the dApp form: name "ZETAPHY hub", the website, the short and long
  descriptions above, the logo and the contract addresses from [DIRECTORIES.md](DIRECTORIES.md#contract-addresses).
- **Logo:** the 256x256 PNG.
- **What the listing gets:** a chain listing shows ZTPHY in the SafePal app and possibly on the hardware wallet; a dApp
  listing shows the hub in SafePal's dApp browser.
- **What it does not get:** hardware-wallet firmware support is SafePal's own decision and timeline; no price and no
  exchange listing.
