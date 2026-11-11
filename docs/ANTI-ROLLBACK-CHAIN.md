**English** | [ภาษาไทย](ANTI-ROLLBACK-CHAIN.th.md)

# Anti-rollback and anti-takeover guards (chain side)

Testnet only. Nothing here holds or pays real money, and none of it has been audited by an outside firm.

Six guards against the ways a node or the chain can be taken backwards or taken over: an old binary, an old copy of
the signing state, a weaker signature algorithm, one validator with too much power, an emergency with no brake, and
a governance vote that undoes the protections. Two are node checks at start; four are chain rules that arrive with
one software upgrade, **`zetaphy-guard`**, and stay off or permissive until governance uses them.

| Guard | What it stops | Where | Default |
|---|---|---|---|
| L1-1 downgrade guard | a binary that cannot run the chain's next block (missing handler of the last completed upgrade, a due plan without handler, an early non-early upgrade) | `zetaphyd start`, `evmd/zetaphy_antirollback.go` | on, every start |
| L1-2 signing-state guard | a validator started on an older `priv_validator_state.json` than the heights it already signed (restored snapshot / backup): double sign | `zetaphyd start`, same file | on, every start |
| T signature algorithms | a crypto downgrade: re-enabling a retired algorithm, bringing ECDSA back after Q-day, unlocking a quantum lock | `evmd/zetaphy_chainguard.go`, ante handler, `MsgSetQDay` | list = all three algorithms enabled, nothing retired |
| S1 voting-power cap | a delegation or self-bond taking one validator above `max_bps` of the active set | staking hooks (every path) | 3333 bps, enforced only with ≥ 4 active validators |
| S2 circuit breaker | nothing until tripped; then the tripped message types fail everywhere | message router + ante | no authority, nothing tripped |
| P constitution | governance proposals that mint, rewrite balances, shorten timelocks/unbonding, weaken thresholds, or remove the guards | proposal submission (ante) + execution (gov router) | **off** (turn on for mainnet) |

All of it is in the embedded `ZETAPHY_PQ_PATCH` of `zetaphy-chain/setup-node.sh`; tests are in
`zetaphy-chain/fork-tests/evmd/zetaphy_chainguard_test.go` (+ the upgrade tests) and the devnet attacks in
`zetaphy-chain/test-anti-rollback.sh` (CI job `zetaphy-chain-attacks`).

## L1-1 and L1-2: the start guard

`zetaphyd start` builds the app on the committed state and, before CometBFT opens its databases, connects to peers
or signs anything, runs two checks. A refusal prints one line to the journal and stderr and exits with status 78;
the systemd unit has `RestartPreventExitStatus=78`, so `systemctl status zetaphyd` shows it failed instead of
restarting it every 5 s.

**L1-1 (downgrade).** It reads the last completed upgrade and the scheduled plan from the local x/upgrade state and
applies the rules of `zetaphyd upgrade-check` (`zetaphyUpgradeCheck`): the binary must have the handler of the last
completed upgrade; a plan due at the next block must have a handler; a not-yet-due plan whose handler this binary
already has must be allowed early (`zetaphyEarlyUpgrades`). x/upgrade checks the first rule only when the first
block runs, after the node has joined and voted (the 2026-11-05 halt at block 239468); this refuses before.
`--unsafe-skip-upgrades` heights are honored.

```
ZETAPHY start guard: refused to start: this binary has no handler for "zetaphy-guard", the chain's last completed
upgrade: ... Install the binary the chain needs; only if you mean it (e.g. a planned rollback): start once with
ZETAPHY_ALLOW_DOWNGRADE=zetaphy_77390-1:350123
```

**L1-2 (signing state).** For a validator with a local key (`priv_validator_laddr` empty; Horcrux and other remote
signers keep their own state and are not checked), `data/priv_validator_state.json` must be at least the highest of:

- the newest height, among the last 1,000 blocks of the local block store, whose commit carries this validator's
  signature;
- `config/zetaphy_sign_state.json`, the sign record: the node writes the height of every precommit it is about to
  sign (from `ExtendVote`, which CometBFT calls just before signing a precommit). It is kept in `config/`, **outside
  `data/`**, so putting back an old copy of `data/` (snapshot, backup, cloned disk) does not roll it back too. It
  carries the chain id and the sha256 of `genesis.json`; a new chain in the same home does not inherit it.

A missing or older state file is what a restored snapshot leaves. A validator started on it can sign a second,
different block at a height it already signed: double sign, slashed and tombstoned. The block store alone cannot see
that case (the snapshot holds an old block store too); the sign record can.

What the guard does not see: a copy of the whole home (`config/` included) restored together, or a key run on two
machines at once. Never run a validator key in two places; for those cases use a remote signer (Horcrux,
`zetaphy-chain/horcrux/`), and on a chain with many validators CometBFT's `double_sign_check_height`.

**Override** (both checks): `ZETAPHY_ALLOW_DOWNGRADE=<chain-id>:<height>`, where height is the node's **last
committed block height**, exactly as the refusal prints it. A wrong or stale value is ignored (logged) and the node
still refuses; the right one starts it once, logged at error level (`ZETAPHY START GUARD OVERRIDDEN`), and resets
the sign record to the state file's height. As soon as the node commits a block, the value no longer matches.

```bash
sudo systemctl set-environment ZETAPHY_ALLOW_DOWNGRADE=<chain-id>:<height>     # [CHANGES FILES] systemd's environment
sudo systemctl restart zetaphyd && sudo systemctl unset-environment ZETAPHY_ALLOW_DOWNGRADE
journalctl -u zetaphyd -n 30 --no-pager | grep -E 'START GUARD|start guard'      # [read]
```

Only use it for a planned rollback of the whole chain (single-validator testnet: the blocks after the copy are thrown
away with it, nobody else signed them). On a chain with other validators put the newest `priv_validator_state.json`
back instead; never override L1-2 there.

### `setup-node.sh` and the pre-flight

`setup-node.sh` (and `zetaphy-validator update`) still runs `upgrade-check` with the new binary against the running
node before it replaces `/usr/local/bin/zetaphyd`. The old `UPGRADE_CHECK=0` skip is gone (it is ignored, with a
notice). A refused binary is installed only with `ZETAPHY_ALLOW_DOWNGRADE=<chain-id>:<height>` naming this node's
chain and a height at most 100 blocks below its current one (the refusal prints the value); each use is logged at
`user.crit` to the journal (`journalctl -t zetaphy-setup`) and to `/var/log/zetaphy-setup.log`. The installed binary
still runs its own start guard.

The setup scripts never write `priv_validator_state.json` from a backup: `zetaphy-validator backup` lists it as a
file that stays on the machine, and `setup-horcrux.sh` only moves it forward (+2). The rollback procedure in
[CHAIN-FIREWALL.md](CHAIN-FIREWALL.md#rollback) keeps a copy of the newest state file before it puts back old data.

## T: no crypto downgrade

The chain keeps a versioned list of account signature algorithms (key `0x41` of the `zetaphypq` store):

```json
{"version": 0, "enabled": ["eth_secp256k1", "mldsa44", "secp256k1"], "retired": []}
```

Governance changes it with `zetaphyd tx security-proposal sig-algos '<json>'`:
`{"version": <current+1>, "enable": [...], "retire": [...]}`.

- The version only goes forward, one at a time.
- A retired algorithm is refused from then on: Cosmos txs whose signer key uses it (multisig sub-keys included),
  and, for `eth_secp256k1`, Ethereum txs (and EIP-7702 authorizations, which are carried in them). Funds stay; a
  quantum-locked account keeps acting through its ML-DSA-44 controller.
- **A retired algorithm can never be enabled again.** Only algorithms this binary can verify can be enabled.
- `mldsa44` (the only post-quantum algorithm) cannot be retired; at least one post-quantum algorithm stays enabled.
- **Q-day stays.** Once Q-day has passed, `MsgSetQDay` is refused (unscheduling it or moving it later is the only
  thing it could do, and both bring ECDSA back). Before Q-day governance can still move it.
- **Quantum locks stay post-quantum** (already true, now tested): no message removes a lock, control only moves to
  another ML-DSA-44 account that is not locked itself, and the locked ECDSA key is refused everywhere.

Contract-level `ecrecover` follows Q-day, not this list.

## S1: voting-power cap

`max_bps` (key `0x42`, default 3333 = just under 1/3, so no single validator can stop the chain on its own). A
delegation, redelegation or self-bond (`MsgCreateValidator`) that would put the target validator above `max_bps` of
the active set's power (counting the validator as if it joined the set) fails with `voting power cap`. It is
enforced **only while the last active set has at least 4 validators**: the testnet (1 validator) and the CI devnets
(2 validators, 60/40) are never refused. Staking hooks see every path: Cosmos messages, authz, the staking precompile
(0x…0800) and gentxs. Only additions are checked: undelegating from, or slashing, a validator above the cap is never
blocked. Governance: `zetaphyd tx security-proposal power-cap <bps>` (0 turns it off).

## S2: circuit breaker

An equivalent of Cosmos SDK `x/circuit`, which SDK v0.54 no longer ships, kept in the existing store (so the upgrade
adds no store and may run early, see below). It sits in the message router (`MsgServiceRouter.SetCircuit`), so a
tripped message type fails wherever it runs: top-level txs, `authz` `MsgExec`, governance proposals, ICA; the ante
handler also refuses it at CheckTx.

- **Authority**: governance names it (`security-proposal circuit-authority <zetaphy1…>`). It must be a **multisig**
  account with a threshold of at least 2 of at least 2 distinct keys; this is checked from its on-chain public key
  every time it acts, so a single key (or a 1-of-N multisig) can never trip anything. Governance itself can always
  trip and reset.
- **Trip / reset**: `zetaphyd tx circuit trip|reset <type URL>[,...] --from <multisig>` (build with
  `--generate-only`, sign with `tx sign --multisig ... --sign-mode amino-json` by each key, combine with
  `tx multisign`, broadcast), or `security-proposal circuit-trip|circuit-reset`. The CLI prints ZETAPHY messages
  in JSON without their fields; put the message back with its Go field names (`Authority`, `Kind`, `Data` as
  base64) in the unsigned and the combined file, as `test-anti-rollback.sh` (`ms_tx`) does. The signature covers
  the message (a changed message is refused).
- **Never trippable**: `/cosmos.gov.*`, `/cosmos.upgrade.*`, `/cosmos.consensus.*`, `MsgUnjail`, and the chain's own
  `MsgSetFuture`, `MsgPQCertificate`, `MsgZXVotes`, `MsgPQVoteKey`, so governance can always reset it and blocks
  keep their certificates.

## P: the constitution (off by default)

`security-proposal constitution on` (key `0x45`). When it is turned on, the values in force become floors (or
ceilings), and from then on a governance proposal is refused at submission (Cosmos txs) and again when it executes
(every path, through the governance router) if it would:

- run a CosmWasm contract's `sudo` (arbitrary contract state and balances);
- mint more: raise `inflation_max`, `inflation_min`, `inflation_rate_change` or `max_supply` (or make it unlimited),
  lower `blocks_per_year`, or change the mint denom;
- rewrite balances by changing the bond denom or the EVM denom;
- shorten `unbonding_time`, `voting_period`, `expedited_voting_period`, the Q-day reveal delay or the IBC hold delay;
- lower `quorum`, `threshold`, `veto_threshold`, `expedited_threshold` or `slash_fraction_double_sign`;
- remove the power cap or raise it above its value then;
- change or turn off the constitution itself.

It is off on this testnet so nothing current changes; it is meant to be turned on at mainnet. No existing timelock
value was changed by this work. Limits: governance can still execute ordinary messages as the governance account
(e.g. a `MsgEVMCall` to a contract it owns, as `gov.sh neuro` does) and can still vote a software upgrade to a binary
without these rules; the contract-layer timelocks (`ZetaphyTimelock`, 48 h) are separate and unchanged.

## The `zetaphy-guard` upgrade

The handler sets key `0x40` of the `zetaphypq` store to the upgrade height + 1 and runs the module migrations
(none). It adds **no store**: every new value lives in the existing `zetaphypq` store, so `zetaphy-guard` is in
`zetaphyEarlyUpgrades` and a validator may install the new binary any time before the height. Below the height every
new path returns exactly what the binary without it returned, reading `0x40` without gas: the new `MsgSetFuture`
kinds fail with the old error text, the router, staking hooks, ante checks and `MsgSetQDay` behave as before. It needs
v5 (`zetaphy-v5`, done on the testnet). A new chain may put `0x40` in genesis (`app_state.zetaphypq`).

Checked: `TestChainGuardOffBeforeHeight` (same error and gas before the height, store untouched),
`TestChainGuardUpgradeHandler`, `TestUpgradeRestartAfterEveryUpgrade` (now with `zetaphy-guard`, and the start guard
agrees), and on a devnet: validator A on the binary before this change and validator B plus a full node on the new
one ran bank, staking and a failing chain-guard proposal with the same app hash at every compared height; at the
upgrade height A stopped (`UPGRADE "zetaphy-guard" NEEDED`), B ran it early, A switched and the chain went on.

## Activating it on the live testnet

Legend as in [CHAIN-FIREWALL.md](CHAIN-FIREWALL.md#upgrade-runbook-the-testnet-node-zetaphy-node-0): **[read]**
changes nothing, **[CHANGES FILES]**, **[CHANGES CHAIN]**. Nothing here was run against the live node. Governance
votes take the chain's voting period (600 s on the testnet); nothing here goes around a vote, and nothing touches
`ZetaphyTimelock`: contract admin actions keep their 48-hour delay.

1. Merge, publish `public/` (the new `setup-node.sh` fingerprint) and wait for the `release-zetaphyd` build, as for
   every `setup-node.sh` change.
2. **[read]** `zetaphyd q upgrade applied zetaphy-firewall` must show a height (the testnet has v5 and the firewall).
3. **[CHANGES FILES]** Install the new release (`sudo zetaphy-validator update`, or steps 3–4 of the firewall
   runbook with `zetaphy-guard`). `upgrade-check` passes (early upgrade). After the restart check the journal for
   `start guard` lines: none means both checks passed. The node writes `~/.zetaphy/config/zetaphy_sign_state.json`
   from then on.
4. **[CHANGES CHAIN]** `gov.sh propose-upgrade zetaphy-guard <H> 'Chain guard: algorithm list, power cap, circuit
   breaker, constitution (off)'` with H at least ~300 blocks ahead, then `gov.sh vote <ID> yes`. After H:
   `zetaphyd q upgrade applied zetaphy-guard` **[read]**.
5. Optional **[CHANGES CHAIN]**, each a governance proposal (`zetaphyd tx security-proposal <kind> ... --deposit ...`,
   then `gov.sh vote`):
   - `circuit-authority <multisig>`: create the multisig first (`zetaphyd keys add ms --multisig a,b,c
     --multisig-threshold 2`), fund it, and keep its keys on different machines and people.
   - `power-cap <bps>` only if 3333 should change (it does nothing while the testnet has fewer than 4 validators).
   - Leave `constitution` off on the testnet; turn it on at mainnet launch, once the parameters are final (it
     freezes their floors).
   - `sig-algos` only together with a migration plan: retiring an algorithm freezes every account that still signs
     with it.

Rollback: before H, the previous binary still runs the chain (the upgrade is early-capable, nothing was written).
After H, the previous binary stops at its first block (`upgrade handler is missing for zetaphy-guard`) and the
pre-flight and start guard refuse it; the way back is a fixed binary, or the data-copy rollback of the firewall
runbook with the override above.

## Tests

- Fork tests (`go test -tags=test -run 'ChainGuard|StartGuard|Upgrade' ./evmd` in the patched source):
  `TestChainGuardOffBeforeHeight`, `TestChainGuardUpgradeHandler`, `TestChainGuardSigAlgos`,
  `TestChainGuardNoWayBackToECDSA`, `TestChainGuardPowerCap`, `TestChainGuardCircuit`, `TestChainGuardConstitution`
  (constitution on), `TestStartGuardDowngrade`, `TestStartGuardSignState`, and the restart tests.
- Devnet attacks, `zetaphy-chain/test-anti-rollback.sh <new zetaphyd> <old zetaphyd>` (CI job
  `zetaphy-chain-attacks`, the old binary is built from the commit before `zetaphy-guard`): mixed binaries before the
  height, the upgrade, then: the old binary after the upgrade (refused by `upgrade-check`, stops at its first block),
  an old copy of a validator's `data/` (refused; also with a wrong override), re-enabling a retired algorithm (the
  proposal fails), tripping the breaker without authority (refused) and with the 2-of-3 multisig (works, then reset),
  constitution-breaking proposals with the constitution on (refused at submission), and a 4-validator devnet where a
  delegation above the cap is refused.
