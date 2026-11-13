#!/bin/bash
# shellcheck disable=SC2034  # run() sets variables the sourced setup-node.sh block reads
# setup-node.sh's mainnet faucet (MAINNET_FAUCET=1, owner decision 2026-11-13; docs/ZETAPHY-MAINNET-PROCEDURE.md,
# "Mainnet faucet on the sentry"): refused on a node without a public RPC (the validator) and on any machine that
# signs as a validator; on the public sentry a fresh key (mode 600) and the limits files 1 / 5 / 200, kept by later
# runs; never a key it did not make. Runs the faucet block of setup-node.sh alone, with a stand-in zetaphyd, for each
# case (as test-plan-pin.sh does for its block). The node side of the limits: fork-tests/evmd/zetaphy_faucetlimits_test.go.
#   bash zetaphy-chain/test-mainnet-faucet.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
awk '/^# ---- mainnet faucet \(MAINNET_FAUCET=1/{f=1} f{print} /^# ---- end of the mainnet faucet/{exit}' "$here/setup-node.sh" > "$T/block.sh"
grep -q '^mainnet_faucet_setup()' "$T/block.sh" && grep -q '^# ---- end of the mainnet faucet' "$T/block.sh" \
  || { echo "FAIL: the mainnet faucet block was not found in setup-node.sh"; exit 1; }
grep -q '^  mainnet_faucet_check$' "$here/setup-node.sh" && grep -q '^  mainnet_faucet_setup$' "$here/setup-node.sh" \
  || { echo "FAIL: setup-node.sh does not call the mainnet faucet block in pinned mode"; exit 1; }

# The published mainnet genesis: its one gentx is the validator's consensus key.
GEN="$here/mainnet/zetaphy_3659-1/genesis.json"
VAL_PUBKEY=$(jq -r '.app_state.genutil.gen_txs[0].body.messages[0].pubkey.key' "$GEN")

# A stand-in zetaphyd for the few commands the block runs (keys add / unsafe-export-eth-key / show, debug addr).
cat > "$T/zetaphyd" <<'Z'
#!/bin/bash
dir=""; prev=""; for a in "$@"; do [ "$prev" = --keyring-dir ] && dir=$a; prev=$a; done
case "$1 $2" in
  "keys add") od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$dir/faucet.hex"; echo "mnemonic words that must not be printed" ;;
  "keys unsafe-export-eth-key") cat "$dir/faucet.hex" ;;
  "keys show") echo "zetaphy1$(printf 'q%.0s' $(seq 1 38))" ;;
  "debug addr") echo "Address bytes: [1 2 3]"; echo "Address hex: 0x00000000000000000000000000000000000fa0c7" ;;
  *) echo "zetaphyd stand-in: $*" >&2; exit 1 ;;
esac
Z
chmod 755 "$T/zetaphyd"

# new_machine <name>: a node home as `zetaphyd init` leaves it (a fresh consensus key, the stock config.toml)
new_machine() {
  M="$T/$1"; rm -rf "$M"; mkdir -p "$M/home/config" "$M/etc"
  jq -n '{pub_key: {type: "tendermint/PubKeyEd25519", value: "c2VudHJ5IGtleSwgbm90IGEgdmFsaWRhdG9yJ3Mga2V5IQ=="}}' > "$M/home/config/priv_validator_key.json"
  printf '[rpc]\nladdr = "tcp://127.0.0.1:26657"\n\n[priv_validator]\npriv_validator_laddr = ""\n' > "$M/home/config/config.toml"
}
# run [VAR=value ...]: the block's two steps, as setup-node.sh runs them in pinned mode, on machine $M; then writes
# $PINNED as setup-node.sh does. Prints the outcome; ACCEPTED if nothing was refused.
run() {
  ( set -euo pipefail
    NODE_USER=$(id -un); NODE_HOME=$M/home; GENESIS_FILE=$GEN; PINNED=$M/etc/pinned-chain.env; PUBLIC_RPC=""
    MAINNET_FAUCET=""; FAUCET_AMOUNT=""; FAUCET_POW_AMOUNT=""; FAUCET_DAY_BUDGET=""
    for kv in "$@"; do export "${kv?}"; done
    pinned() { sed -n "s/^$1=\([0-9a-f]*\)\$/\1/p" "$PINNED" 2>/dev/null | head -1; }
    PUBLIC_RPC=${PUBLIC_RPC:-$(pinned PUBLIC_RPC || true)}; PUBLIC_RPC=${PUBLIC_RPC:-0}   # as setup-node.sh: given, else the pin
    as_node() { bash -c "$*"; }
    z() { bash -c "'$T/zetaphyd' $*"; }
    curl() { [ -f "$M/status.json" ] && cat "$M/status.json" || return 7; }
    . "$T/block.sh"
    VALIDATOR_KEYRING_DIR=$M/keyring
    mainnet_faucet_check
    mainnet_faucet_setup
    { printf 'GENESIS_SHA256=%s\nGENESIS_EVM_CHAIN_ID=3659\nPUBLIC_RPC=%s\nMAINNET_FAUCET=%s\n' "$(printf 'a%.0s' $(seq 1 64))" "$PUBLIC_RPC" "$MAINNET_FAUCET"
      [ -z "$FAUCET_KEY_SHA256" ] || printf 'FAUCET_KEY_SHA256=%s\n' "$FAUCET_KEY_SHA256"; } > "$PINNED"
    echo ACCEPTED ) 2>&1
}
expect() { # expect <case> <ACCEPTED|refused> <output> [text the output must contain]
  case $2 in
    ACCEPTED) grep -q '^ACCEPTED$' <<<"$3" || { echo "FAIL: $1: refused: $3"; exit 1; } ;;
    *) ! grep -q '^ACCEPTED$' <<<"$3" && grep -q 'refused' <<<"$3" || { echo "FAIL: $1: accepted: $3"; exit 1; } ;;
  esac
  [ -z "${4:-}" ] || grep -qF -- "$4" <<<"$3" || { echo "FAIL: $1: no \"$4\" in: $3"; exit 1; }
  echo "ok $1"
}
nokey() { [ ! -e "$M/home/config/faucet.key" ] && [ ! -e "$M/home/config/faucet-amount" ] || { echo "FAIL: $1: a faucet key or file was made"; exit 1; }; }
val() { cat "$M/home/config/$1"; }
fp() { sha256sum < "$M/home/config/faucet.key" | cut -d' ' -f1; }

# --- refused: the validator, a node without a public RPC, a machine that signs as a validator
new_machine validator
jq -n --arg k "$VAL_PUBKEY" '{pub_key: {type: "tendermint/PubKeyEd25519", value: $k}}' > "$M/home/config/priv_validator_key.json"
expect "the validator (no public RPC)" refused "$(run MAINNET_FAUCET=1)" "needs PUBLIC_RPC=1"; nokey validator
expect "the validator, even with PUBLIC_RPC=1 (its consensus key is in the genesis)" refused "$(run MAINNET_FAUCET=1 PUBLIC_RPC=1)" "genesis validator"; nokey validator
new_machine private
expect "a node without a public RPC" refused "$(run MAINNET_FAUCET=1 PUBLIC_RPC=0)" "never on the validator"; nokey private
new_machine power
echo '{"result":{"validator_info":{"voting_power":"10"}}}' > "$M/status.json"
expect "a node with voting power" refused "$(run MAINNET_FAUCET=1 PUBLIC_RPC=1)" "voting power"; nokey power
new_machine horcrux
sed -i 's|^priv_validator_laddr = ""|priv_validator_laddr = "tcp://0.0.0.0:1234"|' "$M/home/config/config.toml"
expect "a node signing through a remote signer" refused "$(run MAINNET_FAUCET=1 PUBLIC_RPC=1)" "remote signer"; nokey horcrux
new_machine keyring
mkdir -p "$M/keyring" && touch "$M/keyring/validator.info"
expect "a machine holding the validator's key ring" refused "$(run MAINNET_FAUCET=1 PUBLIC_RPC=1)" "key ring"; nokey keyring
new_machine badvalue
expect "MAINNET_FAUCET=yes" refused "$(run MAINNET_FAUCET=yes PUBLIC_RPC=1 | sed 's/^MAINNET_FAUCET: 0 or 1$/refused: &/')" "0 or 1"; nokey badvalue
for bad in FAUCET_AMOUNT=0 FAUCET_AMOUNT=-1 FAUCET_AMOUNT=abc FAUCET_AMOUNT=101 FAUCET_POW_AMOUNT=1e3 FAUCET_POW_AMOUNT=0.0000000000000000001 \
  FAUCET_DAY_BUDGET=100001 FAUCET_DAY_BUDGET=4; do
  expect "$bad" refused "$(run MAINNET_FAUCET=1 PUBLIC_RPC=1 "$bad")" "${bad%%=*}"; nokey badvalue
done

# --- default: a pinned node has no faucet; a faucet key it did not make is refused
new_machine plain
expect "no MAINNET_FAUCET: no faucet" ACCEPTED "$(run PUBLIC_RPC=1)"; nokey plain
grep -qx 'MAINNET_FAUCET=0' "$M/etc/pinned-chain.env" || { echo "FAIL: MAINNET_FAUCET=0 not recorded"; exit 1; }
echo 0x1111111111111111111111111111111111111111111111111111111111111111 > "$M/home/config/faucet.key"
expect "a testnet faucet key, no MAINNET_FAUCET" refused "$(run PUBLIC_RPC=1)" "a testnet faucet"
expect "a testnet faucet key, MAINNET_FAUCET=1" refused "$(run MAINNET_FAUCET=1 PUBLIC_RPC=1)" "is not the faucet key"
[ "$(cat "$M/home/config/faucet.key")" = 0x1111111111111111111111111111111111111111111111111111111111111111 ] || { echo "FAIL: the key was changed"; exit 1; }

# --- accepted: the public sentry
new_machine sentry
out=$(run MAINNET_FAUCET=1 PUBLIC_RPC=1); expect "the public sentry" ACCEPTED "$out"
grep -q 'mnemonic' <<<"$out" && { echo "FAIL: the key's words were printed"; exit 1; }
k="$M/home/config/faucet.key"
grep -Eqx '[0-9a-f]{64}' "$k" || { echo "FAIL: faucet.key: $(wc -c < "$k") bytes, not a key"; exit 1; }
[ "$(stat -c '%a %U' "$k")" = "600 $(id -un)" ] || { echo "FAIL: faucet.key is $(stat -c '%a %U' "$k")"; exit 1; }
[ "$(val faucet-amount)/$(val faucet-pow-amount)/$(val faucet-day-budget)" = 1/5/200 ] || { echo "FAIL: limits $(val faucet-amount)/$(val faucet-pow-amount)/$(val faucet-day-budget)"; exit 1; }
[ "$(sed -n 1p "$M/home/config/faucet.address")" = 0x00000000000000000000000000000000000fa0c7 ] && grep -q '^zetaphy1' "$M/home/config/faucet.address" \
  || { echo "FAIL: faucet.address"; exit 1; }
grep -qx 'MAINNET_FAUCET=1' "$M/etc/pinned-chain.env" && grep -qx "FAUCET_KEY_SHA256=$(fp)" "$M/etc/pinned-chain.env" \
  || { echo "FAIL: the choice is not in pinned-chain.env: $(cat "$M/etc/pinned-chain.env")"; exit 1; }
[ -z "$(find "$M/home/config" -name '*.new')" ] || { echo "FAIL: temporary files left"; exit 1; }
first=$(fp)

# --- later runs keep it: no new key, the owner's own changes to the files kept, the choice from the pin
chmod 644 "$k"
expect "a later run (MAINNET_FAUCET from the pin)" ACCEPTED "$(run PUBLIC_RPC=1)"
[ "$(fp)" = "$first" ] || { echo "FAIL: the key was replaced"; exit 1; }
[ "$(stat -c '%a' "$k")" = 600 ] || { echo "FAIL: the key's mode was not put back to 600"; exit 1; }
echo 0.5 > "$M/home/config/faucet-amount"
expect "a later run keeps the owner's limits" ACCEPTED "$(run)"
[ "$(val faucet-amount)/$(val faucet-pow-amount)/$(val faucet-day-budget)" = 0.5/5/200 ] || { echo "FAIL: limits not kept"; exit 1; }
expect "new limits given" ACCEPTED "$(run FAUCET_POW_AMOUNT=2.5 FAUCET_DAY_BUDGET=150)"
[ "$(val faucet-amount)/$(val faucet-pow-amount)/$(val faucet-day-budget)" = 0.5/2.5/150 ] || { echo "FAIL: limits not changed"; exit 1; }
[ "$(fp)" = "$first" ] || { echo "FAIL: the key was replaced"; exit 1; }
echo 'x' > "$M/home/config/faucet-day-budget"
expect "an invalid limits file" refused "$(run)" "FAUCET_DAY_BUDGET=x"
echo 150 > "$M/home/config/faucet-day-budget"
expect "the sentry later without a public RPC" refused "$(run PUBLIC_RPC=0)" "needs PUBLIC_RPC=1"
cp "$k" "$T/key.bak"; echo 0x2222222222222222222222222222222222222222222222222222222222222222 > "$k"
expect "another key in place of the one it made" refused "$(run)" "is not the faucet key"
cp "$T/key.bak" "$k"

# --- turning it off: MAINNET_FAUCET=0 while the key is there is refused with the steps; without it, off
expect "MAINNET_FAUCET=0 with the key still there" refused "$(run MAINNET_FAUCET=0 PUBLIC_RPC=1)" "move its funds out"
rm -f "$k" "$M/home/config/faucet-amount" "$M/home/config/faucet-pow-amount" "$M/home/config/faucet-day-budget"
expect "MAINNET_FAUCET=0 once the key is deleted" ACCEPTED "$(run MAINNET_FAUCET=0 PUBLIC_RPC=1)"; nokey sentry
grep -qx 'MAINNET_FAUCET=0' "$M/etc/pinned-chain.env" && ! grep -q FAUCET_KEY_SHA256 "$M/etc/pinned-chain.env" \
  || { echo "FAIL: the faucet is still recorded: $(cat "$M/etc/pinned-chain.env")"; exit 1; }
expect "a later run stays off" ACCEPTED "$(run PUBLIC_RPC=1)"; nokey sentry
echo "mainnet faucet checks: all passed"
