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
#                  writes with --record; without a record, the upgrade names found in the installed binary.
#   4. optional    --setup <setup-node.sh>: the script's sha256 must be the one the release was built from.
#
# Usage
#   bash verify-release.sh --dir <download dir> [--arch amd64|arm64] [--repo owner/name] [--setup setup-node.sh]
#                          [--installed-bin /usr/local/bin/zetaphyd] [--record-file /var/lib/zetaphy/installed-release.json]
#                          [--record]       # after every check passed: write the record (run with sudo)
# Environment: VERIFIER=auto|gh|cosign (default auto: gh if installed, else cosign)
#              ALLOW_ROLLBACK=1   accept an older release on purpose (the check still prints what is older)
#              ALLOW_UNSIGNED=1   accept a release published before signing existed (no RELEASE.json / bundle):
#                                 hashes and gh attestation of the binary only, no rollback check. Avoid.
# Exit: 0 every check passed, 1 refused, 2 usage / missing tool.
# Reads only; changes nothing unless --record. Nothing here needs a GitHub token except `gh attestation verify`
# without a bundle (it fetches the attestation from GitHub's API; `gh auth login` or GH_TOKEN, read-only is enough).
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
VERIFIER="${VERIFIER:-auto}"

usage() { sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
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
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
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

LEGACY=0
if [ ! -f "$MANIFEST" ]; then
  [ "${ALLOW_UNSIGNED:-0}" = 1 ] || die "no RELEASE.json: a release from before signing (or files missing). ALLOW_UNSIGNED=1 accepts it without the rollback check"
  LEGACY=1
  echo "WARN  no RELEASE.json (ALLOW_UNSIGNED=1): no rollback check; only the binary's own attestation is checked"
else
  check_hash RELEASE.json
fi

# ---------------------------------------------------------------- RELEASE.json
COMMIT=""
if [ "$LEGACY" = 0 ]; then
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
fi

# ---------------------------------------------------------------- 2. signature
if [ "$VERIFIER" = auto ]; then
  if command -v gh >/dev/null 2>&1; then VERIFIER=gh
  elif command -v cosign >/dev/null 2>&1; then VERIFIER=cosign
  else echo "missing tool: gh (https://cli.github.com) or cosign (https://github.com/sigstore/cosign/releases), both free" >&2; exit 2
  fi
fi
SIGNED=("$BIN_NAME")
[ "$LEGACY" = 0 ] && SIGNED+=(SHA256SUMS RELEASE.json)
for f in "${SIGNED[@]}"; do
  case "$VERIFIER" in
    gh)
      need gh "https://cli.github.com"
      args=(attestation verify "$DIR/$f" --repo "$REPO" --signer-workflow "$REPO/$WORKFLOW_PATH" --source-ref "$REF"
            --deny-self-hosted-runners --predicate-type "https://slsa.dev/provenance/v1")
      [ -n "$COMMIT" ] && args+=(--source-digest "$COMMIT")
      [ -f "$BUNDLE" ] && args+=(--bundle "$BUNDLE")
      gh "${args[@]}" >/dev/null || die "$f: no valid attestation from $REPO/$WORKFLOW_PATH on $REF${COMMIT:+ at $COMMIT}"
      ;;
    cosign)
      need cosign "https://github.com/sigstore/cosign/releases"
      [ -f "$BUNDLE" ] || die "cosign needs the bundle $BUNDLE (or install gh)"
      [ -n "$COMMIT" ] || die "cosign: no commit to bind (RELEASE.json missing)"
      cosign verify-blob-attestation --bundle "$BUNDLE" --new-bundle-format --type slsaprovenance1 \
        --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
        --certificate-identity "https://github.com/$REPO/$WORKFLOW_PATH@$REF" \
        --certificate-github-workflow-repository "$REPO" --certificate-github-workflow-ref "$REF" \
        --certificate-github-workflow-sha "$COMMIT" "$DIR/$f" >/dev/null 2>&1 \
        || die "$f: the bundle's signature does not verify for $REPO/$WORKFLOW_PATH@$REF at $COMMIT"
      ;;
    *) echo "VERIFIER must be auto, gh or cosign" >&2; exit 2 ;;
  esac
  ok "signed: $f (Sigstore, $REPO/$WORKFLOW_PATH@$REF${COMMIT:+, commit ${COMMIT:0:12}}, $VERIFIER)"
done

# ---------------------------------------------------------------- 3. no rollback
if [ "$LEGACY" = 0 ]; then
  rollback() {
    if [ "${ALLOW_ROLLBACK:-0}" = 1 ]; then echo "WARN  $* (ALLOW_ROLLBACK=1: accepted on purpose)"; else die "$* (an older release: ALLOW_ROLLBACK=1 only for a deliberate rollback)"; fi
  }
  new_seq=$(jq -r .main_commits "$MANIFEST")
  if [ -f "$RECORD_FILE" ]; then
    jq -e '.main_commits|type=="number"' "$RECORD_FILE" >/dev/null 2>&1 || die "$RECORD_FILE is not a release record"
    old_seq=$(jq -r .main_commits "$RECORD_FILE")
    old_commit=$(jq -r .commit "$RECORD_FILE")
    if [ "$new_seq" -lt "$old_seq" ]; then rollback "release #$new_seq on main is older than the installed #$old_seq ($old_commit)"
    elif [ "$new_seq" -eq "$old_seq" ] && [ "$COMMIT" != "$old_commit" ]; then rollback "release #$new_seq is a different commit than the installed one at the same position ($old_commit): main was rewritten?"
    else ok "not older: #$new_seq on main >= installed #$old_seq"
    fi
    missing=$(jq -r --slurpfile n "$MANIFEST" '.upgrades - $n[0].upgrades | .[]' "$RECORD_FILE")
  elif [ -x "$INSTALLED_BIN" ]; then
    # no record yet: the highest zetaphy-vN upgrade handler named in the installed binary must be in this release
    # too (only the highest: a stray lower string in the binary cannot cause a false refusal)
    vmax() { grep -oE 'zetaphy-v[0-9]+' | sed 's/zetaphy-v//' | sort -n | tail -1; }
    old_v=$(grep -aoE 'zetaphy-v[0-9]+' "$INSTALLED_BIN" | vmax || true)
    new_v=$(jq -r '.upgrades[]' "$MANIFEST" | vmax || true)
    missing=""
    if [ -n "$old_v" ] && { [ -z "$new_v" ] || [ "$new_v" -lt "$old_v" ]; }; then missing="zetaphy-v$old_v"; fi
    echo "note  no record at $RECORD_FILE: compared with the upgrade names in $INSTALLED_BIN (installed up to zetaphy-v${old_v:-?}, this release up to zetaphy-v${new_v:-?})"
  else
    missing=""
    echo "note  nothing installed yet (no $RECORD_FILE, no $INSTALLED_BIN): first install"
  fi
  if [ -n "$missing" ]; then rollback "the installed release carries upgrade handler(s) this one lacks: $(echo $missing)"
  else ok "carries every upgrade handler of the installed release"
  fi
fi

# ---------------------------------------------------------------- record
if [ "$RECORD" = 1 ]; then
  [ "$LEGACY" = 0 ] || die "--record needs RELEASE.json"
  mkdir -p "$(dirname "$RECORD_FILE")"
  tmp="$RECORD_FILE.tmp.$$"
  jq --arg sha "$(sha256sum "$BIN" | cut -d' ' -f1)" --arg arch "$ARCH" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '. + {binary_sha256: $sha, arch: $arch, recorded_at: $at}' "$MANIFEST" > "$tmp"
  mv "$tmp" "$RECORD_FILE"
  ok "recorded $RECORD_FILE (the next install must not be older)"
fi
echo "VERIFIED $BIN_NAME${COMMIT:+ (commit $COMMIT)}"
