#!/bin/bash
# shellcheck disable=SC2034  # run() sets variables the sourced setup-node.sh blocks read
# setup-node.sh pinned mode on a validator node (VALIDATOR_NODE=1, set by join-validator.sh / install.sh validator):
# never a public RPC (PUBLIC_RPC=1), a plain-http RPC (PUBLIC_HTTP_RPC=1) or a faucet (MAINNET_FAUCET=1), on this run
# or any later one (the choice is kept in the pin), and VALIDATOR_NODE=0 later is refused; PUBLIC_RPC=1 is refused on
# any machine that signs as a validator. The public sentry (PUBLIC_RPC=1, not a validator) is accepted. Runs the
# pinned-mode block of setup-node.sh alone (with its mainnet faucet block), as test-mainnet-faucet.sh does.
#   bash zetaphy-chain/test-validator-node.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
awk '/^# ---- mainnet faucet \(MAINNET_FAUCET=1/{f=1} f{print} /^# ---- end of the mainnet faucet/{exit}' "$here/setup-node.sh" > "$T/faucet.sh"
awk '/^GENESIS_FILE="\$\{GENESIS_FILE:-\}"; GENESIS_SHA256=/{f=1} f{print} f&&/^fi$/{exit}' "$here/setup-node.sh" > "$T/pinned.sh"
grep -q '^mainnet_faucet_check()' "$T/faucet.sh" && grep -q 'VALIDATOR_NODE=\${VALIDATOR_NODE:-\$(pinned VALIDATOR_NODE' "$T/pinned.sh" \
  && grep -q '^  mainnet_faucet_check$' "$T/pinned.sh" || { echo "FAIL: the pinned-mode block was not found in setup-node.sh"; exit 1; }
# the pin setup-node.sh writes records the choice
grep -q "printf 'GENESIS_SHA256=%s.*VALIDATOR_NODE=%s" "$here/setup-node.sh" || { echo "FAIL: setup-node.sh does not record VALIDATOR_NODE in its pin"; exit 1; }

GEN="$here/mainnet/zetaphy_3659-1/genesis.json"
SHA=ca0efb15f6ca80f57e157b32837e012a15f3dc3597531b18747629c8f0a94667
VAL_PUBKEY=$(jq -r '.app_state.genutil.gen_txs[0].body.messages[0].pubkey.key' "$GEN")
printf '#!/bin/sh\nexit 0\n' > "$T/zetaphyd"; chmod 755 "$T/zetaphyd"

new_machine() {
  M="$T/$1"; rm -rf "$M"; mkdir -p "$M/home/config" "$M/etc"
  jq -n '{pub_key: {type: "tendermint/PubKeyEd25519", value: "c2VudHJ5IGtleSwgbm90IGEgdmFsaWRhdG9yJ3Mga2V5IQ=="}}' > "$M/home/config/priv_validator_key.json"
  printf '[rpc]\nladdr = "tcp://127.0.0.1:26657"\n\n[priv_validator]\npriv_validator_laddr = ""\n' > "$M/home/config/config.toml"
}
# run [VAR=value ...]: the pinned-mode block as setup-node.sh runs it on machine $M, then the pin it writes.
run() {
  ( set -euo pipefail
    CHAIN_ID="zetaphy_77390-1"; EVM_CHAIN_ID=77390; DENOM=azetaphy; JOIN=""; PUBLIC_HTTP_RPC=0
    NODE_USER=$(id -un); NODE_HOME=$M/home; PINNED=$M/etc/pinned-chain.env; BIN=$T/zetaphyd; ZETAPHYD_BIN=$T/zetaphyd
    GENESIS_FILE=$GEN; GENESIS_SHA256=$SHA; GENESIS_EVM_CHAIN_ID=3659
    PUBLIC_RPC=""; MAINNET_FAUCET=""; VALIDATOR_NODE=""; PEERS=""; FAUCET_AMOUNT=""; FAUCET_POW_AMOUNT=""; FAUCET_DAY_BUDGET=""
    for kv in "$@"; do export "${kv?}"; done
    curl() { [ -f "$M/status.json" ] && cat "$M/status.json" || return 7; }
    . "$T/faucet.sh"
    VALIDATOR_KEYRING_DIR=$M/keyring
    . "$T/pinned.sh"
    printf 'GENESIS_SHA256=%s\nGENESIS_EVM_CHAIN_ID=%s\nPUBLIC_RPC=%s\nMAINNET_FAUCET=%s\nVALIDATOR_NODE=%s\n' \
      "$GENESIS_SHA256" "$EVM_CHAIN_ID" "$PUBLIC_RPC" "$MAINNET_FAUCET" "$VALIDATOR_NODE" > "$PINNED"
    echo "ACCEPTED $CHAIN_ID public=$SERVE_PUBLIC"
  ) 2>&1
}
expect() { # expect <case> <ACCEPTED|refused> <output> [text the output must contain]
  case $2 in
    ACCEPTED) grep -q '^ACCEPTED ' <<<"$3" || { echo "FAIL: $1: refused: $3"; exit 1; } ;;
    *) ! grep -q '^ACCEPTED ' <<<"$3" && grep -q 'refused' <<<"$3" || { echo "FAIL: $1: accepted: $3"; exit 1; } ;;
  esac
  [ -z "${4:-}" ] || grep -qF -- "$4" <<<"$3" || { echo "FAIL: $1: no \"$4\" in: $3"; exit 1; }
  echo "ok $1"
}
nopin() { [ ! -e "$M/etc/pinned-chain.env" ] || { echo "FAIL: $1: a pin was written"; exit 1; }; }

# --- a validator node: never public, never a faucet
for bad in PUBLIC_RPC=1 PUBLIC_HTTP_RPC=1 MAINNET_FAUCET=1; do
  new_machine "v-$bad"
  expect "VALIDATOR_NODE=1 with $bad" refused "$(run VALIDATOR_NODE=1 "$bad")" "a validator node never serves a public RPC or a faucet"; nopin "$bad"
done
new_machine validator
out=$(run VALIDATOR_NODE=1); expect "a validator node (no public RPC)" ACCEPTED "$out" "public=0"
grep -qx 'VALIDATOR_NODE=1' "$M/etc/pinned-chain.env" || { echo "FAIL: VALIDATOR_NODE=1 not in the pin"; exit 1; }
cp "$GEN" "$M/home/config/genesis.json"   # as setup-node.sh installs it
# later runs (zetaphy-validator update, the upgrade timer) keep it: the pin alone is enough
expect "a later run with PUBLIC_RPC=1" refused "$(run GENESIS_FILE= GENESIS_SHA256= GENESIS_EVM_CHAIN_ID= PUBLIC_RPC=1)" "never serves a public RPC"
expect "a later run with MAINNET_FAUCET=1" refused "$(run GENESIS_FILE= GENESIS_SHA256= GENESIS_EVM_CHAIN_ID= PUBLIC_RPC=1 MAINNET_FAUCET=1)" "never serves"
expect "a later run with VALIDATOR_NODE=0" refused "$(run VALIDATOR_NODE=0 PUBLIC_RPC=1)" "it stays one"
expect "a later run with the pin only" ACCEPTED "$(run GENESIS_FILE= GENESIS_SHA256= GENESIS_EVM_CHAIN_ID=)" "public=0"
grep -qx 'VALIDATOR_NODE=1' "$M/etc/pinned-chain.env" || { echo "FAIL: VALIDATOR_NODE lost from the pin"; exit 1; }
new_machine badvalue
expect "VALIDATOR_NODE=yes" refused "$(run VALIDATOR_NODE=yes | sed 's/^VALIDATOR_NODE: 0 or 1$/refused: &/')" "0 or 1"; nopin badvalue

# --- PUBLIC_RPC=1 on a machine that signs as a validator, whatever VALIDATOR_NODE says
new_machine genval
jq -n --arg k "$VAL_PUBKEY" '{pub_key: {type: "tendermint/PubKeyEd25519", value: $k}}' > "$M/home/config/priv_validator_key.json"
expect "PUBLIC_RPC=1 with the genesis validator's consensus key" refused "$(run PUBLIC_RPC=1)" "signs as a validator"; nopin genval
new_machine keyring
mkdir -p "$M/keyring" && touch "$M/keyring/validator.info"
expect "PUBLIC_RPC=1 on a machine holding the validator's key ring" refused "$(run PUBLIC_RPC=1)" "the public RPC runs on the sentry only"; nopin keyring
new_machine power
echo '{"result":{"validator_info":{"voting_power":"10"}}}' > "$M/status.json"
expect "PUBLIC_RPC=1 on a node with voting power" refused "$(run PUBLIC_RPC=1)" "voting power"; nopin power

# --- the public sentry is accepted, its faucet too
new_machine sentry
expect "the public sentry (PUBLIC_RPC=1)" ACCEPTED "$(run PUBLIC_RPC=1)" "public=1"
grep -qx 'VALIDATOR_NODE=0' "$M/etc/pinned-chain.env" || { echo "FAIL: VALIDATOR_NODE=0 not recorded on the sentry"; exit 1; }
new_machine sentry-faucet
expect "the public sentry with MAINNET_FAUCET=1 (the check)" ACCEPTED "$(run PUBLIC_RPC=1 MAINNET_FAUCET=1)" "public=1"
echo "validator node checks: all passed"
