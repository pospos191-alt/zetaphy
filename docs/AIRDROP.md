# ZTPHY airdrop: lists, the claim contract, the claim page

> **Testnet shut down 2026-11-14.** ZETAPHY mainnet (`zetaphy_3659-1`, chain 3659) is the only network; where this page says testnet, it describes the retired testnet (or a devnet). See the [mainnet notice](ZETAPHY-MAINNET-NOTICE.md).

[ภาษาไทย](AIRDROP.th.md)

> **Round 1 (SWD holders, mainnet chain 3659) is open:** link your Solana wallet before 2026-12-04 14:00 UTC.
> Dates, rules and step-by-step: [AIRDROP-ROUND1.md](AIRDROP-ROUND1.md) · link page: `https://app.sawasdeecoin.com/airdrop-link.html`.

How the owner pays ZTPHY (the ZETAPHY chain's native coin) to about 100,000 people who hold their own EVM
wallets, without any of them giving anything but an address, and without the project ever pushing coins to people
who did not ask. Nothing here is deployed and no coin moves until the owner runs the steps below (testnet first).

| Piece | Where |
|---|---|
| Claim contract | `zetaphy-network/contracts/ZtphyMerkleDistributor.sol` (artifact `artifacts/ZtphyMerkleDistributor.json`) |
| List tooling | `zetaphy-network/airdrop/cli.js` (`from-csv`, `link-message`, `link-solana`, `merge`, `merkle`, `verify`, `init-code`; the stage-2 `snapshot`, `allocate`, `merkle` still work) |
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

**These people did not sign up.** So the airdrop must be claim-based (this distributor), with a public eligibility
checker (the hub card works with any address and no wallet), a clear announcement on the project's official
channels, and a deadline after which unclaimed coins return to the community fund. **Never push unsolicited tokens**
to them, never DM them, and never ask them for keys or signatures beyond the claim transaction itself: anyone
asking for more is a scammer, and the announcement must say so.

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

**Testnet** (with existing tooling):

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
~3.6 ZTPHY; a Cosmos `MsgMultiSend` (`zetaphy-chain/gov.sh airdrop`, testnet only) is in the same range. The push
is cheaper in gas but sends coins to 100,000 addresses that never asked, spreads the pool over many signed
transactions from the pool key, and leaves unused coins stranded in inactive wallets; the claim keeps them in the
community fund.

## 6. Checklist (owner)

1. Decide pool per round, equal vs weighted, cap, start, deadline, `returnTo`, guardian.
2. Collect addresses (form with address only; Solana links; BigQuery export). No other personal data.
3. `from-csv` / `link-solana` / `merge` -> `merkle` -> `verify`. Read every report of dropped rows.
4. Testnet round end-to-end first (deploy, fund, claim from a test wallet, abort on a second test round, sweep).
5. Mainnet: deploy, `verify --rpc`, fund from the pool multisig, announce (contract, root, sha256, deadline, "we
   never ask for keys or signatures"), wait the review window, open claims.
6. After the deadline: `sweep()`; report claimed / returned.
