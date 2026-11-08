#!/usr/bin/env bash
# Verified build for swd_amm (2026-11-06). Anyone can rebuild the program from this repo in the same Docker image and
# check that the bytes on mainnet match, and OtterSec's registry shows a "Verified" badge on explorers (Solscan etc.).
#
#   1) before deploy  : bash scripts/verified-build.sh build
#   2) after deploy   : bash scripts/verified-build.sh verify <PROGRAM_ID> <MAINNET_RPC>
#   3) publish result : bash scripts/verified-build.sh upload <PROGRAM_ID> <MAINNET_RPC>   (needs the upgrade authority,
#                       i.e. a Squads proposal once the authority is the multisig vault — see docs/MAINNET_RUNBOOK.md)
#
# Needs Docker and `cargo install solana-verify`. Never put a private key in this repo or in CI.
set -euo pipefail
cmd="${1:-}"
LIB=swd_amm
REPO_URL="${REPO_URL:-https://github.com/pospos191-alt/zetaphy}"
case "$cmd" in
  build)
    solana-verify build --library-name "$LIB" -- --features mainnet
    solana-verify get-executable-hash "target/deploy/${LIB}.so"
    ;;
  verify)
    : "${2:?program id}" "${3:?rpc url}"
    COMMIT=$(git rev-parse HEAD)
    solana-verify verify-from-repo -u "$3" --program-id "$2" --library-name "$LIB" --commit-hash "$COMMIT" \
      --mount-path . "$REPO_URL" -- --features mainnet
    solana-verify get-program-hash -u "$3" "$2"
    ;;
  upload)
    : "${2:?program id}" "${3:?rpc url}"
    COMMIT=$(git rev-parse HEAD)
    # writes the verify PDA (signed by the upgrade authority; KEYPAIR=<path>, default the solana CLI keypair),
    # then queues OtterSec's remote job. solana-verify 0.5.x removed `--remote` from verify-from-repo.
    # Once the authority is the Squads vault: `solana-verify export-pda-tx ...` -> Squads proposal, then submit-job
    # with UPLOADER=<vault>.
    solana-verify -u "$3" verify-from-repo --program-id "$2" --library-name "$LIB" --commit-hash "$COMMIT" \
      --mount-path . ${KEYPAIR:+--keypair "$KEYPAIR"} "$REPO_URL" -- --features mainnet
    UPLOADER="${UPLOADER:-$(solana-keygen pubkey ${KEYPAIR:-})}"
    solana-verify -u "$3" remote submit-job --program-id "$2" --uploader "$UPLOADER"
    ;;
  *)
    echo "usage: $0 build | verify <PROGRAM_ID> <RPC> | upload <PROGRAM_ID> <RPC>" >&2
    exit 2
    ;;
esac
