# ZTPHY airdrop round 1: SWD holders

[ภาษาไทย](AIRDROP-ROUND1.th.md) · how the airdrop works in general: [AIRDROP.md](AIRDROP.md)

Round 1 of the ZTPHY airdrop is for people who hold **SWD on Solana**. ZTPHY is the native coin of the ZETAPHY
mainnet (`zetaphy_3659-1`, EVM chain id **3659**). ZETAPHY pays 0x (EVM) addresses, and SWD lives in Solana
wallets. To take part, you **link** your Solana wallet to your 0x address once, by signing a short text message.
Signing it is free, and it moves nothing.

## At a glance

| | |
|---|---|
| Who | Solana wallets that hold SWD (mint `Cmh2tu6bt5z2a8NKsx6G5WfVmaeQ9f2fcX5VnQbVaGLL`) at the snapshot |
| Snapshot | **2026-11-20 14:00 UTC** (21:00 Thailand time) |
| Linking window | **open now until 2026-12-04 14:00 UTC** (21:00 Thailand time). You can link before or after the snapshot, as long as it is before the deadline |
| Round size | **20,000,000 ZTPHY**, from the SWD-airdrop multisig `0xaE842c15Ad4A6D6027597C3c3d44A4ada8FB0318` |
| Your share | pro-rata to the SWD you hold at the snapshot, **at most 5,000 ZTPHY per wallet** |
| Minimum | 10 SWD at the snapshot (smaller balances are dust and are left out) |
| Claim window | **90 days** from the claim start. The claim start is announced after the list is published and has been open for review |
| Gas | none for you: a project relayer sends the claims (`claimMany`), so you need no ZTPHY |
| Unclaimed coins | after the 90 days, anyone can call `sweep()`, which sends them back to `0xaE842c15Ad4A6D6027597C3c3d44A4ada8FB0318` and nowhere else |
| Link page | **https://app.sawasdeecoin.com/airdrop-link.html** |
| Link form | [GitHub: "ZTPHY airdrop round 1: link a Solana wallet"](https://github.com/pospos191-alt/zetaphy/issues/new?template=airdrop-link.yml) |

## Safety rules (read these first)

- **ZETAPHY never asks for your recovery phrase (seed words) or private key**, never asks you to pay anything, and
  never asks you to approve a transaction in order to link. Anyone who asks for any of these is a scammer. That
  includes "support" accounts, DMs, and lookalike sites.
- The only thing you sign is a plain text message that starts with `ZETAPHY airdrop: link`. If your wallet shows
  **"Approve transaction"**, a network fee, a token approval, or a change in your balance, **stop and reject it**.
- Use only the links in this document: the link page at `https://app.sawasdeecoin.com/airdrop-link.html` and the
  issue form in this repository (`github.com/pospos191-alt/zetaphy`). Any other site or form is not ours.
- ZETAPHY does not contact you first. There is nothing to "validate", "sync" or "unlock".
- The link is **public**. Anyone can see that your Solana wallet and your 0x address belong together. If you do not
  want that, do not link.

## Who is eligible

- Every Solana wallet (the *owner* address that you see in Phantom, Solflare or Backpack) that holds at least
  10 SWD at 2026-11-20 14:00 UTC. The snapshot adds up all of the wallet's SWD token accounts (both SPL Token and
  Token-2022).
- You must be able to sign with that wallet. SWD held on an exchange or inside a liquidity pool belongs, on chain,
  to the exchange's or the pool's account, not to you. To take part, move it to your own wallet before the
  snapshot.
- Addresses that are left out (if any, for example the project's own accounts) are published with the list.
- Only wallets that linked before the deadline are paid in round 1. The share of a wallet that did not link is not
  paid out in this round. It stays in the SWD-airdrop multisig, and a later round may pay it.

**How your amount is worked out.** 20,000,000 ZTPHY is split pro-rata to the SWD held by every eligible wallet at
the snapshot. No wallet gets more than 5,000 ZTPHY. Whatever is cut off by the cap is shared among the wallets
below the cap (this is called water-filling). The cap applies to each Solana wallet. If you link several Solana
wallets to the same 0x address, their amounts are added together into one claim.

## How to link (about 2 minutes)

You need three things: the Solana wallet that holds SWD, your ZETAPHY 0x address (any EVM wallet, for example
MetaMask, Rabby, Trust or OKX, shows one), and a free GitHub account to publish the link.

### The easy way: the link page

1. Open **https://app.sawasdeecoin.com/airdrop-link.html** in a browser that has your Solana wallet:
   - **Phantom** (phone): open Phantom, go to the browser tab (the globe icon), and type the address.
     Computer: the Phantom browser extension.
   - **Solflare** (phone): open Solflare, go to the in-app browser (Explore), and type the address. Computer: the
     Solflare extension.
   - **Backpack** (phone): open Backpack, go to the in-app browser, and type the address. Computer: the Backpack
     extension.
2. Press **Connect Phantom / Solflare / Backpack**, and approve the connection in the wallet. This only shares your
   public address.
3. Type or paste your 0x address, or press **Use my EVM wallet's address** if an EVM wallet is in the same browser.
   The page checks the EIP-55 checksum, which catches most typos.
4. Read the message on the page. It looks like this:
   `ZETAPHY airdrop: link 7xKX…sAsU to 0xAbC…123 on 3659`
5. Press **Sign the message (free)**. Your wallet shows a **"Sign message"** screen with the same text. Approve it.
   There is no fee and no transaction.
6. The page checks the signature itself and shows it. Press **Open the prefilled GitHub form**. Check the fields,
   tick the safety box, and press **Create**. That's it.

### By hand (without the page)

1. Build the exact message yourself (one line, single spaces, your 0x address in checksum form):
   `ZETAPHY airdrop: link <your Solana address> to <your 0x address> on 3659`
   You can also print it with `node zetaphy-network/airdrop/cli.js link-message <Solana> <0x> --chain-id 3659`.
2. Sign it with your Solana wallet's "sign message" feature. That gives a 64-byte ed25519 signature. Base58,
   0x-hex and base64 are all accepted.
3. Open the [issue form](https://github.com/pospos191-alt/zetaphy/issues/new?template=airdrop-link.yml), fill in the
   Solana address, the 0x address and the signature, tick the box, and press **Create**.

**Ledger and other hardware wallets.** These sign Solana "off-chain message" envelopes, which give a different byte
string, so round 1 cannot accept them yet. Never type a hardware wallet's recovery phrase into a software wallet to
get around this. If you want to take part, move your SWD to a software wallet you control before the snapshot.

**Made a mistake?** Close your issue as **"not planned"** (the arrow next to "Close issue"), then open a new one
with the right address. If one Solana wallet has two open links with different 0x addresses, both are left out
until only one remains.

## After the deadline: the list, the root, and how to check them

1. After 2026-12-04 14:00 UTC, the owner collects the issues, checks every signature, and builds the list. The full
   list is published in this repository, together with:
   - `summary.json`: the number of recipients, the total, the **Merkle root**, and the `listSha256` of `list.csv`
   - `list.csv`: every `index,address,amount` (amounts in base units, 18 decimals)
   - `shards/`: small per-address files, so you can find your own entry
   - a report of the issues that were rejected, conflicting or duplicated, with the reason for each
   It is also served at `https://app.sawasdeecoin.com/airdrop/`. The root and `listSha256` are posted on every
   official channel.
2. **Check it yourself.** Anyone can rebuild the root from the published list:
   ```bash
   cd zetaphy-network && npm ci
   node airdrop/cli.js verify <the published round folder>
   sha256sum <the published round folder>/list.csv     # must equal listSha256 in summary.json
   ```
   Once the claim contract (`ZtphyMerkleDistributor`) is deployed, the same command also checks the contract's root,
   total and leaf count against the list:
   ```bash
   node airdrop/cli.js verify <folder> --rpc https://129-221-199-191.sslip.io --distributor 0x<announced address>
   ```
   Look up your own 0x address in `list.csv`, or in the hub's "Claim airdrop" card, which works without a wallet.
3. **Review window.** The contract is funded with exactly the list's total. Claims can only start at a fixed time
   (`claimStart`), which is announced together with the list and leaves time for review. If the list turns out to be
   wrong before any claim has been paid, the round can be aborted and the coins return to the multisig. Nobody can
   change the list or the root of a deployed contract.

## The claim and the sweep

- From the claim start, for **90 days**, each listed 0x address can be paid once. A project relayer sends the claims
  in batches (`claimMany`) and pays the gas, so you do not need ZTPHY. You can also claim yourself from the hub's
  "Claim airdrop" card. Whoever sends the claim, the coins can only go to the 0x address in the list.
- When the 90 days are over, anyone can call `sweep()`. Everything left goes to
  `0xaE842c15Ad4A6D6027597C3c3d44A4ada8FB0318`, the SWD-airdrop multisig. That address is set in the contract when
  it is deployed, and it cannot be changed.

## For the owner: the commands for this round

Run from `zetaphy-network/` (`npm ci` first). Nothing here moves coins.

```bash
# 1. at 2026-11-20 14:00 UTC: the SWD snapshot (read-only Solana RPC; it records the slot and the time it was taken)
node airdrop/cli.js snapshot --mint Cmh2tu6bt5z2a8NKsx6G5WfVmaeQ9f2fcX5VnQbVaGLL [--exclude <project accounts>] > snapshot.json
# 2. pro-rata, 20,000,000 ZTPHY, 5,000 ZTPHY cap per wallet, dust filter 10 SWD (SWD has 5 decimals)
node airdrop/cli.js allocate snapshot.json --min 1000000 --pool 20000000 --cap 5000 > swd.json
# 3. after 2026-12-04 14:00 UTC: the link issues, as the GitHub API returns them (no label filter needed)
gh api --paginate --slurp 'repos/pospos191-alt/zetaphy/issues?state=all&per_page=100' > issues.json
node airdrop/cli.js links-from-issues issues.json --chain-id 3659 --deadline 2026-12-04T14:00:00Z > links.json
node airdrop/cli.js link-solana swd.json links.json --chain-id 3659 > linked.json
# 4. the list (publish the folder and the rejected / conflicts parts of links.json and linked.json)
node airdrop/cli.js merkle linked.json --out round1 --chain-id 3659 --pool 20000000
node airdrop/cli.js verify round1
# 5. the contract: claims open at <claim start>, close 90 days later; unclaimed coins return to the multisig
node airdrop/cli.js init-code round1 --start <claim start, ISO> --deadline <claim start + 90 days, ISO> \
  --return-to 0xaE842c15Ad4A6D6027597C3c3d44A4ada8FB0318 [--guardian 0x<multisig>]
```

`links-from-issues` reads the issue bodies of the form (`.github/ISSUE_TEMPLATE/airdrop-link.yml`). It checks every
signature for chain 3659 with the same rules as `link-solana`, and reports what it drops: issues created after
`--deadline`, a box that is not ticked, a bad address or signature, a wrong chain id, duplicates (counted once),
conflicts (one Solana wallet with several 0x addresses: left out), and issues closed as "not planned" (withdrawn
or rejected). The label `airdrop-link` (`gh label create airdrop-link`) makes the issues easy to find, but the
collector does not depend on it.

Deploy the distributor as described in [ZETAPHY-MAINNET-PROCEDURE.md](ZETAPHY-MAINNET-PROCEDURE.md). Then check it
with `verify round1 --rpc https://129-221-199-191.sslip.io --distributor 0x…`, fund it from the multisig with
exactly `summary.total`, announce the contract address, root, `listSha256` and claim start, and after the claim start
run the relayer with `claimMany`. Only `linked.json`'s total (the linked holders) is funded. The unlinked share stays
in the multisig.
