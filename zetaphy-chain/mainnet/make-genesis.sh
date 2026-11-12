#!/usr/bin/env bash
# make-genesis.sh: the ZETAPHY mainnet genesis, from a config file of addresses and parameters
# (docs/ZETAPHY-MAINNET-PROCEDURE.md). Run it on a clean, offline machine with the zetaphyd of the signed release,
# checked with zetaphy-chain/verify-release.sh first.
#
#   ZETAPHYD=<zetaphyd> bash make-genesis.sh draft    <config.env> <out-dir>
#       out-dir/genesis.draft.json: chain id, coin, allocations (addresses only, vesting for team/treasury),
#       governance/staking/slashing/fee parameters, the chain guard, shield, invariant-firewall layer and security core
#       active from block 1, the circuit-breaker authority (a multisig) and the constitution on from block 1.
#       The validator makes its gentx against this file.
#   ZETAPHYD=<zetaphyd> bash make-genesis.sh finalize <config.env> <out-dir> <gentx.json>...
#       out-dir/genesis.json (the draft + the gentxs), genesis.sha256 and chain.json (chain ids, sha256, min gas price)
#   ZETAPHYD=<zetaphyd> bash make-genesis.sh verify   <config.env> <genesis.json> [--draft]
#       anyone: re-checks a published genesis against the config (every property below) and prints its sha256
#
# It never makes, asks for or stores a private key: every account is an address, the circuit authority is a multisig
# PUBLIC key (`zetaphyd keys show <multisig> -p`). It refuses: a missing or single-key circuit authority, the
# testnet's chain id or a taken EVM chain id, allocations that do not add up to TOTAL_SUPPLY, placeholder or
# malformed addresses, a faucet, testnet-like voting/unbonding periods, unknown config keys, and a genesis that
# `zetaphyd genesis validate-genesis` rejects. Exit: 0 ok, 1 refused, 2 usage.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
TOOL="$here/genesis_tool.py"
SETUP="${SETUP_NODE:-$here/../setup-node.sh}"   # for the EVM preinstalls (setup-node.sh --preinstalls)
usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
die() { echo "REFUSED: $*" >&2; exit 1; }

[ $# -ge 3 ] || usage
cmd=$1 cfg=$2
[ -n "${ZETAPHYD:-}" ] && [ -x "$ZETAPHYD" ] || die "ZETAPHYD=<path to the verified release zetaphyd> is required"
ZETAPHYD=$(readlink -f "$ZETAPHYD")
for t in python3 sha256sum; do command -v $t >/dev/null || { echo "missing tool: $t" >&2; exit 2; }; done
py() { python3 -I "$TOOL" "$@"; }

work=$(mktemp -d "${TMPDIR:-/tmp}/zetaphy-genesis.XXXXXX")
trap 'rm -rf "$work"' EXIT
py config "$cfg" > "$work/config.json"
C="$work/config.json"
jv() { python3 -I -c 'import json,sys; v=json.load(open(sys.argv[1])); [v:=v[k] for k in sys.argv[2:]]; print(v)' "$C" "$@"; }
CHAIN_ID=$(jv chain_id); DENOM=$(jv denom)
H="$work/home"
z() { (cd "$work" && "$ZETAPHYD" "$@" --home "$H" 2>&1); }   # (the binary may create data/ in its working directory)

summary() { # summary <genesis>
  python3 -I - "$C" "$1" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])); g = json.load(open(sys.argv[2]))
print(f"  chain id        {c['chain_id']}   EVM chain id {c['evm_chain_id']}   genesis time {c['genesis_time']}")
print(f"  coin            {c['symbol']} ({c['denom']}, 18 decimals), supply {c['supply']:,}, no inflation")
print(f"  min gas price   {c['min_gas_price']} {c['denom']}/gas")
for a in c["allocations"]:
    v = f"  vesting {a['vesting_start']}..{a['vesting_end']}" if "vesting_start" in a else ""
    print(f"  ALLOC_{a['name']:<12} {a['address']} {a['amount']:>15,}{v}")
print(f"  circuit authority {c['circuit_authority']} (multisig {c['circuit_pubkey']['threshold']} of {len(c['circuit_pubkey']['public_keys'])})")
gv = c['gov']
print(f"  gov             voting {gv['voting']} s, expedited {gv['expedited']} s, deposit {gv['min_deposit']:,} {c['symbol']}, quorum {gv['quorum']}")
print(f"  staking         unbonding {c['staking']['unbonding']} s; power cap {c['power_cap']} bps; Q-day {'height %d' % c['qday']['height'] if c['qday'] else 'off'}")
print(f"  from block 1    chain guard, shield, invariant-firewall layer, security core, constitution ON")
print(f"  gentxs          {len(g['app_state'].get('genutil', {}).get('gen_txs') or [])}")
PY
}

validate() { # validate <genesis> [--final]
  mkdir -p "$H/config"; cp "$1" "$H/config/genesis.json"
  local v; v=$(z genesis validate-genesis) || { echo "$v" | grep -v "^ |^Usage|^Aliases|^Flags|^Global|^$" | tail -2 >&2; die "zetaphyd genesis validate-genesis rejected the genesis"; }
  py check "$C" "$1" ${2:-}
}

case "$cmd" in
  draft)
    out=$3; [ ! -e "$out/genesis.draft.json" ] || die "$out/genesis.draft.json exists: use a new directory"
    mkdir -p "$out"
    z init genesis-maker --chain-id "$CHAIN_ID" >/dev/null || die "zetaphyd init failed"
    G="$H/config/genesis.json"
    bash "$SETUP" --preinstalls > "$work/pre.json"
    python3 -I -c 'import json,sys; g=json.load(open(sys.argv[1])); g["app_state"]["evm"]["preinstalls"]=json.load(open(sys.argv[2])); json.dump(g,open(sys.argv[1],"w"),indent=2)' "$G" "$work/pre.json"
    py edit "$C" "$G"
    python3 -I -c '
import json,sys
for a in json.load(open(sys.argv[1]))["allocations"]:
    v = " %s %s" % (a["vesting_start"], a["vesting_end"]) if "vesting_start" in a else ""
    print(a["address"], a["atto"] + sys.argv[2], v)' "$C" "$DENOM" > "$work/allocs"
    while read -r addr coins vs ve; do
      if [ -n "${vs:-}" ]; then
        z genesis add-genesis-account "$addr" "$coins" --vesting-amount "$coins" --vesting-start-time "$vs" --vesting-end-time "$ve" >/dev/null \
          || die "add-genesis-account $addr failed"
      else
        z genesis add-genesis-account "$addr" "$coins" >/dev/null || die "add-genesis-account $addr failed"
      fi
    done < "$work/allocs"
    py pubkey "$C" "$G"
    cp "$G" "$work/draft.json"
    validate "$work/draft.json"
    install -m 644 "$work/draft.json" "$out/genesis.draft.json"
    echo "draft genesis: $out/genesis.draft.json"
    summary "$out/genesis.draft.json"
    echo "  sha256          $(sha256sum "$out/genesis.draft.json" | cut -d' ' -f1)  (draft; the final one changes with the gentx)"
    ;;
  finalize)
    out=$3; shift 3
    [ $# -ge 1 ] || usage
    [ -f "$out/genesis.draft.json" ] || die "$out/genesis.draft.json: run draft first"
    [ ! -e "$out/genesis.json" ] || die "$out/genesis.json exists already"
    py check "$C" "$out/genesis.draft.json"   # the draft is still what the config says
    mkdir -p "$H/config/gentx"; cp "$out/genesis.draft.json" "$H/config/genesis.json"
    n=0; for f in "$@"; do n=$((n + 1)); install -m 644 "$f" "$H/config/gentx/gentx-$n.json"; done
    z genesis collect-gentxs --gentx-dir "$H/config/gentx" >/dev/null || die "collect-gentxs failed (a gentx for another chain id or genesis?)"
    cp "$H/config/genesis.json" "$work/final.json"
    validate "$work/final.json" --final
    install -m 644 "$work/final.json" "$out/genesis.json"
    sha=$(sha256sum "$out/genesis.json" | cut -d' ' -f1)
    echo "$sha  genesis.json" > "$out/genesis.sha256"
    python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1])); json.dump({"chain_id":c["chain_id"],"evm_chain_id":c["evm_chain_id"],"genesis_sha256":sys.argv[2],"genesis_time":c["genesis_time"],"denom":c["denom"],"symbol":c["symbol"],"min_gas_price":str(c["min_gas_price"])+c["denom"]},open(sys.argv[3],"w"),indent=2)' "$C" "$sha" "$out/chain.json"
    echo "final genesis: $out/genesis.json"
    summary "$out/genesis.json"
    echo "GENESIS_SHA256=$sha"
    ;;
  verify)
    g=$3; flag=--final; [ "${4:-}" = --draft ] && flag=""
    [ -f "$g" ] || die "$g: no such file"
    validate "$g" $flag
    summary "$g"
    echo "OK  sha256 $(sha256sum "$g" | cut -d' ' -f1)"
    ;;
  *) usage ;;
esac
