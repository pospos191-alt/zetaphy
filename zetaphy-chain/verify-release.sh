#!/usr/bin/env bash
# verify-release.sh: check a downloaded zetaphyd release BEFORE installing it (L1-3, docs/ANTI-ROLLBACK-OFFCHAIN.md).
#
#   1. hashes      the binary and RELEASE.json are listed in SHA256SUMS and match (a missing line is a failure,
#                  unlike `sha256sum -c --ignore-missing`)
#   2. signature   a Sigstore build-provenance attestation (made by .github/workflows/release-zetaphyd.yml, keyless,
#                  through GitHub's OIDC) covers the binary, SHA256SUMS and RELEASE.json, and its certificate says:
#                  this repository, that workflow file, ref refs/heads/main, the commit RELEASE.json names, a
#                  GitHub-hosted runner. Checked with `gh attestation verify` (or `cosign verify-blob-attestation`
#                  with the bundle shipped in the release, if gh is not installed).
#   3. no rollback RELEASE.json's position on main (main_commits) must not be lower than the installed release's, and
#                  it must carry every chain-upgrade handler the installed one carries (a binary without a handler the
#                  chain already ran cannot be the newer one). The installed release is the record this script
#                  writes with --record; without a record, every upgrade handler name found in the installed binary
#                  (zetaphy-v2, zetaphy-v3, ..., and the named ones: KNOWN_UPGRADES below and any the new release lists).
#                  RELEASE.json is required: there is no unsigned / legacy path.
#   4. freshness   warns when the release is old (commit_time more than MAX_RELEASE_AGE_DAYS days before now) or when the
#                  newest published release (its RELEASE.json, fetched when reachable) is further along main than this
#                  one: someone may be withholding a newer release. Offline: only the age check. Never fetched for
#                  trust: it can only add a warning (or a refusal with REQUIRE_FRESH=1).
#   5. optional    --setup <setup-node.sh>: the script's sha256 must be the one the release was built from.
#
# Usage
#   bash verify-release.sh --dir <download dir> [--arch amd64|arm64] [--repo owner/name] [--setup setup-node.sh]
#                          [--installed-bin /usr/local/bin/zetaphyd] [--record-file /var/lib/zetaphy/installed-release.json]
#                          [--record]       # after every check passed: write the record (run with sudo)
#   bash verify-release.sh --mark-refused [--installed-bin ...] [--record-file ...]
#                          after the start guard refused the recorded release and the node went back to the previous
#                          binary ($BIN.prev): marks the recorded release as refused on this node. The record keeps
#                          the refused release's position on main as the floor (never lowered: no downgrade path), and
#                          that exact release is not accepted again (RETRY_REFUSED=1 retries it on purpose).
# Environment: VERIFIER=auto|gh|cosign (default auto: gh if installed, else cosign)
#              COSIGN_MAX_ATTACHMENT_SIZE  cosign's size limit for a checked file (default here 512MiB; cosign's own
#                                 128MiB is smaller than a zetaphyd binary)
#              COSIGN_TRUSTED_ROOT=<trusted_root.json>  cosign: use this Sigstore trusted root instead of fetching
#                                 it (TUF) from tuf-repo-cdn.sigstore.dev (machines without that host)
#              ALLOW_ROLLBACK=1   accept an older release on purpose (the check still prints what is older)
#              MAX_RELEASE_AGE_DAYS=<n>  warn when the release's commit is older than n days (default 60)
#              LATEST_RELEASE_URL=<url>  where the newest release's RELEASE.json is (default: this repository's
#                                 releases/latest/download/RELEASE.json); OFFLINE=1 skips that fetch
#              REQUIRE_FRESH=1    a freshness warning refuses instead (automation that must not install a stale release)
#              RETRY_REFUSED=1    accept a release this node's start guard refused before (--mark-refused)
# Exit: 0 every check passed, 1 refused, 2 usage / missing tool.
# Reads only; changes nothing unless --record. Network: the verifier, and one GET of the newest release's RELEASE.json
# (OFFLINE=1: none). Nothing here needs a GitHub token except `gh attestation verify` without a bundle (it fetches
# the attestation from GitHub's API; `gh auth login` or GH_TOKEN, read-only is enough).
set -euo pipefail

REPO="pospos191-alt/zetaphy"
WORKFLOW_PATH=".github/workflows/release-zetaphyd.yml"
REF="refs/heads/main"
DIR=""
ARCH=""
SETUP=""
INSTALLED_BIN="/usr/local/bin/zetaphyd"
RECORD_FILE="/var/lib/zetaphy/installed-release.json"
RECORD=0
MARK_REFUSED=0
VERIFIER="${VERIFIER:-auto}"
# Upgrade handlers with a name instead of a number (setup-node.sh's Zetaphy*UpgradeName). Probed in an installed binary
# when there is no record yet; add each new named handler here (zetaphy-vN are found by pattern).
KNOWN_UPGRADES="zetaphy-firewall zetaphy-guard zetaphy-shield"

usage() { sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
die() { echo "REFUSED: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1 ($2)" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --setup) SETUP="$2"; shift 2 ;;
    --installed-bin) INSTALLED_BIN="$2"; shift 2 ;;
    --record-file) RECORD_FILE="$2"; shift 2 ;;
    --record) RECORD=1; shift ;;
    --mark-refused) MARK_REFUSED=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
need_early() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 2; }; }
# ---------------------------------------------------------------- --mark-refused (after a start-guard revert)
# The start guard refused the recorded release and the node now runs the previous binary again. The record must not
# move down (that would let an older release in), so it keeps the refused release's fields as the floor and only
# adds: refused[] (commit, position, binary sha256: this exact release is not taken again) and running_binary_sha256
# (what actually runs). The next release must still be at least as far along main as the refused one.
if [ "$MARK_REFUSED" = 1 ]; then
  need_early jq; need_early sha256sum
  [ -f "$RECORD_FILE" ] || { echo "REFUSED: no record at $RECORD_FILE: nothing to mark" >&2; exit 1; }
  jq -e '(.main_commits|type=="number") and (.upgrades|type=="array") and (.commit|type=="string")' "$RECORD_FILE" >/dev/null 2>&1 \
    || { echo "REFUSED: $RECORD_FILE is not a release record" >&2; exit 1; }
  [ -f "$INSTALLED_BIN" ] || { echo "REFUSED: $INSTALLED_BIN not found" >&2; exit 1; }
  running=$(sha256sum "$INSTALLED_BIN" | cut -d' ' -f1)
  if [ "$running" = "$(jq -r '.binary_sha256 // ""' "$RECORD_FILE")" ]; then
    echo "REFUSED: $INSTALLED_BIN is the recorded release itself (no revert happened): nothing marked" >&2; exit 1
  fi
  tmp="$RECORD_FILE.tmp.$$"
  jq --arg run "$running" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.refused = (((.refused // []) + [{commit, main_commits, tag, binary_sha256, at: $at}]) | unique_by(.commit + (.binary_sha256 // "")))
     | .running_binary_sha256 = $run' "$RECORD_FILE" > "$tmp"
  mv "$tmp" "$RECORD_FILE"
  echo "ok    marked $(jq -r .tag "$RECORD_FILE") (#$(jq -r .main_commits "$RECORD_FILE")) as refused by the start guard; the floor stays at #$(jq -r .main_commits "$RECORD_FILE"); running $running"
  exit 0
fi
[ -n "$DIR" ] || usage
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in x86_64|amd64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "unknown machine $(uname -m): pass --arch" >&2; exit 2 ;; esac
fi
case "$ARCH" in amd64|arm64) ;; *) echo "--arch must be amd64 or arm64" >&2; exit 2 ;; esac
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "--repo must be owner/name" >&2; exit 2; }
need sha256sum "coreutils"
need jq "apt-get install -y jq"

BIN_NAME="zetaphyd-linux-$ARCH"
BIN="$DIR/$BIN_NAME"
SUMS="$DIR/SHA256SUMS"
MANIFEST="$DIR/RELEASE.json"
BUNDLE="$DIR/zetaphyd-provenance.sigstore.json"
[ -f "$BIN" ] || die "$BIN not found"
[ -f "$SUMS" ] || die "$SUMS not found"

ok() { echo "ok    $*"; }

# Runs a verifier with its output kept; on failure its last lines are shown (why it refused: wrong identity, size
# limit, no network, ...), then the caller refuses. On success nothing of it is printed.
TOOL_LOG=""
cleanup() { [ -z "$TOOL_LOG" ] || rm -f "$TOOL_LOG"; }
trap cleanup EXIT
run_tool() {
  local name="$1" rc=0; shift
  [ -n "$TOOL_LOG" ] || TOOL_LOG=$(mktemp)
  "$@" >"$TOOL_LOG" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "----- $name exited $rc; its last lines:" >&2
    tail -n "${TOOL_LINES:-20}" "$TOOL_LOG" | sed 's/^/  | /' >&2
  fi
  return "$rc"
}

# ---------------------------------------------------------------- 1. hashes
sum_of() { # the hash SHA256SUMS lists for a file name (exactly one line, else empty)
  awk -v f="$1" '{ n=$2; sub(/^\*/, "", n) } n == f { print $1; c++ } END { if (c != 1) exit 1 }' "$SUMS"
}
check_hash() {
  local f="$1" want got
  want=$(sum_of "$f") || die "SHA256SUMS has no single line for $f"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "SHA256SUMS line for $f is not a sha256"
  got=$(sha256sum "$DIR/$f" | cut -d' ' -f1)
  [ "$got" = "$want" ] || die "$f: sha256 $got, SHA256SUMS says $want"
  ok "sha256 $f $got"
}
check_hash "$BIN_NAME"

# RELEASE.json is required (internal review 2026-11-12, Z-49): without it there is no commit to bind the signature to
# and nothing to compare with the installed release, so a missing file must never lower the bar.
[ -f "$MANIFEST" ] || die "no RELEASE.json in $DIR: not a signed release (or files missing); there is no unsigned path"
check_hash RELEASE.json

# ---------------------------------------------------------------- RELEASE.json
jq -e . "$MANIFEST" >/dev/null 2>&1 || die "RELEASE.json is not JSON"
[ "$(jq -r .schema "$MANIFEST")" = "zetaphy-release/v1" ] || die "RELEASE.json: unknown schema"
[ "$(jq -r .repository "$MANIFEST")" = "$REPO" ] || die "RELEASE.json: built from $(jq -r .repository "$MANIFEST"), not $REPO"
[ "$(jq -r .ref "$MANIFEST")" = "$REF" ] || die "RELEASE.json: built from $(jq -r .ref "$MANIFEST"), not $REF"
COMMIT=$(jq -r .commit "$MANIFEST")
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE.json: bad commit"
jq -e '(.main_commits|type=="number") and (.commit_time|type=="number") and (.upgrades|type=="array")' "$MANIFEST" >/dev/null \
  || die "RELEASE.json: main_commits, commit_time or upgrades missing"
SETUP_SHA=$(jq -r .setup_node_sha256 "$MANIFEST")
[ "$(jq -r .tag "$MANIFEST")" = "zetaphyd-${SETUP_SHA:0:12}" ] || die "RELEASE.json: tag does not match setup_node_sha256"
ok "RELEASE.json $(jq -r .tag "$MANIFEST"), commit $COMMIT, #$(jq -r .main_commits "$MANIFEST") on main, upgrades $(jq -c .upgrades "$MANIFEST")"
if [ -n "$SETUP" ]; then
  got=$(sha256sum "$SETUP" | cut -d' ' -f1)
  [ "$got" = "$SETUP_SHA" ] || die "$SETUP has sha256 $got; this release was built from $SETUP_SHA"
  ok "setup-node.sh $got is the one this release was built from"
fi

# ---------------------------------------------------------------- 2. signature
if [ "$VERIFIER" = auto ]; then
  if command -v gh >/dev/null 2>&1; then VERIFIER=gh
  elif command -v cosign >/dev/null 2>&1; then VERIFIER=cosign
  else echo "missing tool: gh (https://cli.github.com) or cosign (https://github.com/sigstore/cosign/releases), both free" >&2; exit 2
  fi
fi
# cosign flags that depend on its version (asked once): v2.4-v2.x read the Sigstore bundle only with
# --new-bundle-format; v3 reads nothing else and warns that the flag is deprecated. An unreadable version: v3.
COSIGN_EXTRA=()
COSIGN_ASKED=0
cosign_flags() {
  [ "$COSIGN_ASKED" = 0 ] || return 0
  COSIGN_ASKED=1
  local major
  major=$(cosign version 2>&1 | sed -n 's/^GitVersion: *v\{0,1\}\([0-9][0-9]*\)\..*/\1/p' | head -n 1)
  if [ -n "$major" ] && [ "$major" -lt 3 ]; then COSIGN_EXTRA+=(--new-bundle-format); fi
  if [ -n "${COSIGN_TRUSTED_ROOT:-}" ]; then
    [ -f "$COSIGN_TRUSTED_ROOT" ] || { echo "COSIGN_TRUSTED_ROOT: $COSIGN_TRUSTED_ROOT not found" >&2; exit 2; }
    COSIGN_EXTRA+=(--trusted-root "$COSIGN_TRUSTED_ROOT")
  fi
  return 0
}
for f in "$BIN_NAME" SHA256SUMS RELEASE.json; do
  case "$VERIFIER" in
    gh)
      need gh "https://cli.github.com"
      args=(attestation verify "$DIR/$f" --repo "$REPO" --signer-workflow "$REPO/$WORKFLOW_PATH" --source-ref "$REF"
            --deny-self-hosted-runners --predicate-type "https://slsa.dev/provenance/v1" --source-digest "$COMMIT")
      [ -f "$BUNDLE" ] && args+=(--bundle "$BUNDLE")
      run_tool gh gh "${args[@]}" || die "$f: no valid attestation from $REPO/$WORKFLOW_PATH on $REF at $COMMIT"
      ;;
    cosign)
      need cosign "https://github.com/sigstore/cosign/releases"
      [ -f "$BUNDLE" ] || die "cosign needs the bundle $BUNDLE (or install gh)"
      cosign_flags
      COSIGN_MAX_ATTACHMENT_SIZE="${COSIGN_MAX_ATTACHMENT_SIZE:-512MiB}" \
      run_tool cosign cosign verify-blob-attestation --bundle "$BUNDLE" "${COSIGN_EXTRA[@]}" --type slsaprovenance1 \
        --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
        --certificate-identity "https://github.com/$REPO/$WORKFLOW_PATH@$REF" \
        --certificate-github-workflow-repository "$REPO" --certificate-github-workflow-ref "$REF" \
        --certificate-github-workflow-sha "$COMMIT" "$DIR/$f" \
        || die "$f: the bundle's signature does not verify for $REPO/$WORKFLOW_PATH@$REF at $COMMIT"
      ;;
    *) echo "VERIFIER must be auto, gh or cosign" >&2; exit 2 ;;
  esac
  ok "signed: $f (Sigstore, $REPO/$WORKFLOW_PATH@$REF, commit ${COMMIT:0:12}, $VERIFIER)"
done

# ---------------------------------------------------------------- 3. no rollback
rollback() {
  if [ "${ALLOW_ROLLBACK:-0}" = 1 ]; then echo "WARN  $* (ALLOW_ROLLBACK=1: accepted on purpose)"; else die "$* (an older release: ALLOW_ROLLBACK=1 only for a deliberate rollback)"; fi
}
new_seq=$(jq -r .main_commits "$MANIFEST")
if [ -f "$RECORD_FILE" ]; then
  jq -e '(.main_commits|type=="number") and (.upgrades|type=="array")' "$RECORD_FILE" >/dev/null 2>&1 || die "$RECORD_FILE is not a release record"
  old_seq=$(jq -r .main_commits "$RECORD_FILE")
  old_commit=$(jq -r .commit "$RECORD_FILE")
  if [ "$new_seq" -lt "$old_seq" ]; then rollback "release #$new_seq on main is older than the installed #$old_seq ($old_commit)"
  elif [ "$new_seq" -eq "$old_seq" ] && [ "$COMMIT" != "$old_commit" ]; then rollback "release #$new_seq is a different commit than the installed one at the same position ($old_commit): main was rewritten?"
  else ok "not older: #$new_seq on main >= installed #$old_seq"
  fi
  missing=$(jq -r --slurpfile n "$MANIFEST" '.upgrades - $n[0].upgrades | .[]' "$RECORD_FILE")
  # a release this node's start guard refused (--mark-refused): not again, unless on purpose
  bin_sha=$(sha256sum "$BIN" | cut -d' ' -f1)
  if jq -e --arg c "$COMMIT" --arg b "$bin_sha" '(.refused // []) | any(.commit == $c or .binary_sha256 == $b)' "$RECORD_FILE" >/dev/null; then
    if [ "${RETRY_REFUSED:-0}" = 1 ]; then echo "WARN  this node's start guard refused this release before (RETRY_REFUSED=1: tried again on purpose)"
    else die "this node's start guard refused this release before (it went back to the previous binary); install a newer release, or RETRY_REFUSED=1 on purpose"
    fi
  fi
  if [ -n "$(jq -r '.running_binary_sha256 // ""' "$RECORD_FILE")" ]; then
    echo "note  this node runs its previous binary after a start-guard revert; the floor stays at the refused #$old_seq"
  fi
elif [ -x "$INSTALLED_BIN" ]; then
  # No record yet (a node installed before records existed): every upgrade handler name the installed binary
  # carries must be in this release too (internal review 2026-11-12, Z-49: not only the highest zetaphy-vN, so a
  # release that drops a named handler or one in the middle is refused). Probed: zetaphy-vN for N >= 2 (zetaphy-v1 is
  # the genesis version, not a handler), KNOWN_UPGRADES and every name this release lists.
  installed=$( { grep -aoE 'zetaphy-v[0-9]+' "$INSTALLED_BIN" | awk -F'-v' '$2 + 0 >= 2' || true
                 for n in $KNOWN_UPGRADES $(jq -r '.upgrades[]' "$MANIFEST"); do if grep -aqF -- "$n" "$INSTALLED_BIN"; then echo "$n"; fi; done
               } | sort -u)
  missing=$(comm -23 <(echo "$installed" | sed '/^$/d') <(jq -r '.upgrades[]' "$MANIFEST" | sort -u))
  echo "note  no record at $RECORD_FILE: compared with the upgrade handler names in $INSTALLED_BIN ($(echo ${installed:-none}))"
else
  missing=""
  echo "note  nothing installed yet (no $RECORD_FILE, no $INSTALLED_BIN): first install"
fi
if [ -n "$missing" ]; then rollback "the installed release carries upgrade handler(s) this one lacks: $(echo $missing)"
else ok "carries every upgrade handler of the installed release"
fi

# ---------------------------------------------------------------- 4. freshness
# A signed release can still be an old one that someone serves instead of the newest (a freeze: the node never learns
# about the fix). Two signals, neither needs the network to pass: the release's age, and, when reachable, the newest
# published release's position on main. Both only warn (REQUIRE_FRESH=1: refuse); the fetched file is never trusted
# for anything else.
stale() {
  if [ "${REQUIRE_FRESH:-0}" = 1 ]; then die "$* (REQUIRE_FRESH=1)"; else echo "WARN  $*"; fi
}
max_age=${MAX_RELEASE_AGE_DAYS:-60}
[[ "$max_age" =~ ^[0-9]+$ ]] || { echo "MAX_RELEASE_AGE_DAYS must be a number of days" >&2; exit 2; }
age_days=$(( ($(date +%s) - $(jq -r .commit_time "$MANIFEST")) / 86400 ))
if [ "$age_days" -gt "$max_age" ]; then stale "this release's commit is $age_days days old (more than $max_age): check that no newer release exists"
else ok "release age $age_days days (at most $max_age)"
fi
LATEST_URL=${LATEST_RELEASE_URL:-https://github.com/$REPO/releases/latest/download/RELEASE.json}
if [ "${OFFLINE:-0}" = 1 ]; then
  echo "note  OFFLINE=1: the newest published release was not looked up"
elif ! command -v curl >/dev/null 2>&1; then
  echo "note  no curl: the newest published release was not looked up"
else
  [ -n "$TOOL_LOG" ] || TOOL_LOG=$(mktemp)
  if curl -fsSL --max-time "${LATEST_TIMEOUT:-10}" --max-filesize 65536 -o "$TOOL_LOG" "$LATEST_URL" 2>/dev/null \
    && jq -e --arg r "$REPO" '.schema == "zetaphy-release/v1" and .repository == $r and (.main_commits|type=="number" and . >= 0 and . == floor)' "$TOOL_LOG" >/dev/null 2>&1; then
    latest_seq=$(jq -r .main_commits "$TOOL_LOG")
    latest_tag=$(jq -r '(.tag // "?") | tostring | gsub("[^A-Za-z0-9._-]"; "")' "$TOOL_LOG")
    if [ "$latest_seq" -gt "$new_seq" ]; then
      stale "a newer release is published: $latest_tag (#$latest_seq on main; this one is #$new_seq)"
    else ok "the newest published release ($latest_tag, #$latest_seq) is not further along main than this one"
    fi
  else
    echo "note  could not read the newest published release ($LATEST_URL): offline? only the age was checked"
  fi
fi

# ---------------------------------------------------------------- record
if [ "$RECORD" = 1 ]; then
  mkdir -p "$(dirname "$RECORD_FILE")"
  tmp="$RECORD_FILE.tmp.$$"
  # the start-guard refusals stay in the record (history), the new release becomes the floor and what runs
  refused='[]'
  [ -f "$RECORD_FILE" ] && refused=$(jq -c '.refused // []' "$RECORD_FILE" 2>/dev/null || echo '[]')
  jq --arg sha "$(sha256sum "$BIN" | cut -d' ' -f1)" --arg arch "$ARCH" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson refused "$refused" \
    '. + {binary_sha256: $sha, arch: $arch, recorded_at: $at} + (if ($refused|length) > 0 then {refused: $refused} else {} end)' "$MANIFEST" > "$tmp"
  mv "$tmp" "$RECORD_FILE"
  ok "recorded $RECORD_FILE (the next install must not be older)"
fi
echo "VERIFIED $BIN_NAME (commit $COMMIT)"
