**English** | [ภาษาไทย](PROGRAM_ROLLBACK.th.md)

# SWD AMM: verifiable builds, on-chain watch, and rolling back after a hack

This page is for the owner and the Squads members. It covers four tools:

| Tool | What it does | File |
|---|---|---|
| **Verifiable build** | Builds the program in a fixed Docker image (solana-verify), so anyone can rebuild it and get the same bytes. Each `program-v*` tag publishes a GitHub Release with the `.so`, its hashes, the IDL and signed provenance | `scripts/verified-build.sh`, `.github/workflows/verifiable-build.yml` |
| **On-chain watch** | Checks every hour that the deployed code equals the latest release and that the upgrade authority is the Squads vault. Alerts by Telegram and fails the workflow (GitHub e-mails you) | `scripts/program-watch.mjs`, `.github/workflows/program-watch.yml` |
| **Rollback** | Puts a verified release back on chain: hash checks, a buffer, buffer authority to the vault, then the Squads steps. Dry run unless you add `--execute` | `scripts/rollback-program.sh` |
| **Emergency pause** | The emergency key stops swaps / deposits / withdrawals on a pool **at once** | `yarn governance emergency-pause-v2-pool` |

Why it matters: on Solana, whoever holds the **upgrade authority** can replace the program code. The tools above make
every replacement **visible** (watch), **checkable** (verifiable build: the hash on chain equals a public commit), and
**reversible** (rollback to a known-good release). They cannot stop a holder of the authority; only the Squads M-of-N
and its time lock do that.

## Pause or roll back?

| Situation | First action | Then |
|---|---|---|
| Funds are moving out in a way they should not, or a credible exploit report | **Pause** the affected pools (emergency key, seconds) | Assess. Roll back or fix forward |
| The **latest upgrade** introduced the bug, and the previous release is safe | Pause | **Roll back** to the previous `program-v*` release through Squads |
| The bug is in **every** release | Pause | **Fix forward**: a fixed commit, a fix review by the auditor, a new tag, then the same Squads path (`prepare <new tag>`) |
| program-watch: **"NOT any published release"** (unknown code on chain), with the authority still the vault | Pause. Ask every Squads member: "did you approve an upgrade?" | If nobody did, treat the vault as compromised (below). If it was a mistake, roll back to the latest release |
| program-watch: **authority changed** (not the vault) | Pause. Warn users at once (website banner, socials) | See "Authority lost" |
| A UI / API bug only (`test-ui/`) | Take the site down or roll it back (Vercel / Cloudflare) | The program stays as it is |

**Pause** is instant and cannot move funds. It only stops actions. The emergency key **cannot unpause**: unpausing needs
the multisig plus the 24–48 h timelock. **Rollback** replaces the code and needs the Squads threshold and its time lock.
So the order is always: **pause first, then take your time.**

> **Is the old code compatible?** A rollback runs old code on today's accounts. If the newer release changed an account
> layout (new fields, a migration), the old code may misread them. Before any rollback, read the release notes of every
> release between the two versions. If accounts changed, **fix forward** instead.

## Step by step after a hack

**1. Emergency pause (minutes).** The emergency-key holder (hardware wallet, not a Squads member):
```bash
yarn governance emergency-pause-v2-pool <POOL> true true true --yes      # swap, deposit, withdraw
```
If the bug is in pool creation, governance also signs `set-pool-creation-paused true` through Squads.
Put a maintenance banner on the website. Do **not** unpause during the incident (`emergency-cancel-unpause <id>` cancels a
pending unpause).

**2. Assess (hours).**
```bash
bash scripts/rollback-program.sh status --cluster mainnet --program-id <ID> --url <PRIVATE_RPC> --vault <SQUADS_VAULT>
```
This shows the last deployed slot, the authority, and which release the on-chain code is (or **UNKNOWN CODE**). Save the
attack transaction signatures. Contact the auditor and decide: roll back to which release, or fix forward.

**3. Prepare the rollback (dry run first, on the operator's computer).**
```bash
bash scripts/rollback-program.sh prepare program-vX.Y.Z --cluster mainnet --program-id <ID> \
  --url <PRIVATE_RPC> --vault <SQUADS_VAULT> --keypair ~/keys/ops-payer.json            # prints every step
... the same ... --execute                                                                # asks "yes" before each step
```
The script downloads the release and checks it against `SHA256SUMS`, `release.json` and the signed provenance. It writes
a buffer, checks the buffer's hash again, and hands the buffer to the vault. The payer key only pays SOL for the buffer
(about 5.7 SOL for an ~800 kB program, refunded on upgrade). It needs **no** special rights.

**4. Squads proposal (the script prints the exact values).** In the Squads app: Developers → Programs → the program →
Upgrade, with the buffer address and a refund address. **Every member checks the buffer hash on their own computer before
approving:**
```bash
solana program dump <BUFFER> buffer.so -u <RPC> && bash scripts/verified-build.sh hash buffer.so
```
Approve with the threshold. **Time lock:** if the multisig has a Squads time lock, the upgrade can only be executed after
it has passed. The program's own 24–48 h timelock covers governance actions, **not** code upgrades, so the Squads time
lock is the only delay on an upgrade. The pause keeps users safe while you wait.

**5. Check the hash.**
```bash
bash scripts/rollback-program.sh status --cluster mainnet --program-id <ID> --url <RPC> --vault <SQUADS_VAULT>
bash scripts/verified-build.sh verify-command <ID> mainnet <COMMIT_OF_THAT_RELEASE>   # public check, incl. OtterSec
```
Then set the repository variable `EXPECTED_HASH_MAINNET` to the rolled-back release's hash, so program-watch is green
again. Remove the variable once a new release is deployed. Run the `verifiable-build` workflow by hand with the program
id to see MATCH in its summary.

**6. Unpause (≥ 24 h, through the timelock).**
```bash
yarn governance propose-unpause-v2 <POOL> true true true --print-ix    # wrap in a Squads proposal
# after the timelock (and within 7 days):
yarn governance execute <ACTION_ID>
```
Afterwards: write a post-mortem, publish an advisory, and pay the bounty if a researcher reported it
(`audit-package/BUG_BOUNTY.md`).

### Authority lost (the vault or the upgrade key is compromised)

If someone else holds the upgrade authority, **no tool can roll back for you**. They can deploy anything, including code
without the pause. What still helps:
- the emergency pause, as long as their code still honours it. Use it at once;
- warning users fast: the website, socials, and Squads / explorer security contacts. Ask users to withdraw if they still can;
- the public evidence: program-watch, the release hashes, OtterSec's record. These prove which code is genuine.

Prevention is the only real defence: hardware wallets for every Squads member, a 2-of-3 or 3-of-5 threshold, a Squads time
lock, and program-watch with Telegram alerts.

## Squads time lock: recommendation

`scripts/squads-setup.ts` creates the multisig with time lock 0. A time lock of **12–24 h** on the vault that holds the
upgrade authority gives everyone time to notice a malicious upgrade proposal (watch the Squads app, and check every
proposal's buffer hash) before it can run. The cost: a rollback also waits that long. The emergency pause covers that
wait. Changing the time lock is a Squads config proposal, approved with the threshold.

## Setup checklist (owner)

1. Merge this, then tag the first release from `main`:
   `git tag program-v0.1.0 <commit> && git push origin program-v0.1.0`. The `verifiable-build` workflow publishes it.
2. **Devnet:** deploy that release so devnet runs verified code. The current devnet program was built with a plain
   `anchor build`, so its hash matches no release, and program-watch reports it until you do this:
   `bash scripts/rollback-program.sh prepare program-v0.1.0 --cluster devnet --keypair <DEVNET_UPGRADE_AUTHORITY.json> --execute`
3. Repository variables (Settings → Secrets and variables → Actions → Variables): `EXPECTED_AUTHORITY_DEVNET`. Later
   `MAINNET_PROGRAM_ID` and `EXPECTED_AUTHORITY_MAINNET` (= the Squads vault).
4. Telegram (optional but recommended): make a bot with @BotFather, add it to a private group, and set the secrets
   `ALERT_TELEGRAM_BOT_TOKEN` and `ALERT_TELEGRAM_CHAT_ID`. For a private RPC, add `MAINNET_RPC_URL` / `DEVNET_RPC_URL`.
5. Mainnet: the program id is compiled in (`declare_id!`; today it is the devnet id). So the mainnet release must be
   tagged on the commit that sets the mainnet id (`scripts/deploy-mainnet.sh` preflight). Deploy only that release's
   `swd_amm-mainnet.so` (one that matches the audit report's hash), then publish the
   OtterSec record (`verified-build.sh upload`, or `verify-command` → `export-pda-tx` once the vault holds the authority).
6. Set the Squads time lock (above). Give the emergency key to the on-call person.

## Monthly drill on devnet (about 1 hour; first Monday of the month)

Practice, so that on the real day everyone knows the steps. Record each run in a GitHub issue titled
"Rollback drill YYYY-MM": who did what, and how long each step took.

1. Actions → program-watch → Run workflow. It should be green (devnet = the latest release).
2. `bash scripts/rollback-program.sh status --cluster devnet`.
3. Pause a test pool you created on devnet with the devnet emergency key (`emergency-pause-v2-pool ... true true true`).
4. Roll back to the **previous** release: `rollback-program.sh prepare <previous tag> --cluster devnet --keypair <devnet authority> --execute`.
   For practice, use `--via-squads --vault <devnet Squads vault>` and do the Squads proposal too.
5. Run program-watch again. It must **alert** (older release on chain). That confirms the alert works, including Telegram.
6. Roll forward to the latest release the same way. Run program-watch: green, plus a "redeployed" notice.
7. Unpause: `propose-unpause-v2`, wait (devnet builds allow a timelock as short as 5 s), `execute`.
8. Write down anything that was unclear and fix this page.
