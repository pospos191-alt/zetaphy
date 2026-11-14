**English** | [ภาษาไทย](DIRECTORIES.th.md)

# Directories and community posts (submitted by the owner)

Ready-to-submit texts for DappRadar, the awesome-cosmos list and the Cosmos forum. The basic facts (chain ids, RPC,
logo, the long description with its risk notice) are in [FORMS.md](FORMS.md#common-answers); this file adds what each
of these three places needs. Anything marked **not verified** could not be checked on the site itself when this was
prepared (2026-11-14): the build machine could reach GitHub but not these websites.

## DappRadar: "submit a dapp"

- **Where:** not verified (dappradar.com could not be opened). Use the "submit dapp" link on DappRadar's own site.
- **Chain:** ZETAPHY is very likely not in DappRadar's chain list (not verified). Do **not** pick another chain such as
  Ethereum: the contracts below exist only on ZETAPHY (chain id 3659) and a wrong chain makes the listing false. If
  ZETAPHY is missing, ask DappRadar (in the form's notes or their support) to add the chain first; tracking a new chain
  is their decision.
- **Logo:** the 256x256 PNG (`zetaphy-hub/zetaphy-256.png`); the SVG if they take one.
- **Social links:** website https://app.sawasdeecoin.com, GitHub https://github.com/pospos191-alt/zetaphy,
  `<X account>`, `<Telegram>`, `<Discord>` (none yet: leave blank).

### Main entry: the hub

| Field | Answer |
| --- | --- |
| Name | ZETAPHY hub |
| Website | https://app.sawasdeecoin.com |
| Category | Other (several apps in one). If one category must be chosen: DeFi, because of the swap |
| Short description | Every ZETAPHY app on one page: post-quantum wallet, swap, NFT market, explorer and Neuro scam protection on ZETAPHY mainnet. |
| Long description | below |

> The ZETAPHY hub puts every ZETAPHY app on one page: a wallet whose accounts can use post-quantum ML-DSA-44 keys, an
> AMM swap, an NFT marketplace, a block explorer, staking and governance, and Neuro scam protection, which
> checks contracts and publishes its findings on chain in a ThreatRegistry that the wallet reads before you sign.
> ZETAPHY is an EVM-compatible Layer 1 built on the Cosmos SDK (chain id 3659, coin ZTPHY). ZETAPHY mainnet currently
> runs on a single validator operated by the ZETAPHY project, and its code has not yet completed an independent
> external audit. Until more independent validators join and the audit is published, the project can halt or change
> the chain. Use it only with amounts you can afford to lose.

### The main parts (only if DappRadar wants them as separate dapps)

Each long description ends with the same risk notice as above; paste it after the text.

| Part | Address | Category | Short description | Contracts |
| --- | --- | --- | --- | --- |
| Wallet | https://app.sawasdeecoin.com/?tab=wallet | Other (wallet) | A browser wallet for ZETAPHY whose accounts can be controlled by post-quantum ML-DSA-44 keys, and which checks destinations against Neuro's ThreatRegistry before you sign. | none of its own (uses ThreatRegistry) |
| Swap | https://app.sawasdeecoin.com/?tab=swap | DeFi (exchange) | Swap and provide liquidity on ZETAPHY with constant-product (AMM) pools. No pools exist yet; the DLMM contracts are deployed but their tab is not on mainnet yet. | ZetaphyFactory, ZetaphyRouter (DLMM factory and router: add only once the DLMM tab is live) |
| Explorer | https://explorer.sawasdeecoin.com/?network=mainnet | Other (explorer) | A block explorer for ZETAPHY that reads the node directly: EVM and Cosmos transactions, addresses, validators with their post-quantum vote keys. | none |
| NFT | https://app.sawasdeecoin.com/?tab=nft | Collectibles (marketplace) | Create and trade NFTs on ZETAPHY. | NFT factory, NFT marketplace |
| Neuro | https://app.sawasdeecoin.com/?tab=neuro | Other (security) | Neuro scam protection: contract checks whose results go on chain in a public ThreatRegistry that wallets can read. | NeuroControl, NeuroJobs, ThreatRegistry, ThreatReports |

### Contract addresses

From `zetaphy-chain/mainnet/zetaphy_3659-1/contracts.json` (chain id 3659). The two addresses that file lists under
`notUsed` are left out on purpose: they are not part of the system.

| Contract | Address |
| --- | --- |
| ZetaphyFactory (AMM) | `0x93463B001483970f8CAE63cd8B60D28F17a1C1AA` |
| ZetaphyRouter (AMM) | `0xa5221A7F25cf10d99446Fde3e95c15b1f696e783` |
| DLMM factory | `0x65fe29Eb6deaBf1ae8929De7E0A793aB394c887a` |
| DLMM router | `0xf6CdF4aD5316aDF8F73E768faB997C1E7C4df43B` |
| NFT factory | `0xc0800dBEbFFC80120f5DC0E6f2a603C00F6AF391` |
| NFT marketplace | `0x0402d6E7af2912D002EfCa7543eb44A3EB3Bbc14` |
| NeuroControl | `0x97F5D7FBc6228aA7A145505AABdbdC7825e161AE` |
| NeuroJobs | `0x5044309622064d21c5D7Ac681f7a4489ca4Ce4fB` |
| ThreatRegistry | `0xaACfc7Cf7148b7AE530c2Ab891D4220E648A2139` |
| ThreatReports | `0x11411E0c35dA30b4a5009827770798ad79881c31` |
| ZetaphyBounty | `0xb73856D25a3547581D36E8F2D9F3601a5DF39eBE` |

The full list (vault, oracle, identity, AI map and the other contracts added on 2026-11-14) is in the same file under
`addedOnResume`. A DappRadar entry needs only the contracts users call through that dapp.

## awesome-cosmos (cosmos/awesome-cosmos on GitHub)

**What the repo asks** (from its README and CONTRIBUTING.md, checked on GitHub at commit `ec1d861`, 2024-11-19):

- Open a pull request against the default branch; the CI runs `npx awesome-lint`.
- Block explorers and wallets need https and a Twitter or GitHub to contact the developers; wallets also need a
  published security audit, so the ZETAPHY wallet does **not** qualify yet.
- Its "Ecosystem" section does not list projects (it points to cosmos.directory) and "Wallets" points to
  cosmos.network: there is no line to add there.

**What fits:** the ZETAPHY explorer, in **Block Explorers** (the first list, sorted by name, so it goes last after
"Stake ID"):

```markdown
* [ZETAPHY Explorer](https://explorer.sawasdeecoin.com/?network=mainnet) - [Source](https://github.com/pospos191-alt/zetaphy/tree/main/zetaphy-explorer)
```

The patch is [awesome-cosmos/0001-block-explorers-zetaphy.patch](awesome-cosmos/0001-block-explorers-zetaphy.patch).
It applies cleanly to that commit (`git apply --check`), and `awesome-lint` 2.3.0 gives the same 3 errors and 15
warnings with and without it: all of them are in lines that are already there, none in the new line. The list's last
change is a year old, so a review may be slow or not come.

**PR title:** `Add ZETAPHY Explorer to Block Explorers`

**PR body:**

```markdown
Adds the ZETAPHY block explorer to "Block Explorers".

- Explorer: https://explorer.sawasdeecoin.com/?network=mainnet (https)
- Source: https://github.com/pospos191-alt/zetaphy/tree/main/zetaphy-explorer (open source, GitHub for contact)
- Chain: ZETAPHY mainnet, a Cosmos SDK + cosmos/evm chain (`zetaphy_3659-1`, EVM chain id 3659)

It reads a node directly (CometBFT RPC and REST): blocks, EVM and Cosmos transactions, addresses, validators and governance.

Please note: ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not
yet completed an independent external audit.

`npx awesome-lint` reports no new findings for the added line.
```

**Submit (web UI):** open https://github.com/cosmos/awesome-cosmos, press **Fork**; in the fork open `README.md`,
press the pencil, add the line after `* [Stake ID](https://stake.id)`, commit to a new branch, then **Contribute →
Open pull request** with the title and body above.

## Cosmos forum (forum.cosmos.network): introduction post

- **Category:** not verified (the forum could not be opened). Pick the category the forum uses for new chains or
  project introductions; if none fits, use the general one, and read the forum's posting rules first.
- **Title:** `Introducing ZETAPHY: a Cosmos SDK + cosmos/evm chain with post-quantum signatures, looking for independent validators`

**Body:**

```markdown
Hi all. We'd like to introduce ZETAPHY, a Cosmos SDK chain that went live on 2026-11-13, and invite independent validators.

**What it is**
- A Cosmos SDK chain (v0.54) with an EVM through cosmos/evm, on CometBFT. Cosmos chain id `zetaphy_3659-1`, EVM chain id 3659, coin ZTPHY (base denom `azetaphy`, 18 decimals), bech32 prefix `zetaphy`, coin type 60.
- Post-quantum signatures: besides eth_secp256k1 keys, accounts can be controlled by ML-DSA-44 (FIPS 204) keys, and validators can register an ML-DSA-44 vote key that signs alongside ed25519.
- Neuro scam protection: contract checks whose results are published on chain in a ThreatRegistry; the ZETAPHY wallet checks destinations against it before signing.
- IBC: planned, not live. A Noble route was tested on our testnet (now shut down); no IBC channel is open on mainnet yet.

**Please read this first**
ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not yet completed an independent external audit. Until more independent validators join and the audit is published, the project can halt or change the chain. Use it only with amounts you can afford to lose.

**Running a node or a validator**
We are looking for independent validators: today there is only one, run by the project. The validator guide is at https://app.sawasdeecoin.com/validators.html (start, checks, getting ZTPHY for the stake, keys and safety). In short, on a Linux server with systemd:

    curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/install.sh | sudo bash -s -- validator

It installs the signed release and the published genesis (sha256 checked) and syncs from the public sentry; then `sudo zetaphy-validator key` and `sudo zetaphy-validator stake <ZTPHY>`. Questions and reviews of the setup are welcome.

**Links**
- Website and apps: https://app.sawasdeecoin.com
- Explorer: https://explorer.sawasdeecoin.com/?network=mainnet
- Code: https://github.com/pospos191-alt/zetaphy
- Genesis and mainnet notice: https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md (genesis sha256 `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`)
- Public endpoints (one sentry): EVM JSON-RPC https://129-221-199-191.sslip.io, CometBFT https://129-221-199-191.sslip.io/rpc, REST https://129-221-199-191.sslip.io/rest
- Faucet: https://app.sawasdeecoin.com/?tab=earn
- Chain registry files: https://github.com/pospos191-alt/zetaphy/tree/main/zetaphy-chain/listings/cosmos-chain-registry/zetaphy

Feedback on the chain design, the security model and the code is very welcome, and so are independent auditors. Security reports: https://github.com/pospos191-alt/zetaphy/blob/main/SECURITY.md
```

Before posting, check that the validator guide and the install command still match (they change with releases), and
change "went live on 2026-11-13" only if the facts change.
