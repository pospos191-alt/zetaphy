**English** | [ภาษาไทย](ZETAPHY-MAINNET-NOTICE.th.md)

# ZETAPHY mainnet: notice

ZETAPHY mainnet (`zetaphy_3659-1`, EVM chain id 3659, coin ZTPHY) has its genesis time on **2026-11-13 at 14:00 UTC**.
Its genesis sha256 is `ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`
([the published files](../zetaphy-chain/mainnet/zetaphy_3659-1/README.md)).

**Mainnet is the only ZETAPHY network.** The testnet (`zetaphy_77390-1`, EVM chain id 77390, https://rpc.sawasdeecoin.com)
was shut down for good on **2026-11-14** (owner decision). Its coins, contracts and RPC are gone; do not send anything to
chain 77390.

## Before you use it

ZETAPHY mainnet currently runs on a single validator operated by the ZETAPHY project, and its code has not yet
completed an independent external audit. Until more independent validators join and the audit is published, the
project can halt or change the chain. **Use it only with amounts you can afford to lose.**

## Stay safe

- Official addresses, RPC endpoints and announcements are published only in this repository.
- The project never asks for a recovery phrase, a private key, or a payment, for an airdrop or anything else.
- Check the genesis yourself: `sha256sum -c genesis.sha256` in the published folder.

## What is fixed from block 1

- Supply: 1,000,000,000 ZTPHY, no inflation; half of each fee and the dEaD address burn coins.
- Team coins: locked for 1 year, then released linearly until year 4.
- The chain guard, shield, invariant firewall, security core and the constitution are on.
- A single key cannot trip the circuit breaker: only governance or the 2-of-3 circuit-breaker multisig can.

## Short text for the apps, the website and social posts

> ZETAPHY mainnet (zetaphy_3659-1, EVM 3659, ZTPHY) has its genesis on 2026-11-13. It runs on a single validator
> operated by the project, and its code has not yet passed an independent external audit. Until more independent
> validators join and the audit is published, the project can halt or change the chain. Use it only with amounts you
> can afford to lose. Genesis sha256 ca0efb15…0a94667. Details:
> https://github.com/pospos191-alt/zetaphy/blob/main/docs/ZETAPHY-MAINNET-NOTICE.md

Security reports: [SECURITY.md](../SECURITY.md).
