#!/bin/bash
# setup-node.sh installs a prebuilt zetaphyd that carries the handler of the chain's scheduled or halted
# upgrade only if it is the binary the plan's info pins (docs/ANTI-ROLLBACK-CHAIN.md, "Voted binary
# checksums"). Runs that block of setup-node.sh alone, with stand-ins, for each case.
#   bash zetaphy-chain/test-plan-pin.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
awk '/# A prebuilt binary \(ZETAPHYD_BIN: zetaphy-validator update/{f=1} f{print} /^  install -m 755 "\$new_bin" "\$BIN"$/{exit}' \
  "$here/setup-node.sh" | sed '$d' > "$T/snippet.sh"
grep -q 'ZETAPHY_ALLOW_UNPINNED' "$T/snippet.sh" || { echo "FAIL: the plan-pin block was not found in setup-node.sh"; exit 1; }
mkdir -p "$T/home/config" "$T/home/data"
echo '{"chain_id":"zetaphy_77390-1"}' > "$T/home/config/genesis.json"
plat="linux/$(case "$(uname -m)" in x86_64) echo amd64 ;; aarch64) echo arm64 ;; *) uname -m ;; esac)"
other=$([ "$plat" = linux/amd64 ] && echo linux/arm64 || echo linux/amd64)
bad=$(printf 'a%.0s' $(seq 1 64))
run() { # run <binary content> -> prints the outcome; INSTALLED if the block let it through
  printf '%s' "$1" > "$T/bin"
  ( cd "$T"; NODE_HOME=$T/home; ZETAPHYD_BIN=$T/bin; new_bin=$T/bin; BIN=/nonexistent/zetaphyd; LOG=/dev/null; st=""
    as_node() { :; }; logger() { :; }
    set -euo pipefail; . ./snippet.sh; echo INSTALLED ) 2>&1
}
plan() { jq -n --arg i "$1" '{name:"zetaphy-shield",height:100,info:$i}' > "$T/home/data/upgrade-info.json"; }
pins() { jq -cn --arg p "$1" --arg s "$2" '{binaries:{($p):("https://example.invalid/zetaphyd?checksum=sha256:" + $s)}}'; }
expect() { # expect <case> <INSTALLED|refused> <output>
  case $2 in
    INSTALLED) grep -q '^INSTALLED$' <<<"$3" || { echo "FAIL: $1: refused: $3"; exit 1; } ;;
    *) ! grep -q '^INSTALLED$' <<<"$3" && grep -q '^refused:' <<<"$3" || { echo "FAIL: $1: installed: $3"; exit 1; } ;;
  esac
  echo "ok $1"
}
good='zetaphyd with the zetaphy-shield handler'
sum=$(printf '%s' "$good" | sha256sum | cut -d' ' -f1)
plan "$(pins "$plat" "$sum")";   expect "the pinned binary" INSTALLED "$(run "$good")"
plan "$(pins "$plat" "$bad")";   expect "another binary" refused "$(run "$good")"
out=$(ZETAPHY_ALLOW_UNPINNED=zetaphy_77390-1:zetaphy-shield run "$good"); expect "another binary, logged override" INSTALLED "$out"
grep -q 'deliberate override' <<<"$out" || { echo "FAIL: the override was not reported"; exit 1; }
expect "an override for another upgrade" refused "$(ZETAPHY_ALLOW_UNPINNED=zetaphy_77390-1:zetaphy-v9 run "$good")"
plan "$(pins "$other" "$sum")";  expect "no pin for this platform" refused "$(run "$good")"
plan "";                         expect "a plan without pins (signature only)" INSTALLED "$(run "$good")"
plan "$(pins "$plat" "$bad")";   expect "a binary without the plan's handler" INSTALLED "$(run 'zetaphyd without it')"
touch -d '2 hours ago' "$T/home/data/upgrade-info.json"
expect "an old upgrade-info.json (not halted now)" INSTALLED "$(run "$good")"
echo "plan pin checks: all passed"
