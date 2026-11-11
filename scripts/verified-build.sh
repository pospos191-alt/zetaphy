#!/usr/bin/env bash
# Verified (reproducible) build for swd_amm (2026-11-06, release + rollback support 2026-11-11).
# Anyone can rebuild the program from this repo in the same pinned Docker image (solana-verify, Ellipsis Labs /
# OtterSec) and check that the bytes on chain match; OtterSec's registry then shows "Verified" on explorers.
#
#   build   [devnet|mainnet]        one deterministic build -> target/deploy/swd_amm.so + hashes
#   release [OUT_DIR]               BOTH feature sets -> OUT_DIR (default dist/program): .so files, IDLs,
#                                   SHA256SUMS and release.json (what .github/workflows/verifiable-build.yml publishes,
#                                   and what scripts/rollback-program.sh and scripts/program-watch.mjs check against)
#   hash    <file.so>               sha256 of the file + the "executable hash" (sha256 with trailing zero bytes
#                                   removed — the number solana-verify and OtterSec compare). Needs only python3.
#   verify  <PROGRAM_ID> <RPC> [devnet|mainnet]   rebuild at HEAD from the public repo and compare with chain
#   upload  <PROGRAM_ID> <RPC> [devnet|mainnet]   write the verify PDA + queue OtterSec's remote job (needs the
#                                   upgrade authority, i.e. a Squads proposal once it is the vault — see below)
#   verify-command <PROGRAM_ID> <devnet|mainnet> [COMMIT] [RPC]
#                                   print (never run) the exact commands anyone can use to check the deployed program
#
# Feature sets (the flavour argument):
#   devnet  = no extra features: exactly what CI's deploy-devnet job builds (`anchor build`)
#   mainnet = --features mainnet,v2-only: the audited scope (CP + DLMM compiled out), scripts/deploy-mainnet.sh default
#   FEATURES=<list> still overrides both (old behaviour; FEATURES=mainnet ships all pools).
#
# Needs Docker and `cargo install solana-verify --locked` (0.6.x). The pinned build image is chosen from
# [workspace.metadata.cli] solana = "3.1.10" in the root Cargo.toml. Never put a private key in this repo or in CI.
#
# Note: the program id is compiled in (declare_id! in programs/swd_amm/src/lib.rs = the devnet id today). A mainnet
# deploy with a fresh program keypair needs the commit that sets declare_id! to that id, and a release from it.
set -euo pipefail
cmd="${1:-}"
LIB=swd_amm
REPO_URL="${REPO_URL:-https://github.com/pospos191-alt/zetaphy}"
SO="target/deploy/${LIB}.so"

cd "$(git rev-parse --show-toplevel)"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# flavour -> cargo features ("" = none). FEATURES in the environment wins.
features_for() {
  if [ -n "${FEATURES+x}" ]; then printf '%s' "$FEATURES"; return; fi
  case "${1:-mainnet}" in
    devnet) printf '' ;;
    mainnet) printf 'mainnet,v2-only' ;;
    *) die "flavour must be devnet or mainnet (got '$1')" ;;
  esac
}
# cargo args after `--` for solana-verify / anchor (nothing for the default feature set)
cargo_args() { if [ -n "$1" ]; then printf -- '-- --features %s' "$1"; fi; }

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
# same as solana-verify's get_binary_hash: sha256 of the bytes after stripping trailing 0x00 (ProgramData accounts
# are zero-padded to their allocated length, the .so file is not)
exe_hash_of() {
  python3 -c 'import hashlib,sys; d=open(sys.argv[1],"rb").read().rstrip(b"\0"); print(hashlib.sha256(d).hexdigest())' "$1"
}

do_build() { # flavour
  local f; f=$(features_for "$1")
  command -v solana-verify >/dev/null 2>&1 || die "install solana-verify: cargo install solana-verify --locked"
  echo "== solana-verify build ($1: features '${f:-<default>}')"
  # shellcheck disable=SC2046  # cargo_args is intentionally split into words
  solana-verify build --library-name "$LIB" $(cargo_args "$f")
  [ -f "$SO" ] || die "$SO was not produced"
  echo "sha256:          $(sha256_of "$SO")"
  echo "executable hash: $(exe_hash_of "$SO")   (solana-verify: $(solana-verify get-executable-hash "$SO"))"
}

do_idl() { # flavour out
  local f; f=$(features_for "$1")
  if [ "${SKIP_IDL:-0}" = 1 ]; then echo "(SKIP_IDL=1: no IDL)"; return 0; fi
  command -v anchor >/dev/null 2>&1 || die "anchor 0.31.1 is needed for the IDL (or SKIP_IDL=1)"
  # Own target dir: the Docker build leaves target/ owned by root on most machines (and on CI runners).
  # shellcheck disable=SC2046
  CARGO_TARGET_DIR="${IDL_TARGET_DIR:-${TMPDIR:-/tmp}/swd_amm-idl-target}" anchor idl build -p "$LIB" -o "$2" $(cargo_args "$f")
}

case "$cmd" in
  build)
    do_build "${2:-mainnet}"
    ;;

  release)
    OUT="${2:-dist/program}"
    [ -z "${FEATURES+x}" ] || die "unset FEATURES: a release always builds both flavours (devnet + mainnet)"
    mkdir -p "$OUT"
    [ -z "$(git status --porcelain -- programs Cargo.toml Cargo.lock)" ] || die "programs/ or Cargo.* has uncommitted changes — a release must be one commit"
    COMMIT=$(git rev-parse HEAD)
    TAG="${RELEASE_TAG:-$(git describe --tags --exact-match 2>/dev/null || echo "untagged-$(git rev-parse --short HEAD)")}"
    entries=()
    for flavour in devnet mainnet; do
      f=$(features_for "$flavour")
      do_build "$flavour"
      cp "$SO" "$OUT/${LIB}-${flavour}.so"
      do_idl "$flavour" "$OUT/${LIB}-${flavour}.idl.json"
      entries+=("$flavour|$f|${LIB}-${flavour}.so|$(sha256_of "$OUT/${LIB}-${flavour}.so")|$(exe_hash_of "$OUT/${LIB}-${flavour}.so")|$(stat -c %s "$OUT/${LIB}-${flavour}.so")")
    done
    ( cd "$OUT" && sha256sum ./*.so ./*.json 2>/dev/null | grep -v ' ./release.json$' | sed 's# \./# #' > SHA256SUMS )
    SV_VERSION=$(solana-verify --version 2>/dev/null | awk '{print $NF}')
    python3 - "$OUT/release.json" "$TAG" "$COMMIT" "$REPO_URL" "$SV_VERSION" "${entries[@]}" <<'PY'
import json, sys
out, tag, commit, repo, sv, *entries = sys.argv[1:]
builds = {}
for e in entries:
    flavour, features, file, sha, exe, size = e.split("|")
    builds[flavour] = {"features": features, "file": file, "sha256": sha, "executable_hash": exe, "size": int(size),
                       "idl": f"swd_amm-{flavour}.idl.json"}
json.dump({"schema": 1, "program": "swd_amm", "tag": tag, "commit": commit, "repo": repo,
           "solana_version": "3.1.10", "anchor_version": "0.31.1", "solana_verify_version": sv,
           "builds": builds}, open(out, "w"), indent=2)
PY
    echo "== $OUT"; cat "$OUT/SHA256SUMS"; cat "$OUT/release.json"
    ;;

  hash)
    : "${2:?file.so}"
    echo "sha256:          $(sha256_of "$2")"
    echo "executable hash: $(exe_hash_of "$2")"
    ;;

  verify)
    : "${2:?program id}" "${3:?rpc url}"
    COMMIT=$(git rev-parse HEAD); f=$(features_for "${4:-mainnet}")
    # Answer "n" at the "upload to the blockchain?" prompt: checking writes nothing.
    # shellcheck disable=SC2046
    solana-verify verify-from-repo -u "$3" --program-id "$2" --library-name "$LIB" --commit-hash "$COMMIT" \
      --mount-path . "$REPO_URL" $(cargo_args "$f")
    solana-verify get-program-hash -u "$3" "$2"
    ;;

  upload)
    : "${2:?program id}" "${3:?rpc url}"
    COMMIT=$(git rev-parse HEAD); f=$(features_for "${4:-mainnet}")
    # writes the verify PDA (signed by the upgrade authority; KEYPAIR=<path>, default the solana CLI keypair),
    # then queues OtterSec's remote job. solana-verify 0.5+ removed `--remote` from verify-from-repo.
    # Once the authority is the Squads vault: `verify-command` below prints the export-pda-tx -> Squads route.
    # shellcheck disable=SC2046
    solana-verify -u "$3" verify-from-repo --program-id "$2" --library-name "$LIB" --commit-hash "$COMMIT" \
      --mount-path . ${KEYPAIR:+--keypair "$KEYPAIR"} "$REPO_URL" $(cargo_args "$f")
    UPLOADER="${UPLOADER:-$(solana-keygen pubkey ${KEYPAIR:+"$KEYPAIR"})}"
    solana-verify -u "$3" remote submit-job --program-id "$2" --uploader "$UPLOADER"
    ;;

  verify-command)
    : "${2:?program id}" "${3:?devnet|mainnet}"
    PID="$2"; flavour="$3"; COMMIT="${4:-$(git rev-parse HEAD)}"
    f=$(features_for "$flavour")
    case "$flavour" in devnet) RPC="${5:-https://api.devnet.solana.com}" ;; *) RPC="${5:-https://api.mainnet-beta.solana.com}" ;; esac
    ca=$(cargo_args "$f")
    cat <<EOF
# Check that program $PID ($flavour) is exactly commit $COMMIT of $REPO_URL
# (features: ${f:-<default>}). Needs Docker + \`cargo install solana-verify --locked\`.

# 1) Rebuild from the public repo in the pinned image and compare with the chain (answer n to the upload prompt):
solana-verify verify-from-repo -u $RPC --program-id $PID --library-name $LIB \\
  --commit-hash $COMMIT --mount-path . $REPO_URL ${ca}

# 2) Just the two hashes (they must be equal):
solana-verify get-program-hash -u $RPC $PID
#    and the "executable_hash" in release.json of the matching program-v* GitHub Release (or of your own build:
#    solana-verify get-executable-hash target/deploy/$LIB.so)

# 3) OtterSec's public record (no install needed; is_verified, on_chain_hash, executable_hash, repo, commit):
curl -s https://verify.osec.io/status/$PID
solana-verify -u $RPC remote get-status --program-id $PID

# 4) Owner only — publish the record (verify PDA) and queue OtterSec's remote build:
#    a) upgrade authority is still a key file:
solana-verify -u $RPC verify-from-repo --program-id $PID --library-name $LIB --commit-hash $COMMIT \\
  --mount-path . --keypair <UPGRADE_AUTHORITY_KEYPAIR> $REPO_URL ${ca}
#    b) upgrade authority is the Squads vault: export the PDA transaction, import it in Squads
#       (Developers -> Transaction builder / Import, base58), approve with the threshold, execute; then:
solana-verify -u $RPC export-pda-tx --program-id $PID --uploader <SQUADS_VAULT> --library-name $LIB \\
  --commit-hash $COMMIT --mount-path . --encoding base58 $REPO_URL ${ca}
solana-verify -u $RPC remote submit-job --program-id $PID --uploader <SQUADS_VAULT_OR_AUTHORITY>
EOF
    ;;

  *)
    sed -n '2,28p' "$0" >&2
    exit 2
    ;;
esac
