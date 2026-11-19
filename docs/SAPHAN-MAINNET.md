**English** | [ภาษาไทย](SAPHAN-MAINNET.th.md)

# Saphan mainnet: ZTPHY between ZETAPHY and Base

Owner decision 2026-11-14: open the Saphan bridge between ZETAPHY mainnet (`zetaphy_3659-1`, EVM chain 3659) and Base
mainnet (8453), so ZTPHY can trade against USDC (and USDT) on Base. Owner decision 2026-11-16: also BNB Smart Chain (56)
and Arbitrum One (42161), each its own route (see "More destinations" below; Polygon PoS prepared, disabled). The testnet is shut down; this is the mainnet tooling.
Everything here is **owner-run** from the owner's own machine: no workflow holds a mainnet key, and nothing in this
repository ever sends a mainnet transaction by itself.

Every command below has one label:

| Label | Meaning |
|---|---|
| **[อ่าน]** | read only: changes nothing anywhere |
| **[เปลี่ยนไฟล์]** | writes a file on your machine (commit it in a pull request when the runbook says so) |
| **[เปลี่ยนเชน]** | sends a transaction to a real chain (costs gas; cannot be undone) |
| **[เปลี่ยนการตั้งค่า]** | changes a machine's settings (services, keys, packages) |

## Read this first: the risks, plainly

- **ZETAPHY mainnet runs on ONE validator.** If it stops, the bridge stops (nothing is lost, everything waits). If it is
  taken over, it can rewrite ZETAPHY, and the bridge believes ZETAPHY.
- **Our own small validator set signs the bridge.** ZETAPHY -> Base mints are believed when OUR Hyperlane validators sign
  them (`validators.zetaphyOrigin`); Base -> ZETAPHY releases when our Base-origin validators sign (or Hyperlane's
  published 3-of-5 for Base, if `validators.baseOrigin.mode = "hyperlane"`). This is not Hyperlane's network securing us:
  it is us. A 1-of-1 set (one key on one machine) is refused unless `validators.allowSingleValidator` is `true`, and
  then every plan prints: *ONE key can sign a false message*.
- **The bridge contracts are NOT audited** (`ZetaphyTokenVault`, `SaphanSyntheticToken`, in
  `zetaphy-network/contracts/SaphanTokens.sol`; tested here, never audited). **Users bridge only what they can afford to
  lose.** Say so wherever the bridge is offered.
- **What bounds a failure** (`saphan-mainnet.json` -> `token.limits`): at most **2,500,000 ZTPHY** can ever be locked
  (0.25% of the supply; the config refuses more than 1%), at most 2,500,000 ZTPHY on Base; at most 2,000,000 minted on
  Base per day, each mint waits **1 h**; at most **250,000** released back per day, each release waits **6 h**. During a
  wait the guardians can **veto** that one payout or **pause** an end at once. Raising any limit is a 48 h timelock call.
- **The first pools are thin**: 100 USDC against 1,000,000 ZTPHY. A $10 buy moves the price about **+21%**, a $50 buy
  about **+124%** (`saphan-pool.js plan` prints it per pool).
- **Never send back more than one day's release limit at once** (250,000 ZTPHY): a single payout above the daily limit
  waits until governance raises the limit (48 h).

## What gets deployed

```
 ZETAPHY mainnet (3659)                                         Base mainnet (8453)
 ───────────────────────────────────────                       ─────────────────────────────────────────────
 Hyperlane core (NEW, ours): Mailbox, merkle tree hook,         Hyperlane core (EXISTING, Hyperlane's: never redeployed)
   ISM factories, ValidatorAnnounce, ProxyAdmin                   Mailbox 0xeA87…4f1D, merkle tree hook 0x19dc…0117,
   every owner = the ZETAPHY timelock                             ISM factory 0x8F74…110A, ValidatorAnnounce 0x182E…5a7B
 ZetaphyTokenVault (native ZTPHY)    ── lock ──────────────▶   SaphanSyntheticToken "ZTPHY" (minted 1:1, after 1 h)
   ISM: Base-origin validators                                    ISM: OUR validators for origin ZETAPHY
   release after 6 h, ≤ 250,000/day ◀──────────── sendBack ──    burn
 governance: ZETAPHY timelock 0x9fC2…f9cA (48 h; gov vote)      governance: a NEW ZetaphyTimelock on Base (48 h)
 guardian:   guardian multisig 0x54EF…4519 (2 of 3)             guardian/proposer: a NEW SimpleMultisig on Base (2 of 3)
 deployed CLOSED (paused); opening = both timelocks             deployed CLOSED (paused)
```

No interchain gas paymaster is used: our relayer delivers only the vault's and the synthetic's messages (a whitelist),
and the owner keeps it funded. The deployer key keeps no role anywhere (checked by `verify`).

Files: `zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json` (the config), `registry/chains/zetaphy/metadata.yaml`
(ZETAPHY for the Hyperlane CLI), `setup-agents-mainnet.sh` (the agents). Code: `zetaphy-network/src/saphanmainnet.js`,
`src/saphanpool.js`, `scripts/saphan-mainnet.js` (the owner's tool), `scripts/saphan-pool.js` (the pools),
`scripts/saphan-mainnet-dryrun.js` (the local dry run). The deploy reuses the testnet route code (`scripts/saphan.js`
`originPrepare`, `tokenVault`, `tokenSynthetic`) unchanged.

## Owner inputs (what only the owner can decide)

| Input | Where | Status |
|---|---|---|
| A **fresh deployer key** (same address on both chains), its address | `deployer.address` | missing |
| Our validator address(es) for origin ZETAPHY (from the agents machine) + threshold | `validators.zetaphyOrigin` | missing |
| Base-origin validators: ours (`mode: "ours"`, a second validator process) or Hyperlane's 3-of-5 (`mode: "hyperlane"`) | `validators.baseOrigin` | missing (decide) |
| The **Safe on Base** that receives the bridged ZTPHY and owns the pools (2 of 3, made at app.safe.global) | `liquidity.baseRecipient` | missing |
| The **USDT token on Base** (verify on basescan.org: see below) | `liquidity.pools[1].address` | missing |
| The Base multisig owners (default: the ZETAPHY guardian owners) | `base.owners` | confirm |
| Pool amounts (decided 2026-11-16: one pool to start, 500,000 ZTPHY + 50 USDC, 0.0001 USD per ZTPHY; a USDT pool later, once the token is named) | `liquidity.pools` | set |
| ETH on Base: deployer ~0.0035, relayer ~0.002 (float), Safe ~0.001; 50 USDC into the Safe | — | to buy/send |
| ZTPHY: 1 to the deployer, 0.1 to each validator, 1 to the relayer (ZETAPHY side), 10,000 per gov proposal deposit | — | to send |

**USDC on Base** is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle): the address the repository already verified
(`zetaphy-neuro/src/known-tokens.js`), the same in the Uniswap and Superchain token lists. The address in the brief,
`0x833589fCD6eDb6E08f4c7C32D29b5Dd5Ac9F4f8E`, is **not** USDC (same start, different end): the config refuses it.

**USDT on Base** could not be verified from this repository: Tether's own list of issuing chains is not in it, and
`known-tokens.js` deliberately lists no USDT on Base. The Superchain token list names a "Tether USD" token on Base, which
is a bridged token, not one Tether issues there. Decide which token you mean, check it on basescan.org (contract, name,
decimals 6, who can mint, freeze or upgrade it), then put its address in the config. Until then the USDT pool is not built.

**Uniswap v3 on Base**: factory `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`, position manager
`0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` (Uniswap `sdk-core`, pinned commit in the config). The CI dry run forks Base
and checks that the position manager's `factory()` is that factory; `check` does the same live.

## Costs

`node zetaphy-network/scripts/saphan-mainnet.js costs --base-gwei <gwei>` **[อ่าน]** prints the itemised estimate
(ZETAPHY at its 1 gwei floor, Base at the gwei you give, the relayer's float). At 0.02 gwei on Base and $3,000/ETH:

| What | Chain | Gas | Cost |
|---|---|---:|---:|
| Hyperlane core (Mailbox, hook, ISM factories, ValidatorAnnounce, ProxyAdmin, ICA router) | ZETAPHY | ~35,000,000 | ~0.035 ZTPHY |
| core hand-over, the vault's ISM + `ZetaphyTokenVault` | ZETAPHY | ~3,300,000 | ~0.003 ZTPHY |
| validator announce (once each) | ZETAPHY / Base | ~130,000 | ~0.0001 ZTPHY / ~0.000003 ETH |
| SimpleMultisig + ZetaphyTimelock + our ISM + `SaphanSyntheticToken` | Base | ~7,250,000 | ~0.00015 ETH + L1 data fee |
| opening on Base (propose/confirm/execute twice) | Base | ~1,000,000 | ~0.00002 ETH |
| relayer: 200 deliveries ZETAPHY -> Base (the float) | Base | ~80,000,000 | ~0.0016 ETH (~$4.80) |
| relayer: 200 deliveries Base -> ZETAPHY | ZETAPHY | ~80,000,000 | ~0.08 ZTPHY |
| Safe + 2 pools (approvals, create + initialise, mint) | Base | ~12,000,000 | ~0.00025 ETH |
| **Total** | | | **~0.12 ZTPHY on ZETAPHY; ~0.004 ETH (~$12) on Base incl. an L1 data fee allowance and the float** |
| gov proposal deposit (opening) | ZETAPHY | | 10,000 ZTPHY, refunded when it passes (burned on a veto) |

The local dry run measured: deployer on Base 5.9 M gas (estimate 7.25 M), on ZETAPHY 2.55 M (estimate 3.27 M, core
excluded), the two pools 10.6 M (estimate 11.8 M), Hyperlane core on ZETAPHY about 33 M. Base gas prices move: check
basescan.org/gastracker and run `costs` again before funding.

## What runs where

| Machine | Runs | RAM |
|---|---|---|
| The owner's own computer | `saphan-mainnet.js` (plan, check, deploy, verify, open-proposals), `saphan-pool.js`, the Hyperlane CLI once (core) | any; Node.js 20+ |
| One Oracle Always Free VM | `setup-agents-mainnet.sh`: our ZETAPHY validator, optionally our Base validator, the relayer (Docker, systemd) | see below |
| The ZETAPHY validator node (M-VAL) | nothing new (the gov proposal is submitted with `gov.sh` as for any proposal) | — |

**Is a free E2.1.Micro (1 GB RAM) enough? Not reliably for all three.** The validator for ZETAPHY fits (capped at 220 MB);
the relayer (capped at 480 MB) with Docker and the OS on 1 GB needs the 2 GB swap the script makes, and the kernel may
restart it under pressure (it resumes from its database: deliveries wait, nothing is lost). A Base-origin validator of
our own (`mode: "ours"`) must first read Base's whole Hyperlane merkle tree since 2023 through public RPCs, which is heavy
for 1 GB and slow. **Recommended: the Oracle Always Free Ampere A1 (arm64, up to 4 OCPU / 24 GB, also free)**, which runs
all three with room (set `MEM_RELAYER=1500 MEM_VALIDATOR=600`). The agent image is multi-arch.

**Checkpoint storage (free):** local disk. The validators write `/var/lib/hyperlane-mainnet/checkpoints/<origin>` and the
relayer on the same machine reads them; nothing to pay. Hyperlane's agents read checkpoints only from local disk, S3 or
GCS (not plain HTTP), so the relayer must run on the validators' machine with local storage. `publish-checkpoints`
optionally serves a read-only public copy over HTTPS with Caddy (free, for auditing what we signed).

## Deployed on mainnet (2026-11-16)

Recorded in `zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json` and `registry/chains/zetaphy/addresses.yaml`
(the tool reads both; done steps are skipped). Everything below is **closed**: nothing crosses until the BSC gov proposal
and the BSC multisig open it.

| What | Chain | Address |
|---|---|---|
| Hyperlane Mailbox (core, shared by every route) | ZETAPHY | `0x9FC59F469454FD27813Da94DF5803D603340E91c` |
| core owners: mailbox, proxyAdmin, defaultIsm, requiredHook, ICA router | ZETAPHY | all the timelock `0x9fC29E85005e37b3C2e1CA31B3D89521A5C4f9cA` (read back) |
| BSC multisig (2 of 3, the guardian owners) | BSC | `0x54EF410b2C7cbec6238fA6d6D9DbAaEABa0F4519` |
| BSC timelock | BSC | `0x7841608c96da5D35cbedFa13139A9f9952fc7695` |
| our ISM on BSC (1 of 1, `0xF134…F6Ea`) | BSC | `0xcAF6e250b5eAd400097004055628B5DC9D6197FF` |
| ZTPHY on BSC (synthetic) | BSC | `0x68aa0f0144605024eCe1aDccFCC1626352779569` |
| the BSC vault | ZETAPHY | `0xFA8F7a89A1f870bDFC03740FbF687e931B0b384A` |
| Base (2026-11-18): multisig, timelock, ZTPHY | Base | ที่อยู่เดียวกับบน BSC (nonce ของ deployer ตรงกัน): `0x54EF…4519`, `0x7841…7695`, **`0x68aa0f0144605024eCe1aDccFCC1626352779569`** |
| ISM ของเราบน Base | Base | `0xD1044D43a7df117094A46e0AD01B000965Fe35fB` |
| vault ของ Base | ZETAPHY | `0x022Ea911906e325caDe7cAA53DCFd5402738410d` |

The BSC multisig has the same address as the guardian multisig on ZETAPHY: both are the deployer's first contract
(nonce 0) on their chain, with the same three owners and threshold. `verify --route bsc`: every read-back ok.
Arbitrum One is not deployed. ZTPHY on Base and on BSC share one address but are separate tokens, each backed by its own vault. Next for BSC: the agents (step 8), the opening (step 9), the pool (step 10).

## ZTPHY on BSC: logo, name and the real contract (free)

The BSC synthetic is `0x68aa0f0144605024eCe1aDccFCC1626352779569`. Wallets and explorers show no logo until:

1. **[อ่าน]** `node scripts/saphan-verify-input.js --route bsc --out ~/verify --sourcify yes` (Oracle Cloud Shell): it checks
   the creation transaction against the committed bytecode, writes the standard-JSON file and the constructor arguments,
   prints the form's values, and submits to Sourcify (free).
2. **[เปลี่ยนการตั้งค่า]** BscScan → the token's page → Contract → **Verify and Publish** (free web form; the free Etherscan
   API leaves BNB Chain out): compiler type Solidity (Standard-Json-Input), the printed compiler version, MIT; upload the
   `.standard-input.json`, contract name `contracts/SaphanTokens.sol:SaphanSyntheticToken`, paste the constructor arguments.
3. **[เปลี่ยนการตั้งค่า]** Once verified: BscScan → Token Info Update (free; a BscScan account, an e-mail on sawasdeecoin.com,
   the 32x32 and 256x256 logo `zetaphy-hub/zetaphy-256.png`, website https://app.sawasdeecoin.com, the risk sentence).
4. The hub's "Did you get ZTPHY?" page has "Add ZTPHY (BNB Chain) to <wallet>": it switches to chain 56 and adds the
   token with the IPFS logo (`wallet_watchAsset`), and shows the contract and its BscScan link.

## The runbook

Run the repository commands from `zetaphy-network/` (`npm ci` once). `KEYFILE` is the deployer's key file, read only by
`--send yes` steps and never printed. Any step can be re-run: done steps are skipped (the state file
`zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json` remembers them).

### 0. See the plan

```bash
node scripts/saphan-mainnet.js plan            # [อ่าน] risks, config problems, missing owner inputs, steps, costs
node scripts/saphan-pool.js plan               # [อ่าน] the pools: prices, how thin, what will be signed
```

### 1. The agents machine (validator addresses first)

On the Oracle VM, with this repository's `zetaphy-chain/hyperlane/mainnet/setup-agents-mainnet.sh` copied there:

```bash
sudo bash setup-agents-mainnet.sh install                     # [เปลี่ยนการตั้งค่า] Docker, image, swap, keys made HERE; prints addresses only
sudo VALIDATE_BASE=yes bash setup-agents-mainnet.sh install   # [เปลี่ยนการตั้งค่า] instead, if baseOrigin.mode = "ours"
sudo bash setup-agents-mainnet.sh addresses                   # [อ่าน] the addresses again
```

Put the printed validator address(es) into `saphan-mainnet.json` (`validators.zetaphyOrigin.validators`, and
`validators.baseOrigin.validators` or `mode: "hyperlane"`), set the thresholds **[เปลี่ยนไฟล์]**, open a pull request.
Two validators on two machines with threshold 2 is much safer than one; 1-of-1 needs `allowSingleValidator: true`.

### 2. The deployer key and the remaining inputs

Make a fresh key on your computer (e.g. `cast wallet new` and keep it in a keystore), put only its address in
`deployer.address` **[เปลี่ยนไฟล์]**. Fund it: 1 ZTPHY on ZETAPHY (from the liquidity multisig, as in
docs/ZETAPHY-MAINNET-PROCEDURE.md 16.4) and the ETH `costs` recommends on Base **[เปลี่ยนเชน]**. Create the Safe on Base
(app.safe.global, the liquidity members' keys, 2 of 3) **[เปลี่ยนเชน]** and put it in `liquidity.baseRecipient`; set the
USDT address after checking it. `plan` must show no missing input except those you chose to leave for later.

**Do not use the deployer key on Base for anything else until step 5 is done**: the synthetic's address is fixed by the
deployer's Base nonce at base-roles; a stray transaction moves it and the next step refuses ("nonce moved").

### 3. Check both chains

```bash
node scripts/saphan-mainnet.js check           # [อ่าน] chain ids, Base core, timelock delay + the gov module as proposer,
                                               #        guardian 2 of 3, ThreatRegistry, native ERC-20, USDC, Uniswap, Safe, deployer
```

### 4. Hyperlane core on ZETAPHY (never on Base)

```bash
npm i -g @hyperlane-xyz/cli@45.0.1                                   # [เปลี่ยนการตั้งค่า] the pinned CLI
node scripts/saphan-mainnet.js core-config                            # [เปลี่ยนไฟล์] mainnet/core-config.yaml: every owner the timelock
node scripts/saphan-mainnet.js core                                   # [อ่าน] prints the exact CLI command
KEYFILE=~/zetaphy-bridge/deployer.key node scripts/saphan-mainnet.js core --send yes          # [เปลี่ยนเชน] deploys; writes registry/chains/zetaphy/addresses.yaml
KEYFILE=~/zetaphy-bridge/deployer.key node scripts/saphan-mainnet.js core-handover --send yes # [เปลี่ยนเชน] the ICA router -> the timelock; checks every owner
```

Commit `registry/chains/zetaphy/addresses.yaml` and `core-config.yaml` in a pull request **[เปลี่ยนไฟล์]**.

### 5. The route (deployed CLOSED)

```bash
node scripts/saphan-mainnet.js deploy --step base-roles                                   # [อ่าน] what it would deploy
KEYFILE=… node scripts/saphan-mainnet.js deploy --step base-roles --send yes              # [เปลี่ยนเชน] Base: multisig, timelock, our ISM
KEYFILE=… node scripts/saphan-mainnet.js deploy --step zetaphy-vault --send yes           # [เปลี่ยนเชน] ZETAPHY: ISM + vault (closed)
KEYFILE=… node scripts/saphan-mainnet.js deploy --step base-synthetic --send yes          # [เปลี่ยนเชน] Base: the synthetic ZTPHY (closed)
node scripts/saphan-mainnet.js verify                                                     # [อ่าน] every read-back must be ok
```

Commit `saphan-mainnet-state.json` (public addresses and blocks) **[เปลี่ยนไฟล์]**. Send what is left on the deployer
back to the liquidity multisig and retire the key.

### 6. Start the agents

```bash
node scripts/saphan-mainnet.js agent-config --out agent-config.json [--rpc-base <a private Base RPC>]   # [เปลี่ยนไฟล์]
node scripts/saphan-mainnet.js relayer-env > relayer.env                                                # [เปลี่ยนไฟล์]
# copy both to the VM, then there:
sudo AGENT_CONFIG=agent-config.json CONFIG_SHA256=<sha256 you computed> bash setup-agents-mainnet.sh config   # [เปลี่ยนการตั้งค่า]
# send 0.1 ZTPHY to the ZETAPHY validator (and 0.0002 ETH on Base to the Base validator) [เปลี่ยนเชน]
sudo bash setup-agents-mainnet.sh start-validators                     # [เปลี่ยนการตั้งค่า]
# send the relayer its ETH on Base and 1 ZTPHY [เปลี่ยนเชน]
sudo RELAYER_ENV=relayer.env bash setup-agents-mainnet.sh start-relayer  # [เปลี่ยนการตั้งค่า]
sudo bash setup-agents-mainnet.sh status                               # [อ่าน] announced, checkpoints, balances, memory
```

A free public Base RPC works but rate-limits; a free-tier key from an RPC provider is steadier (`--rpc-base`; it then
sits in `agent-config.json` on the VM only: do not commit that file if the URL holds a key).

### 7. Open (a separate owner step, 48 h on each side)

```bash
node scripts/saphan-mainnet.js open-proposals --out open/              # [เปลี่ยนไฟล์] the gov proposal + the Base multisig calls
```

It prints, in order: **[เปลี่ยนเชน]** `bash zetaphy-chain/gov.sh propose-file open/open-zetaphy.gov-proposal.json`
(deposit 10,000 ZTPHY) and the vote; after it passes and 48 h, anyone sends the printed `execute` to the ZETAPHY timelock;
on Base one owner sends the printed `propose` to the Base multisig, a second owner `confirm(id)` and `execute(id)`; after
48 h the same for the printed execute call. Then `status` **[อ่าน]** shows both `paused: false`.

### 8. The pools on Base

```bash
node scripts/saphan-pool.js plan --live yes --out pools/   # [เปลี่ยนไฟล์] bridge-zetaphy.unsigned.json, pool-USDC.safe-batch.json, pool-USDT.safe-batch.json
```

(a) **[เปลี่ยนเชน]** **Do not sign `bridge-zetaphy.unsigned.json` with the Cosmos multisig.** Tried on mainnet
(2026-11-19): `MsgEVMCall` does not survive the CLI's JSON (`tx encode` then `tx decode` gives back only its `@type`), so
`tx multisign` writes a transaction with an empty message and the node refuses it (`code 7`, empty address). Worse,
legacy-amino signing may not cover the message's fields at all, so a signature would not bind what it sends: never sign a
`MsgEVMCall` from a multisig. What worked instead (BSC, 500,000 ZTPHY): the liquidity multisig signs a plain bank send of
the amount to the deployer (`MsgSend`, members' paper keys in a RAM-only keyring on M-VAL, as in
docs/ZETAPHY-MAINNET-PROCEDURE.md 16.4), and the deployer (its keystore) sends the same two calls the file lists as EVM
transactions at once (approve the vault on `0xEeee…EEeE`, then `lock(Safe, amount)` with `value = quote()`), checking
the calldata against the plan byte for byte. The deployer holds the coins for minutes; key watch follows it, and the
mint still waits the 1 h delay, which guardians can veto.
After the 1 h mint delay, anyone sends `claim(id)` to the synthetic on Base **[เปลี่ยนเชน]** (the relayer does not claim).
(b)+(c) **[เปลี่ยนเชน]** Put 100 USDC and 100 USDT in the Safe; in app.safe.global -> Apps -> Transaction Builder, load
`pool-USDC.safe-batch.json`, check it, sign with 2 of 3, execute; the same for USDT. Each batch: approve ZTPHY, approve
the stable, create the pool at the owner's price (1% fee tier), mint full range to the Safe, with 1% minimums: if
someone created the pool first at another price, the mint fails instead of selling cheaply. Run `saphan-pool.js plan
--live yes` again: it reads the pools and the Safe's balances.

### 9. Every day

`node scripts/saphan-mainnet.js status` **[อ่าน]**: messages waiting each way, today's room, `backed: true` (supply on
Base ≤ locked on ZETAPHY). Guardians: compare each `Queued` on one end with a `Sent` on the other during the delay, and
veto any mismatch. Keep the relayer's ETH above the float (`setup-agents-mainnet.sh status`).

## How to pause

At once, no vote, by 2 of 3 guardians on each side:

```bash
node scripts/saphan-mainnet.js pause                       # [อ่าน] the calldata
node scripts/saphan-mainnet.js pause --veto 0x<payout id>  # [อ่าน] also: veto one queued payout (id = the Queued event's)
```

ZETAPHY: one guardian owner sends `pause.propose` to the guardian multisig `0x54EF…4519`, a second `confirm(id)` and
`execute(id)` **[เปลี่ยนเชน]**. Base: the same on the Base multisig. A pause stops locks, send-backs and claims; a
message that arrives while paused is recorded and waits. Guardians can also lower the daily limits and caps and raise
the delays at once. **Only governance opens again** (step 7 with the same files: unpause through both timelocks, 48 h).

## For the hub (not changed here)

The hub's bridge page reads `saphan-routes.json` (testnet). For mainnet it should show the route from
`zetaphy-chain/hyperlane/mainnet/saphan-mainnet-state.json` (vault, synthetic, CLOSED/OPEN), the risk lines of this page
verbatim, the caps and delays, and a link to the two Uniswap pools; it should never offer an amount above one day's
release limit for the way back.

## More destinations: BNB Smart Chain and Arbitrum One (Polygon PoS prepared, disabled)

Owner decisions of 2026-11-16: Base is hard to fund, so ZTPHY also goes to **BNB Smart Chain** (BSC, chain 56) with one
**PancakeSwap v3** pool against **USDT**, and to **Arbitrum One** (42161) with one **Uniswap v3** pool against Circle's
native **USDC**. **Polygon PoS** (137) is prepared in the config but `"enabled": false`. No other chain is added. Nothing
here is deployed: these are tooling, config, tests and docs.

**ZTPHY on BSC is NOT the same token as ZTPHY on Base (or on Arbitrum).** Each chain gets its own synthetic, backed by its
own vault of locked native ZTPHY on ZETAPHY. The pools are separate markets, each with its own price. Moving ZTPHY from
BSC to Base means sending it back to ZETAPHY first (6 h release delay) and then out again.

### The design: one vault per destination

The existing `ZetaphyTokenVault` sends to exactly one remote contract on one domain (`remote`, `remoteDomain`) and takes
one ISM. A single vault for every chain would need a new, unaudited contract. So each route gets **its own vault** on
ZETAPHY, deployed by the same unchanged code, and this is the safer choice too:

- **A failure stays on one route.** A forged message or a bad key on BSC can at most drain the BSC vault (lockCap
  1,000,000 ZTPHY). It cannot touch what is locked for Base: the Base vault takes only messages from Base's domain and
  from the Base synthetic (tested: `test/saphanroutes.test.js`, and the dry run).
- **Its own caps and delays per route** (`destinations.<route>.limits`). The open routes together are refused above 1% of
  the supply (now 2,500,000 + 1,000,000 + 1,000,000 = 4,500,000 ZTPHY).
- **Every safety rule is the same**: each vault and synthetic is deployed closed, opening is a gov proposal plus 48 h on
  ZETAPHY and the route's multisig plus a 48 h timelock on the other side. The same guardian multisig `0x54EF…4519`
  pauses and vetoes every vault at once; on each destination a new SimpleMultisig is the guardian. Replay and veto rules
  are in the contracts and do not change.
- **Our one ZETAPHY validator signs for every destination.** A Hyperlane validator signs ZETAPHY's merkle tree, which every
  destination's ISM checks. The messages from each destination back to ZETAPHY are checked by Hyperlane's published set
  for that chain: BSC 4 of 6, Arbitrum 3 of 5 (Polygon 2 of 3), the same idea as Base's 3 of 5.
- ZETAPHY's Hyperlane core and its default ISM do not change (the default ISM keeps trusting only the Base set; every
  vault has its own ISM).

Config: `zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json` -> `destinations.bsc`, `.arbitrum`, `.polygon`. **A new EVM
chain is one entry there, with no code change** (the same fields, verified addresses with their source and commit in
`sources`). Base keeps its original fields and state file names (`base-roles`, `zetaphy-vault`, `base-synthetic`).
The other routes add `<route>-roles`, `zetaphy-vault-<route>`, `<route>-synthetic` to the same state file.

### Addresses and where they come from (read 2026-11-16)

| What | BNB Smart Chain (56) | Arbitrum One (42161) | Polygon PoS (137, disabled) |
|---|---|---|---|
| Hyperlane Mailbox | `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4` | `0x979Ca5202784112f4738403dBec5D0F3B9daabB9` | `0x5d934f4e2f797775e53561bB72aca21ba36B96BB` |
| merkle tree hook | `0xFDb9Cd5f9daAA2E4474019405A328a88E7484f26` | `0x748040afB89B8FdBb992799808215419d36A0930` | `0x73FbD25c3e817DC4B4Cd9d00eff6D83dcde2DfF6` |
| ValidatorAnnounce | `0x7024078130D9c2100fEA474DAD009C2d1703aCcd` | `0x1df063280C4166AF9a725e3828b4dAC6c7113B08` | `0x454E1a1E1CA8B51506090f1b5399083658eA4Fc5` |
| message-id multisig ISM factory | `0x4B1d8352E35e3BDE36dF5ED2e73C24E35c4a96b7` | `0x12Df53079d399a47e9E730df095b712B0FDFA791` | `0xEa5Be2AD66BB1BA321B7aCf0A079fBE304B09Ca0` |
| Hyperlane's validators for messages from it | 4 of 6 | 3 of 5 | 2 of 3 |
| DEX | PancakeSwap v3: factory `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`, position manager `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | Uniswap v3: factory `0x1F98431c8aD98523631AE4a59f267346ea31F984`, position manager `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | Uniswap v3 (same addresses) |
| stable | USDT (BSC-USD) `0x55d398326f99059fF775485246999027B3197955`, **18 decimals**; also USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`, 18 decimals | native USDC (Circle) `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, 6 decimals | native USDC (Circle) `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`, 6 decimals |
| gas token | BNB | ETH | POL |

Sources, pinned by commit in the config (`destinations.<route>.sources`):

- Hyperlane core and domain ids: `hyperlane-xyz/hyperlane-registry` commit `099d9d2a5f27f6d40589a0b55102f917a50b79c7`,
  `chains/{bsc,arbitrum,polygon}/addresses.yaml` and `metadata.yaml` (domain = chain id for all three; sha256 in the config).
- Hyperlane's validator sets: `hyperlane-xyz/hyperlane-monorepo` commit `5db7d80874062bfede7b81fb5eb5ad44398c9c52`,
  `typescript/sdk/src/consts/multisigIsm.ts` (`defaultMultisigConfigs.bsc`, `.arbitrum`, `.polygon`).
- PancakeSwap v3: `pancakeswap/pancake-v3-contracts` commit `986847948755cba528324d41be19480731c36c2a`,
  `projects/v3-core/deployments/bscMainnet.json` and `projects/v3-periphery/deployments/bscMainnet.json`; the fee tiers
  from `projects/v3-core/contracts/PancakeV3Factory.sol`: 100/1, 500/10, **2500/50** (Uniswap has 3000/60), 10000/200.
  The tool keeps a tick spacing table per DEX, so a 2500 pool gets full-range ticks of ±887,250 and Base refuses 2500.
- Uniswap v3 on Arbitrum and Polygon: `Uniswap/sdk-core` commit `baff6d3c78b09aa0b2f96148bc223b42a57fd28a`,
  `src/addresses.ts` (`DEFAULT_ADDRESSES`, as for Base). On Polygon Uniswap v3 was chosen over QuickSwap v3: QuickSwap v3
  is Algebra (no fee tiers, another position manager interface), which the pool code does not build.
- BSC stables: PancakeSwap's own token list (`pancakeswap/token-list` commit `1dd8633d75ea081a9fbf88b1a22f29f74c06b36d`,
  `lists/pancakeswap-default.json`: "Binance Pegged USDT", "Binance Pegged USD Coin", decimals 18), the same in Trust
  Wallet's asset list (`trustwallet/assets` commit `50d6fd574843da19cdd5fded102b5d6b951c72d2`) and in this repository's
  `zetaphy-neuro/src/known-tokens.js`.
- Arbitrum USDC: Arbitrum's own docs (`OffchainLabs/arbitrum-docs` commit `8f3db19377666b0b2f1a5180e34754160f7047e5`,
  `content/docs/arbitrum-bridge/usdc-arbitrum-one.mdx`: native USDC, not USDC.e `0xFF97…5CC8`), Trust Wallet (6 decimals)
  and `known-tokens.js`. Polygon USDC: Uniswap's default token list (commit `0ae664438dd43d428c5cbef2726af1ba6378a17c`,
  `src/tokens/polygon.json`: "USDCoin", 6 decimals; not USDC.e `0x2791…4174`) and Trust Wallet.
- **Not verified**: Circle's own address page (developers.circle.com could not be reached from the machine that wrote
  this); any read of the live chains (no BSC, Arbitrum or Polygon RPC was reachable). `check --route <route>` reads every
  address on the live chain before anything is sent: the Mailbox's domain, the hook, the ISM factory, the stable's
  decimals, the position manager's `factory()`, the fee tier's tick spacing, and that your Safe exists there.

### Owner inputs per chain

`node scripts/saphan-mainnet.js plan` **[อ่าน]** lists what is still missing, per chain. For BSC and Arbitrum today:

| Input | Where | Status |
|---|---|---|
| The **Safe on that chain** that receives its ZTPHY and owns its pool. You may use the same address as on Base (`0x08Da43D48f1f68587220768Faf5a00C28962Dc36`): at app.safe.global, open the Safe, "Add another network", pick the chain; it exists there only once you have done that (and paid its gas). `check --route` reads it on that chain. | `destinations.<route>.liquidity.recipient` | missing |
| The multisig owners on that chain (suggested: the three ZETAPHY guardian owners, in `ownersSuggested`; copy them to `owners` to confirm) and the threshold (2) | `destinations.<route>.owners`, `.threshold` | missing |
| The gas you send the deployer and the relayer on that chain (`costs` recommends; `plan` warns if lower) | `destinations.<route>.funding.deployer`, `.relayer` | missing |
| Pool amounts (default 500,000 ZTPHY + 50 USDT on BSC, + 50 USDC on Arbitrum, 0.0001 USD per ZTPHY, 1% tier, full range) | `destinations.<route>.liquidity.pools`, `.feeTier` | set (edit if you want) |
| The deployer key and our ZETAPHY validator: the same as for Base (one key; the synthetic's address on each chain depends only on that chain's nonce) | `deployer.address`, `validators.zetaphyOrigin` | missing (shared) |

The BSC pool needs 500,000 ZTPHY of its own (a separate lock into the BSC vault): ZETAPHY's liquidity multisig locks
500,000 for Base, 500,000 for BSC and 500,000 for Arbitrum, 1,500,000 ZTPHY in all, and 50 + 50 + 50 USD of stables.

### BSC: the owner's steps, in order

1. **[อ่าน]** `node scripts/saphan-mainnet.js plan` and `node scripts/saphan-pool.js plan --route bsc`.
2. **[เปลี่ยนเชน]** **The Safe on BSC**: at app.safe.global add BNB Smart Chain to your Safe (or create a new 2-of-3
   there). Put its address in `destinations.bsc.liquidity.recipient` **[เปลี่ยนไฟล์]**.
3. **[เปลี่ยนเชน]** **USDT into the Safe through Binance**: in Binance, Withdraw -> USDT -> network **"BSC (BEP20)"**
   (also shown as "BNB Smart Chain (BEP20)"), address = the Safe on BSC. Send a small test amount first and see it
   arrive on bscscan.com, then the rest (50 USDT plus Binance's withdrawal fee). **Never pick another network** for that
   address (ERC20, Arbitrum, opBNB...): the same address on another chain may be no Safe, and the coins are then lost.
   USDT on BSC has 18 decimals: 50 USDT is shown as 50 in wallets and as 50,000,000,000,000,000,000 in raw calldata.
4. **[เปลี่ยนเชน]** **BNB**: withdraw BNB on "BSC (BEP20)" to (a) the deployer (`costs` recommends ~0.0022 BNB at 0.1
   gwei, 3x the estimate), (b) the relayer (~0.008 BNB for 200 deliveries) and (c) the Safe owner key that will execute the
   pool batch (~0.001 BNB). Write the deployer and relayer amounts into `destinations.bsc.funding`.
5. **[เปลี่ยนไฟล์]** The BSC multisig owners: copy `ownersSuggested` to `owners` (or name others), open a pull request.
6. **[อ่าน]** `node scripts/saphan-mainnet.js check --route bsc` (BSC core, PancakeSwap, USDT decimals 18, the Safe on BSC).
7. **[เปลี่ยนเชน]** After the Base route's core step (ZETAPHY's core is shared, done once):
   ```bash
   KEYFILE=… node scripts/saphan-mainnet.js deploy --route bsc --step roles --send yes       # BSC: multisig, timelock, our ISM
   KEYFILE=… node scripts/saphan-mainnet.js deploy --route bsc --step vault --send yes       # ZETAPHY: the BSC vault (closed)
   KEYFILE=… node scripts/saphan-mainnet.js deploy --route bsc --step synthetic --send yes   # BSC: the BSC synthetic (closed)
   node scripts/saphan-mainnet.js verify --route bsc                                        # [อ่าน]
   ```
   Do not use the deployer key on BSC for anything else in between (the synthetic's address is fixed by its BSC nonce).
8. **[เปลี่ยนการตั้งค่า]** The agents: `agent-config` and `relayer-env` now include every deployed route; install them on
   the agents machine as in step 6 of the runbook, then send the relayer its BNB.
9. **[เปลี่ยนเชน]** Open: `node scripts/saphan-mainnet.js open-proposals --route bsc` writes
   `open/open-zetaphy-bsc.gov-proposal.json` (its own gov proposal, 10,000 ZTPHY deposit, refunded) and the BSC multisig
   calls; 48 h on each side.
10. **[เปลี่ยนเชน]** The pool: `node scripts/saphan-pool.js plan --route bsc --live yes --out pools/` writes
    `bridge-zetaphy-bsc.unsigned.json` (the liquidity multisig locks 500,000 ZTPHY into the BSC vault for the BSC Safe) and
    `pool-bsc-USDT.safe-batch.json` (approve ZTPHY, approve USDT, create the PancakeSwap v3 pool at 0.0001 USDT per ZTPHY,
    mint full range with 1% minimums); the ZTPHY goes through the deployer as in step 8 (a), never a multisig-signed
    `MsgEVMCall`. After the 1 h mint delay anyone sends `claim(id)` on BSC; then load the batch in
    app.safe.global (BNB Smart Chain) -> Transaction Builder, check it, sign, execute.

Arbitrum One is the same with `--route arbitrum`, ETH on Arbitrum One for gas (withdraw on the "Arbitrum One" network,
never "Arbitrum Nova"), and native USDC (6 decimals) into its Safe.

### Costs of the new routes

`node scripts/saphan-mainnet.js costs --bsc-gwei <gwei> --arbitrum-gwei <gwei>` **[อ่าน]** prints each route in its own gas
token. At the defaults (BSC 0.1 gwei and $700/BNB; Arbitrum 0.02 gwei plus an L1 data fee allowance and $3,000/ETH):

| Route | Deployer (estimate; fund 3x) | Relayer float (200 deliveries) | Total on that chain | ZETAPHY gas |
|---|---:|---:|---:|---:|
| BNB Smart Chain | ~0.000725 BNB (fund ~0.0022) | ~0.008 BNB (~$5.60) | ~0.0095 BNB (~$6.60) | ~0.084 ZTPHY |
| Arbitrum One | ~0.00075 ETH incl. L1 fee (fund ~0.0022) | 0.002 ETH (floor) | ~0.0031 ETH (~$9.30) | ~0.084 ZTPHY |

Plus one gov proposal deposit per route to open (10,000 ZTPHY, refunded when it passes). Check bscscan.com/gastracker
and arbiscan.io before funding and run `costs` again.

### Agents on the 1-CPU / 6 GB sentry

One relayer relays every deployed route; its whitelist names only our vaults and synthetics (two entries per route), so
nobody can spend its BNB or ETH on other messages. Our one ZETAPHY validator signs for every destination: no extra
validator is needed (unless a route's `originValidators.mode` is "ours": then `VALIDATE_ORIGINS="bsc"`). The RPCs are the
Hyperlane registry's public lists (BSC: bsc.drpc.org, bsc-rpc.publicnode.com, bsc.rpc.blxrbdn.com); override them with
`--rpc-bsc <url>` / `BSC_RPC` (a free-tier key from an RPC provider is steadier: then do not commit `agent-config.json`).
Memory: the relayer's cap is 480 MB for two chains plus 200 MB per further chain (880 MB for ZETAPHY + Base + BSC +
Arbitrum), at most 40% of the RAM; set `MEM_RELAYER` to override. Every agent container runs with a low CPU weight
(`--cpu-shares 512`), so on one CPU the ZETAPHY node wins when both need it. BSC makes a block every 0.45 s: indexing it
from a public RPC is the heaviest part; if the relayer falls behind, give it a private RPC.

### Risks of the new routes, plainly

- **USDT on BSC is Binance-Peg BSC-USD, issued by Binance, not by Tether.** Binance (its owner key) can mint more of it,
  and it is worth 1 USD only while Binance honours the peg. The same holds for Binance-Peg USDC on BSC (issued by Binance,
  not Circle). The ZTPHY/USDT pool on BSC carries that trust in Binance.
- **ZTPHY on BSC, on Base and on Arbitrum are three separate synthetics and three separate markets.** Their prices can
  drift apart; arbitrage between them needs a trip through ZETAPHY (hours).
- **PancakeSwap's factory owner can switch a fee tier off or whitelist it** for new pools (`PancakeV3Factory`); `check`
  and `saphan-pool.js --live` read the tier before you sign. An existing pool is not affected.
- Everything in "Read this first" applies to each route: one ZETAPHY validator, our small signing set, unaudited
  contracts, thin pools ($50 a side: a $10 buy moves the price about +43%).

**Why more chains is not free.** Each route was kept only because the owner asked for it, and no more than these four are
configured, because:

- every pool splits the same small liquidity: three pools of $50 are each thinner than one of $150;
- every route adds a synthetic, a timelock and a multisig that the guardians must watch every day;
- the relayer pays gas on every chain, and must be kept funded on each;
- each is one more place where a bug or a lost key can lose funds.

### The dry run for BSC

The `saphan-mainnet` workflow runs the BSC route after the Base route on the **same local ZETAPHY** (two vaults side by
side), on a **local anvil with chain id 56**: Hyperlane core from the pinned CLI and Uniswap v3 from its npm artifacts
(v3-core 1.0.1, v3-periphery 1.4.4; the pool init code hash matches) as the stand-in for PancakeSwap v3, which has the
same position manager interface and the same 1% tier and tick spacing (200). A fork of BSC mainnet is not used: no
public BSC RPC that a GitHub runner can use keeps archive state, and with 0.45 s blocks a non-archive node prunes the fork
block's state within about a minute, much less than this run takes. The real PancakeSwap v3 on BSC is checked by
`check --route bsc` and `saphan-pool.js plan --route bsc --live yes` (read only) from the owner's machine.

## Verified, and not

- `npm test` (zetaphy-network) runs `test/saphanmainnet.test.js`: the config, the refusals, 1-of-1 only with the flag,
  USDC against `known-tokens.js`, the core config, opening and pause calldata, the relayer whitelist, the agent config,
  the costs, the pool math and calldata, the bridge transaction, and the two contracts with the mainnet caps.
- `scripts/saphan-mainnet-dryrun.js` passed on two local chains here (anvil 8453 with Hyperlane core from the pinned CLI
  and Uniswap v3 from its npm artifacts; anvil 3659 with the core config this tool writes): hand-over, deploy, resume,
  29 read-backs, opening through both timelocks, 2,000,000 ZTPHY to the Safe, caps, both pools at 0.0001 USD,
  burn -> release after 6 h, the daily limits, pause, forged messages. The `saphan-mainnet` workflow runs the same on a
  **fork of Base mainnet** (its real Mailbox, ISM factory, USDC and Uniswap) and starts the agents.
- `test/saphanroutes.test.js` covers the other routes: the committed BSC, Arbitrum and Polygon entries against their
  sources and `known-tokens.js`, the refusals of a weakened BSC route, Polygon refused while disabled and valid once
  enabled with its inputs, the PancakeSwap v3 tiers and full range, the 18-decimal USDT pool at exactly 0.0001, the
  bridge per destination, opening and pause per route, the relayer whitelist and the agent config naming every chain,
  the costs in BNB, and two routes' contracts side by side (each vault takes only its own chain's messages).
- The BSC pool plan's four calls were also executed once against real Uniswap v3 bytecode (npm v3-core 1.0.1 /
  v3-periphery 1.4.4, the stand-in for PancakeSwap v3) with an 18-decimal USDT stand-in: the pool was created at exactly
  the planned sqrtPriceX96 and the full-range mint passed its 1% minimums. The extended dry run (`--route bsc`) and its
  workflow steps were written but not run on the machine that wrote them (no anvil there): the first CI run is their test.
- Not verified: any read of the live ZETAPHY, Base, BSC, Arbitrum or Polygon chains (the machine that wrote this could
  not reach their RPCs); Circle's own USDC address page; the USDT token on Base; the liquidity multisig signing
  `MsgEVMCall`; the Hyperlane agents against mainnet; the memory use of the agents on an E2.1.Micro or the sentry.
