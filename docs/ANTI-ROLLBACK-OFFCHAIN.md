**English** | [ภาษาไทย](ANTI-ROLLBACK-OFFCHAIN.th.md)

# Anti-rollback and anti-takeover: the off-chain half

**Testnet only, not audited.** The chain-side guards (start guard, sign record, no crypto downgrade, voting-power cap,
circuit breaker) are in [ANTI-ROLLBACK-CHAIN.md](ANTI-ROLLBACK-CHAIN.md). This page is everything around the chain:
the binaries nodes install, the dependencies we build them from, what a finder earns, and what each user keeps.

| Item | Stops | Where | Tests |
|---|---|---|---|
| L1-3 signed releases | a node installing a binary that this repository's release workflow did not build from `main`, or an older one | `.github/workflows/release-zetaphyd.yml` (job `sign`), [`zetaphy-chain/verify-release.sh`](../zetaphy-chain/verify-release.sh) | `node --test audit/tools/verify-release.test.js` (workflow `verify-release.yml`) |
| L1-3 installs only verified releases (internal review 2026-11-10, Z-04) | `install.sh validator`, `zetaphy-validator update` and the upgrade timer running a `setup-node.sh`, a `zetaphyd` or the script itself that no signed release vouches for | [`zetaphy-chain/join-validator.sh`](../zetaphy-chain/join-validator.sh) (`fetch_release`, `install_self`) | `node --test audit/tools/join-validator-release.test.js` (workflow `verify-release.yml`), `runner-install.yml` |
| cloud-init pin is published (internal review 2026-11-10, Z-05) | `cloud-init.sh` on `main` pinning a `v/<sha256>.sh` that the public repository does not have (no node) | [`audit/tools/cloud-init-published.sh`](../audit/tools/cloud-init-published.sh), workflow `cloud-init-published.yml` | `node --test audit/tools/cloud-init-published.test.js` |
| L1-4 no dependency downgrades | a pull request that quietly moves Go, a Go module, an npm or Cargo package back to an older (vulnerable) version | [`audit/tools/no-downgrade.js`](../audit/tools/no-downgrade.js), [`audit/allow-downgrade.txt`](../audit/allow-downgrade.txt), workflow `no-downgrade.yml` | `node --test audit/tools/no-downgrade.test.js` (incl. the mutation test) |
| U bug bounty | an attack paying more than reporting it | [`ZetaphyBounty.sol`](../zetaphy-network/contracts/ZetaphyBounty.sol) | `test/zetaphybounty.test.js`, `audit/invariants/ZetaphyBounty.inv.t.sol` |
| Q your own proof + forced exit | ZETAPHY's validators censoring, stopping or rolling back while bridged funds are locked on the source chain | [`ZetaphyForcedExit.sol`](../zetaphy-network/contracts/ZetaphyForcedExit.sol), `HyperlaneLockBoxV2.forcedPay`, [`src/forcedexit.js`](../zetaphy-network/src/forcedexit.js) | `test/forcedexit.test.js`, `audit/invariants/ForcedExit.inv.t.sol` |
| F rollback alarm (wallet) | a node (or a rolled-back chain) showing the user a lower block or another state than one the wallet already holds | [`zetaphy-wallet/rollback.js`](../zetaphy-wallet/rollback.js), `app.js` | `zetaphy-wallet/test/wallet.e2e.js` ("rollback alarm") |

## L1-3: signed releases

`release-zetaphyd.yml` builds `zetaphyd-linux-amd64` / `-arm64` as before. A separate job **`sign`** (the only job with
`id-token: write` and `attestations: write`; it cannot publish) then writes

- `RELEASE.json`: what the release is: `tag` (`zetaphyd-<first 12 hex of setup-node.sh's sha256>`), `setup_node_sha256`,
  `commit`, `ref` (`refs/heads/main`), `main_commits` (the commit's position on `main`: `git rev-list --count`),
  `commit_time`, `upgrades` (the chain-upgrade handlers in the patch: `zetaphy-v2` … `zetaphy-guard`), `scripts`
  (the sha256 of `zetaphy-chain/join-validator.sh` and `verify-release.sh` at that commit; releases from before
  this field lack it);
- `SHA256SUMS` over the binaries and `RELEASE.json`;
- one **Sigstore build-provenance attestation** (`actions/attest-build-provenance`, keyless: GitHub's OIDC token gets a
  short-lived Fulcio certificate naming this repository, the workflow file, the ref and the commit; free) over every
  binary, `SHA256SUMS` and `RELEASE.json`, and its bundle `zetaphyd-provenance.sigstore.json`.

The job `release` (environment `release`, only `contents: write`) checks the hashes and publishes all of them. **A tag
is never reused for other signed files** (internal review 2026-11-12, Z-49): when the tag already has a `RELEASE.json`,
the job stops with an error unless the published `SHA256SUMS` is byte-identical to the new one (then there is nothing
to do). A new release always comes with a new `setup-node.sh`, so a new tag. Only a release made before signing
existed (no `RELEASE.json`) gets the signed files added to its tag.

### `verify-release.sh`: what it checks

1. **Hashes**: the binary and `RELEASE.json` each have exactly one line in `SHA256SUMS`, and match it (a missing line is
   a failure, unlike `sha256sum -c --ignore-missing`).
2. **Signature**: `gh attestation verify` (or, without gh, `cosign verify-blob-attestation` with the shipped bundle) for
   the binary, `SHA256SUMS` and `RELEASE.json`: signer workflow `pospos191-alt/zetaphy/.github/workflows/release-zetaphyd.yml`,
   source ref `refs/heads/main`, source commit = `RELEASE.json`'s `commit`, GitHub-hosted runner, SLSA provenance v1.
   `RELEASE.json` must also name this repository and `refs/heads/main`, and its tag must match its `setup_node_sha256`;
   with `--setup <file>` that file must be the `setup-node.sh` the release was built from.
3. **No rollback**: against the record of the installed release (`/var/lib/zetaphy/installed-release.json`, written by
   `--record`): `main_commits` must not be lower (the same position must be the same commit), and every upgrade handler
   of the installed release must be in the new one. Without a record yet: **every** upgrade handler name found in the
   installed binary (`zetaphy-v2`, `zetaphy-v3`, ..., and the named ones such as `zetaphy-firewall`, `zetaphy-guard`,
   `zetaphy-shield`: the script's `KNOWN_UPGRADES` plus every name the new release lists) must be in the new release,
   not only the highest number. `ALLOW_ROLLBACK=1` accepts an older release on purpose (still printed).
4. **`RELEASE.json` is required.** There is no unsigned path any more (`ALLOW_UNSIGNED` was removed, internal review
   2026-11-12, Z-49): a folder without it is refused before any other check, so removing it cannot skip the rollback
   check.
5. **Freshness** (a signed but old release served instead of the newest): a warning when the release's commit is more
   than `MAX_RELEASE_AGE_DAYS` (default 60) days old, and, when the newest published release's `RELEASE.json` can be
   fetched (`LATEST_RELEASE_URL`, default `https://github.com/<repo>/releases/latest/download/RELEASE.json`; `OFFLINE=1`
   skips it), a warning when that one is further along `main`. Offline, only the age is checked. The fetched file is
   used for nothing else. `REQUIRE_FRESH=1` turns either warning into a refusal.

Exit 0 = verified, 1 = refused, 2 = usage / tool missing.

**After a start-guard revert** (the node refused the newly installed binary and went back to `$BIN.prev`), the record
still names the newer release. `verify-release.sh --mark-refused` (run by the revert, or by hand with `sudo`) keeps that
release's position on `main` as the floor (it is never lowered, so this opens no way back to an older release), adds
it to `refused` (commit, position, binary sha256) and notes the binary that actually runs (`running_binary_sha256`).
That exact release is then refused again (`RETRY_REFUSED=1` tries it on purpose); the next release must be at least
as far along `main`. Recording a newer release keeps the `refused` history.

`setup-node.sh`'s own `UPGRADE_CHECK` (the binary must run the next block of this node's chain) and the start guard
still apply after install; this check runs before anything is installed.

### On the VM

**[อ่าน]** = only reads; **[เปลี่ยนไฟล์]** = writes files (as in [CHAIN-FIREWALL.md](CHAIN-FIREWALL.md)).

```bash
# [อ่าน] tools: cosign (or gh), jq; both verifiers are free
command -v cosign gh jq sha256sum
# [เปลี่ยนไฟล์] cosign, if missing: its own release, checked against that release's checksum list (arm64: cosign-linux-arm64)
cd /tmp && curl -fsSLO https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 \
  && curl -fsSLO https://github.com/sigstore/cosign/releases/latest/download/cosign_checksums.txt
grep ' cosign-linux-amd64$' cosign_checksums.txt | sha256sum -c -        # must print: cosign-linux-amd64: OK
sudo install -m 755 cosign-linux-amd64 /usr/local/bin/cosign && cosign version | grep GitVersion
# [เปลี่ยนไฟล์] download the release into its own folder (R = zetaphyd-<12 hex>, ARCH = amd64 or arm64)
R=zetaphyd-<12 hex>; ARCH=amd64; D=/tmp/$R; mkdir -p $D && cd $D
for f in zetaphyd-linux-$ARCH SHA256SUMS RELEASE.json zetaphyd-provenance.sigstore.json; do
  curl -fsSLO https://github.com/pospos191-alt/zetaphy/releases/download/$R/$f; done
# [เปลี่ยนไฟล์] the checker itself, from the commit the release names (read it: it is short)
C=$(jq -r .commit RELEASE.json)
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/verify-release.sh -o verify-release.sh
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/setup-node.sh -o setup.sh
# [อ่าน] verify with cosign (needs no account or token)
VERIFIER=cosign bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [อ่าน] the same with gh (needs `gh auth login` or GH_TOKEN, read-only)
VERIFIER=gh bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [เปลี่ยนไฟล์] install as usual (zetaphy-chain/README.md, ZETAPHYD_BIN=$D/zetaphyd-linux-$ARCH), then record it:
sudo VERIFIER=cosign bash verify-release.sh --dir $D --arch $ARCH --record     # writes /var/lib/zetaphy/installed-release.json
# [อ่าน] what is installed
sudo cat /var/lib/zetaphy/installed-release.json | jq '{tag, commit, main_commits, upgrades}'
```

Only "VERIFIED" at the end means every check passed. A `REFUSED:` line says which one did not; do not install.
When cosign or gh refused, the lines above it (`----- cosign exited 1; its last lines:`) are the tool's own reason
(wrong identity, no network, ...).

About cosign:

- **Size limit.** cosign refuses to check a file over 128 MiB by default, and `zetaphyd` is larger (about 160 MB).
  `verify-release.sh` sets `COSIGN_MAX_ATTACHMENT_SIZE=512MiB` for its cosign calls unless you set it yourself.
- **Versions.** cosign v3 reads the Sigstore bundle without `--new-bundle-format` (and warns that the flag is
  deprecated), so the script does not pass it; for cosign v2.4 to v2.x, which need it, it does. Checked against the
  release `zetaphyd-fd0f272aa982` with cosign v3.1.4, v2.5.3 and v2.4.3 (all three: VERIFIED).
- **No network to Sigstore's TUF host** (`tuf-repo-cdn.sigstore.dev`): cosign then cannot fetch the trusted root.
  `COSIGN_TRUSTED_ROOT=<trusted_root.json>` passes a copy (`--trusted-root`), e.g. from
  `https://raw.githubusercontent.com/sigstore/root-signing/main/targets/trusted_root.json`. Normal machines need nothing.

**What only CI / the VM can show**: the tests (`audit/tools/verify-release.test.js`) run the script on fake release
folders with stub `gh` / `cosign` / `curl` that accept only the right identity, so they prove the hashes, the identity
flags, the anti-rollback (with and without a record), the refusals, the freshness warnings and the cosign handling
(size limit, version flags, the tool's lines on refusal), not Sigstore itself. Run the commands above once on a VM (or a laptop) after each change to the signing.

### Installs and upgrades take only verified releases (`join-validator.sh`)

Internal review 2026-11-10, Z-04. `install.sh validator`, `zetaphy-validator update` and the 1-minute upgrade timer
(`upgrade-watch`) all go through `fetch_release`:

1. `setup-node.sh` at `REF` (default `main`) only names the release (`zetaphyd-<12 hex>`; `RELEASE_TAG=` pins
   another one). Nothing downloaded runs yet; everything lands in `/usr/local/lib/zetaphy-validator/incoming`.
2. The verifier is pinned in `join-validator.sh` itself: `verify-release.sh` by its sha256 (`VERIFY_RELEASE_SHA256`,
   kept in step by a test) and cosign (`COSIGN_VERSION`, per-architecture sha256 from cosign's checksum list),
   downloaded once and refused when the hash differs. `VERIFIER=gh` uses an installed, logged-in gh instead.
3. `verify-release.sh` checks the release (signature, hashes, `setup-node.sh` is the one the release was built
   from, not older than the installed release). Only then are the files moved into place and `setup-node.sh` run with
   the verified binary; afterwards the record (`/var/lib/zetaphy/installed-release.json`) is written, so the next
   update or upgrade cannot be older.
4. `/usr/local/bin/zetaphy-validator` is the file that is running (`install.sh` saves it first). Through a pipe
   (`curl ... | sudo bash`, no file) it is the copy at the signed release's commit whose sha256 `RELEASE.json`'s
   `scripts` names; with a release that lacks that field, nothing is fetched and the message says to use `install.sh`.
5. No signed release (an old one without `RELEASE.json`, or none yet): **refused**. `ALLOW_UNVERIFIED_INSTALL=1`
   is the deliberate exception (the old SHA256SUMS-only or build-from-source way), logged to the journal
   (`journalctl -t zetaphy-validator`) and to `/var/lib/zetaphy-validator/unverified-installs.log`. The upgrade timer
   ignores it.

The first download (`install.sh` and `join-validator.sh` from `main`) is where the trust starts. To pin it as well:
verify a release as in "On the VM", then run the `join-validator.sh` of its commit, checked against `RELEASE.json`:

```bash
# [เปลี่ยนไฟล์] after VERIFIED above, in $D
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/join-validator.sh -o join-validator.sh
echo "$(jq -r '.scripts["join-validator.sh"]' RELEASE.json)  join-validator.sh" | sha256sum -c -   # must print: OK
sudo REF=$C RELEASE_TAG=$R MONIKER=your-name bash join-validator.sh install
```

Not covered here: a binary pinned by the governance-voted upgrade plan (`Plan.Info`) itself; the signed release
of this repository's workflow on `main` is the anchor.

### Publishing setup-node.sh (cloud-init): publish first, then move the pin

Internal review 2026-11-10, Z-05. `cloud-init.sh` downloads `v/<sha256>.sh` from the public repository
`pospos191-alt/zetaphy-chain` and stops when it is not there. Workflow `cloud-init-published.yml` asks the public
repository (`audit/tools/cloud-init-published.sh`: `curl -fsI` on the pinned URL, then its sha256):

| When | What it does |
|---|---|
| pull request touching `setup-node.sh` / `cloud-init.sh` | a warning only (the file may be published later, before the merge) |
| push to `main`, every day, manual run | fails, and opens (or adds to) the issue "cloud-init.sh pins a setup-node.sh that is not published"; closes it once the file is there; a network error is only a warning |

The order for the owner, every time `setup-node.sh` changes:

1. In the pull request: `bash zetaphy-chain/pack-cloud-init.sh` (writes `cloud-init.sh` and `zetaphy-chain/public/`).
2. **Publish first**: copy `zetaphy-chain/public/v/<sha256>.sh` into the public repository's `v/`, unchanged, and push
   it (a file named by its own sha256 is never changed or deleted later). Check:
   `curl -fsI https://raw.githubusercontent.com/pospos191-alt/zetaphy-chain/main/v/<sha256>.sh` answers 200.
3. **Then** merge the pull request that moves the pin on `main`. `cloud-init-published` on `main` must pass.
4. After the merge: copy the same file over the public `setup-node.sh` (the "latest" copy) and `README.md`.

## L1-4: no dependency downgrades

`no-downgrade.yml` (pull requests and pushes to `main` that touch `setup-node.sh`, a `go.mod`, a lockfile or a workflow)
runs the unit tests and then `node audit/tools/no-downgrade.js --base-ref <base> --head-ref HEAD`. It compares every
version pin of the base commit with the head commit and fails when one goes down:

- `setup:<VAR>`: `GO_VERSION`, `*_VERSION`, `*_TAG` in `zetaphy-chain/setup-node.sh`;
- `gomod:<file>:…`: the `go` / `toolchain` directives and every `require` / `replace` target of each `go.mod` diff
  embedded in setup-node.sh's patch (`evmd/go.mod`, the root `go.mod`), read from the new side of the diff. A module the
  base patch itself pinned that the head patch drops falls back to the older upstream version, so it counts too
  (`pin removed`); unchanged upstream context lines that leave a hunk do not;
- plain `go.mod` files, `go-version:` in workflows (lowest and highest per file), the top-level packages of every
  `package-lock.json`, the highest version of each crate in every `Cargo.lock`.

Semver order, pre-releases and Go pseudo-versions included. A downgrade passes only with a reviewed line in
`audit/allow-downgrade.txt` (empty by default): `<key> <from> -> <to>  # <reason>` (the reason is required; `*` matches
any version). Locally: `node audit/tools/no-downgrade.js --base-ref origin/main`. Reversing the last Go bump
(`--base-ref HEAD --head-ref HEAD~3`) fails with 57 findings, as it should.

## U: the bug bounty (`ZetaphyBounty`)

A funded pool that pays whoever privately reports a real hole in the chain, the bridge or the contracts, so that
reporting pays more and more surely than exploiting. (`BugBounty.sol` is something else: sponsored fuzz jobs for
browsers.)

1. **Report privately** (SECURITY.md), then **commit** on chain: `commit(commitmentOf(reportHash, you, salt))` with the
   `reportBond`. `reportHash` = keccak256 of the report you sent. The commit's time is your proof of priority; it reveals
   nothing and a copy is useless (it is bound to your address).
2. **Reveal** within 90 days: `reveal(id, reportHash, salt)`. The content can stay private until a fix ships; publishing
   it later lets anyone check the hash.
3. **The committee** (members, a majority `threshold`) approves `approvePay(id, amount)`, `amount <= maxPayout`, **to
   the reporter only**, or `approveReject(id)`. A payout is scheduled with `eta = now + timelock` (>= 2 days); during the
   timelock the committee can still reject it. Then anyone calls `execute(id)`; the reporter calls `withdraw()` and
   receives the amount plus the bond.
4. **Caps**: at most `maxPayout` per report and `periodCap` per 30 days, and never more than the pool holds (scheduled
   payouts are reserved). **Pause**: any member pauses at once; unpausing takes the threshold and execution waits
   another timelock. **No admin key**: there is no sweep, rescue, owner or migration; members cannot report; a
   committee change (and setting the bond or the verifier) needs the threshold and the timelock and voids every approval
   collected before it. Donations (`fund()`) are final. A rejected or never revealed report's bond stays in the pool; a
   report left undecided for 180 days gets its bond back (`abandon`).
5. **Proof-of-exploit hook**: `IExploitVerifier.verify(id, reportHash, reporter, proof) -> (valid, amount)`. None exists
   yet (no ZK here). Once the committee sets one (threshold + timelock), `proveExploit(id, proof)` schedules the amount it
   supports, capped, through the same timelock and caps; the committee can still reject it.

Insurance: `HackInsurance` pays victims after an incident, this pays finders before one. They share no money: a deposit
into the insurance pool would give this contract withdrawable shares, so the bounty never makes one.
Nothing is deployed. To deploy on the testnet: members = the multisig owners (or the signers of `SimpleMultisig`),
threshold a majority, e.g. `maxPayout` 10 ZTPHY, `periodCap` 25 ZTPHY, `timelock` 2 days, bond 0.1 ZTPHY; see
`docs/BUG_BOUNTY.md` for what the testnet rewards mean (no real money).

## Q and F: your own proof, the rollback alarm, the forced exit

### In the wallet (what the alarm means for you)

Every 5 minutes, and on Refresh, the wallet takes a **checkpoint** of block H (the latest minus one) and keeps it **on
this device only**:

- block H as the node's EVM sees it (number, hash, state root);
- `eth_getProof` of your account at H, and of the loaded token's `balanceOf` slot (BridgedToken layout) at H;
- when the node's CometBFT RPC answers (default `<node address>/rpc/`, or the address you save in the card "Your own
  proof"): block H+1's **post-quantum finality certificate**, checked in the page with the same rule every node applies
  (ML-DSA-44 votes of more than 2/3 of the power for header H), and header H's `app_hash`, which must equal the EVM state
  root.

**The alarm** (a red box on top, in every language): the node now says the chain is at a **lower block** than one you
hold, shows **another state** for a block you hold, **no longer has** a block it showed you, or gives **two answers
that do not match** (EVM state root vs certified header, proof vs balance). While it is on, the wallet **refuses to
sign anything** (this page's key, the ZETAPHY Snap, MetaMask paths). What to do:

1. Do not sign elsewhere either until you know why. Click **Download my proofs** (one JSON file: the certified
   checkpoint, its proofs and certificate, the alarm).
2. Try another node (change the RPC). If the other node agrees with what you hold, the first one was lying.
3. Only if the ZETAPHY team **announced** a chain restart (a testnet reset), click **Accept the new chain**: it forgets
   the checkpoints (after a confirm) and signing works again.

Without a CometBFT RPC the wallet still keeps the proofs, just without a verified certificate (it says so). A node that
does not serve `eth_getProof` is a note in the card, never an alarm. A node one block behind another is not an alarm (only
blocks the wallet holds proofs for count for "lower").

### On the source chain: `ZetaphyForcedExit` + `HyperlaneLockBoxV2.forcedPay`

The escape hatch (docs/SAPHAN-SAFETY.md) needs ZETAPHY's validators to sign an exit root. If they do not within
**`FORCE_AFTER` (7 days) after escaping begins** (14 days without a heartbeat), holders exit on **their own proof**:

- **One height for every claim** (internal review 2026-11-12, Z-43): each heartbeat (`SaphanCheckpointer`, 224-byte
  body) carries ZETAPHY's block height next to the supply; the lockbox keeps it as `snapshotHeight`
  (`SaphanCheckpointer.lastHeight()` on ZETAPHY is the same number). Claims are of exactly that height: no earlier one,
  no later one. So each account counts once, in the same state the supply is of, and the claims add up to that state's
  balances. The older 192-byte heartbeat (no height) still keeps the route alive but clears the snapshot: no forced
  payout until a heartbeat with a height arrives.
- `prove(account, snapshotHeight, balance, proof)`: token(X)'s `balanceOf[account]` = `balance` in ZETAPHY's state at
  the snapshot height, whose app hash `StarkLightClient` finalized; IAVL path of key `0x02 || token || keccak256(account, 3)`
  and the multistore path of `evm` (the proof code of the proven releases). Anyone may prove for anyone; money only goes
  to the account. Once per account and snapshot. If a heartbeat came in between (ZETAPHY was back, then silent again),
  a claim of the old snapshot is not paid; a proof at the new one replaces it.
- `finalize(account)` after the 3-day window: the lockbox pays the account (`forcedPay` checks the height again), pro
  rata against the last heartbeat's token(X) supply (proof of reserves), once per address, never more owed in all than
  that supply. After the first forced payout no heartbeat or exit root is accepted, so the snapshot cannot move; an exit
  root that came in time closes the forced path.
- `src/forcedexit.js forcedExitArgs({ proof, height, holder, token, snapshotHeight })` turns an `eth_getProof(token,
  [slot], H)` answer (ICS23 ops) into `prove`'s arguments, after checking the key, the IAVL leaf spec, the `evm` store
  and (with `snapshotHeight`, from `ZetaphyForcedExit.snapshotHeight()`) that H is the snapshot height. The proof at
  block H verifies against `appHashAt(H)`, the app hash in header H. Get it from any archive node at the snapshot height;
  the wallet's own checkpoints are at other heights (see below).

Governance names the forced exit once (`setForcedExit`, never while escaping), like the checkpointer. Not covered:
releases queued on the lockbox and locks ZETAPHY never minted (the validators' exit root covers those).

### What the chain node would need for a complete forced exit (not changed here)

1. **Prove the cosmos/evm `eth_getProof` format on a devnet**: that `storageProof[].proof` is `[IAVL CommitmentProof, multistore CommitmentProof]`
   at IAVL version H-1 (so against header H's app hash), as `src/forcedexit.js` assumes. If not, a JSON-RPC
   `zetaphy_storageProof(address, slot, height)` returning exactly those two ICS23 existence proofs and the header height.
2. **`zetaphy_pqCertificate(height)`** on the EVM JSON-RPC (header H, block H+1's certificate tx, the validator set and
   vote keys at H), so wallets that only know the EVM RPC can keep the certificate without the CometBFT port.
3. Done: the heartbeat carries its height and claims are pinned to it. Still needed: StarkLightClient finalizing
   ZETAPHY on each source chain, at least every heartbeat's height (its prover must run; without the snapshot height in
   `appHashAt`, forced exits cannot start), and the wallet keeping its own `eth_getProof` at the last heartbeat's height
   (`SaphanCheckpointer.lastHeight()`), so a holder does not depend on an archive node.
4. Optional: token(X) checkpoints of a balances root in state, so one proof covers every holder (no per-account
   challenge needed).

## Tests (local results when this was written)

```
node --test audit/tools/no-downgrade.test.js      # 19 pass (12 mutation cases: each deliberate downgrade fails)
node --test audit/tools/verify-release.test.js    # 12 pass (Z-49: handler list without a record, no unsigned path, freshness; start-guard revert)
node --test audit/tools/join-validator-release.test.js   # 9 pass (installs only verified releases)
node --test audit/tools/cloud-init-published.test.js     # 7 pass (cloud-init pin is published)
cd zetaphy-network && node --test test/zetaphybounty.test.js test/forcedexit.test.js   # 10 + 9 pass
cd zetaphy-network && forge test --match-path 'audit/invariants/{ZetaphyBounty,ForcedExit}.inv.t.sol'   # 13 pass
cd zetaphy-wallet && npm test                      # 40 pass (3 new: rollback alarm)
```
