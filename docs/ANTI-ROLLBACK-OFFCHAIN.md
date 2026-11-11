**English** | [ภาษาไทย](ANTI-ROLLBACK-OFFCHAIN.th.md)

# Anti-rollback and anti-takeover: the off-chain half

**Testnet only, not audited.** The chain-side guards (start guard, sign record, no crypto downgrade, voting-power cap,
circuit breaker) are in [ANTI-ROLLBACK-CHAIN.md](ANTI-ROLLBACK-CHAIN.md). This page is everything around the chain:
the binaries nodes install, the dependencies we build them from, what a finder earns, and what each user keeps.

| Item | Stops | Where | Tests |
|---|---|---|---|
| L1-3 signed releases | a node installing a binary that this repository's release workflow did not build from `main`, or an older one | `.github/workflows/release-zetaphyd.yml` (job `sign`), [`zetaphy-chain/verify-release.sh`](../zetaphy-chain/verify-release.sh) | `node --test audit/tools/verify-release.test.js` (workflow `verify-release.yml`) |
| L1-4 no dependency downgrades | a pull request that quietly moves Go, a Go module, an npm or Cargo package back to an older (vulnerable) version | [`audit/tools/no-downgrade.js`](../audit/tools/no-downgrade.js), [`audit/allow-downgrade.txt`](../audit/allow-downgrade.txt), workflow `no-downgrade.yml` | `node --test audit/tools/no-downgrade.test.js` (incl. the mutation test) |
| U bug bounty | an attack paying more than reporting it | [`ZetaphyBounty.sol`](../zetaphy-network/contracts/ZetaphyBounty.sol) | `test/zetaphybounty.test.js`, `audit/invariants/ZetaphyBounty.inv.t.sol` |
| Q your own proof + forced exit | ZETAPHY's validators censoring, stopping or rolling back while bridged funds are locked on the source chain | [`ZetaphyForcedExit.sol`](../zetaphy-network/contracts/ZetaphyForcedExit.sol), `HyperlaneLockBoxV2.forcedPay`, [`src/forcedexit.js`](../zetaphy-network/src/forcedexit.js) | `test/forcedexit.test.js`, `audit/invariants/ForcedExit.inv.t.sol` |
| F rollback alarm (wallet) | a node (or a rolled-back chain) showing the user a lower block or another state than one the wallet already holds | [`zetaphy-wallet/rollback.js`](../zetaphy-wallet/rollback.js), `app.js` | `zetaphy-wallet/test/wallet.e2e.js` ("rollback alarm") |

## L1-3: signed releases

`release-zetaphyd.yml` builds `zetaphyd-linux-amd64` / `-arm64` as before. A separate job **`sign`** (the only job with
`id-token: write` and `attestations: write`; it cannot publish) then writes

- `RELEASE.json`: what the release is: `tag` (`zetaphyd-<first 12 hex of setup-node.sh's sha256>`), `setup_node_sha256`,
  `commit`, `ref` (`refs/heads/main`), `main_commits` (the commit's position on `main`: `git rev-list --count`),
  `commit_time`, `upgrades` (the chain-upgrade handlers in the patch: `zetaphy-v2` … `zetaphy-guard`);
- `SHA256SUMS` over the binaries and `RELEASE.json`;
- one **Sigstore build-provenance attestation** (`actions/attest-build-provenance`, keyless: GitHub's OIDC token gets a
  short-lived Fulcio certificate naming this repository, the workflow file, the ref and the commit; free) over every
  binary, `SHA256SUMS` and `RELEASE.json`, and its bundle `zetaphyd-provenance.sigstore.json`.

The job `release` (environment `release`, only `contents: write`) checks the hashes and publishes all of them. A release
made before signing existed keeps its files; a re-run on the same tag adds the signed files (`--clobber`).

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
   of the installed release must be in the new one. Without a record yet: the highest `zetaphy-vN` named in the
   installed binary must be in the new release. `ALLOW_ROLLBACK=1` accepts an older release on purpose (still printed).
4. A release from before signing (no `RELEASE.json`) is refused; `ALLOW_UNSIGNED=1` accepts it with the binary's own
   attestation only and no rollback check. Exit 0 = verified, 1 = refused, 2 = usage / tool missing.

`setup-node.sh`'s own `UPGRADE_CHECK` (the binary must run the next block of this node's chain) and the start guard
still apply after install; this check runs before anything is installed.

### On the VM

**[อ่าน]** = only reads; **[เปลี่ยนไฟล์]** = writes files (as in [CHAIN-FIREWALL.md](CHAIN-FIREWALL.md)).

```bash
# [อ่าน] tools: gh (https://cli.github.com) or cosign; jq; both verifiers are free
command -v gh cosign jq sha256sum
# [เปลี่ยนไฟล์] download the release into its own folder (R = zetaphyd-<12 hex>, ARCH = amd64 or arm64)
R=zetaphyd-<12 hex>; ARCH=amd64; D=/tmp/$R; mkdir -p $D && cd $D
for f in zetaphyd-linux-$ARCH SHA256SUMS RELEASE.json zetaphyd-provenance.sigstore.json; do
  curl -fsSLO https://github.com/pospos191-alt/zetaphy/releases/download/$R/$f; done
# [เปลี่ยนไฟล์] the checker itself, from the commit the release names (read it: it is short)
C=$(jq -r .commit RELEASE.json)
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/verify-release.sh -o verify-release.sh
curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/$C/zetaphy-chain/setup-node.sh -o setup.sh
# [อ่าน] verify (gh needs `gh auth login` or GH_TOKEN, read-only; cosign needs nothing)
bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [อ่าน] the same with cosign instead of gh
VERIFIER=cosign bash verify-release.sh --dir $D --arch $ARCH --setup setup.sh
# [เปลี่ยนไฟล์] install as usual (zetaphy-chain/README.md, ZETAPHYD_BIN=$D/zetaphyd-linux-$ARCH), then record it:
sudo bash verify-release.sh --dir $D --arch $ARCH --record     # writes /var/lib/zetaphy/installed-release.json
# [อ่าน] what is installed
sudo cat /var/lib/zetaphy/installed-release.json | jq '{tag, commit, main_commits, upgrades}'
```

Only "VERIFIED" at the end means every check passed. A `REFUSED:` line says which one did not; do not install.

**What only CI / the VM can show**: a real Sigstore signature exists only after the first run of `sign` on `main`. The
tests (`audit/tools/verify-release.test.js`) run the script on fake release folders with stub `gh` / `cosign` that accept
only the right identity, so they prove the hashes, the identity flags, the anti-rollback and the refusals, not
Sigstore itself. After the first signed release, run the commands above once on a VM (or a laptop) to confirm.

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

- `prove(account, height, balance, proof)`: token(X)'s `balanceOf[account]` = `balance` in ZETAPHY's state at `height`,
  whose app hash `StarkLightClient` finalized; IAVL path of key `0x02 || token || keccak256(account, 3)` and the
  multistore path of `evm` (the proof code of the proven releases). Anyone may prove for anyone; money only goes to the
  account. A **later finalized height replaces an earlier one** (anyone, until paid): a stale proof (a balance spent
  since) is corrected by whoever holds a newer one, e.g. any archive node, within the 3-day challenge window.
- `finalize(account)` after the window: the lockbox pays the account, pro rata against the last heartbeat's token(X)
  supply (proof of reserves), once per address, never more owed in all than that supply. After the first forced payout
  no exit root is accepted; an exit root that came in time closes the forced path.
- `src/forcedexit.js forcedExitArgs({ proof, height, holder, token })` turns the wallet's stored `eth_getProof(token,
  [slot], H)` answer (ICS23 ops) into `prove`'s arguments, after checking the key, the IAVL leaf spec and the `evm` store.
  The proof at block H verifies against `appHashAt(H)`, the app hash in header H, which the PQ certificate in block H+1
  certifies.

Governance names the forced exit once (`setForcedExit`, never while escaping), like the checkpointer. Not covered:
releases queued on the lockbox and locks ZETAPHY never minted (the validators' exit root covers those).

### What the chain node would need for a complete forced exit (not changed here)

1. **Prove the cosmos/evm `eth_getProof` format on a devnet**: that `storageProof[].proof` is `[IAVL CommitmentProof, multistore CommitmentProof]`
   at IAVL version H-1 (so against header H's app hash), as `src/forcedexit.js` assumes. If not, a JSON-RPC
   `zetaphy_storageProof(address, slot, height)` returning exactly those two ICS23 existence proofs and the header height.
2. **`zetaphy_pqCertificate(height)`** on the EVM JSON-RPC (header H, block H+1's certificate tx, the validator set and
   vote keys at H), so wallets that only know the EVM RPC can keep the certificate without the CometBFT port.
3. **A heartbeat that carries a finalized height** (SaphanCheckpointer body: add `block.number`), so the lockbox can set
   a floor under the heights `prove` accepts (today any finalized height is accepted and stale claims rely on newer
   proofs); and StarkLightClient finalizing ZETAPHY regularly on each source chain (its prover must run; without it,
   `appHashAt` has nothing and forced exits cannot start).
4. Optional: token(X) checkpoints of a balances root in state, so one proof covers every holder (no per-account
   challenge needed).

## Tests (local results when this was written)

```
node --test audit/tools/no-downgrade.test.js      # 19 pass (12 mutation cases: each deliberate downgrade fails)
node --test audit/tools/verify-release.test.js    # 7 pass
cd zetaphy-network && node --test test/zetaphybounty.test.js test/forcedexit.test.js   # 10 + 7 pass
cd zetaphy-network && forge test --match-path 'audit/invariants/{ZetaphyBounty,ForcedExit}.inv.t.sol'   # 8 pass
cd zetaphy-wallet && npm test                      # 40 pass (3 new: rollback alarm)
```
