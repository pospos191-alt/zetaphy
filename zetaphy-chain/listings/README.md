**English** | [ภาษาไทย](README.th.md)

# Wallet listings (ready to submit)

## Mainnet `zetaphy_3659-1` (EVM 3659)

| Folder / file | Goes to | What it gives |
| --- | --- | --- |
| `chainlist/eip155-3659.json`, `chainlist/icons/zetaphy.json` | ethereum-lists/chains `_data/chains/` and `_data/icons/` | chainlist.org, and the wallets that read that list |
| `keplr/zetaphy_3659.json`, `keplr/images/zetaphy_3659/*.png` | chainapsis/keplr-chain-registry `cosmos/` and `images/zetaphy_3659/` | Keplr |
| `cosmos-chain-registry/zetaphy/` | cosmos/chain-registry `zetaphy/` (chain.json, assetlist.json, images) | Leap, Mintscan and most Cosmos apps; checked against that repo's chain.schema.json and assetlist.schema.json |
| `tokenpocket/chain-3659.json` | TP-Lab/networklist-org `chains.json` | TokenPocket's network list ("Easy Add") and chainlist.tokenpocket.pro |
| `cosmostation/chain/zetaphy/` | CosmosLabsKR/chainlist `chain/zetaphy/` | Cosmostation wallets (mobile and extension); Mintscan only if Cosmostation enables it |
| `pingpub/` | ping-pub/ping.pub `chains/mainnet/zetaphy.json` and `logos/zetaphy.png` | ping.pub explorer (only with 10+ independent validators, see below) |
| `FORMS.md` | Rabby / DeBank, OKX Wallet, Bitget Wallet, SafePal (forms, not pull requests) | answers to paste |
| `DIRECTORIES.md`, `awesome-cosmos/` | DappRadar, cosmos/awesome-cosmos, forum.cosmos.network | texts and a patch to submit |

Logo: `zetaphy-hub/zetaphy-256.png` (256x256, 26,592 bytes) is pinned on IPFS (Pinata, free plan, by the owner on 2026-11-14) as
`ipfs://bafkreiazxgczetev7j2mxdv4i5htnbhyx4fhtmngspqao4mit22o667giq` (CIDv0 of the same file: `QmUvJMJD1a8sVnpDq6D93T6ZGVZAXWJ3rmAAWZmD2ULkET`);
`chainlist/icons/zetaphy.json` points at it. Wallets that read EIP-3085 `iconUrls` (the apps' "Add network" button sends
`https://app.sawasdeecoin.com/zetaphy-256.png`) show the logo when the network is added; MetaMask ignores `iconUrls`.

Public RPC: https://rpc.sawasdeecoin.com (since 2026-11-16; the same sentry also still answers on https://129-221-199-191.sslip.io; EVM JSON-RPC at `/`, CometBFT at `/rpc`, websocket at `/rpc/websocket`,
REST at `/rest`, through rpc-guard; no public gRPC). Check that each path answers before submitting
(`curl -s https://rpc.sawasdeecoin.com/rpc/status`,
`curl -s https://rpc.sawasdeecoin.com/rest/cosmos/base/tendermint/v1beta1/node_info`): reviewers test them.

Every free-text description in these files carries the risk sentence from
[docs/ZETAPHY-MAINNET-NOTICE.md](../../docs/ZETAPHY-MAINNET-NOTICE.md). Keep it when you edit them.

## How to submit a pull request from the browser

All the GitHub targets below work the same way, with no tools installed:

1. Sign in to GitHub, open the target repository and press **Fork** (top right), then **Create fork**.
2. In your fork, go to the target folder, then **Add file → Upload files** and drag in the files (dragging a whole
   folder keeps its sub-folders), or **Add file → Create new file** and paste the JSON. To change an existing file
   (TokenPocket, awesome-cosmos), open it and press the pencil.
3. At the bottom choose **Create a new branch for this commit**, write a short message such as `Add ZETAPHY mainnet`,
   and press **Commit changes / Propose changes**.
4. Press **Create pull request**, fill in the repository's template if it shows one, and submit.
5. Watch the pull request: answer reviewers and fix failed checks in the same branch (more commits from the web UI).

Some registries accept only signed (Verified) commits. Commits made in GitHub's web UI are signed by GitHub
automatically, so the steps above meet that rule; commits made with `git` on your computer are not, unless you set up
signing.

## Submit steps per target

### TokenPocket: TP-Lab/networklist-org

- **Repo / path:** https://github.com/TP-Lab/networklist-org, the one file `chains.json` in the root.
- **Change:** open `chains.json`, press the pencil, go to the very end, add a comma after the last `}` and paste the
  whole object from `tokenpocket/chain-3659.json` before the final `]`. Nothing else changes.
- **Check before sending:** the repo's own CI runs ESLint with `jsonc/auto` and `jsonc/comma-dangle` on `chains.json`.
  The entry passed that exact check (appended to the repo's `chains.json` at commit `e2fe433`), and chain id 3659 and
  short name `zetaphy` were not taken.
- **Logos:** TokenPocket takes image URLs, not files. All four `app_resource` icons point at the 256x256 logo on
  raw.githubusercontent.com (that URL answered 200 with a PNG). The README's icon standard is a set of images on
  tp-statics.tokenpocket.pro that could not be opened, so separate "selected / unselected / dark" icons were not made;
  `app_resource` is optional and many entries use one icon for all four, as here.
- **Cost:** the repo's README says a donation is needed for a PR to be merged, not refunded if the PR does not meet
  the review rules, and points to https://help.tokenpocket.pro/developer-en/network/add-chain for the amount and rules.
  That page could not be opened when this was prepared: read it before paying anything, and pay only to an address
  published there.

### Cosmostation: CosmosLabsKR/chainlist

- **Repo / path:** https://github.com/CosmosLabsKR/chainlist, folder `chain/zetaphy/`. The old cosmostation/chainlist
  repository is marked deprecated and says to send all pull requests to CosmosLabsKR/chainlist.
- **Files:** upload the folder `cosmostation/chain/zetaphy/` as `chain/zetaphy/`: `param_2.json`, `assets_2.json`,
  `resource/chain_zetaphy.png`, `resource/chain_zetaphy_evm.png`, `resource/chain_zetaphy_noti.png`,
  `asset/ztphy.png`. The image URLs inside the JSON point at those paths in that repository, so they work once merged.
- **Format:** modelled on `mantra` (also cosmos/evm, same `/cosmos.evm.crypto.v1.ethsecp256k1.PubKey` key type),
  `evmos` and `sei`. Images follow theirs: 192x192 PNG for chain, EVM and coin, 340x74 PNG for the notice image. Their
  README asks for "3D" chain images made from their Figma brand kit; ours are the flat logo. Expect them to ask for, or
  make, 3D versions.
- **Check before sending:** their CI runs `@prantlf/jsonlint` on all JSON; ours passed it, and every key and value
  type in our files also appears in mantra, evmos or sei. There is no public gRPC, so `grpc_endpoint` is empty;
  Cosmostation may require one.
- **Notes:** the description is in English only (as in six existing chains); add `ko` and `ja` if they ask. Their
  README says assets of unverified networks may not be merged, so a single-validator chain may wait.

### Ping.pub: ping-pub/ping.pub

- **Repo / path:** https://github.com/ping-pub/ping.pub (ping-pub/mainnet leads to the same repository):
  `chains/mainnet/zetaphy.json` and `logos/zetaphy.png`. The ping-pub/explorer repository says to send listings here.
- **Do not submit yet.** Its README says: "We accept all blockchains which have 10+ independent validators."
  ZETAPHY has one. Submit when that is true.
- **When you do:** use the pull request template's checklist (connect wallet, transfer, delegate, redelegate,
  unbond, withdraw commission and rewards); do each test on mainnet first and tick only what worked. The REST endpoint
  must allow CORS (`Access-Control-Allow-Origin: *`).
- **Check before sending:** the repo's CI (`scripts/check-config-format.sh`, `jq empty`) passed, and the keys and
  value types match evmos, haqq, injective and bitway. The file follows the explorer's `LocalChainConfig` type
  (`src/types/chaindata.ts` in ping-pub/explorer). It includes the Keplr feature `eth-secp256k1-cosmos`, which ZETAPHY
  needs; whether ping.pub's wallet code passes it to Keplr was not tested.
- **Self-hosting:** the same file works in a self-hosted ping-pub/explorer under `chains/mainnet/` (point `logo` at a
  full URL there).

### awesome-cosmos, DappRadar, the Cosmos forum

See [DIRECTORIES.md](DIRECTORIES.md): the exact line, section, PR title and body for cosmos/awesome-cosmos (patch in
`awesome-cosmos/`), the DappRadar fields with contract addresses, and the forum post.

### Rabby / DeBank, OKX Wallet, Bitget Wallet, SafePal

See [FORMS.md](FORMS.md). These take forms or business contact, not pull requests; most submit places could not be
verified.

## Testnet `zetaphy_77390-1`: shut down 2026-11-14

The testnet was shut down for good on 2026-11-14 (owner decision); mainnet is the only network. Do not submit its files
(`chainlist/eip155-77390.json`, `keplr/zetaphy_77390.json`): its RPC (https://rpc.sawasdeecoin.com) no longer answers, so
the registries would reject them. They stay here as a record only.
