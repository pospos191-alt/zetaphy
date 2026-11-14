**English** | [ภาษาไทย](SAPHAN-MAINNET.th.md)

# Saphan mainnet: ZTPHY between ZETAPHY and Base

Owner decision 2026-11-14: open the Saphan bridge between ZETAPHY mainnet (`zetaphy_3659-1`, EVM chain 3659) and Base
mainnet (8453), so ZTPHY can trade against USDC (and USDT) on Base. The testnet is shut down; this is the mainnet tooling.
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
| Pool amounts (decided: 1,000,000 ZTPHY + 100 USDC; 1,000,000 ZTPHY + 100 USDT; 0.0001 USD per ZTPHY) | `liquidity.pools` | set |
| ETH on Base: deployer ~0.0035, relayer ~0.002 (float), Safe ~0.001; 100 USDC + 100 USDT into the Safe | — | to buy/send |
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

(a) **[เปลี่ยนเชน]** The liquidity multisig (`0x8598…15d1`, a Cosmos 2-of-3) signs `bridge-zetaphy.unsigned.json`: one
Cosmos transaction with two `MsgEVMCall`: approve the vault on the native ERC-20, then `lock(Safe, 2,000,000 ZTPHY)`.
Members sign as for the deployer's funding (docs/ZETAPHY-MAINNET-PROCEDURE.md 16.4), with `zetaphyd tx sign … --multisig
<liquidity multisig zetaphy1…> --from <member>`, then `tx multisign` and `gov.sh broadcast`. **Not verified here**: whether
the node's legacy-amino multisig signing accepts `MsgEVMCall` (it was never tried from a multisig). Try it first with a
copy of the file whose amounts are 1 ZTPHY; if signing refuses the message, use `--sign-mode direct`; if that is refused
too, the fallback is a bank send of the 2,000,000 ZTPHY to a fresh one-time key that sends the same two calls with
`cast send` (one key holds the coins for minutes: a weaker, single-key step).
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

## Verified, and not

- `npm test` (zetaphy-network) runs `test/saphanmainnet.test.js`: the config, the refusals, 1-of-1 only with the flag,
  USDC against `known-tokens.js`, the core config, opening and pause calldata, the relayer whitelist, the agent config,
  the costs, the pool math and calldata, the bridge transaction, and the two contracts with the mainnet caps.
- `scripts/saphan-mainnet-dryrun.js` passed on two local chains here (anvil 8453 with Hyperlane core from the pinned CLI
  and Uniswap v3 from its npm artifacts; anvil 3659 with the core config this tool writes): hand-over, deploy, resume,
  29 read-backs, opening through both timelocks, 2,000,000 ZTPHY to the Safe, caps, both pools at 0.0001 USD,
  burn -> release after 6 h, the daily limits, pause, forged messages. The `saphan-mainnet` workflow runs the same on a
  **fork of Base mainnet** (its real Mailbox, ISM factory, USDC and Uniswap) and starts the agents.
- Not verified: any read of the live ZETAPHY or Base chains (the machine that wrote this could not reach their RPCs);
  the USDT token; the liquidity multisig signing `MsgEVMCall`; the Hyperlane agents against mainnet; the memory use of the
  agents on an E2.1.Micro.
