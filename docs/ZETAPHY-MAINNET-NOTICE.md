**English** | [ภาษาไทย](ZETAPHY-MAINNET-NOTICE.th.md)

# ZETAPHY mainnet: risk notice

ZETAPHY mainnet (`zetaphy_3659-1`, EVM chain id 3659, coin ZTPHY) has its genesis time on **2026-11-13 at 14:00 UTC**. Its genesis
sha256 is `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`
([the published files](../zetaphy-chain/mainnet/zetaphy_3659-1/README.md)).

The project owner decided to launch now. Read what that means before you hold or send ZTPHY.

## What you need to know

1. **One validator, run by the project.** The chain runs on a single validator operated by the ZETAPHY project.
   Whoever controls that machine or its key can halt the chain, censor transactions, and, with a modified binary,
   change its rules, including every guard the chain has. If that machine is lost, the chain stops until it is
   restored. More independent validators are planned; none has joined yet.
2. **No independent external audit yet.** The code has had internal reviews only. No audit firm or public audit
   contest has reviewed the release that runs the mainnet.
3. **Shorter testing than planned.** The release ran on the testnet for less than the 4 weeks the
   [runbook](ZETAPHY-MAINNET-RUNBOOK.md) asks for.
4. **The multisig keys are held by one person today.** The pools (rewards, airdrop, community, liquidity, team) and
   the circuit-breaker authority are 2-of-3 multisigs, but all three keys are held by the project owner. The multisig
   protects against losing one key; it does not protect against the owner. The pools are planned to move to
   multisigs whose keys different people hold.
5. **Governance votes last 1 day.** A proposal can pass 24 hours after its voting starts (expedited proposals: 12
   hours). Watch proposals if you hold ZTPHY. The constitution (on from block 1) stops proposals that shorten voting,
   create coins, or weaken its other floors.
6. **No public access yet.** There is no public RPC or public peer at launch. Until one is published in
   [the genesis folder](../zetaphy-chain/mainnet/zetaphy_3659-1/README.md), any "ZETAPHY mainnet RPC" you see
   elsewhere is not from the project.
7. **The airdrop is not open.** The SWD holders airdrop is claim-based and has not started. Its contract address will
   be published in this repository. The project never asks for a recovery phrase, a private key, or a payment to
   receive an airdrop.
8. **The bridge is closed.** The Saphan bridge and other contracts are not deployed on the mainnet yet.

**Use ZETAPHY mainnet only with amounts you can afford to lose.**

## What is fixed from block 1

- Supply: 1,000,000,000 ZTPHY, no inflation; half of each fee and the dEaD address burn coins.
- Team coins: locked for 1 year, then released linearly until year 4.
- The chain guard, shield, invariant firewall, security core and the constitution are on.
- A single key cannot trip the circuit breaker: only governance or the 2-of-3 circuit-breaker multisig can.

## Short text for the apps, the website and social posts

> ZETAPHY mainnet (zetaphy_3659-1, EVM 3659, ZTPHY) has its genesis on 2026-11-13. It runs on a single validator operated by
> the project, and its code has not yet passed an independent external audit. Until more independent validators join
> and the audit is published, the project can halt or change the chain. Use it only with amounts you can afford to
> lose. Genesis sha256 ca0efb15…0a94667. Details:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

## Status

The launch gates and what is still open are tracked in [the runbook](ZETAPHY-MAINNET-RUNBOOK.md). Security reports:
[SECURITY.md](../SECURITY.md).
