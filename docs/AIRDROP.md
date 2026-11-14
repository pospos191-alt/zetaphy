# ZTPHY airdrop: lists, the claim contract, the claim page

> **Testnet shut down 2026-11-14.** ZETAPHY mainnet (`zetaphy_3659-1`, chain 3659) is the only network; where this page says testnet, it describes the retired testnet (or a devnet). See the [mainnet notice](ZETAPHY-MAINNET-NOTICE.md).

[ภาษาไทย](AIRDROP.th.md)

> **Round 1 (SWD holders, mainnet chain 3659) is open:** link your Solana wallet before 2026-12-04 14:00 UTC.
> Dates, rules and step-by-step: [AIRDROP-ROUND1.md](AIRDROP-ROUND1.md) · link page: `https://app.sawasdeecoin.com/airdrop-link.html`.

> **Owner decision 2026-11-14: push airdrop on mainnet.** 10 ZTPHY to each of 100,000 active Ethereum wallets
> (1,000,000 ZTPHY from the Community pool), sent by `gov.sh airdrop`: [section 7](#7-push-airdrop-on-mainnet-owner-decision-2026-11-14).

How the owner pays ZTPHY (the ZETAPHY chain's native coin) to about 100,000 people who hold their own EVM
wallets, without any of them giving anything but an address. The claim contract (sections 1-6) lets people claim; for
the active Ethereum wallets the owner decided on 2026-11-14 to push the coins instead (section 7). Nothing here is
deployed and no coin moves until the owner runs the steps below.

| Piece | Where |
|---|---|
| Claim contract | `zetaphy-network/contracts/ZtphyMerkleDistributor.sol` (artifact `artifacts/ZtphyMerkleDistributor.json`) |
| List tooling | `zetaphy-network/airdrop/cli.js` (`from-csv`, `push-list`, `link-message`, `link-solana`, `merge`, `merkle`, `verify`, `init-code`; the stage-2 `snapshot`, `allocate`, `merkle` still work) |
| Push (section 7) | `zetaphy-chain/gov.sh airdrop` (mainnet: `AIRDROP_MAINNET=1`), `gov.sh transfer` (the multisig move) |
| Public-chain query | `zetaphy-network/airdrop/queries/active-evm-wallets.sql` (BigQuery, free tier) |
| Claim page | hub, Agents tab, card "Claim airdrop" (`zetaphy-hub/airdrop.js`, 8 languages) |
| Tests | `zetaphy-network/test/distributor.test.js`, `test/airdrop-evm.test.js`, `audit/invariants/MerkleDistributor.inv.t.sol`, `zetaphy-hub/test/airdrop.test.mjs`, `test/airdrop.e2e.mjs` |

## 1. How it works

1. The owner builds a list `(index, address, amount)` off chain and publishes it in full (`list.csv`), with a
   `summary.json` (count, total, Merkle root, sha256 of the list) and small per-address files (`shards/`).
2. One `ZtphyMerkleDistributor` is deployed per round with: the root, the declared total and leaf count, a claim
   start, a claim deadline, a `returnTo` address (community fund / governance) and an optional `guardian`. None of
   these can ever change: there is no owner or admin.
3. The airdrop pool funds it with a plain transfer of exactly the total.
4. Between funding and `claimStart` (a review window, e.g. 3-7 days) anyone recomputes the root from the published
   list (`cli.js verify`). If the list is wrong, the guardian calls `abort()` and anyone can `sweep()` the coins back
   to `returnTo` at once. The guardian can do this only while no claim has been paid; it can never redirect coins,
   pause a live round, or stop claims.
5. From `claimStart` to `claimDeadline` each listed address claims once (`claim(index, account, amount, proof)`).
   Anyone may send the claim (a relayer, a sponsor, the person), but the coins go only to the listed `account`.
   `claimMany` lets a relayer pay the gas for many people in one transaction (already-claimed entries are skipped).
6. After the deadline anyone calls `sweep()`: what is left goes to `returnTo`, nowhere else.

Leaf = `keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount))))` (the double
hash of OpenZeppelin's StandardMerkleTree: a leaf can never pass for an inner node); inner nodes hash the sorted pair;
the odd last node of a layer moves up unchanged. Index = position after sorting by lower-case address, so the same
allocations always give the same root. Claims are recorded in a bitmap (256 per storage word).

Why no pause: a pause key could freeze a live round (censorship) or be lost; the only expensive mistake the
contract can still undo is a wrong root before anyone was paid, and `claimStart` plus `abort` covers exactly that.
Defence in depth: no claim can make the paid total exceed `totalAllocated`, use an index `>= leafCount`, or pay
more than the contract holds.

## 2. Where the addresses come from

Three sources, each producing the same `{allocations: [{address, amount}]}` JSON; `merge` adds them per address.

### 2a. Sign-up / registration (`from-csv`)

Collect **only an EVM address** (`0x…`). No name, e-mail, phone, country, social handle or wallet signature is
needed: the coins go to the address itself, so a typo only costs the person their slot. Ideas:

- A static form (any form tool) with one field, "Your ZETAPHY / EVM address (0x…)". Turn off e-mail collection and
  respondent tracking; export CSV. Validate client-side with the checksum (EIP-55) if the tool allows it.
- The hub: a person connects the wallet and presses "register"; store the address only.
- Never ask for a seed phrase, private key, "verification" signature or token approval. Say so on the form.

```bash
node airdrop/cli.js from-csv signups.csv --each 1000 --pool 20000000 > signups.json        # 1,000 ZTPHY each
node airdrop/cli.js from-csv signups.csv --equal --pool 20000000 --cap 5000 > signups.json  # pool split equally, capped
node airdrop/cli.js from-csv given.csv > given.json            # address,amount (ZTPHY) or address,amount_wei as given
```

`from-csv` checks the EIP-55 checksum of mixed-case addresses, drops duplicates (case-insensitive, first row
kept), the zero address, precompiles and reserved addresses (anything below `0x…10000`, which holds Ethereum's and
ZETAPHY's precompiles), known non-person addresses (burn `0x…dEaD`, `0xdead…`, the `0xEeee…` placeholder),
`--exclude <file>` addresses and, with `--rpc <URL>`, contracts (`eth_getCode` != `0x`, batched, read-only; an
EIP-7702-delegated EOA is a person's key and stays). The total must fit the pool. The report lists every dropped
row with its line and reason. Sign-up lists are trivially Sybil-able (one person, many addresses): keep amounts
small, use a cap, or use one of the stronger sources below.

### 2b. SWD holders (Solana) -> EVM addresses (`link-solana`)

SWD lives on Solana; the airdrop pays EVM addresses. Each holder signs, with the Solana wallet that held SWD at the
snapshot, exactly:

```
ZETAPHY airdrop: link <solanaOwner> to <0xEVM in EIP-55 checksum form> on <chainId>
```

(`node airdrop/cli.js link-message <solanaOwner> <0xEVM> --chain-id 77390` prints it.) Phantom, Solflare and
Backpack sign the raw UTF-8 bytes with `signMessage`; a minimal page for the form:

```js
const msg = `ZETAPHY airdrop: link ${solanaOwner} to ${evmChecksummed} on ${chainId}`;
const { signature } = await window.solana.signMessage(new TextEncoder().encode(msg), 'utf8');
// submit { solana: solanaOwner, evm: evmChecksummed, chainId, signature: base58(signature) }
```

The chain id is inside the message, so a testnet link cannot be replayed on mainnet. The tool verifies strict
RFC 8032 ed25519 (`@noble/curves`, already a dependency) and accepts the signature as base58, 0x-hex or base64.

```bash
node airdrop/cli.js snapshot --mint <SWD mint> > snapshot.json
node airdrop/cli.js allocate snapshot.json --min 1000000 --cap-bps 100 > swd.json   # dust filter + whale cap
node airdrop/cli.js link-solana swd.json links.json --chain-id <ZETAPHY chain id> > linked.json
```

Rules: one EVM address per Solana owner (the same record twice counts once; two different addresses for one owner
is a conflict, that owner is left out and reported); several Solana owners may link the same EVM address (one
person, several wallets: amounts are added). A wrong message, wrong chain id, swapped EVM address, other signer or
tampered signature is rejected with its reason. Holders who did not link are **not paid this round**; `unlinked`
lists them with their amounts so a later round can pay them. Hardware wallets that sign Solana "off-chain message"
envelopes (Ledger) produce a different byte string: not accepted yet (open item).

### 2c. Recipients from public chains (retroactive, `active-evm-wallets.sql`)

To reach real users who never heard of ZETAPHY, take EVM wallets that people actively use on public chains. The
same private key controls the same address on ZETAPHY (EVM, `eth_secp256k1`), so an Ethereum EOA can claim here
with the wallet it already has. Contract wallets (Safe, smart accounts) do **not** exist at the same address on
ZETAPHY and could never claim: they are excluded.

Criteria of the query (all parameters at its top, `DECLARE …`):

| Rule | Default | Why |
|---|---|---|
| successful transactions sent in the window | >= 10 | a used wallet |
| distinct active months | >= 3 | not a one-off burst |
| last activity | within 6 months of `window_end` | still active |
| first activity in the window | >= 6 months before `window_end` | not a fresh farm wallet |
| total transactions in the window | <= 50,000 | not an exchange / bot |
| busiest day | <= 500 transactions | not a bot / batcher |
| not a contract | anti-join on `crypto_ethereum.contracts` (+ `--rpc` later) | must be a key that can sign here |
| output | top 100,000 by distinct active days, columns `address,score` | |

**These people did not sign up.** The default for them was a claim (this distributor), with a public eligibility
checker (the hub card works with any address and no wallet), a clear announcement on the project's official
channels, and a deadline after which unclaimed coins return to the community fund. **Owner decision 2026-11-14:** for
the 100,000 active Ethereum wallets the owner chose to push 10 ZTPHY each instead (section 7), knowing they did not
ask. What does not change: never DM them, and never ask them for keys, seed phrases, signatures or approvals: anyone
asking is a scammer, and the announcement must say so. Any other push to people who did not ask needs its own owner
decision.

Running it in the owner's own Google Cloud project (free tier: 1 TB of queries a month):

1. console.cloud.google.com -> create (or pick) a project -> BigQuery -> "+ Compose a new query".
2. More -> Query settings -> Advanced -> **Maximum bytes billed** = `150000000000` (150 GB): a mistake fails
   instead of billing.
3. Paste `airdrop/queries/active-evm-wallets.sql`, adjust the `DECLARE` lines (`window_end`, `lookback_months`, …).
   It reads ~60 B per transaction of the window (`from_address`, `block_timestamp`, `receipt_status`); a 24-month
   window is ~60-70 GB, so ~15 runs fit in the free tier. (The editor's estimate for a script with DECLAREd dates may
   show the whole table; the run still prunes partitions. Put literal dates in once to see the pruned estimate.)
4. Run. Save results -> CSV (local file; 100,000 rows are ~5 MB) or to Google Drive.
5. Feed it to the CLI, checking for contracts again on Ethereum:

```bash
node airdrop/cli.js from-csv active.csv --weight score --cap 5000 --pool 100000000 --rpc https://<an Ethereum RPC> > active.json
node airdrop/cli.js from-csv active.csv --equal --pool 100000000 --rpc https://<an Ethereum RPC> > active.json
```

`--weight score` is pro-rata to the score with a per-address cap (water-filling: the capped get the cap, the others
share the rest); `--equal` gives everyone the same. `--min-score N` drops low scores.

Sybil heuristics: the query's activity rules, the busiest-day and volume limits, the contract exclusion and the
per-address cap are built in. Clustering wallets funded from the same source within a short window is a known
stronger filter and is a **future step** (it needs `traces` / funding graphs; not implemented). For strict one
person = one claim, use the zero-knowledge identity airdrop (`contracts/PrivateAirdrop.sol`,
[docs/future/zk-identity.md](future/zk-identity.md)) instead of an address list.

## 3. Build, verify and publish the list

```bash
node airdrop/cli.js merge signups.json linked.json active.json --pool 200000000 > round.json
node airdrop/cli.js merkle round.json --out round1 --chain-id <chain id> --pool 200000000
node airdrop/cli.js verify round1
```

`round1/` holds `summary.json`, `list.csv` (`index,address,amount`, base units with 18 decimals) and
`shards/<first N hex chars of the address>.json` (N is chosen so a shard holds ~256 claims: 100,000 people -> 4,096
files of ~30 KB). `verify` rebuilds everything from `list.csv`: its sha256, order, uniqueness, count, total, root,
and every shard entry and proof. Measured on this machine: 100,000 rows `from-csv` ~3 s, `merkle` ~8 s, `verify`
~10 s.

Publish `round1/` as static files: put it in `zetaphy-hub/airdrop/` (the hub build copies it to `/airdrop/`) or
any https host, and publish `summary.json`'s root and `listSha256` in the announcement. Anyone can then run
`verify` themselves; after deployment, `verify round1 --rpc <ZETAPHY RPC> --distributor 0x…` also checks the
contract's root, total and leaf count.

## 4. Deploy, fund, claim, sweep

Decide first (owner): pool for this round, equal vs pro-rata, the cap, `claimStart` (review window after funding),
`claimDeadline` (e.g. 90-180 days), `returnTo` (the community fund or the governance module address) and the
guardian (a multisig, or none).

**Testnet** (the record: the testnet was shut down on 2026-11-14, so these commands no longer have a chain to run on; mainnet below):

```bash
INIT=$(node airdrop/cli.js init-code round1 --start 2026-12-01T00:00:00Z --deadline 2027-03-01T00:00:00Z \
        --return-to 0x<community fund> --guardian 0x<multisig> | jq -r .initCode)
zetaphy pq native deploy "$INIT" --gas 3000000        # from the native PQ account (fund it first); prints the address
# or from any testnet EVM key:  cast send --create "$INIT" --rpc-url https://rpc.sawasdeecoin.com --interactive
node airdrop/cli.js verify round1 --rpc https://rpc.sawasdeecoin.com --distributor 0x<it>
```

Then fund it with exactly `summary.total` from the testnet community key (an EVM transfer to the contract emits
`Funded`; a Cosmos bank send to its address also works, the contract only uses its balance), and record
`zetaphy-network/deployments/airdrop-77390.json`:

```json
{ "chainId": 77390, "contracts": { "airdropDistributor": "0x…" }, "list": "./airdrop/" }
```

so the hub card is filled in (`build.mjs` reads it).

**Mainnet**: deploy only once the mainnet contract-deploy tooling exists (`docs/ZETAPHY-MAINNET-PROCEDURE.md`),
with the same `init-code`. The airdrop pool (20% of supply, 200,000,000 ZTPHY) is a genesis multisig: fund the
distributor by a multisig bank send of exactly `summary.total` (a governance proposal if the pool is a module
account). Announce the contract address, root and `listSha256` on every official channel before `claimStart`.
Record it in `zetaphy-network/deployments/airdrop-3659.json` (`{ "chainId": 3659, "contracts": { "airdropDistributor": "0x…" }, "list": "…" }`):
the hub's next build shows the claim card on mainnet (`build.mjs` puts it in `hub-config.json` `mainnet`; the testnet keeps its own file).

**Claiming**: people open the hub, Agents tab, "Claim airdrop", check their address and press Claim. The card reads
`summary.json` and one shard, checks the proof in the browser against the root **on chain** (a list that does not
match the contract is refused), shows the amount and window, and sends `claim`. People with no ZTPHY for gas can
use the faucet, or hand the shown call data to a relayer / sponsor (it cannot change who is paid); the project can
run such a relayer with `claimMany`.

**After the deadline**: anyone calls `sweep()`; the rest goes to `returnTo`. Unpaid SWD holders can be paid in a
later round (a new distributor with a new list).

## 5. Cost for 100,000 claims

Measured in `test/distributor.test.js` on a 100,000-leaf tree (depth 17), per claim transaction, including the
21,000 base and calldata, to a recipient account that did not exist yet (the usual case on a new chain):

| Case | Gas |
|---|---|
| a claim in a bitmap word already touched (255 of every 256 claims) | ~79,500 |
| the first claim in a bitmap word (1 of every 256) | ~96,600 |
| the very first claim of the round | ~115,700 |
| `claimMany`, 20 claims per transaction (a relayer) | ~57,300 per claim |

At 1 gwei: ~0.00008 ZTPHY per claimer; 100,000 claims ~8.0 ZTPHY in total, paid by the claimers (or ~5.7 ZTPHY if
a sponsor batches them all). For comparison, a project-paid push: 100,000 plain transfers at 21,000 gas = 2.1e9 gas
= ~2.1 ZTPHY, or ~35,000-38,000 gas each from a multi-send contract (new accounts cost 25,000 extra inside a call) =
~3.6 ZTPHY; a Cosmos `MsgMultiSend` (`zetaphy-chain/gov.sh airdrop`, on mainnet with `AIRDROP_MAINNET=1`, section 7)
is in the same range. The push is cheaper in gas but sends coins to 100,000 addresses that never asked, needs many
signed transactions (so a hot key, not the pool's multisig), and leaves unused coins stranded in inactive wallets; the
claim keeps them in the community fund. The owner weighed this and chose the push for the active Ethereum wallets
(2026-11-14, section 7).

## 6. Checklist (owner)

1. Decide pool per round, equal vs weighted, cap, start, deadline, `returnTo`, guardian.
2. Collect addresses (form with address only; Solana links; BigQuery export). No other personal data.
3. `from-csv` / `link-solana` / `merge` -> `merkle` -> `verify`. Read every report of dropped rows.
4. Testnet round end-to-end first (deploy, fund, claim from a test wallet, abort on a second test round, sweep).
5. Mainnet: deploy, `verify --rpc`, fund from the pool multisig, announce (contract, root, sha256, deadline, "we
   never ask for keys or signatures"), wait the review window, open claims.
6. After the deadline: `sweep()`; report claimed / returned.

## 7. Push airdrop on mainnet (owner decision 2026-11-14)

**The decision.** For the active Ethereum wallets of section 2c the owner chose a **push** instead of the claim
distributor: **10 ZTPHY to each of 100,000 addresses, 1,000,000 ZTPHY in all**, from the **Community pool** (a 2-of-3
multisig). The multisig moves 1,000,100 ZTPHY (the airdrop plus 100 ZTPHY for gas) to a new hot key named `airdrop`
in an encrypted file keyring on the validator machine. That key sends the batches with `gov.sh airdrop`. The claim
distributor (sections 1-6) stays the way to pay the SWD holders and later rounds.

**These people never asked.** The coins simply appear in their wallet on ZETAPHY (chain 3659, same address as on
Ethereum). Scammers will copy the news with fake "claim" pages. The announcement must say, in every language and on
every official channel: *the coins are already in your wallet; there is nothing to claim and nothing to pay; the
project will never DM you, never ask for your seed phrase, private key, a signature or an approval; anyone who does
is a scammer.* Recipients who do not want the coins can ignore them.

### What gov.sh does on mainnet

`AIRDROP_MAINNET=1 gov.sh airdrop <list> [ZTPHY each, default 10] [key, default airdrop]` on a pinned node:

- Refused without `AIRDROP_MAINNET=1`, with `--keyring-backend test`, and with `--generate-only` (a multisig cannot
  sign 556 transactions: that is why the coins go to a hot key first).
- A dry run unless `SEND=1` is set or the owner answers `y`. Before the question it shows the number of addresses,
  the total, the number of batches, the gas price in force (the genesis minimum, or the feemarket base fee when that is
  higher), the gas reserve, the simulated gas of the first batch, the estimated gas and fee of the whole airdrop, and
  the expected time.
- `MAX_EACH` defaults to 10 on mainnet: a larger amount is refused unless `MAX_EACH` is set on purpose.
- Refused if the key holds less than the total plus the gas reserve = batches x `MAX_TX_GAS` x gas price (an upper
  bound: no batch may use more than `MAX_TX_GAS`).
- Every line must be a clean address (the list comes from `push-list`, below); the zero address, precompile and system
  addresses (below `0x…10000`), burn addresses and bad checksums are counted as bad lines, and any bad line stops the
  run before anything is sent. `0x…` becomes `zetaphy1…` in bash (100,000 addresses in about a minute); the first
  conversion is checked against `zetaphyd debug addr`.
- **One transaction in flight, confirmed in a block.** For each batch: simulate it (`--gas auto --gas-adjustment 1.5
  --generate-only`: simulated with the key's own public key, nothing signed), refuse it if its gas limit is above `MAX_TX_GAS` (default 10,000,000, at most 15,000,000), write
  `<ledger>.pending` (sequence, timeout height, addresses), broadcast it with that gas and `--timeout-height` = current
  block + 12 (about a minute), record the tx hash in the pending file, poll `q tx <hash>` until it is in a block, and
  only when its code is 0 add its addresses to the ledger (`~/.zetaphy/airdrop-zetaphy_3659-1-paid.txt`) and remove
  the pending file. Then it waits for the next block before it sends the next batch.
- **On a failure it stops and names the batch** (`STOPPED at batch 17/556: …`): refused by the node (CheckTx), failed
  in its block (code, log), or not in a block by its timeout height. Those addresses are not in the ledger. Run the
  same command again: it sends only the addresses that are not paid.
- **Never paid twice.** If no block confirms a batch within `AIRDROP_TIMEOUT` (180 s), for example because the chain
  stalls, the batch stays in `<ledger>.pending` and the run stops. The next run settles it first: by its hash (or, when
  zetaphyd died before printing the hash, by the sender's sequence, `tx.acc_seq`). If it was included with code 0, its
  addresses go in the ledger and are not sent again. If it failed, or the chain is past its timeout height and the
  sender's sequence has not moved, it can never be included any more and its addresses are sent again. Otherwise the
  run refuses ("cannot tell yet") and sends nothing.
- `flock` on the ledger: two runs at once are refused.
- With the file keyring, the passphrase is asked once and handed to each zetaphyd call on its stdin (never in a file,
  an argument or the environment).

### Batch size and gas (an estimate: measure it with the dry run)

`MsgMultiSend` to accounts that do not exist yet, per output, with the Cosmos SDK's default gas costs (reads 1,000 +
3 per byte, writes 2,000 + 30 per byte, 10 per byte of transaction):

| Per output | Gas (estimate) |
|---|---|
| ~90 bytes in the transaction (address, amount, denom) | ~900 |
| the receiver's balance: read, write, denom index | ~8,000-9,000 |
| a new account: existence check, next account number, account and its number index | ~12,000-14,000 |
| ZETAPHY's account guard looks at every output (`setup-node.sh`, the `MsgMultiSend` case) | not measured |
| **total** | **~23,000; planned with 25,000-35,000** |

So the default `BATCH` on mainnet is **180**: 180 x 35,000 x 1.5 (gas adjustment) + the fixed part (signature, fee)
is about 9.6M gas, under the 10M cap, a third of a block (`max_gas` 30,000,000); the transaction is ~17 KB (blocks
allow 22 MB). If the dry run shows a gas limit above the cap, it prints the `BATCH` that fits. **Not measured on the
chain**: the real gas of `MsgMultiSend` on ZETAPHY; the dry run's first-batch simulation is the first real number.

**Time and cost** for 100,000 addresses: 556 batches; each needs its block and then the next one (5 s blocks), so
about 11 s a batch: **about 1 h 40 min**. Fee (Cosmos charges the gas limit, not the gas used): ~100,000 x 23,000 x 1.5
= ~3.5e9 gas, **~3.5 ZTPHY at 1 gwei** (~5.3 ZTPHY if outputs cost 35,000). The reserve check asks for 6 ZTPHY
(556 x 10M x 1 gwei); the extra 100 ZTPHY moved to the hot key covers it many times over. One transaction at a time
uses at most a third of a block, so other people's transactions still get in and the mempool never fills.

### The owner's commands

Run them on the **validator machine** (129.221.162.14, user `zetaphy`, keyring `~/.zetaphy-keys`), over SSH or the
Oracle Cloud Shell, and the list step in the Oracle Cloud Shell. **Never on your own computer.** The only exception is
the multisig signatures: each member signs wherever their member key is kept (section 4 of
[ZETAPHY-MAINNET-PROCEDURE.md](ZETAPHY-MAINNET-PROCEDURE.md)); only the unsigned file goes there and a signature file
comes back. Labels: **[อ่าน]** only reads, **[เปลี่ยนไฟล์]** writes files, **[เปลี่ยนเชน]** sends a transaction,
**[เปลี่ยนการตั้งค่า]** changes settings.

**1. The list** (Oracle Cloud Shell; the BigQuery CSV of section 2c, saved from BigQuery and uploaded with the Cloud
Shell menu, Upload; Node.js 20 or later):

```bash
git clone --depth 1 https://github.com/pospos191-alt/zetaphy.git ~/zetaphy                     # [เปลี่ยนไฟล์]
cd ~/zetaphy/zetaphy-network && npm ci --no-audit --no-fund                                     # [เปลี่ยนไฟล์]
node airdrop/cli.js push-list ~/active.csv --rpc https://ethereum-rpc.publicnode.com \
  --max 100000 --out ~/push.txt                                                                 # [เปลี่ยนไฟล์]
#   push-list: N addresses (10 ZTPHY each = …); dropped …: {…}; contracts checked on …; sha256 of the list <S>
scp ~/push.txt <your SSH user>@129.221.162.14:/tmp/push.txt                                     # [เปลี่ยนไฟล์]
```

`push-list` drops bad addresses and bad checksums, duplicates, the zero address, precompiles and reserved addresses,
burn and placeholder addresses, ZETAPHY's module accounts and preinstalls, `--exclude <file>`, and then every
**contract on Ethereum** (`eth_getCode`, required: a contract address there has no key here, so coins pushed to it are
lost; an EIP-7702-delegated EOA stays). It keeps the highest scores first and at most `--max`. If the RPC refuses (rate
limit), run it again with `--batch 20` or another Ethereum RPC.

**2. Onto the validator, and gov.sh** (SSH to 129.221.162.14):

```bash
sudo install -o zetaphy -g zetaphy -m 600 /tmp/push.txt /home/zetaphy/push.txt && rm /tmp/push.txt   # [เปลี่ยนไฟล์]
sudo -iu zetaphy
sha256sum ~/push.txt; wc -l ~/push.txt                     # [อ่าน] the sha256 push-list printed; ~100000 lines
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/zetaphy-chain/gov.sh -o ~/gov.sh   # [เปลี่ยนไฟล์]
```

(gov.sh from `main` once this change is merged.)

**3. The hot key** (you type the passphrase; the file keyring has one passphrase for the whole `~/.zetaphy-keys`, so
it is the one its other keys use):

```bash
zetaphyd keys add airdrop --keyring-backend file --keyring-dir ~/.zetaphy-keys --algo eth_secp256k1   # [เปลี่ยนไฟล์]
#   write the 24 words on paper and keep them offline until the airdrop is over
zetaphyd keys show airdrop -a --keyring-backend file --keyring-dir ~/.zetaphy-keys                      # [อ่าน] -> <airdrop zetaphy1…>
```

**4. The Community multisig moves 1,000,100 ZTPHY to it** (gov.sh's `--generate-only` flow, then 2 of 3 signatures):

```bash
zetaphyd q auth account <Community multisig zetaphy1…> --node tcp://127.0.0.1:26657 -o json   # [อ่าน] account_number N, sequence S
bash ~/gov.sh transfer <airdrop zetaphy1…> 1000100 --from <Community multisig zetaphy1…> \
  --generate-only ~/community-to-airdrop.json                                                  # [เปลี่ยนไฟล์]
#   transfer 1000100 ZTPHY (1000100000000000000000000 azetaphy) from … to … on zetaphy_3659-1
#   unsigned transaction written to …; nothing was sent
# each of 2 members, where their member key is kept (only this file goes there):
zetaphyd tx sign community-to-airdrop.json --multisig <Community multisig zetaphy1…> --from <member key> \
  --keyring-backend file --keyring-dir <member keyring> --chain-id zetaphy_3659-1 --sign-mode amino-json \
  --offline --account-number N --sequence S --output-document m1.json                         # [เปลี่ยนไฟล์]
# back on the validator, with the two signature files, in a keyring that holds the multisig (public keys only;
# if there is none: section 4 of ZETAPHY-MAINNET-PROCEDURE.md, keys add m1..m3 --pubkey, keys add <name> --multisig):
zetaphyd tx multisign ~/community-to-airdrop.json <multisig key name> m1.json m2.json --chain-id zetaphy_3659-1 \
  --keyring-backend file --keyring-dir ~/ms --offline --account-number N --sequence S > ~/signed.json   # [เปลี่ยนไฟล์]
bash ~/gov.sh broadcast ~/signed.json                                                          # [เปลี่ยนเชน]
zetaphyd q bank balances <airdrop zetaphy1…> --node tcp://127.0.0.1:26657                      # [อ่าน] 1000100000000000000000000 azetaphy
```

**5. The dry run** (in `tmux`, so a dropped SSH does not stop the real run later: `tmux attach -t airdrop` gets back):

```bash
tmux new -s airdrop                                                                            # [อ่าน]
AIRDROP_MAINNET=1 bash ~/gov.sh airdrop ~/push.txt 10 airdrop                                  # [อ่าน] answer N
#   passphrase of the keyring in ~/.zetaphy-keys (asked once for the whole airdrop):
#   mainnet zetaphy_3659-1: key airdrop (file keyring /home/zetaphy/.zetaphy-keys)
#   push airdrop on zetaphy_3659-1 from airdrop (zetaphy1…): 100000 addresses, 1000000 ZTPHY in all; the key has 1000100 ZTPHY
#     skipped: 0 bad, 0 repeated, 0 paid before (/home/zetaphy/.zetaphy/airdrop-zetaphy_3659-1-paid.txt)
#     556 batches of up to 180 addresses, one transaction in flight (each waits for its block, then the next block)
#     gas price 1000000000azetaphy; gas reserve 6 ZTPHY (556 batches x at most 10000000 gas)
#     first batch: 180 outputs, gas limit G (simulated x 1.5; cap 10000000); whole airdrop ~… gas, fee ~… ZTPHY
#     expected time: ~102 minutes (~11 s a batch with 5 s blocks)
#   send 1000000 ZTPHY to 100000 addresses in 556 batches on zetaphy_3659-1? [y/N] N
```

Stop if the count, the total or the gas price is not what you expect, or if it refuses. (It only creates the empty
ledger file and its `.lock`.)

**6. The real run, and resuming** (same command, answer `y`):

```bash
AIRDROP_MAINNET=1 bash ~/gov.sh airdrop ~/push.txt 10 airdrop                                  # [เปลี่ยนเชน] answer y
#   batch 1/556: 180 x 10 ZTPHY, tx <hash> in block <H> (code 0); 180 of 100000 paid
#   …
#   airdrop done: 100000 addresses, 1000000 ZTPHY; ledger … (100000 addresses)
```

If it prints `STOPPED at batch k/n: …`, read the reason, then run the **same command** again: paid addresses are
skipped, and a batch left in `airdrop-zetaphy_3659-1-paid.txt.pending` is settled first. If it prints `refused: cannot
tell yet whether that batch was paid`, wait a few minutes (the chain may be stalled; check `sudo systemctl status
zetaphyd`) and run it again. Never delete the `.pending` file by hand unless `zetaphyd q tx <its txhash>` shows the tx
and you have added or not added its addresses to the ledger accordingly.

**7. Checks afterwards**:

```bash
L=~/.zetaphy/airdrop-zetaphy_3659-1-paid.txt
sort -u $L | wc -l                                                                             # [อ่าน] = the lines of push.txt
ls $L.pending 2>/dev/null || echo "no pending batch"                                           # [อ่าน]
shuf -n 5 $L | while read -r a; do zetaphyd q bank balances "$a" --node tcp://127.0.0.1:26657 -o json | jq -c .balances; done   # [อ่าน] 10 ZTPHY each
zetaphyd q bank balances <airdrop zetaphy1…> --node tcp://127.0.0.1:26657                      # [อ่าน] ~94-97 ZTPHY left
```

Also open one recipient's `0x…` on the explorer (chain 3659): 10 ZTPHY. Keep the ledger file (it is the record of who
was paid).

**8. The rest back to the Community pool**, then retire the hot key:

```bash
bash ~/gov.sh transfer <Community multisig zetaphy1…> <balance minus 0.01> --from airdrop      # [เปลี่ยนเชน] answer y
zetaphyd keys delete airdrop --keyring-backend file --keyring-dir ~/.zetaphy-keys              # [เปลี่ยนไฟล์] once the balance is ~0
```

Tests (no chain; a stand-in zetaphyd plays the chain): `zetaphy-network/test/govairdrop-mainnet.test.js` (batches,
one tx in flight, failure in a block, a dropped tx, a stalled chain and the later inclusion, a lost hash, CheckTx
refusals, gas cap, reserve, `MAX_EACH`, the CSV -> `push-list` -> `gov.sh` path), `test/airdrop-push.test.js`,
`test/govairdrop.test.js` (testnet), `test/govmainnet.test.js` (`transfer`).
