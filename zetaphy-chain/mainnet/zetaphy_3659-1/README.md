**English** | [ภาษาไทย](README.th.md)

# ZETAPHY mainnet `zetaphy_3659-1`: the published genesis

| | |
|---|---|
| Chain id | `zetaphy_3659-1` |
| EVM chain id | `3659` (`0xe4b`) |
| Coin | ZTPHY (`azetaphy`, 18 decimals), supply 1,000,000,000, no inflation |
| Minimum gas price | 1 gwei (`1000000000azetaphy`) |
| Genesis time | `2026-11-13T14:00:00Z` |
| **Genesis sha256** | **`ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667`** |
| Release | `zetaphyd-a5698832d273` (commit `dc0d0bbbaa827c0b5049603ab3fec8a56c8c7f44`), signed with Sigstore |
| Validators at launch | 1 (`zetaphyvaloper1l9fxu7xn7yrug9rlsve9hs4mgtpn9zej9tqvx8`, node id `9d71e8582823a74d2cfbf51b1c6ef4af50e94e5c`) |

**Read the notice first: [docs/ZETAPHY-MAINNET-NOTICE.md](../../../docs/ZETAPHY-MAINNET-NOTICE.md).**

## Files

| File | What |
|---|---|
| `genesis.json` | the genesis every node of this chain must use |
| `genesis.sha256` | its sha256 |
| `chain.json` | chain ids, sha256, coin, minimum gas price |
| `mainnet.env` | the config `make-genesis.sh` built it from (addresses, amounts, parameters) |
| `circuit-authority.pubkey.json` | the circuit-breaker multisig's public key (2 of 3) |
| `gentx.json` | the validator's genesis transaction (bond of 500,000 ZTPHY) |

All files are public: addresses and public keys only.

## Allocations

| Account | Address | ZTPHY |
|---|---|---|
| Rewards (multisig 2 of 3) | `0x3B87f248a644aA66Bf35a33c26AbefF3326b3dD7` | 500,000,000 |
| SWD holders airdrop (multisig 2 of 3) | `0xaE842c15Ad4A6D6027597C3c3d44A4ada8FB0318` | 200,000,000 |
| Community (multisig 2 of 3) | `0x53E762B680b28a378cE33eafc6b6384D9DF4B989` | 150,000,000 |
| Liquidity & partners (multisig 2 of 3) | `0x859872fBaB7ad2C0663DC0253E61Cea628cA15d1` | 98,999,000 |
| Validator operator | `0xF9526e78d3f107c4147f83325Bc2bb42c3328B32` | 1,000,000 |
| Circuit-breaker authority (multisig 2 of 3) | `0x8D0496dcD685ffc5a5e8Ed86f4648206783E8713` | 1,000 |
| Team (multisig 2 of 3; locked 1 year, then linear to year 4) | `0x58B726B2A5404b0374842fE15149294D139D62A8` | 50,000,000 |

## Check it yourself

```bash
sha256sum -c genesis.sha256                                            # genesis.json: OK
ZETAPHYD=<zetaphyd checked with verify-release.sh> bash ../make-genesis.sh verify mainnet.env genesis.json
#   expect the summary and: OK  sha256 ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667
```

`verify` rebuilds every field from `mainnet.env` and refuses any difference: allocations, vesting, the circuit
authority, governance and staking parameters, and the chain guard, shield and constitution being on from block 1.

## Run a node of this chain

A public peer and RPC are not open yet. When they are, this file will list them. A node installs the signed release
and pins this genesis (step 11 of [the procedure](../../../docs/ZETAPHY-MAINNET-PROCEDURE.md)):

```bash
sudo GENESIS_FILE=$PWD/genesis.json GENESIS_SHA256=ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667 \
  GENESIS_EVM_CHAIN_ID=3659 ZETAPHYD_BIN=<verified zetaphyd> PEERS=<published peer> bash setup-node.sh
```
