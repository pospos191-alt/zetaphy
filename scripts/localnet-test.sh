#!/usr/bin/env bash
# Runs ts-mocha suites against the program ALREADY BUILT in target/deploy
# (any feature set), on a fresh solana-test-validator — no `anchor test`,
# no mainnet clone. Used by CI for the v2-only build and by auditors.
#
#   anchor build -- --features v2-only
#   scripts/localnet-test.sh tests/v2-only.ts tests/swdmm_v2.ts tests/security-review.ts
#
#   anchor build -- --features mainnet,v2-only        # 24h-48h timelock
#   SWD_MAINNET_BUILD=1 scripts/localnet-test.sh tests/v2-only.ts
#
# Env: RPC_PORT (default 8899), ANCHOR_WALLET (default ~/.config/solana/id.json).
# The wallet becomes the program's upgrade authority, which
# initialize_global_config requires. Pyth fixtures come from Anchor.toml.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[ "$#" -gt 0 ] || { sed -n '2,13p' "$0"; exit 2; }

RPC_PORT="${RPC_PORT:-8899}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
SO=target/deploy/swd_amm.so
[ -f "$SO" ] || { echo "build first: $SO not found" >&2; exit 1; }
[ -f target/idl/swd_amm.json ] || { echo "build first: target/idl/swd_amm.json not found" >&2; exit 1; }
# The id the built binary declares (it differs between a `mainnet` build and the others).
PID=$(python3 -c 'import json; print(json.load(open("target/idl/swd_amm.json"))["address"])')
AUTH=$(solana-keygen pubkey "$WALLET")

node scripts/gen-pyth-fixtures.js >/dev/null
ACC=()
while read -r addr file; do ACC+=(--account "$addr" "$file"); done < <(python3 - <<'PY'
import re
t = open("Anchor.toml").read()
for m in re.finditer(r'\[\[test\.validator\.account\]\]\s*address = "(\w+)"\s*filename = "([^"]+)"', t):
    print(m.group(1), m.group(2))
PY
)

LEDGER=$(mktemp -d)
solana-test-validator --ledger "$LEDGER" --bind-address 127.0.0.1 --rpc-port "$RPC_PORT" \
  --faucet-port $((RPC_PORT + 1012)) --dynamic-port-range $((RPC_PORT + 200))-$((RPC_PORT + 300)) --quiet --reset \
  --upgradeable-program "$PID" "$SO" "$AUTH" "${ACC[@]}" > "$LEDGER.log" 2>&1 &
VPID=$!
trap 'kill $VPID 2>/dev/null || true; wait $VPID 2>/dev/null || true; rm -rf "$LEDGER" "$LEDGER.log"' EXIT
for _ in $(seq 1 90); do
  solana cluster-version --url "http://127.0.0.1:$RPC_PORT" >/dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || { cat "$LEDGER.log"; exit 1; }
  sleep 1
done

ANCHOR_PROVIDER_URL="http://127.0.0.1:$RPC_PORT" ANCHOR_WALLET="$WALLET" \
  yarn -s ts-mocha -p ./tsconfig.json -t 1000000 "$@"
