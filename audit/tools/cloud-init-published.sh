#!/usr/bin/env bash
# cloud-init-published.sh: is the setup-node.sh that zetaphy-chain/cloud-init.sh pins really published?
# (internal review 2026-11-10, Z-05)
#
# cloud-init.sh downloads https://raw.githubusercontent.com/<public repo>/main/v/<sha256>.sh and runs it only if
# its SHA-256 is the pinned one. `pack-cloud-init.sh --check` (security.yml) proves cloud-init.sh pins this
# checkout's setup-node.sh, but reads local files only. This asks the public repository:
#   1. the pinned URL answers (curl -fsI), names the pinned SHA-256, and its content has that SHA-256;
#   2. (note) the public latest setup-node.sh next to it is the pinned version;
#   3. (note) the pin is this checkout's setup-node.sh (the gate for that is pack-cloud-init.sh --check).
#
# Usage: bash audit/tools/cloud-init-published.sh [--cloud-init <file>] [--warn]
#   --warn   for pull requests: report as a GitHub warning and exit 0 (publishing comes before the merge that
#            moves the pin, so a pull request may pin a file that is published only later; docs/ANTI-ROLLBACK-OFFCHAIN.md)
# Exit: 0 published; 1 not published, or published with other content; 2 usage (no pin found);
#       3 could not check (network error, not an HTTP answer).
# With $GITHUB_OUTPUT set it writes status=published|missing|mismatch|unreachable, url=, sha=.
set -euo pipefail

CI="zetaphy-chain/cloud-init.sh"
WARN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cloud-init) CI="$2"; shift 2 ;;
    --warn) WARN=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -f "$CI" ] || { echo "$CI not found" >&2; exit 2; }

url=$(grep -oE 'https://raw\.githubusercontent\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/v/[0-9a-f]{64}\.sh' "$CI" | head -n 1 || true)
pin=$(sed -nE 's/^echo "([0-9a-f]{64})  \$f" \| sha256sum -c.*/\1/p' "$CI" | head -n 1)
[ -n "$url" ] && [ -n "$pin" ] || { echo "$CI: no pinned v/<sha256>.sh URL and sha256sum line found" >&2; exit 2; }

out() { [ -z "${GITHUB_OUTPUT:-}" ] || printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; }
out url "$url"; out sha "$pin"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

finish() { # finish <status> <message>
  out status "$1"
  case "$1" in
    published) echo "published: $url ($pin)"; exit 0 ;;
    unreachable) echo "::warning title=cloud-init pin not checked::$2"; exit 3 ;;
  esac
  local how="publish v/$pin.sh (zetaphy-chain/public/ after pack-cloud-init.sh) to the public repository first, then merge the change that moves the pin (docs/ANTI-ROLLBACK-OFFCHAIN.md, \"Publishing setup-node.sh\")"
  if [ "$WARN" = 1 ]; then echo "::warning title=setup-node.sh not published for cloud-init::$2. Before merging: $how"; exit 0; fi
  echo "::error title=setup-node.sh not published for cloud-init::$2. New Oracle installs from cloud-init.sh fail until it is: $how"
  exit 1
}

[ "${url##*/}" = "$pin.sh" ] || finish mismatch "$CI downloads ${url##*/} but checks SHA-256 $pin"

# 1. the pinned file answers, and is the pinned content
rc=0; curl -fsSI --retry 3 --retry-delay 5 --max-time 60 "$url" -o /dev/null 2>"$TMP/err" || rc=$?
if [ "$rc" = 22 ]; then finish missing "$url is not published ($(tr -d '\r' < "$TMP/err" | tail -n 1))"
elif [ "$rc" != 0 ]; then finish unreachable "could not reach $url (curl exit $rc: $(tail -n 1 "$TMP/err")); not an answer about publishing"
fi
rc=0; curl -fsSL --retry 3 --retry-delay 5 --max-time 300 "$url" -o "$TMP/v.sh" 2>"$TMP/err" || rc=$?
if [ "$rc" = 22 ]; then finish missing "$url is not published ($(tail -n 1 "$TMP/err"))"
elif [ "$rc" != 0 ]; then finish unreachable "could not download $url (curl exit $rc)"
fi
got=$(sha256sum "$TMP/v.sh" | cut -d' ' -f1)
[ "$got" = "$pin" ] || finish mismatch "$url is published with SHA-256 $got, not the pinned $pin (v/<sha>.sh files must never change)"

# 2. the public latest copy (notes only: cloud-init.sh does not use it)
latest="${url%/v/*}/setup-node.sh"
if curl -fsSL --retry 2 --max-time 300 "$latest" -o "$TMP/latest.sh" 2>/dev/null; then
  l=$(sha256sum "$TMP/latest.sh" | cut -d' ' -f1)
  [ "$l" = "$pin" ] || echo "::notice title=public setup-node.sh is another version::$latest is $l, not the pinned $pin: copy v/$pin.sh over it once this pin is on main"
fi
# 3. this checkout's setup-node.sh (pack-cloud-init.sh --check is the gate; a note here)
local_setup="$(dirname "$CI")/setup-node.sh"
if [ -f "$local_setup" ]; then
  s=$(sha256sum "$local_setup" | cut -d' ' -f1)
  [ "$s" = "$pin" ] || echo "::notice title=cloud-init.sh pins another setup-node.sh::this checkout's setup-node.sh is $s; cloud-init.sh pins $pin (run zetaphy-chain/pack-cloud-init.sh)"
fi
finish published ""
