**English** | [ภาษาไทย](ZETAPHY-MAINNET-PROCEDURE.th.md)

# ZETAPHY mainnet (ZTPHY): the launch procedure

The step-by-step commands for the gates of [ZETAPHY-MAINNET-RUNBOOK.md](ZETAPHY-MAINNET-RUNBOOK.md). Nothing here runs
by itself: no workflow creates a mainnet genesis or starts a mainnet node. The owner runs every step.

**Owner decision: the mainnet launches with one validator**, operated by the project, and more validators are added
later. Risk, stated plainly: whoever controls that one machine (or its key) controls the chain. They can halt it,
censor transactions, and with a modified binary rewrite its rules, and every protection in this document can be
removed by that one operator. If that machine is lost and its key is not backed up, the chain stops. Users must be
told (the notice below). The external audit (gate 1) is not done either; the notice says so too.

Tools (in `zetaphy-chain/mainnet/`):

| File | What |
|---|---|
| `make-genesis.sh` | `draft` / `finalize` / `verify` the genesis from a config of addresses; never holds a private key |
| `mainnet.example.env` | the config, with the proposed values; its addresses are fake placeholders that are refused |
| `genesis_tool.py` | the checks and edits `make-genesis.sh` runs |
| `test-make-genesis.sh` | tests: each unsafe input refused; `--e2e` runs the result as a one-validator chain (CI: `security.yml`, job zetaphy-chain) |

`zetaphy-chain/setup-node.sh` has a pinned-chain mode for the mainnet: `GENESIS_FILE` + `GENESIS_SHA256` +
`GENESIS_EVM_CHAIN_ID` install a node of that genesis only, with no testnet genesis, no faucet (unless the owner opts
in on the sentry, step 12.1), no test keyring, no automatic transactions, and no public RPC unless `PUBLIC_RPC=1`.
With those variables unset it sets up the testnet exactly as before.

Labels: **[อ่าน]** reads only · **[เปลี่ยนไฟล์]** writes files · **[เปลี่ยนเชน]** sends a transaction ·
**[เปลี่ยนการตั้งค่า]** changes a machine or node setting (users, firewall, services, config). **Stop** means: do not go
on; find out why first.

## Proposed values (owner to confirm)

| Item | Proposed | Where |
|---|---|---|
| Chain id / EVM chain id | `zetaphy_3659-1` / `3659` (no `eip155-3659` file in ethereum-lists/chains on 2026-11-12; the testnet is 77390) | `CHAIN_ID`, `EVM_CHAIN_ID` |
| Coin | ZTPHY, base `azetaphy`, display unit `ztphy`, 18 decimals | `DENOM`, `DISPLAY_DENOM`, `SYMBOL` |
| Supply | 1,000,000,000 ZTPHY, fixed (no inflation) | `TOTAL_SUPPLY` |
| Split | rewards 50% · SWD airdrop 20% · community 15% · liquidity & partners 10% (pays the validator's 1,000,000 and the circuit multisig's 1,000) · team 5% (locked 1 year, then linear to year 4) | `ALLOC_*` |
| Self-bond | 500,000 ZTPHY | `SELF_BOND` |
| Minimum gas price | 1 gwei = `1000000000azetaphy` per gas (as on the testnet) | `MIN_GAS_PRICE` |
| Governance | voting 5 days, expedited 1 day, deposit period 14 days, deposit 10,000 ZTPHY (expedited 50,000), 25% of it at submission, quorum 33.4%, threshold 50%, veto 33.4% | `GOV_*` |
| Staking / slashing | unbonding 21 days, min commission 5%, window 10,000 blocks, 5% signed, double-sign 5% | `STAKING_*`, `SLASHING_*` |
| Genesis time | to be agreed | `GENESIS_TIME` |
| Addresses | supplied by the owner; multisig recommended for every pool | `ALLOC_*`, `CIRCUIT_AUTHORITY` |

Fees at 1 gwei: a transfer (21,000 gas) costs about 0.000021 ZTPHY, a swap (~150,000 gas) about 0.00015 ZTPHY. The
EIP-1559 base fee starts at the minimum and never falls below it (feemarket `min_gas_price`). Low fees make spam
cheap on a one-validator chain; the per-IP limits of rpc-guard and the block gas limit (30M) bound it.

The constitution is on from block 1: the governance and staking values above become floors that no later proposal
can lower (shorter votes, lower quorum, shorter unbonding, new inflation, another denom). Choose them once.

## 1. Machines [เปลี่ยนการตั้งค่า]

- **M-GEN**: a clean machine for the genesis (a laptop with a fresh OS is fine). It downloads the release, then works
  offline. It never holds a fund key.
- **M-VAL**: the validator. A new VM, not the testnet VM and not a public-RPC host (Ubuntu 24.04, 4 vCPU, 16 GB RAM,
  200 GB SSD). SSH with keys only. P2P port 26656 open **only to M-SENTRY's address**; no other port public.
- **M-SENTRY**: sentry node and public RPC, on another machine (another provider if feasible). Ports 26656, 80, 443.
- **Signers**: each multisig member's own device (hardware wallet where the key type is supported, or an offline
  machine), held by different people.

Stop if M-VAL would share a machine with the testnet node or with any public RPC.

## 2. Chain ids [อ่าน]

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-3659.json
#   expect 404 (free)
curl -s https://chainid.network/chains.json | jq '[.[] | select(.chainId == 3659)] | length'
#   expect 0
```

Stop if either shows the id in use: pick another (`CHAIN_ID=zetaphy_<id>-1`, `EVM_CHAIN_ID=<id>`). Before launch,
open the pull request to `ethereum-lists/chains` for `eip155-3659` (name, ZTPHY, 18 decimals, the RPC of step 12), so
the id is registered to this chain.

## 3. The release [อ่าน] [เปลี่ยนไฟล์]

The mainnet runs the release frozen at gate 5 (`REL=zetaphyd-<12 hex>`, its commit `COMMIT`). It must contain this
pinned-chain mode of `setup-node.sh` (releases built from this change on). On an online machine:

```bash
REL=zetaphyd-<12 hex>; COMMIT=<40 hex>; mkdir -p ~/rel && cd ~/rel
for f in RELEASE.json SHA256SUMS zetaphyd-provenance.sigstore.json zetaphyd-linux-amd64; do
  curl -fsSLO "https://github.com/pospos191-alt/zetaphy/releases/download/$REL/$f"; done
for f in setup-node.sh verify-release.sh mainnet/make-genesis.sh mainnet/genesis_tool.py mainnet/mainnet.example.env; do
  curl -fsSL "https://raw.githubusercontent.com/pospos191-alt/zetaphy/$COMMIT/zetaphy-chain/$f" -o "$(basename $f)"; done
jq -r '.scripts["verify-release.sh"]' RELEASE.json; sha256sum verify-release.sh   # the two must be equal
bash verify-release.sh --dir . --arch amd64 --setup setup-node.sh --installed-bin /nonexistent --record-file /tmp/none.json
#   expect the last line: VERIFIED zetaphyd-linux-amd64 (commit <COMMIT>)
curl -fsSLO https://github.com/CosmWasm/wasmvm/releases/download/v3.0.9/libwasmvm.x86_64.so
echo "0d41aa842c004a6aa138291d1f9f99818479fec7aef024d419e4ad244f858ee4  libwasmvm.x86_64.so" | sha256sum -c
```

Stop on any `REFUSED` line or hash mismatch. Copy `~/rel` to M-GEN and M-VAL (USB or scp) and run
`sha256sum -c SHA256SUMS --ignore-missing` there. On each machine, `sudo install -m 644 libwasmvm.x86_64.so
/usr/local/lib/ && sudo ldconfig` (or `export LD_LIBRARY_PATH=~/rel`).

## 4. Multisigs, made offline [เปลี่ยนไฟล์]

The circuit-breaker authority must be a multisig (at least 2 of at least 2 distinct keys; 2-of-3 suggested). The
pools (rewards, airdrop, community, liquidity, team) should be multisigs too, each with its own members.

Each member, on their own device:

```bash
zetaphyd keys add m1 --keyring-backend file --keyring-dir ~/zkeys --algo eth_secp256k1   # passphrase; words on paper
zetaphyd keys show m1 -p --keyring-backend file --keyring-dir ~/zkeys > m1.pub.json        # public: send this file
```

The coordinator on M-GEN, with the public keys only:

```bash
for m in m1 m2 m3; do zetaphyd keys add $m --pubkey "$(cat $m.pub.json)" --keyring-backend file --keyring-dir ~/ms; done
zetaphyd keys add circuit-ms --multisig m1,m2,m3 --multisig-threshold 2 --keyring-backend file --keyring-dir ~/ms
zetaphyd keys show circuit-ms -p --keyring-backend file --keyring-dir ~/ms > circuit-authority.pubkey.json
zetaphyd keys show circuit-ms -a --keyring-backend file --keyring-dir ~/ms                  # the address
```

Every member repeats the last four commands on their own machine and must get the same address. Stop if not.

## 5. The validator's key, on M-VAL [เปลี่ยนการตั้งค่า] [เปลี่ยนไฟล์]

```bash
sudo useradd -m -s /bin/bash zetaphy
sudo install -m 755 ~/rel/zetaphyd-linux-amd64 /usr/local/bin/zetaphyd
sudo -iu zetaphy
zetaphyd init zetaphy-validator-0 --chain-id zetaphy_3659-1 --home ~/.zetaphy > /dev/null
zetaphyd keys add validator --keyring-backend file --keyring-dir ~/.zetaphy-keys --algo eth_secp256k1
#   a long passphrase; write the 24 words on paper, keep them offline; never the test backend
zetaphyd keys show validator -a --keyring-backend file --keyring-dir ~/.zetaphy-keys      # -> ALLOC_VALIDATOR
```

`~/.zetaphy/config/priv_validator_key.json` is the consensus key: back it up offline now (encrypted), with
`pq_vote_key.seed` once step 11 has made it. A remote signer (Horcrux, `zetaphy-chain/horcrux/`) can replace the key
file later.

## 6. The config, on M-GEN [เปลี่ยนไฟล์]

```bash
cp ~/rel/mainnet.example.env mainnet.env      # next to circuit-authority.pubkey.json from step 4
```

Fill in every `ALLOC_*` address, `CIRCUIT_AUTHORITY`, `GENESIS_TIME` (UTC, at least a day after step 10), and confirm
each proposed value. Allocations are `<address> <whole ZTPHY>`, and `vesting <start> <end>` for team or treasury.

## 7. Draft genesis [เปลี่ยนไฟล์]

```bash
ZETAPHYD=~/rel/zetaphyd-linux-amd64 bash ~/rel/make-genesis.sh draft mainnet.env out
```

Expect `draft genesis: out/genesis.draft.json` and a summary: chain id, coin, each allocation, `circuit authority …
(multisig 2 of 3)`, `from block 1 chain guard, shield, invariant-firewall layer, security core, constitution ON`,
`gentxs 0`. Stop on `REFUSED: …`; it names the problem (a placeholder or bad address, allocations not adding up to
the supply, a single-key or missing circuit authority, the testnet's chain id, a voting period under a day, an
unknown key, …). Send the draft to the fund holders: each runs
`make-genesis.sh verify mainnet.env genesis.draft.json --draft` and checks their address and amount.

## 8. The gentx, on M-VAL [เปลี่ยนไฟล์]

```bash
cp genesis.draft.json ~/.zetaphy/config/genesis.json      # as the zetaphy user
zetaphyd genesis gentx validator 500000000000000000000000azetaphy --keyring-backend file --keyring-dir ~/.zetaphy-keys \
  --chain-id zetaphy_3659-1 --home ~/.zetaphy --moniker zetaphy-validator-0 --commission-rate 0.05 \
  --commission-max-rate 0.20 --commission-max-change-rate 0.01 --gas-prices 1000000000azetaphy \
  --ip <M-VAL address M-SENTRY reaches> --output-document ~/gentx.json
```

The amount is `SELF_BOND` in azetaphy (500,000 × 10^18). `gentx.json` is public; copy it to M-GEN.

## 9. Final genesis and its sha256 [เปลี่ยนไฟล์]

```bash
ZETAPHYD=~/rel/zetaphyd-linux-amd64 bash ~/rel/make-genesis.sh finalize mainnet.env out gentx.json
```

Expect the summary with `gentxs 1`, then `GENESIS_SHA256=<64 hex>`; `out/` holds `genesis.json`, `genesis.sha256`,
`chain.json`. Stop on `REFUSED` (for example a gentx bonding another amount, or for another chain id).

## 10. Publish [เปลี่ยนไฟล์]

Publish `genesis.json`, `genesis.sha256`, `chain.json`, `mainnet.env` and `circuit-authority.pubkey.json` (all
public: addresses and public keys only), e.g. as a release of the repository. The owner and the multisig members
sign the sha256 publicly (a signed tag or a signed message). Anyone checks:

```bash
ZETAPHYD=<verified zetaphyd> bash make-genesis.sh verify mainnet.env genesis.json   # [อ่าน] expect: OK  sha256 <sha>
```

Write the chain id, sha256 and signatures into gate 6 of the runbook.

## 11. Install the validator node [เปลี่ยนการตั้งค่า]

Copy the published `genesis.json` to `/home/zetaphy/genesis.json` and check `sha256sum` against the published value.

```bash
sudo GENESIS_FILE=/home/zetaphy/genesis.json GENESIS_SHA256=<sha> GENESIS_EVM_CHAIN_ID=3659 \
  ZETAPHYD_BIN=$HOME/rel/zetaphyd-linux-amd64 bash ~/rel/setup-node.sh
sudo bash ~/rel/verify-release.sh --dir ~/rel --arch amd64 --setup ~/rel/setup-node.sh --record   # [เปลี่ยนไฟล์]
```

Expect `5/8 genesis of zetaphy_3659-1 (pinned, sha256 <sha>)` and `ZETAPHY node of zetaphy_3659-1 is starting`,
`Public RPC: none on this machine (PUBLIC_RPC=0)`. The node waits for `GENESIS_TIME`. The pin is kept in
`/etc/zetaphy/pinned-chain.env`: later runs (`sudo zetaphy-validator update`, the upgrade timer) stay on this genesis
and refuse another. Stop if the script says `refused:`. Do not use `zetaphy-validator install`, `check`, `unjail` or
`setup-node.sh --become-validator` on the mainnet: they are the testnet's (test keyring, testnet chain id).

## 12. Sentry and public RPC, on M-SENTRY [เปลี่ยนการตั้งค่า]

Same release steps as step 3, then:

```bash
sudo GENESIS_FILE=$HOME/genesis.json GENESIS_SHA256=<sha> GENESIS_EVM_CHAIN_ID=3659 ZETAPHYD_BIN=$HOME/rel/zetaphyd-linux-amd64 \
  PUBLIC_RPC=1 PUBLIC_HOST=rpc.<your domain> PEERS=<M-VAL node id>@<M-VAL ip>:26656 bash ~/rel/setup-node.sh
```

`zetaphyd comet show-node-id --home ~/.zetaphy` on M-VAL gives its node id. Public access goes through Caddy and
rpc-guard (allowed methods only, per-IP limits); keep `PUBLIC_HTTP_RPC` unset. In `~/.zetaphy/config/config.toml` on
M-SENTRY set `private_peer_ids = "<M-VAL node id>"`; on M-VAL set `pex = false`, then run step 11's command again with
`PEERS=<M-SENTRY node id>@<M-SENTRY ip>:26656` and restart (`sudo systemctl restart zetaphyd`).

### 12.1 Mainnet faucet on the sentry (owner decision) [เปลี่ยนการตั้งค่า] [เปลี่ยนไฟล์] [เปลี่ยนเชน]

**Owner decision (2026-11-13):** the mainnet has a faucet and browser mining, on M-SENTRY only:
`zetaphy_faucet` gives 1 ZTPHY to an address once a day, `zetaphy_faucetPow` (the hub's mining page) 5 ZTPHY for
each accepted proof of work, and both together give at most 200 ZTPHY a UTC day (and at most 200 grants); one
address gets one grant per 24 h from either method. The pool is 10,000 ZTPHY that the owner sends to a dedicated
faucet key. The faucet is RPC only: it sends ordinary signed transfers from that key; no consensus rule changes and
the validator is not involved. rpc-guard still limits faucet calls per IP (3 `zetaphy_faucet` and 10
`zetaphy_faucetPow` a day).

**Risk, stated plainly:** the faucet key is a hot key on a public machine. If M-SENTRY is broken into, the attacker can
send away everything the key holds. The worst case is the pool (what is left of the 10,000 ZTPHY), nothing more: the
key has no role anywhere and cannot sign blocks. Keep only the pool there, and top it up instead of sending more at once.
**The faucet key must never be on the validator**: setup-node.sh refuses `MAINNET_FAUCET=1` without `PUBLIC_RPC=1`
and on any machine that signs as a validator (its consensus key in the genesis, voting power, a remote signer, or the
`~/.zetaphy-keys` keyring).

Enable it: step 12's command again on M-SENTRY, with `MAINNET_FAUCET=1` added:

```bash
sudo GENESIS_FILE=$HOME/genesis.json GENESIS_SHA256=<sha> GENESIS_EVM_CHAIN_ID=3659 ZETAPHYD_BIN=$HOME/rel/zetaphyd-linux-amd64 \
  PUBLIC_RPC=1 PUBLIC_HOST=rpc.<your domain> PEERS=<M-VAL node id>@<M-VAL ip>:26656 MAINNET_FAUCET=1 bash ~/rel/setup-node.sh
```

It makes a fresh key on M-SENTRY (`~/.zetaphy/config/faucet.key`, mode 600, owned by `zetaphy`; it is the only copy:
back it up offline if you want to recover the pool after losing the machine), writes the limits
(`config/faucet-amount` 1, `config/faucet-pow-amount` 5, `config/faucet-day-budget` 200; or `FAUCET_AMOUNT=`,
`FAUCET_POW_AMOUNT=`, `FAUCET_DAY_BUDGET=` on the command), records `MAINNET_FAUCET=1` and the key's fingerprint in
`/etc/zetaphy/pinned-chain.env` (later runs and `zetaphy-validator update` keep the faucet and never make a new key),
and prints `Faucet (MAINNET_FAUCET=1): 0x… zetaphy1…`. Stop if it says `refused:`.

Fund it: from the owner's wallet send the pool to the printed address, e.g. with MetaMask (10000 ZTPHY to the `0x…`
address) or `zetaphyd tx bank send <owner key> <zetaphy1… of the faucet> 10000000000000000000000azetaphy
--keyring-backend file … --gas-prices 1000000000azetaphy`. Check [อ่าน]:

```bash
curl -s https://rpc.<your domain> -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"zetaphy_faucetPowInfo","params":[]}' | jq .result
#   enabled true, address 0x… (the faucet), reward 0x4563918244f40000 (5 ZTPHY), faucetReward 0xde0b6b3a7640000 (1),
#   dayBudget 0xad78ebc5ac6200000 (200), remainingBudget, remainingToday
```

Change the limits: edit the three files on M-SENTRY (`sudo -u zetaphy sh -c 'echo 0.5 > ~/.zetaphy/config/faucet-amount'`,
decimal ZTPHY; an amount above 0 and at most 100, a budget at most 100,000). zetaphyd reads them on every call; no
restart. A file that is not a valid number turns the faucet off (`problem` in `zetaphy_faucetPowInfo`) until it is
fixed. Re-running setup-node.sh keeps the files unless you pass new values.

Turn it off: on M-SENTRY delete the key first, `sudo rm ~zetaphy/.zetaphy/config/faucet.key`. zetaphyd reads the key
file on every call, so both methods stop at once (`the faucet is off on this node`), no restart. Then delete
`~zetaphy/.zetaphy/config/faucet-{amount,pow-amount,day-budget}` (never the files alone while the key is there: without
them the node falls back to the testnet's 10 ZTPHY a grant and no budget) and run step 12's command with
`MAINNET_FAUCET=0`, which records the choice; setup-node.sh refuses `MAINNET_FAUCET=0` while the key is still there.
To get the rest of the pool back, send it to the owner before deleting the key (the key in `faucet.key` imports into
any EVM wallet), or accept that it is lost.

## 13. Start and first checks [อ่าน]

At `GENESIS_TIME` both nodes run. On M-VAL:

```bash
zetaphyd status --home ~/.zetaphy | jq '{net: .node_info.network, h: .sync_info.latest_block_height, power: .validator_info.voting_power}'
#   zetaphy_3659-1, the height going up, power 500000
curl -s -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545
#   "result":"0xe4b"
zetaphyd q bank denom-metadata-by-query-string --denom azetaphy -o json | jq .metadata.symbol     # "ZTPHY"
zetaphyd q gov params -o json | jq .params.voting_period                                          # "120h0m0s"
zetaphyd q feemarket params -o json | jq .params                                                  # base_fee and min_gas_price 1000000000
zetaphyd q bank balance <each allocation address> azetaphy                                         # as in mainnet.env
journalctl -u zetaphyd | grep -i 'start guard\|CONSENSUS FAILURE'                                 # nothing
```

Stop if any value differs from the published genesis.

## 14. The validator's vote key [เปลี่ยนเชน]

```bash
zetaphyd tx pq-vote-key --from validator --keyring-backend file --keyring-dir ~/.zetaphy-keys --home ~/.zetaphy \
  --chain-id zetaphy_3659-1 --gas 600000 --gas-prices 1000000000azetaphy -y -o json | jq '{code, txhash}'   # code 0
```

Back up `~/.zetaphy/config/pq_vote_key.seed` offline with `priv_validator_key.json`.

## 15. Circuit authority and constitution checks [อ่าน] [เปลี่ยนเชน]

1. The constitution refuses a proposal that shortens voting (refused before it enters a block; nothing is spent):
   build a `/cosmos.gov.v1.MsgUpdateParams` proposal from `q gov params` with `voting_period` `600s` and submit it
   with `tx gov submit-proposal`. Expect `constitution is in force`.
2. A single key cannot trip the breaker: `zetaphyd tx circuit trip /cosmos.bank.v1beta1.MsgSend --from validator …`
   gives code 4, `only governance or the circuit authority can trip or reset the circuit breaker`.
3. Drill (before announcing the chain): the multisig trips `MsgSend`, a send fails with `is tripped by the circuit
   breaker`, the multisig resets it. Each member signs offline:
   `tx circuit trip <url> --from circuit-ms --generate-only` (put the message fields back with `jq` as
   `zetaphy-chain/test-anti-rollback.sh` does), `tx sign … --multisig <address> --sign-mode amino-json` by two members,
   `tx multisign`, `tx broadcast`. `zetaphy-chain/mainnet/test-make-genesis.sh` runs exactly this.

Stop if 1 or 2 is accepted.

## 16. Contracts with ZTPHY, admin to governance [อ่าน] [เปลี่ยนไฟล์] [เปลี่ยนเชน]

Tools: `zetaphy-launch/launch.js --network mainnet` (`src/mainnet.js` says what differs from the testnet launch and
why) and `zetaphy-chain/gov.sh`, which is in mainnet mode on a pinned node. What the launch deploys (runbook gate 8):
the guardian multisig; Neuro (`NeuroControl` + `NeuroJobs`, `ThreatRegistry`, `ThreatReports`); the Saphan bridge on
ZETAPHY (`BridgeGuard` + `BridgeAirlock` + `NeuroLane`) **closed**; the DEX (factory + router, no test tokens, no
seeded pools); `ZetaphyBounty` (funded, no admin key); then `ZetaphyTimelock` and the handover. Neuro comes before the
bridge and the DEX because both read it; the timelock comes last so that its bootstrap (the deployer as its only
proposer at a zero delay, for the handover's own batch) lasts minutes. After the handover, the same tool adds the rest
of the testnet's real systems (16.9): `NeuroIdentity` + `NeuroValidation`, `RewardVault`, `QuantumWalletFactory`,
`ComputeMarket`, the DLMM (unaudited), the NFT factory and marketplace, and the oracle (`TwapRecorder`,
`ZetaphyPythRelay`, `ZetaphyOracle`), each handing its roles straight to the timelock. Nothing testnet-only exists in this
mode, and the plan lists each such step as `skipped on mainnet` with its reason: no faucet, no test stablecoins or
StableGateway, no fixed price, no test tokens or seeded pools, no web-app configs, no snap build.

What the launch enforces on mainnet:

- the chain is never a default: `--network mainnet` plus `--chain chain.json` (step 8) and/or `--pin` + `--genesis`
  (the node's pin and the genesis it pins, sha256 checked); every source must agree, the testnet's ids are refused,
  and an RPC whose `eth_chainId` differs is refused before anything is signed. Every transaction carries that id.
- no plain key: `--keystore` (an encrypted keystore JSON, mode 600; the passphrase is asked on the terminal or piped
  with `--passphrase-stdin`, decrypted in memory only) or `--remote-signer` (clef with a hardware wallet, web3signer,
  Frame: each signed transaction is checked field by field before it is sent). `--key-file`, `ZETAPHY_DEPLOYER_KEY`,
  `ZETAPHY_DEPLOYER_KEY_FILE` and `ZETAPHY_PASSPHRASE` are refused; so are `--devnet` and `--redo`.
- the settings come from a deploy config (`zetaphy-launch/mainnet.example.json`): placeholders, unknown keys,
  secret-looking fields, a timelock or bounty delay under 48 h, a bridge token named "test", and the deployer in any
  role are refused. Governance, extra proposers and an existing guardian must have contract code (or be `gov`).
- `--dry-run` prints every contract, its constructor arguments, every call and the gas and cost in ZTPHY, and sends
  and writes nothing; a real run also needs `--confirm-chain <EVM chain id>`.
- the state file (`zetaphy-launch/state/<EVM chain id>.json`) holds addresses only; a failed step resumes with
  `--resume`. At the end the handover gives every admin role to the timelock (delay ≥ 48 h, proposer/canceller the
  gov module, executor anyone), the emergency switches to the guardian multisig, the deployer renounces, and
  `verify` checks on-chain that no EOA and not the deployer holds any role on any contract of the run.

### 16.1 The deployer key, on its own machine [เปลี่ยนไฟล์]

A fresh key, used for this step only (gate 4), never on M-VAL or M-SENTRY. Either an encrypted keystore:

```bash
cast wallet new ~/zetaphy-deployer          # foundry; asks a passphrase; prints the address and the keystore file
chmod 600 ~/zetaphy-deployer/*
```

or a hardware wallet behind clef (Ledger/Trezor, plugged in): `clef --chainid 3659 --http` and use
`--remote-signer http://127.0.0.1:8550 --signer-method account_signTransaction --signer-address 0x<its account>`
below instead of `--keystore`. Approve each transaction on the device.

### 16.2 The deploy config [เปลี่ยนไฟล์]

```bash
cp zetaphy-launch/mainnet.example.json ~/mainnet-deploy.json
```

Fill it in: `governance` `"gov"`; `guardianOwners` (3 different people, hardware wallets; or `guardian` = an existing
multisig); `communityFund` (the community pool's address, 0x form of its zetaphy1…: `zetaphyd debug addr <zetaphy1…>`);
`bridge.lockbox` (`<source chain id>:0x<lockbox>`; drop `bridge` to deploy no bridge yet); `bounty.committee`;
`identity.web` (the Neuro web page, `https://<host>/web/`; drop `identity` to skip NeuroIdentity). The other sections of
16.9 (`vault`, `compute`, `dlmm`, `nft`, `oracle`, `proposalDeposit`) may stay as in the example (their defaults).
The file holds public values only. Every address in the example is a placeholder and is refused, and so is an example
host (`neuro.example`, `*.invalid`, `*.test`, `localhost`) or a bare IP in a URL.

### 16.3 The dry run [อ่าน]

Copy `chain.json` (step 8) next to it, then (`$RPC` = the sentry's https RPC of step 12, or `http://127.0.0.1:8545`
over an SSH tunnel to M-SENTRY):

```bash
node zetaphy-launch/launch.js --network mainnet --rpc "$RPC" --chain chain.json \
  --deploy-config ~/mainnet-deploy.json --keystore ~/zetaphy-deployer/<keystore file> --dry-run
#   ZETAPHY mainnet zetaphy_3659-1 (EVM chain 3659, genesis sha256 <the published one>)
#   the plan: every "deploy <Contract>(<argument>=<value>, …)" with its gas, every call, then
#   total: <C> contract(s), about <M> call(s), ~<G> gas … : the deployer needs <N> ZTPHY
#   dry run: nothing signed, nothing sent, no state written
```

On a machine with the pinned node, `--pin /etc/zetaphy/pinned-chain.env --genesis ~/.zetaphy/config/genesis.json`
may be given too (all sources must agree). Check each constructor argument against the deploy config, the delay
(`delay 172800 s`), `enabled = false  CLOSED` on the bridge route, and that no `deploy Test…(`, `deploy StableGateway(`
or faucet appears (the testnet-only steps show as `- stable: skipped on mainnet (…)` and the like). Stop if anything
differs.

### 16.4 Fund the deployer [เปลี่ยนเชน]

The amount the dry run printed (it includes the bounty's `fund`), from the liquidity multisig (`zetaphyd debug addr 0x<deployer>`
gives its zetaphy1…). Members sign offline, as in step 15:

```bash
zetaphyd tx bank send <liquidity multisig zetaphy1…> <deployer zetaphy1…> <N>azetaphy --chain-id zetaphy_3659-1 \
  --gas 200000 --gas-prices 1000000000azetaphy --generate-only > fund.json
zetaphyd tx sign fund.json --multisig <liquidity multisig zetaphy1…> --from <member> --sign-mode amino-json --chain-id zetaphy_3659-1 --output-document m1.json   # each of 2 members
zetaphyd tx multisign fund.json <multisig key name> m1.json m2.json --chain-id zetaphy_3659-1 > signed.json
bash zetaphy-chain/gov.sh broadcast signed.json                                                    # on M-VAL: mainnet mode
```

Run 16.3 again: `deployer balance` must now cover `the deployer needs`.

### 16.5 Deploy and hand over [เปลี่ยนเชน]

```bash
node zetaphy-launch/launch.js --network mainnet --rpc "$RPC" --chain chain.json \
  --deploy-config ~/mainnet-deploy.json --keystore ~/zetaphy-deployer/<keystore file> --confirm-chain 3659
#   asks the keystore passphrase; then each step: guardian neuro threats reports bridge dex bounty wire timelock handover verify
#   … checked on-chain: N admin role(s) belong to the timelock; no EOA and not the deployer holds a timelock role …
#   … checked on-chain: no EOA and not the deployer 0x… holds a role on any contract of this run; the bridge is closed
```

If a step fails: fix the cause and run the same command with `--resume` (finished steps are kept; never `--fresh` on
mainnet once a contract is deployed). Stop if `the handover check failed` or `the mainnet check failed` is printed:
do not announce any address; find out why first.

### 16.6 Check, and publish the addresses [อ่าน]

```bash
node zetaphy-launch/launch.js --network mainnet --rpc "$RPC" --chain chain.json --deploy-config ~/mainnet-deploy.json \
  --keystore ~/zetaphy-deployer/<keystore file> --check     # reads only: no passphrase, signs nothing; anyone can run it
cast call --rpc-url "$RPC" <timelock> 'getMinDelay()(uint256)'                                    # 172800
cast call --rpc-url "$RPC" <timelock> 'getRoleMember(bytes32,uint256)(address)' $(cast keccak PROPOSER_ROLE) 0   # 0x7b5Fe22B…3dF2 (gov)
cast call --rpc-url "$RPC" <NeuroControl, ThreatRegistry, BridgeGuard, BridgeAirlock, DEX factory> 'governance()(address)'   # the timelock
```

Publish `zetaphy-launch/state/3659.json` (addresses only) and verify each contract's source (Sourcify, gate 8).

### 16.7 Retire the deployer [เปลี่ยนเชน] [เปลี่ยนไฟล์]

Send what is left back to the liquidity pool, then destroy the keystore (or wipe the hardware wallet's account):
`cast send --rpc-url "$RPC" --keystore ~/zetaphy-deployer/<keystore file> <liquidity 0x…> --value <balance minus gas>`,
then `shred -u ~/zetaphy-deployer/*`. It holds no role any more (16.5 checked it).

### 16.8 Governance on M-VAL: gov.sh in mainnet mode

On a pinned node `gov.sh` reads the chain id from the pinned genesis (sha256 checked), checks the node serves it
before signing, uses the file keyring in `~/.zetaphy-keys` (`--keyring-backend file|os|ledger`; `test` is refused),
puts the chain's full `min_deposit` (10,000 ZTPHY) on proposals, and refuses `airdrop` (testnet faucet coins).

```bash
bash zetaphy-chain/gov.sh status                                                                 # [อ่าน]
bash zetaphy-chain/gov.sh vote <id> yes --from validator                                         # [เปลี่ยนเชน] file keyring, asks its passphrase
bash zetaphy-chain/gov.sh vote <id> yes --keyring-backend ledger --from <ledger key>             # [เปลี่ยนเชน] confirm on the device
bash zetaphy-chain/gov.sh propose-upgrade <name> <height> "<summary>" \
  --from <gov multisig zetaphy1…> --generate-only up.json                                          # [เปลี่ยนไฟล์] unsigned, then tx sign / multisign
bash zetaphy-chain/gov.sh broadcast signed.json                                                   # [เปลี่ยนเชน]
bash zetaphy-chain/gov.sh invariant-firewall <InvariantFirewall 0x…> --from <proposer>           # [เปลี่ยนเชน] once one is deployed (below)
```

Not covered by the launch's mainnet steps (open): the `InvariantFirewall` (it needs the SS1 audit contracts,
docs/CHAIN-FIREWALL.md). Do not run the testnet launch's steps against the mainnet (it refuses this chain anyway).

### 16.9 The rest of the systems, on the running mainnet [อ่าน] [เปลี่ยนไฟล์] [เปลี่ยนเชน]

Everything the testnet has that is real (not a test fixture) is added to the live mainnet by the same tool, with the
same state file (`zetaphy-launch/state/3659.json`) and the same deployer keystore or hardware wallet (refund it as in
16.4 first; 16.7 comes after this step), as a `--resume`. The gate-8 set and its handover stay as they are: the
handover step only checks itself again (it sends nothing), then these steps run:

| step | contracts | who holds what |
|---|---|---|
| `identity` | `NeuroIdentity` + `NeuroValidation` (ERC-8004) | NeuroIdentity's admin (add a chain, move the web link): the deployer for one call, then `setAdmin(timelock)` in the same step; NeuroValidation has no admin. ZETAPHY's own chain entry is `eip155:3659` |
| `vault` | `RewardVault` (10% a year to NeuroJobs) | governance: the timelock in the constructor. The deployer puts no coins in it: the rewards pool is moved in later by its own keys |
| `pq` | `QuantumWalletFactory` | no admin |
| `compute` | `ComputeMarket` (on NeuroJobs' runners) | no admin |
| `dlmm` | `ZetaphyDlmmFactory` (+ its `ZetaphyDlmmPairDeployer`) and `ZetaphyDlmmRouter`, **unaudited** | governance: the timelock in the constructor. Its handover would be two-step (the timelock would have to accept), so it never belongs to the deployer; its presets, ThreatRegistry and `feeTo` are set by the timelock batch below. Until then no pair can be made |
| `nft` | `NFTFactory` + `NFTMarketplace` (checks the ThreatRegistry) | marketplace governance: the timelock in the constructor; the factory has no admin |
| `oracle` | `TwapRecorder`, `ZetaphyPythRelay`, `ZetaphyOracle` | relay governance: the timelock in the constructor; the oracle: the deployer sets the guardian multisig (it may pause a feed) and an optional Pyth feed, then `setGovernance(timelock)` in the same step. No DEX-priced feed yet (no pool with a real stablecoin) |
| `protect` | (checks) | the NFT collections' code keys in the ThreatRegistry, which the timelock governs |
| `proposal` | (writes) | ONE timelock batch for what only the timelock can do now (below) |

Not on mainnet, each listed as `skipped on mainnet (…)` in the plan: `stable` (TestStable tUSDC/tUSDT and the
StableGateway), `skill` (inside `neuro`), `configs` (web-app configs), `snap` (a local build), test tokens, seeded pools,
faucet, mining payouts and fixed prices. The bridge stays as it is (it needs a lockbox: `bridge` in the deploy config).

1. Add to `~/mainnet-deploy.json` (16.2): `"identity": { "web": "https://<Neuro web host>/web/" }` (the real page:
   example hosts are refused; without `identity` that step is skipped), and, if wanted, the other sections of
   `mainnet.example.json`: `vault` (`validators` + `validatorsShare`), `compute.minAgreed`, `dlmm.feeTo` (default:
   `dex.feeTo`), `nft.feeBps` / `nft.feeRecipient` (default 100 = 1% to `communityFund`), `oracle.relayers` /
   `relayerThreshold` / `pythZetaFeed`, `proposalDeposit` (default 10000, the mainnet `min_deposit`). Placeholders,
   unknown keys and the deployer in any role are refused.
2. The dry run [อ่าน]:

   ```bash
   node zetaphy-launch/launch.js --network mainnet --rpc "$RPC" --chain chain.json \
     --deploy-config ~/mainnet-deploy.json --keystore ~/zetaphy-deployer/<keystore file> --resume --dry-run
   #   ✓ guardian … ✓ timelock: done …   ✓ handover: done …; checked again on-chain
   #   → identity … deploy NeuroIdentity(webBase=https://…/web/, …, caip2s=[eip155:3659, …], runners=<NeuroJobs 0x…>, …)
   #   → vault … deploy RewardVault(governance=0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA, shares=[[<NeuroJobs>, 10000, true]])
   #   → dlmm … deploy ZetaphyDlmmFactory(governance=0x9fC29E85…f9cA) …   → nft … deploy NFTMarketplace(governance=0x9fC29E85…f9cA, …)
   #   → oracle … call ZetaphyOracle.setGuardian(0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519, true) … setGovernance(ZetaphyTimelock)  one step
   #   - stable: skipped on mainnet (…)   - snap: skipped on mainnet (…)
   #   total: 12 contract(s), about … call(s), … : the deployer needs <N> ZTPHY
   ```

   Check that every governance argument is the timelock `0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA`, the guardian is
   `0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519`, `runners=` is NeuroJobs `0x5044309622064d21c5D7Ac681f7a4489ca4Ce4fB`,
   `threatRegistry=` is `0xaACfc7Cf7148b7AE530c2Ab891D4220E648A2139`, and that no gate-8 contract is deployed again.
   Fund the deployer with what it says (16.4).
3. Deploy [เปลี่ยนเชน]: the same command with `--confirm-chain 3659` instead of `--dry-run` (`--only identity,…` runs
   some of the steps; the handover and verify still check everything). It ends with
   `checked on-chain: no EOA and not the deployer 0x… holds a role on any contract of this run`.
4. The timelock batch [เปลี่ยนเชน]: the `proposal` step simulates each call as the timelock and writes, next to the
   state file, `3659.gov-proposal.json` (for the gov module, the timelock's proposer) and `3659.timelock-batch.json`
   (the calls, the operation id, the `scheduleBatch` and `executeBatch` calldata). On M-VAL:

   ```bash
   bash zetaphy-chain/gov.sh propose-file 3659.gov-proposal.json --from <proposer key>   # deposit 10,000 ZTPHY
   bash zetaphy-chain/gov.sh vote <id> yes --from validator                             # 1 day of voting
   #   passed: the operation is Waiting; 48 h later anyone runs it:
   cast send --rpc-url "$RPC" 0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA "$(jq -r .execute.data 3659.timelock-batch.json)" --keystore <any funded key>
   ```

   Until it runs the DLMM has no preset (nobody can create a pair) and the NFT code keys are unprotected (a code flag
   could mark every factory collection). No role is held by anyone but the timelock meanwhile, so `verify` passes and
   prints the batch as `Waiting`; once it ran, a `--resume` writes no new batch.
5. Check [อ่าน]: `--check` (16.6) now also lists NeuroIdentity, ComputeMarket, the DLMM, the NFT factory, the
   TwapRecorder and the timelock batch. Publish the new addresses with the state file (16.6), then retire the deployer
   (16.7).

## 17. Adding validators [เปลี่ยนการตั้งค่า] [เปลี่ยนเชน]

A new operator: steps 3 and 11 on their own machine with the published `genesis.json` and sha256, `PEERS=` the
sentry, waits for sync, then with their own file-keyring key and funds:
`zetaphyd tx staking create-validator <validator.json> --from <key> --keyring-backend file …`, and step 14. From 4
validators on, the chain guard's power cap (3333 bps) refuses delegations above 1/3; the project then moves stake
away from its own validator. Update gate 2 in the runbook as validators join.

## 18. Operations

Monitoring and alerts (missed blocks, height, start guard, circuit-breaker events, upgrade plans); never restore
`priv_validator_state.json` or `zetaphy_sign_state.json` from an older copy; signed releases only
(`sudo zetaphy-validator update`).

## Public notice (for the apps and the website)

Provide this text where users see the network; it is not wired into the UIs. The full notice for `zetaphy_3659-1`:
[ZETAPHY-MAINNET-NOTICE.md](ZETAPHY-MAINNET-NOTICE.md).

> **EN:** ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not
> yet completed an independent external audit. Until more independent validators join and the audit is published,
> the project can halt or change the chain. Use it only with amounts you can afford to lose. Details:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-RUNBOOK.md

> **TH:** ขณะนี้ ZETAPHY mainnet ทำงานบน validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ
> (audit) จากภายนอกที่เป็นอิสระ จนกว่าจะมี validator อิสระเพิ่มและเผยแพร่ผล audit โครงการสามารถหยุดหรือเปลี่ยนแปลงเชนได้
> โปรดใช้เฉพาะจำนวนที่ยอมเสียได้ รายละเอียด:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-RUNBOOK.th.md
