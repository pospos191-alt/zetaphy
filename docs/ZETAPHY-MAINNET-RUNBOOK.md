**English** | [ภาษาไทย](ZETAPHY-MAINNET-RUNBOOK.th.md)

# ZETAPHY mainnet (ZTPHY): the launch runbook

The ordered gates for turning the ZETAPHY chain into a mainnet whose coin, ZTPHY, can hold real value. Every gate must
be ticked, in order, with the evidence written next to it. Nothing here is automated: no workflow creates a mainnet
genesis or starts a mainnet node. The commands for each gate are in
[ZETAPHY-MAINNET-PROCEDURE.md](ZETAPHY-MAINNET-PROCEDURE.md) (tools: `zetaphy-chain/mainnet/make-genesis.sh` and the
pinned-chain mode of `zetaphy-chain/setup-node.sh`); the owner runs them.

**Owner decision (2026-11-12): the mainnet launches with 1 validator, operated by the project; more are added later.**
The risk of that choice: whoever controls that one machine or its key controls the chain (can halt it, censor it, and
with a modified binary change its rules, including every guard listed here), and losing it without a key backup
stops the chain. Users are told so by the public notice in the procedure, together with the open audit (gate 1).
Gate 2 below stays as the target, marked as this decision.

**Owner decision (2026-11-13): the mainnet `zetaphy_3659-1` was started on 2026-11-13 at 14:00 UTC, before gates 1, 3
and 5 were met.** Genesis sha256 `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`; the published files: [zetaphy-chain/mainnet/zetaphy_3659-1/](../zetaphy-chain/mainnet/zetaphy_3659-1/README.md);
the public notice: [ZETAPHY-MAINNET-NOTICE.md](ZETAPHY-MAINNET-NOTICE.md). The open gates stay open below and are
still worked through in order.

Fees, deployments and gas on ZETAPHY are paid in ZTPHY. No SOL or other outside coin is needed. (SOL is only for the
separate swd-amm program on Solana; see [MAINNET_RUNBOOK.md](MAINNET_RUNBOOK.md).)

**Status on 2026-11-13:** the mainnet runs (owner decision above) on 1 validator. Gate 1 not started; gate 3 started
on 2026-11-12 and not complete; gates 4, 6 and 7 done, as recorded below; gates 8 to 10 open. The testnet
(`zetaphy_77390-1`) keeps running for upgrade rehearsals.

| Gate | What | Status |
|---|---|---|
| 1 | Independent external audit of the release commit; every Critical/High fixed and re-reviewed | ❌ not started |
| 2 | At least 4 independent validators, none above 1/3 of the power | ⚠️ owner decision: 1 validator at launch; plan to add more |
| 3 | The release has run on the testnet for at least 4 weeks without incident | ⏳ started 2026-11-12 |
| 4 | Fresh keys, none on a public host | ✅ 2026-11-13 |
| 5 | Mainnet release: signed, published, fingerprint frozen | ⚠️ owner decision: unaudited release used (recorded in gate 5) |
| 6 | Genesis ceremony with every validator | ✅ 2026-11-13 |
| 7 | Coordinated start | ✅ 2026-11-13 14:00 UTC (blocks, PQ vote certificates, balances checked) |
| 8 | Contracts deployed with ZTPHY, admin handed to governance | ❌ |
| 9 | Operations: monitoring, bounty, incident plan | ❌ |
| 10 | Public RPC, wallets, registries, listings | ❌ (risk notice published) |

## Gate 1: independent external audit

An internal review is not an audit for this gate, whoever wrote it (`audit/REPORT.md`, the 2026-11-10 team-only review).
An audit counts only when:

- it is done by a named firm or a public contest (e.g. Code4rena, Sherlock, Cantina) that is independent of the team;
- its scope names the exact commit and the `setup-node.sh` fingerprint of the release that will run the mainnet: the node
  patch (PQ accounts and signatures, Q-day, quantum locks, guard, invariant firewall, chain guard, IBC holds and rate
  limits, vote extensions, upgrade handlers), the node install/upgrade scripts, and the contracts that will hold value
  (Saphan bridge, DEX, Neuro, timelock, multisig, bounty);
- the auditors ran the code (fork tests, devnet), not only read it;
- every Critical and High is fixed, and the auditors confirm each fix in writing;
- the report is published (attack details may stay private until fixed).

Before sending the code out, fix the open findings of the internal reviews (the private 2026-11-10 list, starting with
its High items), so the paid audit spends its time on what is left.

Record here: firm / contest `________`, report URL `________`, audited commit `________`, fingerprint `________`.

## Gate 2: independent validators

**Owner decision: 1 validator at launch; plan to add more** (risk: above, and in the procedure). Adding validators:
step 17 of [the procedure](ZETAPHY-MAINNET-PROCEDURE.md). The target stays:

- **At least 4** validators run by different people or organisations, on different machines and providers. CometBFT
  stays safe only while less than 1/3 of the power is dishonest: with 4, one can fail or be compromised. With 1, whoever
  holds that machine controls the chain (rewrites history, mints, changes rules), and every guard in
  [ANTI-ROLLBACK-CHAIN.md](ANTI-ROLLBACK-CHAIN.md) can be removed by that one operator.
- No validator above 1/3 of the voting power at genesis; the chain guard's power cap (3333 bps) keeps it that way once
  there are 4 or more.
- Each validator: its own key (ideally a remote signer such as Horcrux), its own sentry, the node installed from the
  signed release with `verify-release.sh`, and a named contact for incidents.
- Recruitment starts on the testnet: invite operators when the public RPC reopens, and have them run a testnet validator
  first ([zetaphy-chain/README.md](../zetaphy-chain/README.md) and `zetaphy-validator`).

Record here: the validators (name, contact, operator address) `zetaphy-validator-0` (ZETAPHY project, see SECURITY.md),
`zetaphyvaloper1l9fxu7xn7yrug9rlsve9hs4mgtpn9zej9tqvx8`, node id `9d71e8582823a74d2cfbf51b1c6ef4af50e94e5c`.

## Gate 3: testnet soak

- The release that will run the mainnet (or the one the audit fixes go into) runs on the testnet for **at least 4
  weeks** with: no consensus failure, no app-hash mismatch, no start-guard refusal that was not intended, at least one
  upgrade carried out by every validator, and the `test-anti-rollback.sh` attacks still refused in CI.
- Open the testnet bounty (`ZetaphyBounty` deployed on the testnet) during the soak.

## Gate 4: fresh keys

Do not reuse any key that touched the testnet, CI secrets, a browser wallet used for testing, or the testnet VM.

| Role | Holder | Storage |
|---|---|---|
| Each validator's consensus key | that validator | remote signer / hardware, never on the RPC host |
| Governance multisig members (at least 2-of-3) | different people | hardware wallets |
| Circuit-breaker authority (multisig, at least 2 distinct keys) | different people | hardware wallets |
| Genesis fund accounts (rewards, airdrop, team, treasury) | multisig or vesting accounts | **not** on any node or RPC host; no `test` keyring |
| Deployer (contracts) | used once, then retired | offline |

Done on 2026-11-13: three signer keys (A, B, C) made on a temporary offline VM (deleted after; recovery phrases on paper,
each checked by recovering it), six 2-of-3 multisigs from them (circuit authority and the five pools, distinct key
orders), and the validator key on the validator machine.

## Gate 5: mainnet release

- Built by `release-zetaphyd.yml` from the audited commit (or the audited commit plus reviewed fixes), signed with
  Sigstore, and checked by every validator with `zetaphy-chain/verify-release.sh` (`VERIFIED` only).
- Freeze here: release tag `zetaphyd-a5698832d273`, commit `dc0d0bbbaa827c0b5049603ab3fec8a56c8c7f44`, `setup-node.sh` sha256
  `a5698832d273aa3e297b0ff7365ca5eeb4b024adb9d361a2e82f052c4ce70c6d` (owner decision 2026-11-13: not audited; gate 1 still applies).
- Publish `zetaphy-chain/public/v/<sha>.sh` before anything points at it (cloud-init and docs).

## Gate 6: genesis ceremony

All validators take part; nobody uses testnet state.

1. A **new chain id** (not `zetaphy_77390-1`) and a new EVM chain id; check that neither is taken in the chain
   registries and chainlist.
2. The coordinator writes a draft genesis: denoms (ZTPHY, 18 decimals), supply and allocations agreed in public,
   governance and staking parameters, Q-day schedule, the firewall/guard heights at 0 (active from block 1), the chain
   guard's settings (algorithm list, power cap 3333, circuit authority = the multisig of gate 4, **constitution on**:
   on mainnet its floors protect holders from a governance capture).
3. Each validator creates its gentx with its fresh key; the coordinator collects them; everyone checks the final
   genesis and signs its sha256 publicly.
4. The published `GENESIS_SHA256` is pinned in the node scripts so a joining node refuses any other genesis.
5. Vesting accounts for team and treasury; no fund key on a public host.

Record here: chain id `zetaphy_3659-1` (EVM 3659), genesis sha256 `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`, signatures `________`.
The genesis was rebuilt independently from the draft and the gentx and gave the same sha256.

## Gate 7: coordinated start

- A genesis time agreed by all validators; each runs the gate-5 release, `verify-release.sh --record`, and starts.
- The chain needs more than 2/3 of the power online to make the first block; with 4 validators, at least 3.
- Watch: blocks advance, every validator signs, app hashes agree, the start guard logs nothing unexpected.

## Gate 8: contracts (paid in ZTPHY)

Deploy with the gate-4 deployer, then hand every admin role to governance through the timelock before any value comes
in. Suggested order: timelock and multisig; Saphan bridge (closed; open only after its own gates and the monitor);
DEX; Neuro; `ZetaphyBounty` (funded). Verify each contract's source (Sourcify) and publish the addresses.

## Gate 9: operations

- Monitoring and alerts: missed blocks per validator, app-hash agreement, start-guard and circuit-breaker events, upgrade
  plans, large outflows, bridge breaker.
- Incident plan: who can trip the circuit breaker (the multisig), how a binary fix is shipped (signed release +
  upgrade), contacts for every validator.
- Bounty funded and published, with a working `security@` contact.
- Backups: never restore `priv_validator_state.json` or `zetaphy_sign_state.json` from an older copy.

## Gate 10: public access

- Public RPC behind rpc-guard, with the egress budget set; wallets (MetaMask, Keplr, Snap) with the new chain ids;
  chain-registry and chainlist entries (only after gates 1–7); explorer.
- The pages drop the testnet banner only after gates 1–8.
- Legal review of the launch in the countries targeted (see `docs/LEGAL.md`).
