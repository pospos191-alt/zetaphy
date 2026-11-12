**English** | [ภาษาไทย](ZETAPHY-MAINNET-RUNBOOK.th.md)

# ZETAPHY mainnet (ZTPHY): the launch runbook

The ordered gates for turning the ZETAPHY chain into a mainnet whose coin, ZTPHY, can hold real value. Every gate must
be ticked, in order, with the evidence written next to it. Nothing here is automated: no workflow creates a mainnet
genesis or starts a mainnet node, and this document holds no command that does.

Fees, deployments and gas on ZETAPHY are paid in ZTPHY. No SOL or other outside coin is needed. (SOL is only for the
separate swd-amm program on Solana; see [MAINNET_RUNBOOK.md](MAINNET_RUNBOOK.md).)

**Status on 2026-11-12:** gate 1 not started, gate 2 not started, gate 3 in progress (the `zetaphy-guard` upgrade
passed on the testnet as proposal 9). The testnet (`zetaphy_77390-1`) runs on one validator. That is acceptable for a
testnet and not for a mainnet.

| Gate | What | Status |
|---|---|---|
| 1 | Independent external audit of the release commit; every Critical/High fixed and re-reviewed | ❌ not started |
| 2 | At least 4 independent validators, none above 1/3 of the power | ❌ 1 validator |
| 3 | The release has run on the testnet for at least 4 weeks without incident | ⏳ started 2026-11-12 |
| 4 | Fresh keys, none on a public host | ❌ |
| 5 | Mainnet release: signed, published, fingerprint frozen | ❌ waits for gate 1 |
| 6 | Genesis ceremony with every validator | ❌ |
| 7 | Coordinated start | ❌ |
| 8 | Contracts deployed with ZTPHY, admin handed to governance | ❌ |
| 9 | Operations: monitoring, bounty, incident plan | ❌ |
| 10 | Public RPC, wallets, registries, listings | ❌ |

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

Record here: the validators (name, contact, operator address) `________`.

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

## Gate 5: mainnet release

- Built by `release-zetaphyd.yml` from the audited commit (or the audited commit plus reviewed fixes), signed with
  Sigstore, and checked by every validator with `zetaphy-chain/verify-release.sh` (`VERIFIED` only).
- Freeze here: release tag `________`, commit `________`, `setup-node.sh` sha256 `________`.
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

Record here: chain id `________`, genesis sha256 `________`, signatures `________`.

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
