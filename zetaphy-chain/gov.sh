#!/bin/bash
# ZETAPHY on-chain governance in one command (stage 2: "vote on upgrades").
# Run on the node as the node user. Every change to the chain goes through a
# public vote: a proposal needs a 1,000 ZETAPHY deposit, staked ZETAPHY votes,
# and the result runs automatically (an upgrade stops the chain at the agreed
# height so every validator switches binary at the same block).
#
#   gov.sh propose-upgrade <name> <height> "<summary>"   schedule a binary upgrade
#   gov.sh propose-text "<title>" "<summary>"            a signalling vote, no code change
#   gov.sh propose-file <proposal.json | https URL>      submit a prepared proposal (e.g. zetaphy-chain/proposals/*.json)
#   gov.sh propose-min-gas-price <gwei>                 chain-wide lowest gas price, e.g. 1 (0.000021 ZETAPHY a transfer)
#   gov.sh vote <id> yes|no|abstain|no_with_veto
#   gov.sh status [id]                                   one proposal, or all of them
#   gov.sh broadcast <signed-tx.json>                    broadcast a transaction signed offline (multisig: tx multisign)
#   gov.sh plan                                          the upgrade the chain is waiting for
#   gov.sh propose-ratelimit <denom> <channel> <send%> <recv%> <hours>
#                                                        cap IBC flow of a denom on a channel
#   gov.sh ratelimits                                    the IBC limits in force
#   gov.sh delegate <zetaphyvaloper1…> <ZETAPHY> [key]   stake from a fund (default community)
#   gov.sh validators                                    who validates, and their share
#   gov.sh transfer <zetaphy1…|0x…> <ZTPHY> --from <key>  a plain bank send (decimals allowed); a multisig: --from <its
#                                                        zetaphy1…> --generate-only <file>, then tx multisign + broadcast
#   gov.sh airdrop <list> [ZETAPHY each] [key]           airdrop: send to every 0x…/zetaphy1… in a file (one per line,
#                                                        "address,amount" also works); testnet: default 100 each from community;
#                                                        shows the total first, pays each address once (SEND=1: no question).
#                                                        Mainnet: AIRDROP_MAINNET=1, default 10 each from the "airdrop" hot key,
#                                                        each batch confirmed in a block before it counts (docs/AIRDROP.md)
#   gov.sh quantum-lock <ML-DSA controller>              hand the FROM account to a PQ account, for good
#   gov.sh vote-key                                      register or replace this node's ML-DSA vote key
#   gov.sh pq-evidence on|off                            propose to stop (on) / resume (off) slashing on
#                                                        ed25519-only double-sign evidence for
#                                                        validators with an ML-DSA vote key
#   gov.sh neuro <action> [value] <NeuroControl 0x…>     a vote that steers Neuro (not the coin):
#     pause | unpause | approve-skill ID | revoke-skill ID | set-active-skill ID | approve-defender 0x…
#     remove-defender 0x… | release 0x… | set-max-bodies N | set-max-regrow N | set-community-fund 0x…
#     approve-chain KEY | remove-chain KEY   (chain keys NeuroJobs takes requests for, e.g. bsc)
#     set-challenge-bond ZETAPHY | set-challenge-window SECONDS | set-defender-timeout SECONDS
#   ---- security core (docs/SECURITY-CORE.md) ----
#   gov.sh security                                      Q-day, threat gate and IBC hold settings in force
#   gov.sh qday <height> [reveal-delay-blocks]           propose Q-day (0 = unschedule): ECDSA-signed txs refused from it
#   gov.sh threat-gate <ThreatRegistry 0x…> on|off       propose the threat gate (enforced flags need the sender's consent)
#   gov.sh ibc-hold <delay-seconds> [guardian]           propose the IBC large-transfer hold delay and guardian
#   gov.sh ibc-hold-rule <denom|*> <min-amount> <bps>    propose when an inbound transfer is held (0 0 removes the rule; "*": bps from min-amount up)
#   gov.sh ibc-holds                                     inbound transfers waiting
#   ---- v5 protocol research (docs/future/chain-protocol.md; all off until voted) ----
#   gov.sh ai-model <model.hex | ->                      propose the AI precompile's model (tools/gbdt-export.mjs; - removes it)
#   gov.sh immune '<json>'                               immune system settings, e.g. '{"enabled":true,"enforce_bps":9000,"hold_bps":8000}'
#   gov.sh breaker '<json>'                              watch a bridge (circuit breaker); "enabled":false stops watching it
#   gov.sh breaker-rearm <bridge 0x…>                    let a tripped breaker fire again (after governance unpaused the bridge)
#   gov.sh model-epochs <ModelEpochs 0x… | ->            propose the Neuro model registry the chain reads (ModelAt; - removes it)
#   gov.sh model-at <height>                             the Neuro model version in force at a height (state after height-1)
#   gov.sh invariant-firewall <InvariantFirewall 0x… | ->  propose the node-level invariant firewall (docs/CHAIN-FIREWALL.md; - turns it off)
#   gov.sh ibc-hold-cancel <id>                          the guardian (FROM) returns a held transfer to its sender
#   gov.sh ibc-usdc-denom <channel>                      USDC from Noble via that channel: ibc/<hash>, ERC-20 0x…
#   gov.sh ibc-usdc-ratelimit <channel> [send%] [recv%] [hours]   cap USDC on it, or change the cap (default 1 1 24)
#   gov.sh ibc-usdc-erc20 <channel>                      USDC as an ERC-20 (MetaMask, explorer, DEX token lists)
#   gov.sh ibc-usdc-metadata <channel>                   its bank metadata (USDC, 6 decimals) for a genesis / upgrade
#   gov.sh erc20-register <0x…> [0x…]                    ERC-20 tokens made on ZETAPHY become coins (erc20/0x…) that IBC can carry
#                                                        (a vote, or a plain tx when registration is permissionless)
#   gov.sh ibc-send <channel> <ZETAPHY|0x…|denom> <amount> <receiver>
#                                                        send from FROM over IBC (amount in base units: 18 decimals for ZETAPHY);
#                                                        an ERC-20 is converted to its coin first
#   ---- CosmWasm (README.md, stage 7) ----
#   gov.sh wasm-store <file.wasm> "<title>" [everybody|nobody|zetaphy1…,zetaphy1…]
#                                                        propose storing contract code (who may instantiate it; default everybody)
#   gov.sh wasm-upload-access nobody|everybody|zetaphy1…,zetaphy1…   propose who may store code without a vote (default: nobody)
#   gov.sh wasm-codes                                    stored contract codes and the upload rule in force
#
# Env (defaults match setup-node.sh): NODE_HOME, KEYS_DIR, FROM (key name),
# ZETAPHYD, NODE (CometBFT RPC), CHAIN_ID, DEPOSIT (azetaphy).
#
# ---- mainnet (docs/ZETAPHY-MAINNET-PROCEDURE.md) ----
# On a node pinned to a chain (setup-node.sh's pinned-chain mode: /etc/zetaphy/pinned-chain.env, or PINNED=<file>),
# or with --network mainnet (NETWORK=mainnet), gov.sh runs in mainnet mode:
#   - the chain id is read from the pinned genesis ($NODE_HOME/config/genesis.json, or GENESIS_FILE), whose sha256 must
#     be the pin's; --chain-id (CHAIN_ID) is only a cross-check (without a pin file it is required). The testnet's
#     chain id is refused, and every transaction first checks that the node (NODE) serves that chain id.
#   - the gas price and the deposit come from the chain: the genesis's minimum gas price and bond denom, and the
#     full min_deposit of `q gov params` (DEPOSIT overrides it).
#   - keys: --keyring-backend file|os|ledger (KEYRING_BACKEND; default file, KEYS_DIR default ~/.zetaphy-keys); never
#     test. ledger: the key (--from, FROM) must be a Ledger key in the keyring (keys add <name> --ledger), signed with
#     amino-json on the device. --from <key name or zetaphy1… address> (FROM).
#   - a multisig: --generate-only <file> (GENERATE_ONLY) writes the unsigned transaction from --from <the multisig's
#     zetaphy1… address> (fixed gas: GAS, default 900000) and prints the signing steps (tx sign --multisig by each
#     member, tx multisign, then gov.sh broadcast <signed.json>).
#   - airdrop only with AIRDROP_MAINNET=1 (the owner's push airdrop of 2026-11-14, docs/AIRDROP.md): a dry run unless
#     SEND=1 or y at the question; MAX_EACH default 10; one transaction in flight, each confirmed in a block (code 0)
#     before its addresses go in the ledger; an unconfirmed batch is kept in <ledger>.pending and checked first.
# Without a pin file and without --network mainnet: the testnet, exactly as before (test keyring, zetaphy_77390-1).
set -euo pipefail
# options for mainnet mode, anywhere after the command; taken out before the command reads its arguments
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --network|--keyring-backend|--chain-id|--from|--generate-only|--keyring-dir)
      [ $# -ge 2 ] || { echo "$1 needs a value"; exit 2; }
      case "$1" in
        --network) NETWORK=$2 ;; --keyring-backend) KEYRING_BACKEND=$2 ;; --chain-id) CHAIN_ID=$2 ;;
        --from) FROM=$2 ;; --generate-only) GENERATE_ONLY=$2 ;; --keyring-dir) KEYS_DIR=$2 ;;
      esac
      shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
set -- "${args[@]+"${args[@]}"}"
ZETAPHYD=${ZETAPHYD:-/usr/local/bin/zetaphyd}
NODE_HOME=${NODE_HOME:-$HOME/.zetaphy}
PINNED=${PINNED:-/etc/zetaphy/pinned-chain.env}
NETWORK=${NETWORK:-}
[ -z "$NETWORK" ] || [ "$NETWORK" = mainnet ] || [ "$NETWORK" = testnet ] || { echo "--network: mainnet or testnet"; exit 2; }
MAINNET=""
if [ "$NETWORK" = mainnet ] || { [ -z "$NETWORK" ] && [ -f "$PINNED" ]; }; then MAINNET=1; fi
[ "$NETWORK" != testnet ] || [ ! -f "$PINNED" ] || { echo "refused: this node is pinned to a chain ($PINNED): it is not the testnet"; exit 1; }
if [ -z "$MAINNET" ]; then
  for v in KEYRING_BACKEND GENERATE_ONLY; do
    [ -z "${!v:-}" ] || { echo "$v / --$(echo "$v" | tr 'A-Z_' 'a-z-') is for mainnet mode (--network mainnet, or a pinned node); the testnet uses the test keyring"; exit 2; }
  done
fi
CHAIN_ID_GIVEN=${CHAIN_ID:-}
KEYS_DIR=${KEYS_DIR:-$([ -n "$MAINNET" ] && echo "$HOME/.zetaphy-keys" || echo "$HOME/.zetaphy-genesis-keys")}
FROM_GIVEN=${FROM:-}
FROM=${FROM:-validator}
NODE=${NODE:-tcp://127.0.0.1:26657}
CHAIN_ID=${CHAIN_ID:-zetaphy_77390-1}
DEPOSIT_GIVEN=${DEPOSIT:-}
DEPOSIT=${DEPOSIT:-1000000000000000000000azetaphy}   # 1,000 ZETAPHY
REPO=${REPO:-pospos191-alt/zetaphy}
SETUP_URL=${SETUP_URL:-https://raw.githubusercontent.com/$REPO/main/zetaphy-chain/setup-node.sh}
RELEASE_BASE=${RELEASE_BASE:-https://github.com/$REPO/releases/download}
GAS_PRICES=1000000000azetaphy
KEYRING="--keyring-backend test"
SIGN_MODE=""

if [ -n "$MAINNET" ]; then
  if [ -f "$PINNED" ]; then
    pin() { sed -n "s/^$1=\([0-9a-f]*\)\$/\1/p" "$PINNED" | head -1; }
    p_sha=$(pin GENESIS_SHA256); p_evm=$(pin GENESIS_EVM_CHAIN_ID)
    [[ "$p_sha" =~ ^[0-9a-f]{64}$ ]] && [[ "$p_evm" =~ ^[1-9][0-9]*$ ]] || { echo "refused: $PINNED is not a pin file (GENESIS_SHA256, GENESIS_EVM_CHAIN_ID)"; exit 1; }
    G=${GENESIS_FILE:-$NODE_HOME/config/genesis.json}
    [ -f "$G" ] && echo "$p_sha  $G" | sha256sum -c --quiet - 2>/dev/null || { echo "refused: $G is not the pinned genesis (sha256 $p_sha, $PINNED)"; exit 1; }
    g=$(jq -r '[.chain_id, .app_state.staking.params.bond_denom, (.app_state.feemarket.params.min_gas_price | tostring | split(".")[0])] | @tsv' "$G") \
      || { echo "refused: cannot read $G"; exit 1; }
    read -r g_chain g_denom g_gas <<<"$g"
    [ -z "$CHAIN_ID_GIVEN" ] || [ "$CHAIN_ID_GIVEN" = "$g_chain" ] || { echo "refused: --chain-id $CHAIN_ID_GIVEN, but the pinned genesis is $g_chain"; exit 1; }
    CHAIN_ID=$g_chain; EVM_CHAIN_ID=$p_evm
    [[ "$g_denom" =~ ^[a-z][a-z0-9]{2,63}$ ]] && [[ "$g_gas" =~ ^[1-9][0-9]*$ ]] || { echo "refused: $G: bond denom / min gas price ($g_denom / $g_gas)"; exit 1; }
    GAS_PRICES=$g_gas$g_denom
  else
    [ -n "$CHAIN_ID_GIVEN" ] || { echo "refused: mainnet mode without a pin file ($PINNED): pass --chain-id <the mainnet's chain id>"; exit 1; }
  fi
  [[ "$CHAIN_ID" =~ ^[a-z][a-z0-9]*_[0-9]+-[0-9]+$ ]] || { echo "refused: chain id $CHAIN_ID"; exit 1; }
  [ "$CHAIN_ID" != zetaphy_77390-1 ] || { echo "refused: zetaphy_77390-1 is the testnet; mainnet mode is for another chain"; exit 1; }
  EVM_CHAIN_ID=${EVM_CHAIN_ID:-$(echo "$CHAIN_ID" | sed -E 's/^[a-z0-9]*_([0-9]+)-.*/\1/')}
  KEYRING_BACKEND=${KEYRING_BACKEND:-file}
  case "$KEYRING_BACKEND" in
    file|os) KEYRING="--keyring-backend $KEYRING_BACKEND" ;;
    ledger)  KEYRING="--keyring-backend ${LEDGER_KEYRING_BACKEND:-file}"; SIGN_MODE="--sign-mode amino-json" ;;
    test)    echo "refused: --keyring-backend test on mainnet (an unencrypted keyring): use file, os or ledger"; exit 1 ;;
    *)       echo "--keyring-backend: file, os or ledger"; exit 2 ;;
  esac
  case "${1:-}" in
    airdrop) [ "${AIRDROP_MAINNET:-}" = 1 ] || { echo "refused: gov.sh airdrop on mainnet moves real ZTPHY: set AIRDROP_MAINNET=1 (the owner's push airdrop, docs/AIRDROP.md \"Push airdrop on mainnet\"); the SWD rounds are claimed from their contract"; exit 1; } ;;
  esac
fi

# Flags go after the subcommand: zetaphyd rejects tx/query flags placed before it.
QF="--home $NODE_HOME --node $NODE -o json"
TXF="--home $NODE_HOME --node $NODE $KEYRING --keyring-dir $KEYS_DIR --from $FROM --chain-id $CHAIN_ID --gas auto --gas-adjustment 1.5 --gas-prices $GAS_PRICES${SIGN_MODE:+ $SIGN_MODE} -y -o json"
if [ -n "${GENERATE_ONLY:-}" ]; then
  # an unsigned tx for a multisig: no simulation (the multisig has no public key on chain yet), fixed gas
  TXF="--home $NODE_HOME --node $NODE $KEYRING --keyring-dir $KEYS_DIR --from $FROM --chain-id $CHAIN_ID --gas ${GAS:-900000} --gas-prices $GAS_PRICES --generate-only"
fi

# Mainnet: before the first transaction, the node must serve the chain id this runs for (and the key must be
# what --keyring-backend says).
MAINNET_CHECKED=""
mainnet_preflight() {
  [ -n "$MAINNET" ] && [ -z "$MAINNET_CHECKED" ] || return 0
  MAINNET_CHECKED=1
  local net
  net=$("$ZETAPHYD" status --home "$NODE_HOME" --node "$NODE" 2>/dev/null | jq -r '.node_info.network // .NodeInfo.network // empty') || true
  [ "$net" = "$CHAIN_ID" ] || { echo "refused: the node at $NODE serves chain ${net:-<no answer>}, not $CHAIN_ID: nothing signed"; exit 1; }
  if [ "${KEYRING_BACKEND:-}" = ledger ] && [ -z "${GENERATE_ONLY:-}" ]; then
    local t
    t=$("$ZETAPHYD" keys show "$FROM" $KEYRING --keyring-dir "$KEYS_DIR" --home "$NODE_HOME" --output json 2>/dev/null | jq -r '.type // empty') || true
    [ "$t" = ledger ] || { echo "refused: --keyring-backend ledger, but \"$FROM\" is not a Ledger key in $KEYS_DIR (keys add $FROM --ledger)"; exit 1; }
  fi
  echo "mainnet $CHAIN_ID: $([ -n "${GENERATE_ONLY:-}" ] && echo "unsigned tx from $FROM" || echo "key $FROM ($KEYRING_BACKEND keyring $KEYS_DIR)")"
}

# Runs a tx; prints the chain's error (not a silent exit) when it is refused.
send() {
  local out
  if [ -n "$MAINNET" ]; then
    mainnet_preflight
    if [ -n "${GENERATE_ONLY:-}" ]; then
      out=$("$ZETAPHYD" "$@" $TXF 2>&1) || { echo "rejected: $(echo "$out" | grep -m1 -E 'rpc error|Error' || echo "$out" | tail -1)"; exit 1; }
      echo "$out" | tail -1 > "$GENERATE_ONLY"
      jq -e '.body.messages | length > 0' "$GENERATE_ONLY" >/dev/null 2>&1 || { echo "rejected: no unsigned transaction came out: $(tail -c 300 "$GENERATE_ONLY")"; exit 1; }
      echo "unsigned transaction written to $GENERATE_ONLY (from $FROM, chain $CHAIN_ID); nothing was sent. Next:"
      echo "  each member: zetaphyd tx sign $GENERATE_ONLY --multisig $FROM --from <member key> --chain-id $CHAIN_ID --node $NODE --sign-mode amino-json --output-document <member>.json"
      echo "  then:        zetaphyd tx multisign $GENERATE_ONLY <multisig key name> <member1>.json <member2>.json --chain-id $CHAIN_ID --node $NODE > signed.json"
      echo "  and:         gov.sh broadcast signed.json"
      exit 0
    fi
    # the keyring may ask for its passphrase (or the Ledger for a confirmation): its prompt stays visible
    local errf; errf=$(mktemp)
    out=$("$ZETAPHYD" "$@" $TXF 2> >(tee "$errf" >&2)) || { sleep 0.2; echo "rejected: $(grep -m1 -E 'rpc error|Error' "$errf" || tail -1 "$errf")"; rm -f "$errf"; exit 1; }
    rm -f "$errf"
  else
    out=$("$ZETAPHYD" "$@" $TXF 2>&1) || { echo "rejected: $(echo "$out" | grep -m1 -E 'rpc error|Error' || echo "$out" | tail -1)"; exit 1; }
  fi
  out=$(echo "$out" | tail -1)
  [ "$(echo "$out" | jq -r .code 2>/dev/null)" = 0 ] || { echo "rejected: $(echo "$out" | jq -r .raw_log 2>/dev/null || echo "$out")"; exit 1; }
  SENT=$out
}

# bech32 (BIP-173) in bash arithmetic, for airdrop lists of 100,000 addresses (a zetaphyd call per address would take
# an hour): 0x… -> zetaphy1…, and the checksum of a zetaphy1… address. The airdrop checks the first conversion
# against `zetaphyd debug addr` before it trusts the rest.
B32=qpzry9x8gf2tvdw0s3jn54khce6mua7l
B32_G=(); for ((b = 0; b < 32; b++)); do g=0
  ((b & 1)) && : $((g ^= 0x3b6a57b2)); ((b & 2)) && : $((g ^= 0x26508e6d)); ((b & 4)) && : $((g ^= 0x1ea119fa))
  ((b & 8)) && : $((g ^= 0x3d4233dd)); ((b & 16)) && : $((g ^= 0x2a1462b3)); B32_G[b]=$g; done
unset b g
b32_init() { # the polymod state after the human-readable part
  local h=$1 i o c=1; B32_HRP=$h
  for ((i = 0; i < ${#h}; i++)); do printf -v o '%d' "'${h:i:1}"; : $((c = ((c & 0x1ffffff) << 5 ^ o >> 5) ^ B32_G[c >> 25])); done
  : $((c = ((c & 0x1ffffff) << 5) ^ B32_G[c >> 25]))
  for ((i = 0; i < ${#h}; i++)); do printf -v o '%d' "'${h:i:1}"; : $((c = ((c & 0x1ffffff) << 5 ^ (o & 31)) ^ B32_G[c >> 25])); done
  B32_H=$c
}
hex_to_bech32() { # 0x + 40 hex -> B32_OUT
  local hex=${1#0x} i j v d c=$B32_H s=""
  for ((i = 0; i < 40; i += 10)); do v=$((16#${hex:i:10}))
    for ((j = 35; j >= 0; j -= 5)); do : $((d = v >> j & 31, c = ((c & 0x1ffffff) << 5 ^ d) ^ B32_G[c >> 25])); s+=${B32:d:1}; done
  done
  for ((j = 0; j < 6; j++)); do : $((c = ((c & 0x1ffffff) << 5) ^ B32_G[c >> 25])); done
  : $((c ^= 1)); for ((j = 25; j >= 0; j -= 5)); do s+=${B32:c >> j & 31:1}; done
  B32_OUT=${B32_HRP}1$s
}
bech32_ok() { # a lower-case <hrp>1… address whose checksum is right
  local t=${1#"${B32_HRP}1"} i p c=$B32_H
  for ((i = 0; i < ${#t}; i++)); do p=${B32%%"${t:i:1}"*}; : $((c = ((c & 0x1ffffff) << 5 ^ ${#p}) ^ B32_G[c >> 25])); done
  ((c == 1))
}

# Mainnet: the deposit of a proposal is the chain's full min_deposit (voting starts at once), unless DEPOSIT is set.
if [ -n "$MAINNET" ] && [ -z "$DEPOSIT_GIVEN" ]; then
  case "${1:-}" in
    propose-*|pq-evidence|neuro|qday|threat-gate|ibc-hold|ibc-hold-rule|ai-model|immune|breaker|breaker-rearm|model-epochs|invariant-firewall|erc20-register|ibc-usdc-ratelimit|wasm-store|wasm-upload-access)
      DEPOSIT=$("$ZETAPHYD" q gov params $QF 2>/dev/null | jq -r '(.params // .).min_deposit[0] | "\(.amount)\(.denom)"') || DEPOSIT=""
      [[ "$DEPOSIT" =~ ^[1-9][0-9]*[a-z][a-z0-9]+$ ]] || { echo "refused: could not read the chain's min_deposit (q gov params); set DEPOSIT=<amount><denom>"; exit 1; } ;;
  esac
fi

# Before a binary-upgrade vote (the 2026-10-29 testnet stop at block 123343 is why):
#  - the upgrade must exist in the current release on main, or the chain would stop at the height
#    with no binary that can go on;
#  - if the binary running here already has the handler, the upgrade must be one that may run
#    early (zetaphyEarlyUpgrades, evmd/zetaphy_upgradeguard.go); otherwise x/upgrade stops the
#    chain one block after the vote passes ("BINARY UPDATED BEFORE TRIGGER").
# FORCE=1 skips these checks.
upgrade_preflight() {
  local name=$1 height=$2 setup tag const early
  [ "${FORCE:-}" = 1 ] && { echo "FORCE=1: upgrade checks skipped"; return 0; }
  local sf; sf=$(mktemp)
  curl -fsSL "$SETUP_URL" -o "$sf" || { echo "cannot read $SETUP_URL to check the upgrade (FORCE=1 skips)"; exit 1; }
  setup=$(cat "$sf"); tag="zetaphyd-$(sha256sum "$sf" | cut -c1-12)"; unlink "$sf"
  const=$(grep -oE "^\+?[[:space:]]*(const )?Zetaphy[A-Za-z0-9]*UpgradeName *= *\"$name\"" <<<"$setup" | grep -oE 'Zetaphy[A-Za-z0-9]*UpgradeName' | head -n 1 || true)
  [ -n "$const" ] || { echo "refused: no release on main has an upgrade handler named \"$name\"; the chain would stop at block $height with no binary to go on"; exit 1; }
  curl -fsSIL "$RELEASE_BASE/$tag/SHA256SUMS" >/dev/null 2>&1 || { echo "refused: release $tag (with \"$name\") is not built yet; wait for the release-zetaphyd workflow"; exit 1; }
  early=no
  grep -qE "^\+?[[:space:]]+$const: true," <<<"$setup" && early=yes
  if grep -aqF "$name" "$ZETAPHYD" 2>/dev/null && [ "$early" = no ]; then
    echo "refused: the zetaphyd running here already has the \"$name\" handler, and \"$name\" may not run early:"
    echo "the chain would stop one block after the vote passes. Run the previous release until block $height"
    echo "(sudo zetaphy-validator upgrade-watch moves the node to $tag when the chain stops there)."
    exit 1
  fi
  echo "upgrade \"$name\" at block $height: release $tag"
  if [ "$early" = yes ]; then
    echo "  validators may install $tag any time before block $height (sudo zetaphy-validator update);"
    echo "  the chain does not stop. A node still on an older binary stops at $height until it updates,"
    echo "  which the zetaphy-upgrade timer does by itself within a minute."
  else
    echo "  validators keep the current binary until block $height, where the chain stops; the"
    echo "  zetaphy-upgrade timer (sudo zetaphy-validator update installs it) then moves each node to $tag."
  fi
}

# The plan's info: the SHA-256 of each zetaphyd of the release (cosmovisor format). setup-node.sh installs a
# binary that carries this upgrade's handler only if it matches (internal review 2026-11-10, Z-04).
upgrade_info() {
  local sf tag sums
  sf=$(mktemp)
  curl -fsSL "$SETUP_URL" -o "$sf" || { unlink "$sf"; echo "cannot read $SETUP_URL for the release checksums" >&2; return 1; }
  tag="zetaphyd-$(sha256sum "$sf" | cut -c1-12)"; unlink "$sf"
  sums=$(curl -fsSL "$RELEASE_BASE/$tag/SHA256SUMS") || { echo "cannot read $RELEASE_BASE/$tag/SHA256SUMS" >&2; return 1; }
  awk -v base="$RELEASE_BASE/$tag" '$2 ~ /^zetaphyd-linux-(amd64|arm64)$/ && $1 ~ /^[0-9a-f]{64}$/ {a=$2; sub("zetaphyd-","",a); sub("-","/",a); printf "%s\t%s/%s?checksum=sha256:%s\n", a, base, $2, $1}' <<<"$sums" \
    | jq -Rn '[inputs | split("\t") | {(.[0]): .[1]}] | add | if . == null then error("no zetaphyd in SHA256SUMS") else {binaries: .} end | tojson' -r
}

submit() { # the tx that submits the proposal, e.g.: tx gov submit-proposal <file>
  local before id=""
  before=$($ZETAPHYD q gov proposals $QF 2>/dev/null | jq -r '[.proposals[]?.id | tonumber] | max // 0')
  send "$@"
  # Wait for the block that includes it (blocks are ~5 s).
  for _ in $(seq 1 12); do
    sleep 2
    id=$($ZETAPHYD q gov proposals $QF 2>/dev/null | jq -r --argjson b "$before" '[.proposals[]?.id | tonumber | select(. > $b)] | max // empty')
    [ -n "$id" ] && break
  done
  [ -n "$id" ] || { echo "submitted, but no new proposal showed up yet: check with gov.sh status"; return; }
  echo "proposal $id submitted; vote with: gov.sh vote $id yes"
}

case "${1:-}" in
  propose-file)
    src=${2:?a proposal .json file or an https URL}; f=$(mktemp)
    if [[ "$src" =~ ^https:// ]]; then curl -fsSL "$src" -o "$f"; else cp "$src" "$f"; fi
    jq -e '.messages | type == "array"' "$f" >/dev/null || { echo "not a proposal file (no messages array)"; rm -f "$f"; exit 1; }
    echo "title: $(jq -r .title "$f")"
    jq -r '.messages[] | "  \(.["@type"]) -> \(.To // .authority // "")"' "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;
  propose-min-gas-price)
    # The feemarket base fee falls to this floor when blocks are empty, so
    # wallets never quote 0 and spam still pays. Every validator enforces it
    # (app.toml minimum-gas-prices is per node). 0 removes the floor.
    g=${2:?gwei, e.g. 1}
    [[ "$g" =~ ^([0-9]{1,3})(\.([0-9]{1,9}))?$ ]] || { echo "gwei: a number from 0 to 999, up to 9 decimals (e.g. 1 or 0.5)"; exit 1; }
    f9=$(printf '%-9s' "${BASH_REMATCH[3]}" | tr ' ' 0)   # gwei decimals -> wei
    wei=$((10#${BASH_REMATCH[1]} * 1000000000 + 10#$f9))
    gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
    params=$($ZETAPHYD q feemarket params $QF | jq -c '.params // .')
    echo "$params" | jq -e 'has("base_fee_change_denominator")' >/dev/null || { echo "could not read the feemarket params"; exit 1; }
    echo "now: min_gas_price $(echo "$params" | jq -r .min_gas_price) azetaphy, base_fee $(echo "$params" | jq -r .base_fee)"
    transfer=$(awk -v w="$wei" 'BEGIN { printf "%.9f", w * 21000 / 1e18 }')
    f=$(mktemp)
    jq -n --arg gov "$gov" --argjson p "$params" --arg m "$wei.000000000000000000" --arg d "$DEPOSIT" --arg g "$g" --arg t "$transfer" \
      '{messages:[{"@type":"/cosmos.evm.feemarket.v1.MsgUpdateParams",authority:$gov,params:($p + {min_gas_price:$m})}],
        metadata:"",deposit:$d,title:("Minimum gas price " + $g + " gwei"),
        summary:("The lowest gas price on ZETAPHY becomes " + $g + " gwei (a plain transfer costs " + $t + " ZETAPHY). Cheap for people, but spam still pays, and wallets never see a price of 0."),expedited:false}' > "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;
  propose-upgrade)
    name=${2:?name}; height=${3:?height}; summary=${4:?summary}
    [[ "$name" =~ ^[a-z0-9.-]{1,40}$ ]] || { echo "name: lowercase letters, digits, . and - only"; exit 1; }
    [[ "$height" =~ ^[0-9]+$ ]] || { echo "height must be a block number"; exit 1; }
    now=$($ZETAPHYD --home "$NODE_HOME" --node "$NODE" status | jq -r '.sync_info.latest_block_height')
    [ "$height" -gt "$((now + 100))" ] || { echo "height must be well after the current block ($now) so the vote can finish"; exit 1; }
    upgrade_preflight "$name" "$height"
    info=""
    if [ "${FORCE:-}" != 1 ]; then
      info=$(upgrade_info) || { echo "refused: the release checksums for the plan could not be read (FORCE=1 proposes without them)"; exit 1; }
      echo "  the plan pins: $(jq -c '.binaries | map_values(sub(".*checksum=sha256:"; ""))' <<<"$info")"
    fi
    gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
    f=$(mktemp)
    jq -n --arg gov "$gov" --arg name "$name" --arg h "$height" --arg d "$DEPOSIT" --arg s "$summary" --arg info "$info" \
      '{messages:[{"@type":"/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade",authority:$gov,plan:{name:$name,height:$h,info:$info}}],
        metadata:"",deposit:$d,title:("Upgrade to " + $name),summary:$s,expedited:false}' > "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;
  propose-text)
    title=${2:?title}; summary=${3:?summary}
    f=$(mktemp)
    # A proposal with no messages must carry metadata (SDK rule).
    jq -n --arg d "$DEPOSIT" --arg t "$title" --arg s "$summary" '{messages:[],metadata:$t,deposit:$d,title:$t,summary:$s,expedited:false}' > "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;
  broadcast)
    f=${2:?a signed transaction .json (zetaphyd tx multisign … > signed.json)}
    [ -f "$f" ] && jq -e '.body.messages and (.signatures | length > 0)' "$f" >/dev/null 2>&1 || { echo "not a signed transaction: $f"; exit 1; }
    if [ -n "$MAINNET" ]; then GENERATE_ONLY=""; mainnet_preflight; fi
    out=$("$ZETAPHYD" tx broadcast "$f" --home "$NODE_HOME" --node "$NODE" --chain-id "$CHAIN_ID" -o json 2>&1) || { echo "rejected: $(echo "$out" | tail -1)"; exit 1; }
    out=$(echo "$out" | tail -1)
    [ "$(echo "$out" | jq -r .code 2>/dev/null)" = 0 ] || { echo "rejected: $(echo "$out" | jq -r .raw_log 2>/dev/null || echo "$out")"; exit 1; }
    echo "broadcast: txhash $(echo "$out" | jq -r .txhash)" ;;
  vote)
    id=${2:?id}; opt=${3:?option}
    [[ "$opt" =~ ^(yes|no|abstain|no_with_veto)$ ]] || { echo "vote: yes, no, abstain or no_with_veto"; exit 1; }
    send tx gov vote "$id" "$opt"
    echo "voted $opt on proposal $id" ;;
  status)
    if [ -n "${2:-}" ]; then $ZETAPHYD q gov proposal "$2" $QF | jq '.proposal | {id, title, status, voting_end_time, final_tally_result}'
    else $ZETAPHYD q gov proposals $QF | jq -c '.proposals[] | {id, title, status}'; fi ;;
  plan)
    $ZETAPHYD q upgrade plan $QF 2>/dev/null || echo "no upgrade scheduled" ;;
  propose-ratelimit)
    # E.g. USDC from Noble: at most 10% of its supply on this chain may come
    # in or go out through channel-0 per 24 hours; a packet that would go
    # over is refused (the funds stay with the sender).
    denom=${2:?denom}; channel=${3:?channel}; send=${4:?send percent}; recv=${5:?recv percent}; hours=${6:?hours}
    [[ "$channel" =~ ^(channel-[0-9]+|[a-z0-9-]+-[0-9]+)$ ]] || { echo "channel: channel-N (or an IBC v2 client id)"; exit 1; }
    for n in "$send" "$recv"; do [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -le 100 ] || { echo "percent: 0 to 100"; exit 1; }; done
    [[ "$hours" =~ ^[1-9][0-9]*$ ]] || { echo "hours: a whole number above 0"; exit 1; }
    gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
    f=$(mktemp)
    jq -n --arg gov "$gov" --arg dn "$denom" --arg ch "$channel" --arg s "$send" --arg r "$recv" --arg h "$hours" --arg d "$DEPOSIT" \
      '{messages:[{"@type":"/ratelimit.v1.MsgAddRateLimit",authority:$gov,denom:$dn,channel_or_client_id:$ch,
        max_percent_send:$s,max_percent_recv:$r,duration_hours:$h}],
        metadata:"",deposit:$d,title:("IBC rate limit: " + $dn + " on " + $ch),
        summary:("At most " + $s + "% out / " + $r + "% in of the supply of " + $dn + " through " + $ch + " every " + $h + " hours."),expedited:false}' > "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;
  ratelimits)
    $ZETAPHYD q ratelimit list-rate-limits $QF ;;
  delegate)
    # Delegation program: the community fund stakes with new validators so
    # voting power does not stay with the first node.
    val=${2:?validator operator address}; amt=${3:?ZETAPHY}; key=${4:-community}
    [[ "$val" =~ ^zetaphyvaloper1[0-9a-z]{38}$ ]] || { echo "validator: zetaphyvaloper1… (gov.sh validators)"; exit 1; }
    [[ "$amt" =~ ^[1-9][0-9]*$ ]] || { echo "amount: whole ZETAPHY"; exit 1; }
    TXF=${TXF/--from $FROM/--from $key}
    send tx staking delegate "$val" "${amt}000000000000000000azetaphy"
    echo "delegated $amt ZETAPHY from $key to $val" ;;
  transfer)
    # A plain bank send from --from (never the default key: it must be named). From a multisig (the Community pool):
    # --from <its zetaphy1…> --generate-only unsigned.json writes the unsigned tx and prints the signing steps.
    to=${2:?receiver: zetaphy1… or 0x…}; amt=${3:?ZTPHY, e.g. 1000100 or 0.5}
    [ -n "$FROM_GIVEN" ] || { echo "transfer: name the sender with --from <key name | multisig zetaphy1…>"; exit 1; }
    b32_init zetaphy
    if [[ "$to" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
      hex_to_bech32 "$to"
      ref=$("$ZETAPHYD" debug addr "$to" 2>/dev/null | awk '/Bech32 Acc/ {print $3}') || ref=""
      [ "$ref" = "$B32_OUT" ] || { echo "refused: $to is $B32_OUT here, but zetaphyd debug addr says ${ref:-nothing}"; exit 1; }
      to=$B32_OUT
    fi
    [[ "$to" =~ ^zetaphy1[02-9ac-hj-np-z]{38}$ ]] && bech32_ok "$to" || { echo "receiver: a zetaphy1… address with a valid checksum, or 0x…"; exit 1; }
    [[ "$amt" =~ ^([0-9]{1,12})(\.([0-9]{1,18}))?$ ]] || { echo "amount: ZTPHY, up to 18 decimals (e.g. 1000100 or 0.5)"; exit 1; }
    frac=${BASH_REMATCH[3]}; zeros=000000000000000000
    base=$(echo "${BASH_REMATCH[1]}$frac${zeros:0:$((18 - ${#frac}))}" | sed 's/^0*//')
    [ -n "$base" ] || { echo "amount: above 0"; exit 1; }
    echo "transfer $amt ZTPHY ($base azetaphy) from $FROM to $to on $CHAIN_ID"
    if [ -z "${GENERATE_ONLY:-}" ] && [ "${SEND:-}" != 1 ] && [ -t 0 ]; then
      read -r -p "send it? [y/N] " ok; [[ "$ok" =~ ^[yY]$ ]] || { echo "nothing sent"; exit 0; }
    fi
    send tx bank send "$FROM" "$to" "${base}azetaphy"
    echo "sent (in the mempool; check with zetaphyd q tx <hash>): txhash $(echo "$SENT" | jq -r .txhash)" ;;
  airdrop)
    # Testnet: the coins anyone can get from the faucet, sent to a list at once. Mainnet (AIRDROP_MAINNET=1): the
    # owner's push airdrop of 2026-11-14 (docs/AIRDROP.md "Push airdrop on mainnet"), from the "airdrop" hot key.
    # Addresses are checked (bech32 checksum) and turned into zetaphy1… (0x… works too), duplicates dropped; nothing
    # is sent before the total is shown and confirmed. Paid addresses go to $AIRDROP_LEDGER, so running it again pays
    # only new ones. On mainnet a batch counts as paid only once it is in a block with code 0; until then it is kept in
    # <ledger>.pending (tx hash, sequence, timeout height, addresses) and the next run settles it before anything else.
    list=${2:?a file with one address per line (0x… or zetaphy1…), optionally "address,amount"}
    [ -r "$list" ] || { echo "cannot read $list"; exit 1; }
    if [ -n "$MAINNET" ]; then
      each=${3:-10}; key=${4:-airdrop}
      LEDGER=${AIRDROP_LEDGER:-$NODE_HOME/airdrop-$CHAIN_ID-paid.txt}
      MAX_EACH_GIVEN=${MAX_EACH:-}
      MAX_EACH=${MAX_EACH:-10}           # whole ZTPHY per address: the owner's 10; more only by setting MAX_EACH
      BATCH=${BATCH:-180}                # outputs per MsgMultiSend: ~23-35k gas each x 1.5 -> at most ~9.6M gas (docs/AIRDROP.md)
      MAX_TX_GAS=${MAX_TX_GAS:-10000000} # a batch whose gas limit is above this is refused (block max_gas 30,000,000)
      ADJ=${GAS_ADJUSTMENT:-1.5}
      TIMEOUT_BLOCKS=${AIRDROP_TIMEOUT_BLOCKS:-12}   # --timeout-height: a batch not in a block by then never will be
      WAIT=${AIRDROP_TIMEOUT:-180}       # seconds to wait for a block before stopping (the batch stays pending)
      POLL=${AIRDROP_POLL:-2}
      [ -z "${GENERATE_ONLY:-}" ] || { echo "refused: a push airdrop is hundreds of transactions; a multisig cannot sign them: move the coins to a hot key (docs/AIRDROP.md)"; exit 1; }
      [[ "$MAX_TX_GAS" =~ ^[1-9][0-9]*$ ]] && [ "$MAX_TX_GAS" -le 15000000 ] || { echo "MAX_TX_GAS: at most 15000000 (half a block)"; exit 1; }
      [[ "$TIMEOUT_BLOCKS" =~ ^[1-9][0-9]{0,3}$ && "$WAIT" =~ ^[1-9][0-9]*$ && "$POLL" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "AIRDROP_TIMEOUT_BLOCKS / AIRDROP_TIMEOUT / AIRDROP_POLL: numbers"; exit 1; }
      [[ "$ADJ" =~ ^[1-9](\.[0-9]{1,3})?$ ]] || { echo "GAS_ADJUSTMENT: e.g. 1.5"; exit 1; }
    else
      each=${3:-100}; key=${4:-community}
      LEDGER=${AIRDROP_LEDGER:-$NODE_HOME/airdrop-paid.txt}
      MAX_EACH=${MAX_EACH:-10000}   # whole ZETAPHY per address; a typo guard
      BATCH=${BATCH:-50}
    fi
    [[ "$each" =~ ^[1-9][0-9]{0,11}$ ]] || { echo "amount: whole ZETAPHY, e.g. 100"; exit 1; }
    [[ "$MAX_EACH" =~ ^[1-9][0-9]{0,11}$ ]] || { echo "MAX_EACH: whole ZETAPHY"; exit 1; }
    [[ "$BATCH" =~ ^[1-9][0-9]{0,3}$ ]] && [ "$BATCH" -le 1000 ] || { echo "BATCH: 1 to 1000 addresses a transaction"; exit 1; }
    if [ -n "$MAINNET" ] && [ "$each" -gt "$MAX_EACH" ]; then
      echo "refused: $each ZTPHY each is above MAX_EACH ($MAX_EACH$([ -z "$MAX_EACH_GIVEN" ] && echo ", the mainnet default")): set MAX_EACH=<whole ZTPHY> to allow it"; exit 1
    fi
    touch "$LEDGER"
    b32_init zetaphy

    if [ -n "$MAINNET" ]; then
      # one airdrop at a time on this ledger: never two transactions in flight
      if command -v flock >/dev/null; then exec 9>>"$LEDGER.lock"; flock -n 9 || { echo "refused: another gov.sh airdrop is running on $LEDGER"; exit 1; }; fi
      FROM=$key; mainnet_preflight
      PENDING=$LEDGER.pending
      unset KPASS
      if [ "$KEYRING" = "--keyring-backend file" ] && [ -t 0 ]; then
        # asked once and handed to each zetaphyd call on its stdin (never in a file, an argument or the environment)
        read -rs -p "passphrase of the keyring in $KEYS_DIR (asked once for the whole airdrop): " KPASS; echo
      fi
      kz() { if [ -n "${KPASS+x}" ]; then "$ZETAPHYD" "$@" <<<"$KPASS"$'\n'"$KPASS"; else "$ZETAPHYD" "$@" </dev/null; fi; }
      from=$(kz keys show "$key" -a $KEYRING --keyring-dir "$KEYS_DIR" --home "$NODE_HOME" 2>/dev/null | tail -1) || from=""
      [[ "$from" =~ ^zetaphy1[02-9ac-hj-np-z]{38}$ ]] || { echo "refused: no key \"$key\" in $KEYS_DIR ($KEYRING_BACKEND keyring), or a wrong passphrase"; exit 1; }
      AFL="--home $NODE_HOME --node $NODE $KEYRING --keyring-dir $KEYS_DIR --from $key --chain-id $CHAIN_ID${SIGN_MODE:+ $SIGN_MODE}"
      chain_height() { local h; h=$("$ZETAPHYD" status --home "$NODE_HOME" --node "$NODE" 2>/dev/null | jq -r '.sync_info.latest_block_height // .SyncInfo.latest_block_height // empty' 2>/dev/null) || h=""
        [[ "$h" =~ ^[0-9]+$ ]] && echo "$h"; }
      acct_seq() { local s; s=$("$ZETAPHYD" q auth account "$1" $QF 2>/dev/null | jq -r '[.. | objects | select(has("sequence")) | .sequence][0] // "0"' 2>/dev/null) || s=""
        [[ "$s" =~ ^[0-9]+$ ]] && echo "$s"; }
      pending_write() { # <txhash or -> <sequence> <timeout height> <batch k/n> <address>…
        local hash=$1 seq=$2 t=$3 b=$4; shift 4
        { printf 'txhash=%s\nsequence=%s\ntimeout_height=%s\nbatch=%s\nsender=%s\n--\n' "${hash#-}" "$seq" "$t" "$b" "$from"; printf '%s\n' "$@"; } >"$PENDING.tmp"
        mv -f "$PENDING.tmp" "$PENDING"
      }
      pv() { sed -n "s/^$1=//p" "$PENDING" | head -1; }
      # settle: what became of the batch in $PENDING. 0: in a block with code 0 (its addresses go in the ledger);
      # 1: failed in a block, or past its timeout height without being in one (not paid, may be sent again);
      # 2: cannot tell yet (kept pending). Waits for blocks up to $WAIT seconds.
      settle() {
        local hash seq t snd r h s until=$((SECONDS + WAIT))
        hash=$(pv txhash); seq=$(pv sequence); t=$(pv timeout_height); snd=$(pv sender)
        S_HEIGHT=""; S_CODE=""; S_LOG=""; S_HASH=$hash
        while :; do
          h=$(chain_height) || h=""
          r=""
          if [ -n "$hash" ]; then r=$("$ZETAPHYD" q tx "$hash" $QF 2>/dev/null) || r=""; fi
          if [ -z "$r" ] && { [ -z "$hash" ] || { [ -n "$h" ] && [ "$h" -gt "$t" ]; }; }; then
            # no hash, or not found: look the sender's sequence up (every signed tx carries tx.acc_seq)
            r=$("$ZETAPHYD" q txs --query "tx.acc_seq='$snd/$seq'" $QF 2>/dev/null | jq -c '(.txs // [])[0] // empty' 2>/dev/null) || r=""
          fi
          if [ -n "$r" ] && echo "$r" | jq -e '.txhash' >/dev/null 2>&1; then
            S_HASH=$(echo "$r" | jq -r .txhash); S_HEIGHT=$(echo "$r" | jq -r '.height // empty')
            S_CODE=$(echo "$r" | jq -r '.code // 0'); S_LOG=$(echo "$r" | jq -r '.raw_log // ""' | head -c 300)
            if [ "$S_CODE" = 0 ]; then sed '1,/^--$/d' "$PENDING" >>"$LEDGER"; rm -f "$PENDING"; return 0; fi
            rm -f "$PENDING"; return 1
          fi
          # two blocks past the timeout height (the tx index can trail the block by a moment): it never will be in one
          if [ -n "$h" ] && [ "$h" -gt $((t + 1)) ]; then
            s=$(acct_seq "$snd") || s=""
            if [ "$s" = "$seq" ]; then S_LOG="not in a block by its timeout height $t (the sender's sequence is still $seq)"; rm -f "$PENDING"; return 1; fi
            S_LOG="the sender's sequence moved from $seq to ${s:-<no answer>}, but the tx is not found"; return 2
          fi
          [ "$SECONDS" -lt "$until" ] || { S_LOG="no answer within ${WAIT}s (block ${h:-<no answer>}, timeout height $t)"; return 2; }
          sleep "$POLL"
        done
      }
      if [ -f "$PENDING" ]; then
        echo "an earlier batch ($(pv batch), tx $(pv txhash)) was not confirmed: checking it first"
        if settle; then echo "  it is in block $S_HEIGHT with code 0 (tx $S_HASH): its addresses are recorded as paid"
        else rc=$?
          if [ "$rc" = 1 ]; then echo "  not paid ($([ -n "$S_CODE" ] && echo "code $S_CODE in block $S_HEIGHT: $S_LOG" || echo "$S_LOG")): its addresses are sent again"
          else echo "refused: cannot tell yet whether that batch was paid: $S_LOG. Nothing sent. Run again later; $PENDING keeps it"; exit 1; fi
        fi
      fi
    fi

    declare -A want=() paidset=()
    order=()
    while IFS= read -r a || [ -n "$a" ]; do [ -n "$a" ] && paidset[$a]=1; done <"$LEDGER"
    bad=0; dup=0; paid=0; checked=""
    while IFS= read -r line || [ -n "$line" ]; do
      line=${line%%#*}; line=${line//[[:space:]]/}; [ -n "$line" ] || continue
      a=${line%%,*}; amt=$each; [[ "$line" == *,* ]] && amt=${line#*,}
      if ! [[ "$amt" =~ ^[1-9][0-9]{0,11}$ ]] || [ "$amt" -gt "$MAX_EACH" ]; then echo "skip (amount $amt): $a"; bad=$((bad + 1)); continue; fi
      if [[ "$a" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        h=$a; lc=${h,,}
        # never a person: the zero address, precompiles and system addresses (below 0x…10000), burn / placeholders
        if [[ "$lc" =~ ^0x0{36} || "$lc" =~ ^0x(e{40}|f{40}|0{36}dead|dead0{36})$ ]]; then echo "skip (system / precompile address): $h"; bad=$((bad + 1)); continue; fi
        hex_to_bech32 "$h"; a=$B32_OUT
        if [ -z "$checked" ]; then
          ref=$("$ZETAPHYD" debug addr "$h" 2>/dev/null | awk '/Bech32 Acc/ {print $3}') || ref=""
          [ -n "$ref" ] || ref=$("$ZETAPHYD" debug addr "${h#0x}" 2>/dev/null | awk '/Bech32 Acc/ {print $3}') || ref=""
          [ "$ref" = "$a" ] || { echo "refused: $h is $a here, but zetaphyd debug addr says ${ref:-nothing}: nothing sent"; exit 1; }
          checked=1
        fi
      elif ! [[ "$a" =~ ^zetaphy1[02-9ac-hj-np-z]{38}$ ]] || ! bech32_ok "$a"; then a=""; fi
      [ -n "$a" ] || { echo "skip (not an address): ${line%%,*}"; bad=$((bad + 1)); continue; }
      if [ -n "${want[$a]:-}" ]; then dup=$((dup + 1)); continue; fi
      if [ -n "${paidset[$a]:-}" ]; then paid=$((paid + 1)); continue; fi
      want[$a]=$amt; order+=("$a")
    done <"$list"
    n=${#order[@]}; total=0
    for a in "${order[@]}"; do total=$((total + want[$a])); done
    amounts=$(for a in "${order[@]}"; do echo "${want[$a]}"; done | sort -un)
    batches=0
    for amt in $amounts; do c=0; for a in "${order[@]}"; do [ "${want[$a]}" = "$amt" ] && c=$((c + 1)); done; batches=$((batches + (c + BATCH - 1) / BATCH)); done

    if [ -z "$MAINNET" ]; then
      from=$("$ZETAPHYD" keys show "$key" -a --keyring-backend test --keyring-dir "$KEYS_DIR" --home "$NODE_HOME" 2>/dev/null) || { echo "no key \"$key\" in $KEYS_DIR"; exit 1; }
      bal=$("$ZETAPHYD" q bank balances "$from" $QF | jq -r '[.balances[]? | select(.denom == "azetaphy") | .amount][0] // "0"')
      have=$(awk -v b="$bal" 'BEGIN { printf "%d", b / 1e18 }')
      echo "airdrop from $key ($from): $n addresses, $total ZETAPHY in all; the fund has $have ZETAPHY"
      echo "  skipped: $bad bad, $dup repeated, $paid paid before ($LEDGER)"
      [ "$n" -gt 0 ] || { echo "nothing to send"; exit 0; }
      awk -v t="$total" -v h="$have" 'BEGIN { exit !(t + 1 <= h) }' || { echo "refused: the fund has $have ZETAPHY, the airdrop needs $total (+ gas)"; exit 1; }
      if [ "${SEND:-}" != 1 ]; then
        [ -t 0 ] || { echo "dry run: nothing sent (SEND=1 sends)"; exit 0; }
        read -r -p "send $total ZETAPHY to $n addresses? [y/N] " ok
        [[ "$ok" =~ ^[yY]$ ]] || { echo "nothing sent"; exit 0; }
      fi
      TXF=${TXF/--from $FROM/--from $key}
      # one multi-send per amount and per $BATCH addresses; the ledger is written after each accepted batch
      for amt in $amounts; do
        group=(); for a in "${order[@]}"; do [ "${want[$a]}" = "$amt" ] && group+=("$a"); done
        for ((i = 0; i < ${#group[@]}; i += BATCH)); do
          part=("${group[@]:i:BATCH}")
          if [ ${#part[@]} -eq 1 ]; then send tx bank send "$key" "${part[0]}" "${amt}000000000000000000azetaphy"
          else send tx bank multi-send "$key" "${part[@]}" "${amt}000000000000000000azetaphy"; fi
          printf '%s\n' "${part[@]}" >>"$LEDGER"
          echo "sent $amt ZETAPHY each to ${#part[@]} addresses"
          sleep 6   # the next block, so the sender's sequence number moves on
        done
      done
      echo "airdrop done: $n addresses, $total ZETAPHY"; exit 0
    fi

    # ---- mainnet ----
    gp=${GAS_PRICES%%[!0-9]*}; gd=${GAS_PRICES#"$gp"}
    # the price actually charged: the feemarket base fee when it is above the genesis minimum
    bf=$("$ZETAPHYD" q feemarket base-fee $QF 2>/dev/null | jq -r '.base_fee // empty' 2>/dev/null) || bf=""
    if [[ "$bf" =~ ^([0-9]+)(\.([0-9]*))?$ ]]; then
      bfi=${BASH_REMATCH[1]}; [[ "${BASH_REMATCH[3]}" =~ [1-9] ]] && bfi=$((10#$bfi + 1))
      [ "${#bfi}" -le 15 ] && [ "$((10#$bfi))" -gt "$gp" ] && gp=$((10#$bfi))
    fi
    bal=$("$ZETAPHYD" q bank balances "$from" $QF 2>/dev/null | jq -r --arg d "$gd" '[.balances[]? | select(.denom == $d) | .amount][0] // "0"') || bal=""
    [[ "$bal" =~ ^[0-9]+$ ]] || { echo "refused: cannot read the balance of $from"; exit 1; }
    have=0; [ ${#bal} -le 18 ] || have=${bal:0:$((${#bal} - 18))}   # whole ZTPHY, rounded down
    # the gas reserve: every batch at the most it may cost (its gas limit is at most MAX_TX_GAS), at the price in force
    reserve=$(awk -v b="$batches" -v g="$MAX_TX_GAS" -v p="$gp" 'BEGIN { r = b * g * p / 1e18; printf "%d", (r == int(r)) ? r : int(r) + 1 }')
    echo "push airdrop on $CHAIN_ID from $key ($from): $n addresses, $total ZTPHY in all; the key has $have ZTPHY"
    echo "  skipped: $bad bad, $dup repeated, $paid paid before ($LEDGER)"
    [ "$bad" = 0 ] || { echo "refused: $bad lines of $list are not a clean address (above): prepare the list with node airdrop/cli.js push-list"; exit 1; }
    [ "$n" -gt 0 ] || { echo "nothing to send"; exit 0; }
    echo "  $batches batches of up to $BATCH addresses, one transaction in flight (each waits for its block, then the next block)"
    echo "  gas price $gp$gd; gas reserve $reserve ZTPHY ($batches batches x at most $MAX_TX_GAS gas)"
    [ "$have" -ge $((total + reserve)) ] || { echo "refused: the key has $have ZTPHY; the airdrop needs $total + $reserve gas reserve = $((total + reserve)) ZTPHY"; exit 1; }
    AFL="$AFL --gas-prices $gp$gd"
    bcmd() { # the tx of one batch, in BCMD: <amount> <address>…
      local amt=$1; shift
      if [ $# -eq 1 ]; then BCMD=(tx bank send "$key" "$1" "${amt}000000000000000000$gd")
      else BCMD=(tx bank multi-send "$key" "$@" "${amt}000000000000000000$gd"); fi
    }
    sim() { # simulate BCMD: SIM_GAS = the gas limit it would get (simulated x GAS_ADJUSTMENT). --generate-only with
      # --gas auto simulates with the key's own public key and signs nothing (--dry-run would need an address in
      # --from and simulate with a placeholder secp256k1 key, which an eth_secp256k1 chain may refuse).
      local o; SIM_GAS=""; SIM_ERR=""
      o=$(kz "${BCMD[@]}" $AFL --gas auto --gas-adjustment "$ADJ" --generate-only 2>&1 >/dev/null) || true
      SIM_GAS=$(echo "$o" | grep -oE 'gas estimate: [0-9]+' | tail -1 | grep -oE '[0-9]+$') || SIM_GAS=""
      [ -n "$SIM_GAS" ] || SIM_ERR=$(echo "$o" | grep -m1 -E 'rpc error|Error|error' || echo "$o" | tail -1)
      [ -n "$SIM_GAS" ]
    }
    first_amt=$(echo "$amounts" | head -1); first=()
    for a in "${order[@]}"; do [ "${want[$a]}" = "$first_amt" ] && first+=("$a"); [ ${#first[@]} -lt "$BATCH" ] || break; done
    bcmd "$first_amt" "${first[@]}"
    sim || { echo "refused: the first batch does not simulate: $SIM_ERR"; exit 1; }
    est=$(awk -v g="$SIM_GAS" -v k="${#first[@]}" -v n="$n" -v p="$gp" 'BEGIN { t = g / k * n; printf "%d gas, fee ~%.4f ZTPHY", t, t * p / 1e18 }')
    echo "  first batch: ${#first[@]} outputs, gas limit $SIM_GAS (simulated x $ADJ; cap $MAX_TX_GAS); whole airdrop ~$est"
    [ "$SIM_GAS" -le "$MAX_TX_GAS" ] || { echo "refused: a batch of ${#first[@]} needs $SIM_GAS gas, above MAX_TX_GAS $MAX_TX_GAS: set BATCH=$((${#first[@]} * MAX_TX_GAS * 9 / 10 / SIM_GAS))"; exit 1; }
    echo "  expected time: ~$(((batches * 11 + 59) / 60)) minutes (~11 s a batch with 5 s blocks)"
    if [ "${SEND:-}" != 1 ]; then
      [ -t 0 ] || { echo "dry run: nothing sent (SEND=1 sends)"; exit 0; }
      read -r -p "send $total ZTPHY to $n addresses in $batches batches on $CHAIN_ID? [y/N] " ok
      [[ "$ok" =~ ^[yY]$ ]] || { echo "nothing sent"; exit 0; }
    fi
    stop() { echo "STOPPED at batch $1: $2"; echo "  paid so far: $(sort -u "$LEDGER" | wc -l | tr -d ' ') addresses in $LEDGER; run the same command again to go on (only unpaid addresses are sent)"; exit 1; }
    k=0; sent=0
    for amt in $amounts; do
      group=(); for a in "${order[@]}"; do [ "${want[$a]}" = "$amt" ] && group+=("$a"); done
      for ((i = 0; i < ${#group[@]}; i += BATCH)); do
        part=("${group[@]:i:BATCH}"); k=$((k + 1)); b="$k/$batches"
        bcmd "$amt" "${part[@]}"
        sim || stop "$b" "the batch does not simulate: $SIM_ERR. Nothing sent for it"
        [ "$SIM_GAS" -le "$MAX_TX_GAS" ] || stop "$b" "gas limit $SIM_GAS is above MAX_TX_GAS $MAX_TX_GAS. Nothing sent for it; set a smaller BATCH"
        h0=$(chain_height) || stop "$b" "no block height from $NODE. Nothing sent for it"
        seq=$(acct_seq "$from") || stop "$b" "cannot read the sequence of $from. Nothing sent for it"
        t=$((h0 + TIMEOUT_BLOCKS))
        pending_write - "$seq" "$t" "$b" "${part[@]}"      # before the broadcast: a crash cannot lose it
        errf=$(mktemp); rc=0
        out=$(kz "${BCMD[@]}" $AFL --gas "$SIM_GAS" --timeout-height "$t" -y -o json 2>"$errf") || rc=$?
        out=$(echo "$out" | tail -1); err=$(grep -m1 -E 'rpc error|Error|error' "$errf" || tail -1 "$errf"); rm -f "$errf"
        code=$(echo "$out" | jq -r '.code // empty' 2>/dev/null) || code=""
        hash=$(echo "$out" | jq -r '.txhash // empty' 2>/dev/null) || hash=""
        if [ "$rc" = 0 ] && [ -n "$code" ] && [ "$code" != 0 ]; then
          rm -f "$PENDING"   # CheckTx refused it: it never entered the mempool
          stop "$b" "the node refused the tx (code $code: $(echo "$out" | jq -r '.raw_log // ""' | head -c 300)). Not paid"
        fi
        if [ "$rc" = 0 ] && [ "$code" = 0 ] && [ -n "$hash" ]; then pending_write "$hash" "$seq" "$t" "$b" "${part[@]}"
        else echo "batch $b: zetaphyd did not confirm the broadcast (${err:-no output}): checking the chain"; fi
        if settle; then
          sent=$((sent + ${#part[@]}))
          echo "batch $b: ${#part[@]} x $amt ZTPHY, tx $S_HASH in block $S_HEIGHT (code 0); $sent of $n paid"
        else
          rc=$?
          [ "$rc" = 1 ] && stop "$b" "tx ${S_HASH:-<none>} $([ -n "$S_CODE" ] && echo "failed in block $S_HEIGHT with code $S_CODE: $S_LOG" || echo "$S_LOG"). Not paid"
          stop "$b" "tx ${S_HASH:-<none>}: $S_LOG. Kept in $PENDING: the next run checks it first, so it is never paid twice"
        fi
        # the next block before the next tx: the sequence has moved on and the mempool holds nothing of ours
        [[ "$S_HEIGHT" =~ ^[0-9]+$ ]] || S_HEIGHT=$h0
        until_t=$((SECONDS + WAIT))
        while :; do
          h=$(chain_height) || h=""
          [ -n "$h" ] && [ "$h" -gt "$S_HEIGHT" ] && break
          [ "$SECONDS" -lt "$until_t" ] || stop "$b" "batch $b is paid, but no block came after $S_HEIGHT within ${WAIT}s"
          sleep "$POLL"
        done
      done
    done
    echo "airdrop done: $n addresses, $total ZTPHY; ledger $LEDGER ($(sort -u "$LEDGER" | wc -l | tr -d ' ') addresses)" ;;
  validators)
    $ZETAPHYD q staking validators $QF | jq -r '[.validators[] | select(.status=="BOND_STATUS_BONDED")] as $v
      | ($v | map(.tokens | tonumber) | add) as $t
      | $v[] | "\(.operator_address)  \(.description.moniker)  \((.tokens | tonumber) / $t * 100 | floor)%"' ;;
  pq-evidence)
    v=${2:?on or off}; [[ "$v" =~ ^(on|off)$ ]] || { echo "on or off"; exit 1; }
    submit tx pq-evidence-proposal "$v" --deposit "$DEPOSIT" ;;
  neuro)
    # The gov module calls NeuroControl as its owner: a MsgEVMCall whose
    # sender is the gov module (EVM address 0x7b5Fe22B5446f7C62Ea27B8BD71CeF94e03f3dF2,
    # the first 20 bytes of sha256("gov")). The calldata is built here, so
    # the node needs no Node.js; ID is a skill id from `zetaphy neuro skill-id`.
    act=${2:?action}
    declare -A SEL=([pause]=8456cb59 [unpause]=3f4ba83a [approve-skill]=53c91c08 [revoke-skill]=615ef428
      [set-active-skill]=dcad4460 [approve-defender]=ccaa1df0 [remove-defender]=874d8a07 [release]=19165587
      [set-max-bodies]=3f1f3008 [set-max-regrow]=ecd0e17e [set-community-fund]=37339a16
      [approve-chain]=2c003714 [remove-chain]=2ccde4b6
      [set-challenge-bond]=18c281a6 [set-challenge-window]=01c1aa0d [set-defender-timeout]=d1d4a2e5)
    sel=${SEL[$act]:-}; [ -n "$sel" ] || { echo "neuro: unknown action $act"; exit 1; }
    case "$act" in
      pause|unpause) arg=""; ctl=${3:?NeuroControl 0x…}; word="" ;;
      *) val=${3:?value}; ctl=${4:?NeuroControl 0x…}
         case "$act" in
           *-skill) [[ "$val" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "skill id: 0x + 64 hex (zetaphy neuro skill-id)"; exit 1; }; word=${val#0x} ;;
           set-max-*|set-challenge-window|set-defender-timeout)
                    [[ "$val" =~ ^[1-9][0-9]{0,5}$ ]] || { echo "a whole number above 0"; exit 1; }; word=$(printf '%064x' "$val") ;;
           set-challenge-bond)
                    # ZETAPHY (up to 18 decimals) -> wei -> 32-byte hex, by long division (bash has 64-bit numbers only).
                    [[ "$val" =~ ^([0-9]{1,12})(\.([0-9]{1,18}))?$ ]] || { echo "an amount of ZETAPHY, e.g. 2.5"; exit 1; }
                    frac=${BASH_REMATCH[3]}; zeros=000000000000000000; n=${BASH_REMATCH[1]}${frac}${zeros:0:$((18 - ${#frac}))}
                    n=$(echo "$n" | sed 's/^0*//'); [ -n "$n" ] || { echo "an amount of ZETAPHY above 0"; exit 1; }
                    word=""
                    while [ -n "$n" ]; do
                      q=""; r=0
                      for ((i = 0; i < ${#n}; i++)); do d=$((r * 10 + ${n:i:1})); q+=$((d / 16)); r=$((d % 16)); done
                      word=$(printf '%x' "$r")$word; n=$(echo "$q" | sed 's/^0*//')
                    done
                    word=$(printf '%064s' "$word" | tr ' ' 0) ;;
           *-chain) [[ "$val" =~ ^[a-z0-9-]{1,31}$ ]] || { echo "chain key: 1-31 of a-z 0-9 - (e.g. bsc)"; exit 1; }
                    word=$(printf '%s' "$val" | od -An -tx1 | tr -d ' \n'); word=$word$(printf '%0*d' $((64 - ${#word})) 0) ;;
           *) [[ "$val" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "address: 0x + 40 hex"; exit 1; }; word=000000000000000000000000${val#0x} ;;
         esac
         arg=" $val" ;;
    esac
    [[ "$ctl" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "NeuroControl: 0x + 40 hex"; exit 1; }
    hex="$sel$word"
    data=$(printf "$(echo -n "$hex" | sed 's/../\\x&/g')" | base64 -w0)
    gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
    f=$(mktemp)
    # MsgEVMCall's JSON uses its Go field names (Sender, To, Value, Data as base64, GasLimit).
    jq -n --arg gov "$gov" --arg to "$ctl" --arg data "$data" --arg d "$DEPOSIT" --arg t "Neuro: $act$arg" \
      '{messages:[{"@type":"/zetaphy.pq.v1.MsgEVMCall",Sender:$gov,To:$to,Value:"0",Data:$data,GasLimit:"300000"}],
        metadata:"",deposit:$d,title:$t,summary:("NeuroControl " + $to + ": " + $t + ". Steers Neuro only, never coin transfers."),expedited:false}' > "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;
  quantum-lock)
    # Afterwards the FROM key is refused; the controller acts for the account
    # (zetaphy pq native ... --as <this account>).
    ctrl=${2:?controller: zetaphy1… or 0x… of an ML-DSA-44 account that has sent a tx}
    send tx quantum-lock "$ctrl"
    echo "$FROM is now controlled by $ctrl" ;;
  vote-key)
    # To replace the key: move pq_vote_key.seed to pq_vote_key.seed.old, put
    # the new seed in pq_vote_key.seed (64 hex characters), then run this.
    TXF=${TXF/--gas auto --gas-adjustment 1.5/--gas 600000}
    send tx pq-vote-key
    echo "vote key registered" ;;

  # ---- security core (docs/SECURITY-CORE.md) --------------------------------
  security)
    rpc=${EVM_RPC:-http://127.0.0.1:8545}
    curl -fsS "$rpc" -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"zetaphy_securityStatus","params":[]}' | jq .result ;;
  qday)
    h=${2:?height (0 = unschedule)}; d=${3:-}
    [[ "$h" =~ ^[0-9]+$ ]] || { echo "height: a block number"; exit 1; }
    if [ "$h" != 0 ]; then
      now=$($ZETAPHYD --home "$NODE_HOME" --node "$NODE" status | jq -r '.sync_info.latest_block_height')
      [ "$h" -gt "$((now + ${QDAY_MIN_NOTICE:-100}))" ] || { echo "Q-day must be well after the current block ($now): the vote must finish and people need time to migrate"; exit 1; }
    fi
    [ -z "$d" ] || [[ "$d" =~ ^[0-9]+$ ]] || { echo "reveal delay: a number of blocks"; exit 1; }
    submit tx security-proposal qday "$h" $d --deposit "$DEPOSIT" ;;
  threat-gate)
    reg=${2:?ThreatRegistry 0x…}; v=${3:?on or off}
    [[ "$reg" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "registry: 0x + 40 hex"; exit 1; }
    [[ "$v" =~ ^(on|off)$ ]] || { echo "on or off"; exit 1; }
    submit tx security-proposal threat-gate "$reg" "$v" --deposit "$DEPOSIT" ;;
  ibc-hold)
    d=${2:?delay in seconds, e.g. 21600 (6 h)}; g=${3:-}
    [[ "$d" =~ ^[0-9]+$ ]] || { echo "delay: seconds"; exit 1; }
    submit tx security-proposal ibc-hold "$d" $g --deposit "$DEPOSIT" ;;
  ibc-hold-rule)
    dn=${2:?denom (ibc/… or *)}; min=${3:?minimum amount in the base unit (0: none)}; bps=${4:?share of supply in basis points (0: none)}
    [[ "$min" =~ ^[0-9]+$ && "$bps" =~ ^[0-9]+$ ]] || { echo "min-amount and bps: whole numbers"; exit 1; }
    submit tx security-proposal ibc-hold-rule "$dn" "$min" "$bps" --deposit "$DEPOSIT" ;;
  ai-model)
    f=${2:?model hex file (node zetaphy-chain/tools/gbdt-export.mjs > model.hex), or - to remove}
    [ "$f" = - ] || [ -f "$f" ] || { echo "$f: no such file"; exit 1; }
    submit tx security-proposal ai-model "$f" --deposit "$DEPOSIT" ;;
  immune|breaker)
    j=${2:?settings as JSON}
    echo "$j" | jq -e . >/dev/null || { echo "settings: JSON"; exit 1; }
    submit tx security-proposal "$1" "$j" --deposit "$DEPOSIT" ;;
  breaker-rearm)
    b=${2:?bridge 0x…}; [[ "$b" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "bridge: 0x + 40 hex"; exit 1; }
    submit tx security-proposal breaker-rearm "$b" --deposit "$DEPOSIT" ;;
  model-epochs)
    r=${2:?ModelEpochs 0x… (zetaphy-network/contracts/ModelEpochs.sol), or - to remove it}
    [ "$r" = - ] || [[ "$r" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "registry: 0x + 40 hex, or -"; exit 1; }
    submit tx security-proposal model-epochs "$r" --deposit "$DEPOSIT" ;;
  invariant-firewall)
    r=${2:?InvariantFirewall 0x… (zetaphy-network/contracts/InvariantFirewall.sol), or - to turn it off}
    [ "$r" = - ] || [[ "$r" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "firewall: 0x + 40 hex, or -"; exit 1; }
    submit tx security-proposal invariant-firewall "$r" --deposit "$DEPOSIT" ;;
  model-at)
    h=${2:?height}; [[ "$h" =~ ^[0-9]+$ ]] || { echo "height: a block number"; exit 1; }
    $ZETAPHYD q neuro model-at "$h" $QF ;;
  ibc-holds)
    rpc=${EVM_RPC:-http://127.0.0.1:8545}
    curl -fsS "$rpc" -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"zetaphy_ibcHolds","params":[]}' | jq .result ;;
  ibc-hold-cancel)
    id=${2:?hold id (gov.sh ibc-holds)}; [[ "$id" =~ ^[0-9]+$ ]] || { echo "id: a number"; exit 1; }
    send tx ibc-hold-cancel "$id"
    echo "held transfer $id returned: the relayer carries the error acknowledgement back and the source chain refunds the sender" ;;

  # ---- ERC-20s made on ZETAPHY, and sending over IBC ------------------------
  erc20-register)
    shift; [ $# -ge 1 ] || { echo "usage: gov.sh erc20-register <0x…> [0x…]"; exit 1; }
    native=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee   # ZETAPHY itself (native precompile): a coin already
    todo=()
    for a in "$@"; do
      [[ "$a" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an ERC-20 address: $a"; exit 1; }
      [ "$(echo "$a" | tr 'A-F' 'a-f')" = "$native" ] && { echo "$a is ZETAPHY itself: already a coin (azetaphy)"; continue; }
      if $ZETAPHYD q erc20 token-pair "$a" $QF >/dev/null 2>&1; then echo "$a is registered already"; continue; fi
      todo+=("$a")
    done
    [ ${#todo[@]} -gt 0 ] || exit 0
    gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
    params=$($ZETAPHYD q erc20 params $QF | jq -c .params)
    on=$(echo "$params" | jq -r '.enable_erc20 // false'); open=$(echo "$params" | jq -r '.permissionless_registration // false')
    if [ "$on" = true ] && [ "$open" = true ]; then
      send tx erc20 register-erc20 "${todo[@]}"
      echo "registered: ${todo[*]} (coins erc20/<address>)"; exit 0
    fi
    # Governance registers them (MsgRegisterERC20 signed by the gov module);
    # the ERC-20 module is switched on in the same proposal when it is off.
    f=$(mktemp)
    printf '%s\n' "${todo[@]}" | jq -R . | jq -s --arg gov "$gov" --argjson p "$params" --arg on "$on" --arg d "$DEPOSIT" \
      '. as $a | {messages:((if $on == "true" then [] else [{"@type":"/cosmos.evm.erc20.v1.MsgUpdateParams",authority:$gov,
          params:{enable_erc20:true,permissionless_registration:($p.permissionless_registration // false)}}] end)
        + [{"@type":"/cosmos.evm.erc20.v1.MsgRegisterERC20",signer:$gov,erc20addresses:$a}]),
        metadata:"",deposit:$d,title:("Register " + ($a | length | tostring) + " ERC-20 token(s) as coins"),
        summary:("So IBC can carry them: " + ($a | join(", ")) + ". Each becomes the coin erc20/<address>."),expedited:false}' > "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;

  ibc-send)
    ch=${2:?channel on the ZETAPHY side, e.g. channel-1}; tok=${3:?ZETAPHY, an ERC-20 0x…, or a coin denom}
    amt=${4:?amount in base units}; to=${5:?receiver on the other chain, e.g. osmo1…}
    [[ "$ch" =~ ^channel-[0-9]+$ ]] || { echo "channel: channel-N"; exit 1; }
    [[ "$amt" =~ ^[1-9][0-9]{0,35}$ ]] || { echo "amount: a whole number of base units"; exit 1; }
    [[ "$to" =~ ^[a-z][a-z0-9]{0,19}1[02-9ac-hj-np-z]{20,90}$ || "$to" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "receiver: a bech32 address (e.g. osmo1…) or 0x…"; exit 1; }
    case "$tok" in
      ZETAPHY|zetaphy|azetaphy|0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE|0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee) denom=azetaphy ;;
      0x*)
        [[ "$tok" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an ERC-20 address: $tok"; exit 1; }
        pair=$($ZETAPHYD q erc20 token-pair "$tok" $QF 2>/dev/null | jq -c '.token_pair // empty' || true)
        [ -n "$pair" ] || { echo "$tok is not registered as a coin yet: gov.sh erc20-register $tok"; exit 1; }
        [ "$(echo "$pair" | jq -r '.enabled // false')" = true ] || { echo "$tok: its conversion is paused by governance"; exit 1; }
        denom=$(echo "$pair" | jq -r .denom)
        # An ERC-20 made on ZETAPHY travels as its coin: convert the amount first.
        [[ "$denom" == erc20/* ]] && { send tx erc20 convert-erc20 "$tok" "$amt"; echo "converted $amt of $tok to $denom"; } ;;
      *) [[ "$tok" =~ ^[a-zA-Z][a-zA-Z0-9/:._-]{1,127}$ ]] || { echo "not a coin denom: $tok"; exit 1; }; denom=$tok ;;
    esac
    send tx ibc-transfer transfer transfer "$ch" "$to" "${amt}${denom}"
    echo "sent $amt $denom through $ch to $to; the relayer carries it (a timeout refunds it here)" ;;

  # ---- IBC: USDC from Noble (zetaphy-chain/ibc/README.md) ------------------
  ibc-usdc-denom|ibc-usdc-ratelimit|ibc-usdc-erc20|ibc-usdc-metadata)
    ch=${2:?ZETAPHY side channel, e.g. channel-0 (ibc/setup-relayer.sh status)}
    [[ "$ch" =~ ^channel-[0-9]+$ ]] || { echo "channel: channel-N (the ZETAPHY side of the Noble channel)"; exit 1; }
    # ICS-20: Noble's uusdc arriving through transfer/<ch> becomes the coin
    # ibc/ + uppercase hex sha256("transfer/<ch>/uusdc"). Cosmos EVM v0.7.3
    # gives it the ERC-20 address made of the last 20 bytes of that hash
    # (utils.GetIBCDenomAddress), served by the ERC-20 precompile (STRv2).
    hash=$(printf 'transfer/%s/uusdc' "$ch" | sha256sum | awk '{print toupper($1)}')
    denom="ibc/$hash"; erc20="0x$(echo "${hash:24}" | tr 'A-F' 'a-f')"
    case "$1" in
      ibc-usdc-denom)
        echo "denom  $denom"; echo "erc20  $erc20" ;;
      ibc-usdc-metadata)
        # ibc-go writes metadata for a voucher only when the first one arrives
        # and none exists, and its default (symbol UUSDC, display "uusdc") makes
        # the ERC-20 report 0 decimals. This entry (for app_state.bank.denom_metadata
        # of a new chain, or an upgrade handler) gives USDC with 6 decimals.
        jq -n --arg dn "$denom" --arg ch "$ch" \
          '{description:("USDC from Noble (IBC transfer/" + $ch + "/uusdc)"),
            denom_units:[{denom:$dn,exponent:0,aliases:["uusdc"]},{denom:"usdc",exponent:6,aliases:[]}],
            base:$dn,display:"usdc",name:"USD Coin",symbol:"USDC",uri:"",uri_hash:""}' ;;
      ibc-usdc-ratelimit)
        # Low by default: 1% of the USDC on ZETAPHY in and 1% out per 24 hours.
        send=${3:-1}; recv=${4:-1}; hours=${5:-24}
        # x/ratelimit caps a share of the coin's supply here, so it refuses a
        # limit while there is none: bring a little USDC in first.
        supply=$($ZETAPHYD q bank total-supply-of "$denom" $QF | jq -r '.amount.amount // "0"')
        [ "$supply" != 0 ] || { echo "no USDC on ZETAPHY through $ch yet; a rate limit needs some first:"
          echo "  sudo bash setup-relayer.sh send-usdc <your 0x…> 1000000   (1 USDC)"; exit 1; }
        echo "USDC on ZETAPHY now: $supply uusdc; proposing at most $send% out / $recv% in every $hours h"
        has=$($ZETAPHYD q ratelimit list-rate-limits $QF 2>/dev/null | jq --arg dn "$denom" --arg ch "$ch" \
          '[.. | objects | select(.path? != null and .path.denom == $dn and .path.channel_or_client_id == $ch)] | length' || echo 0)
        [ "$has" = 0 ] && exec bash "$0" propose-ratelimit "$denom" "$ch" "$send" "$recv" "$hours"
        # A limit is already in force: change it (MsgUpdateRateLimit; its counters restart).
        for n in "$send" "$recv"; do [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -le 100 ] || { echo "percent: 0 to 100"; exit 1; }; done
        [[ "$hours" =~ ^[1-9][0-9]*$ ]] || { echo "hours: a whole number above 0"; exit 1; }
        gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
        f=$(mktemp)
        jq -n --arg gov "$gov" --arg dn "$denom" --arg ch "$ch" --arg s "$send" --arg r "$recv" --arg h "$hours" --arg d "$DEPOSIT" \
          '{messages:[{"@type":"/ratelimit.v1.MsgUpdateRateLimit",authority:$gov,denom:$dn,channel_or_client_id:$ch,
            max_percent_send:$s,max_percent_recv:$r,duration_hours:$h}],
            metadata:"",deposit:$d,title:("IBC rate limit change: USDC on " + $ch),
            summary:("USDC from Noble (" + $dn + "): at most " + $s + "% out / " + $r + "% in through " + $ch + " every " + $h + " hours."),expedited:false}' > "$f"
        submit tx gov submit-proposal "$f"; rm -f "$f" ;;
      ibc-usdc-erc20)
        gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
        params=$($ZETAPHYD q erc20 params $QF | jq -c .params)
        if [ "$(echo "$params" | jq -r '.enable_erc20 // false')" != true ]; then
          # The whole ERC-20 module is switched off: switch it on.
          f=$(mktemp)
          jq -n --arg gov "$gov" --argjson p "$params" --arg d "$DEPOSIT" \
            '{messages:[{"@type":"/cosmos.evm.erc20.v1.MsgUpdateParams",authority:$gov,
               params:{enable_erc20:true,permissionless_registration:($p.permissionless_registration // false)}}],
              metadata:"",deposit:$d,title:"Turn on ERC-20 conversion",summary:"So IBC coins such as USDC from Noble show up as ERC-20 tokens.",expedited:false}' > "$f"
          submit tx gov submit-proposal "$f"; rm -f "$f"
          echo "after it passes, run: gov.sh ibc-usdc-erc20 $ch"; exit 0
        fi
        # v0.7.3 has no proposal that registers a coin: the erc20 IBC
        # middleware registers each new ibc/ coin by itself (OnRecvPacket),
        # when the first one arrives. Governance can only pause or resume it.
        pair=$($ZETAPHYD q erc20 token-pair "$denom" $QF 2>/dev/null | jq -c '.token_pair // empty' || true)
        if [ -z "$pair" ]; then
          echo "USDC is not on ZETAPHY yet: the first USDC that arrives through $ch makes it an ERC-20 at"
          echo "  $erc20"
          echo "bring some in: sudo bash setup-relayer.sh send-usdc <your 0x…> 1000000   (1 USDC), then run this again"
          exit 1
        fi
        addr=$(echo "$pair" | jq -r .erc20_address)
        [ "$(echo "$addr" | tr 'A-F' 'a-f')" = "$erc20" ] || { echo "unexpected: the chain has $addr for $denom, not $erc20"; exit 1; }
        if [ "$(echo "$pair" | jq -r '.enabled // false')" != true ]; then
          f=$(mktemp)
          jq -n --arg gov "$gov" --arg dn "$denom" --arg d "$DEPOSIT" --arg a "$addr" \
            '{messages:[{"@type":"/cosmos.evm.erc20.v1.MsgToggleConversion",authority:$gov,token:$dn}],
              metadata:"",deposit:$d,title:"Resume USDC (Noble) as an ERC-20",summary:("Turns the ERC-20 " + $a + " of " + $dn + " back on."),expedited:false}' > "$f"
          submit tx gov submit-proposal "$f"; rm -f "$f"
          echo "the USDC ERC-20 is paused; after this passes it works again at $addr"; exit 0
        fi
        echo "USDC (from Noble via $ch) is the ERC-20 $addr"
        # decimals() comes from the coin's bank metadata (see ibc-usdc-metadata);
        # with none, the precompile reads 6 from the "u" of uusdc.
        meta=$($ZETAPHYD q bank denom-metadata "$denom" $QF 2>/dev/null || true)
        dec=6
        [ -n "$meta" ] && dec=$(echo "$meta" | jq -r '.metadata | (.display | split("/") | last) as $d
          | [.denom_units[] | select(.denom == $d) | .exponent // 0][0] // "?"' 2>/dev/null || echo "?")
        if [ "$dec" != 6 ]; then
          echo "WARNING: the chain reports $dec decimals for it (ibc-go's default metadata), so wallets"
          echo "  show amounts in uusdc. Fixing it needs a chain upgrade that sets: gov.sh ibc-usdc-metadata $ch"
        fi
        echo "MetaMask: Import tokens -> this address (symbol USDC, 6 decimals)."
        echo "Token list entry (explorer, wallet, DEX):"
        jq -n --arg a "$addr" --arg dn "$denom" --argjson c "${EVM_CHAIN_ID:-77390}" \
          '{chainId:$c,address:$a,name:"USD Coin (Noble)",symbol:"USDC",decimals:6,extensions:{cosmosDenom:$dn,origin:"noble uusdc"}}' ;;
    esac ;;
  # ---- CosmWasm ----------------------------------------------------------
  wasm-store)
    # Code upload is governance only on ZETAPHY: the code goes in a proposal
    # (MsgStoreCode from the gov module), gzipped (wasmd unpacks it; at most
    # 800 KiB unpacked). Its sha256 is in the title so voters can compare it
    # with the published build.
    file=${2:?contract .wasm file}; title=${3:?title}; who=${4:-everybody}
    [ -f "$file" ] || { echo "no such file: $file"; exit 1; }
    head -c4 "$file" | od -An -tx1 | tr -d ' \n' | grep -q '^0061736d' || gzip -t "$file" 2>/dev/null || { echo "not a wasm file: $file"; exit 1; }
    case "$who" in
      everybody) perm='{permission:"Everybody",addresses:[]}' ;;
      nobody)    perm='{permission:"Nobody",addresses:[]}' ;;
      *) [[ "$who" =~ ^zetaphy1[0-9a-z]{38,58}(,zetaphy1[0-9a-z]{38,58})*$ ]] || { echo "instantiate: everybody, nobody or zetaphy1…,zetaphy1…"; exit 1; }
         perm="{permission:\"AnyOfAddresses\",addresses:$(echo "$who" | jq -R -c 'split(",")')}" ;;
    esac
    sum=$( (gzip -dc "$file" 2>/dev/null || cat "$file") | sha256sum | cut -d' ' -f1)
    gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
    z=$(mktemp); f=$(mktemp)
    (gzip -t "$file" 2>/dev/null && cat "$file" || gzip -9nc "$file") | base64 -w0 > "$z"
    jq -n --arg gov "$gov" --rawfile code "$z" --arg d "$DEPOSIT" --arg t "$title" --arg sum "$sum" --arg who "$who" \
      "{messages:[{\"@type\":\"/cosmwasm.wasm.v1.MsgStoreCode\",sender:\$gov,wasm_byte_code:\$code,instantiate_permission:$perm}],
        metadata:\"\",deposit:\$d,title:(\$t + \" (wasm sha256 \" + \$sum[0:16] + \"…)\"),
        summary:(\"Store CosmWasm code, sha256 \" + \$sum + \". Who may instantiate it: \" + \$who + \".\"),expedited:false}" > "$f"
    echo "code sha256 $sum"
    # Storing the proposal costs gas per byte of code; a tight margin keeps a
    # large contract under the 30,000,000 block gas limit.
    TXF=${TXF/--gas-adjustment 1.5/--gas-adjustment 1.1}
    submit tx gov submit-proposal "$f"; rm -f "$f" "$z" ;;
  wasm-upload-access)
    who=${2:?nobody, everybody or zetaphy1…,zetaphy1…}
    case "$who" in
      everybody) up='{permission:"Everybody",addresses:[]}' ;;
      nobody)    up='{permission:"Nobody",addresses:[]}' ;;
      *) [[ "$who" =~ ^zetaphy1[0-9a-z]{38,58}(,zetaphy1[0-9a-z]{38,58})*$ ]] || { echo "nobody, everybody or zetaphy1…,zetaphy1…"; exit 1; }
         up="{permission:\"AnyOfAddresses\",addresses:$(echo "$who" | jq -R -c 'split(",")')}" ;;
    esac
    gov=$($ZETAPHYD q auth module-account gov $QF | jq -r '.account.value.address')
    inst=$($ZETAPHYD q wasm params $QF | jq -r '(.params // .).instantiate_default_permission // "Everybody"')
    f=$(mktemp)
    jq -n --arg gov "$gov" --arg inst "$inst" --arg d "$DEPOSIT" --arg who "$who" \
      "{messages:[{\"@type\":\"/cosmwasm.wasm.v1.MsgUpdateParams\",authority:\$gov,params:{code_upload_access:$up,instantiate_default_permission:\$inst}}],
        metadata:\"\",deposit:\$d,title:(\"CosmWasm code upload: \" + \$who),
        summary:(\"Who may store contract code without a vote: \" + \$who + \". Governance can always store code by proposal.\"),expedited:false}" > "$f"
    submit tx gov submit-proposal "$f"; rm -f "$f" ;;
  wasm-codes)
    $ZETAPHYD q wasm params $QF | jq -c '.params // .'
    $ZETAPHYD q wasm list-code $QF | jq -c '.code_infos[]? | {code_id, creator, data_hash, instantiate_permission}' ;;

  *)
    sed -n '8,67p' "$0" | sed 's/^# //'; exit 2 ;;
esac
