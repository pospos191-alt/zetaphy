#!/bin/bash
# ZETAPHY: one command to set up a server (Linux with sudo; the validator runs on any Linux with systemd). Pick:
#
#   curl -fsSL https://raw.githubusercontent.com/pospos191-alt/zetaphy/main/install.sh | sudo bash -s -- runner
#
#   runner     a Neuro runner on ZETAPHY mainnet: takes Neuro jobs and earns ZTPHY (it waits for its bond)
#   agents     the Hyperlane validator for ZETAPHY Saphan (EVM route); the relayer starts later
#   validator  a ZETAPHY mainnet validator node: the signed release and the published genesis (sha256 checked),
#              synced from the public sentry; no public RPC, no faucet. Then: sudo zetaphy-validator key / stake N
#              (your own ZTPHY; your name: … | sudo MONIKER=my-name bash -s -- validator)
#   update     a ZETAPHY node set up before: the current release and settings (keys and chain data kept)
#
# Several at once: ... | sudo bash -s -- runner agents
# Safe to run again (it updates and keeps the keys). ZETAPHY mainnet (3659); the testnet was shut down 2026-11-14.
set -euo pipefail
REPO="pospos191-alt/zetaphy"
REF="${REF:-main}"
[ "$(id -u)" = 0 ] || { echo "ERROR: run with sudo (… | sudo bash -s -- runner)" >&2; exit 1; }
[ $# -gt 0 ] || { sed -n '2,14p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null || echo "usage: install.sh runner|agents|validator"; exit 1; }

run() { # run <path in the repo> [args…]: download that script (pinned to $REF) and run it
  local f; f=$(mktemp); curl -fsSL "https://raw.githubusercontent.com/$REPO/$REF/$1" -o "$f"; shift
  REF="$REF" bash "$f" "$@"; local code=$?; rm -f "$f"; return $code
}

for role in "$@"; do
  case "$role" in
    runner) run zetaphy-network/setup-runner.sh install ;;
    agents) run zetaphy-chain/hyperlane/setup-agents.sh ;;
    validator) run zetaphy-chain/join-validator.sh install ;;
    update) run zetaphy-chain/join-validator.sh update ;;
    *) echo "unknown role '$role': runner, agents, validator or update" >&2; exit 1 ;;
  esac
done
