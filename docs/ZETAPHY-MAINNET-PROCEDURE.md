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
`GENESIS_EVM_CHAIN_ID` install a node of that genesis only, with no testnet genesis, no faucet, no test keyring, no
automatic transactions, and no public RPC unless `PUBLIC_RPC=1`. With those variables unset it sets up the testnet
exactly as before.

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

## 16. Contracts with ZTPHY, admin to governance [เปลี่ยนเชน]

Order (runbook gate 8): timelock and multisig; Saphan bridge (closed); DEX; Neuro; `ZetaphyBounty` (funded). The
deployer is a fresh key used once, funded with a few ZTPHY, then retired. At the end every admin role goes to a
`ZetaphyTimelock` (48 h delay) whose proposer is governance (`--governance gov`), the emergency guardian is a multisig,
and the tool checks that no single key keeps an admin role (`zetaphy-launch/launch.js --handover`). Then
`zetaphyd tx security-proposal invariant-firewall <InvariantFirewall 0x…>` names the firewall contract (voted).

**Stop here today:** `zetaphy-launch/launch.js` and `zetaphy-chain/gov.sh` are testnet tools (launch.js refuses any
EVM chain id but 77390; gov.sh uses the test keyring). A reviewed mainnet mode of both is needed before this step;
do not edit their checks on the day.

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

Provide this text where users see the network; it is not wired into the UIs.

> **EN:** ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not
> yet completed an independent external audit. Until more independent validators join and the audit is published,
> the project can halt or change the chain. Use it only with amounts you can afford to lose. Details:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-RUNBOOK.md

> **TH:** ขณะนี้ ZETAPHY mainnet ทำงานบน validator เพียงตัวเดียวที่โครงการ ZETAPHY ดูแลเอง และโค้ดยังไม่ผ่านการตรวจสอบ
> (audit) จากภายนอกที่เป็นอิสระ จนกว่าจะมี validator อิสระเพิ่มและเผยแพร่ผล audit โครงการสามารถหยุดหรือเปลี่ยนแปลงเชนได้
> โปรดใช้เฉพาะจำนวนที่ยอมเสียได้ รายละเอียด:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-RUNBOOK.th.md
