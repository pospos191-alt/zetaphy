#!/usr/bin/env bash
# swd_amm program rollback / redeploy from a verified release (2026-11-11). Owner's guide: docs/PROGRAM_ROLLBACK.md
# (Thai: docs/PROGRAM_ROLLBACK.th.md).
#
# DRY RUN BY DEFAULT: prints every command and changes nothing on chain. Add --execute to run; every step that spends
# SOL or changes on-chain state then asks you to type "yes". Keys are only ever passed to the solana CLI as keypair
# FILE PATHS (--keypair); this script never reads, prints or copies a private key.
#
#   status  [--cluster devnet|mainnet] [--program-id ID] [--url RPC]
#       Read only. `solana program show` + `solana program dump` -> last deployed slot, upgrade authority, sha256 and
#       executable hash of the on-chain bytes, compared with every program-v* GitHub Release. Exit 1 when the
#       on-chain code is NOT any published release (tampered / unknown upgrade).
#
#   prepare <TAG> [--sha256 HEX] [options]           roll back (or forward) to a release's .so
#   prepare --so FILE --sha256 HEX [options]         ... or to a local .so whose sha256 you know (e.g. the audit report)
#       1. download + verify: SHA256SUMS, release.json, Sigstore provenance (gh attestation, when gh is logged in)
#       2. solana program write-buffer   (the buffer holds the new code; nothing is live yet)
#       3. dump the buffer and check its hash again
#       mainnet (default: --via-squads):
#       4. solana program set-buffer-authority <BUFFER> --new-buffer-authority <SQUADS_VAULT>
#       5. print the Squads steps (proposal -> approvals -> Squads time lock -> execute) and how to check afterwards
#       devnet (default: --direct):
#       4. solana program upgrade <BUFFER> <PROGRAM_ID>  (after you type yes), then `status`
#
# Options:
#   --cluster devnet|mainnet   default devnet. mainnet needs --program-id (or MAINNET_PROGRAM_ID) and --url (or RPC).
#   --program-id ID            default: devnet 3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL, mainnet $MAINNET_PROGRAM_ID
#   --url RPC                  default: devnet https://api.devnet.solana.com, mainnet $RPC
#   --keypair PATH             fee payer + buffer authority while writing (default: the solana CLI's configured keypair)
#   --upgrade-authority PATH   devnet --direct only: the upgrade authority keypair file (default: --keypair)
#   --vault ADDRESS            the Squads vault (upgrade authority on mainnet; default $SQUADS_VAULT)
#   --flavour devnet|mainnet   which build of the release to use (default = the cluster: devnet build on devnet,
#                              mainnet,v2-only build on mainnet)
#   --via-squads | --direct    override the default mode (direct is refused on mainnet-beta)
#   --priority-fee N           micro-lamports per CU for write-buffer (default 50000 on mainnet, 0 on devnet)
#   --execute                  actually do it (asks "yes" before each on-chain step)
# Environment: REPO (default pospos191-alt/zetaphy), RELEASE_BASE (download base URL, default GitHub Releases).
set -euo pipefail

REPO="${REPO:-pospos191-alt/zetaphy}"
RELEASE_BASE="${RELEASE_BASE:-https://github.com/${REPO}/releases/download}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
DEVNET_ID="3zKYYQT7LhCWLLnzbRMhTZJKmQdSwGzEghRrTyT4jdCL"
MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   WARNING: %s\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

EXECUTE=0; CLUSTER=devnet; PROGRAM_ID=""; URL=""; KEYPAIR=""; UPGRADE_AUTH=""; VAULT="${SQUADS_VAULT:-}"
FLAVOUR=""; MODE=""; PRIORITY_FEE=""; SO_IN=""; WANT_SHA=""; TAG=""
CMD="${1:-}"; [ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --cluster) CLUSTER="${2:?}"; shift ;;
    --program-id) PROGRAM_ID="${2:?}"; shift ;;
    --url) URL="${2:?}"; shift ;;
    --keypair) KEYPAIR="${2:?}"; shift ;;
    --upgrade-authority) UPGRADE_AUTH="${2:?}"; shift ;;
    --vault) VAULT="${2:?}"; shift ;;
    --flavour) FLAVOUR="${2:?}"; shift ;;
    --via-squads) MODE=squads ;;
    --direct) MODE=direct ;;
    --priority-fee) PRIORITY_FEE="${2:?}"; shift ;;
    --so) SO_IN="${2:?}"; shift ;;
    --sha256) WANT_SHA="$(printf '%s' "${2:?}" | tr 'A-F' 'a-f')"; shift ;;
    -h|--help) sed -n '2,42p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$TAG" ] || die "unexpected argument $1"; TAG="$1" ;;
  esac
  shift
done

case "$CLUSTER" in
  devnet)  PROGRAM_ID="${PROGRAM_ID:-$DEVNET_ID}"; URL="${URL:-https://api.devnet.solana.com}"; MODE="${MODE:-direct}"; PRIORITY_FEE="${PRIORITY_FEE:-0}" ;;
  mainnet) PROGRAM_ID="${PROGRAM_ID:-${MAINNET_PROGRAM_ID:-}}"; URL="${URL:-${RPC:-}}"; MODE="${MODE:-squads}"; PRIORITY_FEE="${PRIORITY_FEE:-50000}"
           [ -n "$PROGRAM_ID" ] || die "mainnet: pass --program-id (or set MAINNET_PROGRAM_ID)"
           [ -n "$URL" ] || die "mainnet: pass --url <private mainnet RPC> (or set RPC)" ;;
  *) die "--cluster must be devnet or mainnet" ;;
esac
FLAVOUR="${FLAVOUR:-$CLUSTER}"
case "$FLAVOUR" in devnet|mainnet) ;; *) die "--flavour must be devnet or mainnet" ;; esac
[[ "$PROGRAM_ID" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || die "program id is not a base58 address: $PROGRAM_ID"
[[ -z "$VAULT" || "$VAULT" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || die "--vault is not a base58 address"
[[ "$PRIORITY_FEE" =~ ^[0-9]+$ ]] || die "--priority-fee must be a number"
[ -z "$KEYPAIR" ] || [ -f "$KEYPAIR" ] || die "--keypair file not found: $KEYPAIR"
[ -z "$UPGRADE_AUTH" ] || [ -f "$UPGRADE_AUTH" ] || die "--upgrade-authority file not found: $UPGRADE_AUTH"

for t in solana python3 curl sha256sum; do command -v "$t" >/dev/null 2>&1 || die "missing tool: $t"; done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/swd-rollback.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

# solana CLI args (keypair as a PATH only)
KP=(); [ -n "$KEYPAIR" ] && KP=(--keypair "$KEYPAIR")
sol() { solana "$@" -u "$URL" "${KP[@]}"; }

# run CMD... : print it; with --execute ask for "yes" and run it.
run() {
  if [ "$1" = sol ]; then printf '   $ solana %s -u %s%s\n' "${*:2}" "$URL" "${KEYPAIR:+ --keypair $KEYPAIR}" >&2
  else printf '   $ %s\n' "$*" >&2; fi
  [ "$EXECUTE" -eq 1 ] || return 0
  local ok; read -r -p "   Type yes to run this (anything else stops here): " ok
  [ "$ok" = "yes" ] || die "stopped (nothing after this step was done)"
  "$@"
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
exe_hash_of() { python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read().rstrip(b"\0")).hexdigest())' "$1"; }

cluster_genesis() { solana genesis-hash -u "$URL" 2>/dev/null || true; }

# prints: authority|lastDeploySlot|programdataAddress|dataLen  (empty authority = immutable)
program_show() {
  sol program show "$PROGRAM_ID" --output json 2>"$WORK/show.err" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("|".join(str(d.get(k) if d.get(k) is not None else "") for k in ("authority","lastDeploySlot","programdataAddress","dataLen")))'
}

# all program-v* releases: lines "tag flavour executable_hash sha256", newest first
releases_index() {
  python3 - "$GITHUB_API" "$REPO" "${GITHUB_TOKEN:-}" <<'PY'
import json, sys, urllib.request
api, repo, token = sys.argv[1:4]
def get(url):
    h = {"User-Agent": "swd-rollback", "Accept": "application/vnd.github+json"}
    if token and url.startswith(api): h["Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
        return json.load(r)
try:
    rel = [r for r in get(f"{api}/repos/{repo}/releases?per_page=100") if r.get("tag_name", "").startswith("program-v") and not r.get("draft")]
except Exception as e:
    print(f"# releases unreachable: {e}", file=sys.stderr); sys.exit(0)
rel.sort(key=lambda r: r.get("published_at") or r.get("created_at") or "", reverse=True)
for r in rel[:30]:
    a = next((a for a in r.get("assets", []) if a["name"] == "release.json"), None)
    if not a: continue
    try: m = get(a["browser_download_url"])
    except Exception: continue
    for fl, b in (m.get("builds") or {}).items():
        print(r["tag_name"], fl, b.get("executable_hash", ""), b.get("sha256", ""))
PY
}

status() {
  say "status: $PROGRAM_ID on $CLUSTER ($URL)"
  local g; g=$(cluster_genesis)
  case "$g" in "$MAINNET_GENESIS") info "cluster: mainnet-beta" ;; "$DEVNET_GENESIS") info "cluster: devnet" ;; "") warn "could not read the genesis hash" ;; *) info "cluster genesis: $g" ;; esac
  local show auth slot pd len
  show=$(program_show) || die "solana program show failed: $(cat "$WORK/show.err")"
  IFS='|' read -r auth slot pd len <<<"$show"
  info "programdata:       $pd"
  info "last deployed:     slot $slot"
  info "upgrade authority: ${auth:-none (immutable)}"
  if [ -n "$VAULT" ]; then
    if [ "$auth" = "$VAULT" ]; then info "                   = the Squads vault you gave"; else warn "upgrade authority is NOT the vault $VAULT"; fi
  fi
  sol program dump "$PROGRAM_ID" "$WORK/onchain.so" >/dev/null
  ONCHAIN_EXE=$(exe_hash_of "$WORK/onchain.so")
  info "data length:       $len bytes (dump: $(stat -c %s "$WORK/onchain.so"))"
  info "sha256 (dump):     $(sha256_of "$WORK/onchain.so")"
  info "executable hash:   $ONCHAIN_EXE   (= solana-verify get-program-hash)"
  local idx latest match
  idx=$(releases_index)
  if [ -z "$idx" ]; then warn "no program-v* release found (or GitHub unreachable) — nothing to compare with"; return 0; fi
  latest=$(awk -v f="$FLAVOUR" '$2==f{print $1" "$3; exit}' <<<"$idx")
  match=$(awk -v h="$ONCHAIN_EXE" '$3==h{print $1" ("$2")"}' <<<"$idx" | paste -sd, -)
  info "latest release:    ${latest:-none with a $FLAVOUR build}"
  if [ -n "$match" ]; then
    info "on-chain code is:  $match"
    [ "${latest%% *}" = "$(awk -v h="$ONCHAIN_EXE" -v f="$FLAVOUR" '$3==h&&$2==f{print $1; exit}' <<<"$idx")" ] || warn "not the latest $FLAVOUR release (a rollback in effect, or not upgraded yet)"
  else
    printf '\n   !!! UNKNOWN CODE: the on-chain program is not any published program-v* release.\n   !!! If nobody on the team deployed it: docs/PROGRAM_ROLLBACK.md, step 1 (emergency pause) now.\n' >&2
    return 1
  fi
}

fetch_release() { # -> sets SO, SO_SHA, SO_EXE
  say "1. download and verify $TAG ($FLAVOUR build)"
  local f="swd_amm-${FLAVOUR}.so"
  for a in release.json SHA256SUMS "$f"; do
    info "GET $RELEASE_BASE/$TAG/$a"
    curl -fsSL --retry 3 -o "$WORK/$a" "$RELEASE_BASE/$TAG/$a" || die "could not download $a from release $TAG"
  done
  ( cd "$WORK" && grep -E " \*?${f}\$" SHA256SUMS | sha256sum -c - ) >/dev/null || die "$f does not match the release's SHA256SUMS"
  local man_sha man_exe man_tag
  read -r man_tag man_sha man_exe < <(python3 -c '
import json,sys; m=json.load(open(sys.argv[1])); b=m["builds"][sys.argv[2]]; print(m.get("tag",""), b["sha256"], b["executable_hash"])' "$WORK/release.json" "$FLAVOUR") \
    || die "release.json has no $FLAVOUR build"
  SO="$WORK/$f"; SO_SHA=$(sha256_of "$SO"); SO_EXE=$(exe_hash_of "$SO")
  [ "$SO_SHA" = "$man_sha" ] || die "sha256 $SO_SHA != release.json $man_sha"
  [ "$SO_EXE" = "$man_exe" ] || die "executable hash $SO_EXE != release.json $man_exe"
  [ "$man_tag" = "$TAG" ] || warn "release.json says tag '$man_tag' (asked for $TAG)"
  [ -z "$WANT_SHA" ] || [ "$WANT_SHA" = "$SO_SHA" ] || [ "$WANT_SHA" = "$SO_EXE" ] || die "--sha256 $WANT_SHA does not match the release file ($SO_SHA)"
  info "ok: SHA256SUMS, release.json${WANT_SHA:+ and --sha256} agree"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh attestation verify "$SO" --repo "$REPO" >/dev/null || die "Sigstore provenance check failed: $f was not built by this repository's workflow"
    info "ok: signed provenance (built by $REPO's verifiable-build workflow)"
  else
    warn "gh not logged in: provenance not checked. Check it yourself: gh attestation verify $f --repo $REPO"
  fi
}

prepare() {
  if [ -n "$SO_IN" ]; then
    [ -z "$TAG" ] || die "give a release TAG or --so FILE, not both"
    [ -f "$SO_IN" ] || die "--so file not found: $SO_IN"
    [[ "$WANT_SHA" =~ ^[0-9a-f]{64}$ ]] || die "--so needs --sha256 <64 hex> (the hash you expect, from a release or the audit report)"
    say "1. verify the local file"
    cp "$SO_IN" "$WORK/target.so"; SO="$WORK/target.so"; SO_SHA=$(sha256_of "$SO"); SO_EXE=$(exe_hash_of "$SO")
    [ "$WANT_SHA" = "$SO_SHA" ] || [ "$WANT_SHA" = "$SO_EXE" ] || die "sha256 of $SO_IN is $SO_SHA, not $WANT_SHA — do not deploy it"
    info "ok: hash matches"
  else
    [ -n "$TAG" ] || die "usage: $0 prepare <program-vX.Y.Z> | --so FILE --sha256 HEX  [options]"
    [[ "$TAG" =~ ^program-v[0-9A-Za-z._-]+$ ]] || die "tag must look like program-vX.Y.Z"
    fetch_release
  fi
  info "file:            $SO ($(stat -c %s "$SO") bytes)"
  info "sha256:          $SO_SHA"
  info "executable hash: $SO_EXE"

  say "target: $PROGRAM_ID on $CLUSTER (mode: $MODE)"
  local g; g=$(cluster_genesis)
  if [ "$g" = "$MAINNET_GENESIS" ]; then
    [ "$CLUSTER" = mainnet ] || die "the RPC is mainnet-beta but --cluster is $CLUSTER"
    [ "$MODE" = squads ] || die "direct upgrades are refused on mainnet-beta: the upgrade authority is the Squads vault"
  elif [ -z "$g" ]; then
    [ "$EXECUTE" -eq 0 ] || die "cannot reach $URL"
    warn "RPC unreachable — dry run continues with placeholders"
  elif [ "$CLUSTER" = mainnet ]; then
    die "--cluster mainnet but the RPC's genesis is $g (not mainnet-beta)"
  fi
  local auth="" slot="" pd="" len="" show
  if [ -n "$g" ]; then
    show=$(program_show) || die "solana program show failed: $(cat "$WORK/show.err")"
    IFS='|' read -r auth slot pd len <<<"$show"
    info "now on chain: authority ${auth:-none}, last deployed slot $slot, data length $len"
    [ -n "$auth" ] || die "the program is immutable (no upgrade authority): it cannot be rolled back"
    sol program dump "$PROGRAM_ID" "$WORK/onchain.so" >/dev/null
    local cur; cur=$(exe_hash_of "$WORK/onchain.so")
    info "current executable hash: $cur"
    if [ "$cur" = "$SO_EXE" ]; then info "the chain ALREADY runs exactly this code — nothing to do"; return 0; fi
    local size; size=$(stat -c %s "$SO")
    if [ -n "$len" ] && [ "$size" -gt "$len" ]; then
      warn "the new code ($size bytes) is larger than the program's data account ($len bytes): extend it first:"
      if [ "$MODE" = direct ]; then run sol program extend "$PROGRAM_ID" $((size - len))
      else info "  solana program extend $PROGRAM_ID $((size - len)) -u <RPC>   (if the CLI asks for the upgrade authority, do it as a Squads proposal too)"; fi
    fi
  fi

  local payer; payer=$(solana-keygen pubkey "${KEYPAIR:-$(solana config get keypair 2>/dev/null | awk '{print $NF}')}" 2>/dev/null || echo "<your solana CLI keypair>")
  if [ "$MODE" = squads ]; then
    [ -n "$VAULT" ] || die "--vault <SQUADS_VAULT> is needed (the address that must become the buffer authority)"
    if [ -n "$auth" ] && [ "$auth" != "$VAULT" ]; then
      die "the program's upgrade authority is $auth, not the vault $VAULT — stop: if nobody on the team changed it, the authority itself is compromised (docs/PROGRAM_ROLLBACK.md, 'authority lost')"
    fi
  else
    local ua_path="${UPGRADE_AUTH:-${KEYPAIR:-}}" ua
    ua=$(solana-keygen pubkey "${ua_path:-$(solana config get keypair 2>/dev/null | awk '{print $NF}')}" 2>/dev/null || echo "")
    [ -z "$auth" ] || [ -z "$ua" ] || [ "$ua" = "$auth" ] || die "upgrade authority on chain is $auth, but your keypair is $ua"
  fi

  say "2. write the code into a new buffer account (not live yet; costs ~$(python3 -c "import sys;print(round((int(sys.argv[1])+37)*6960/1e9+0.003,3))" "$(stat -c %s "$SO")") SOL, refunded when the buffer is used or closed)"
  local wb=(program write-buffer "$SO" --output json)
  [ "$PRIORITY_FEE" -eq 0 ] || wb+=(--with-compute-unit-price "$PRIORITY_FEE")
  BUFFER="<BUFFER>"
  run sol "${wb[@]}" | tee "$WORK/buffer.json"
  if [ "$EXECUTE" -eq 1 ]; then
    BUFFER=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["buffer"])' "$WORK/buffer.json") || die "could not read the buffer address"
    info "buffer: $BUFFER   (if anything below fails: solana program close $BUFFER -u $URL  refunds the SOL)"
    say "3. check the buffer holds exactly the verified code"
    sol program dump "$BUFFER" "$WORK/buffer.so" >/dev/null
    [ "$(exe_hash_of "$WORK/buffer.so")" = "$SO_EXE" ] || die "buffer hash differs from the verified file — close it and stop"
    info "ok: buffer executable hash = $SO_EXE"
  else
    say "3. (after step 2) the script dumps the buffer and checks its hash = $SO_EXE"
  fi

  if [ "$MODE" = direct ]; then
    say "4. upgrade $PROGRAM_ID from the buffer ($CLUSTER, direct)"
    local UA=(); [ -n "$UPGRADE_AUTH" ] && UA=(--upgrade-authority "$UPGRADE_AUTH")
    run sol program upgrade "$BUFFER" "$PROGRAM_ID" "${UA[@]}"
    if [ "$EXECUTE" -eq 1 ]; then status || true; else say "5. afterwards: bash scripts/rollback-program.sh status --cluster $CLUSTER"; fi
    return 0
  fi

  say "4. hand the buffer to the Squads vault (only the vault can then use or close it)"
  run sol program set-buffer-authority "$BUFFER" --new-buffer-authority "$VAULT"
  say "5. Squads: propose, approve, wait for the time lock, execute"
  cat <<EOF
   Program:   $PROGRAM_ID
   Buffer:    $BUFFER   (authority: $VAULT)
   New code:  executable hash $SO_EXE${TAG:+  (release $TAG, $FLAVOUR build)}
   Refund to: $payer   (the buffer's SOL goes back here when the upgrade executes)

   a) Squads app (app.squads.so), the multisig whose vault is $VAULT:
      Developers -> Programs -> add / select $PROGRAM_ID -> "Upgrade" (Add upgrade):
        buffer address = $BUFFER, buffer refund = $payer
      Squads checks that the buffer authority is the vault. Write the release tag and the executable hash above
      in the proposal's memo / description so each member can check it.
   b) Every member, before approving (on their own computer):
        solana program dump $BUFFER buffer.so -u <RPC> && bash scripts/verified-build.sh hash buffer.so
      -> the executable hash must be $SO_EXE (and equal the release's release.json / the audit report).
   c) Threshold approvals (2 of 3). If the multisig has a Squads time lock, the transaction can only be executed
      after it has passed. The swd_amm program's own 24-48 h governance timelock does NOT cover code upgrades:
      the Squads time lock is the only delay. Keep the pools PAUSED (emergency key) while you wait.
   d) Execute. Then check:
        bash scripts/rollback-program.sh status --cluster $CLUSTER --program-id $PROGRAM_ID --url <RPC> --vault $VAULT
      -> executable hash $SO_EXE, upgrade authority still $VAULT. Then set the repository variable
         EXPECTED_HASH_${CLUSTER^^}=$SO_EXE (program-watch) until a new release is cut, and unpause through the timelock
         (yarn governance propose-unpause-v2 ...).
   If you abandon it: a Squads proposal closing the buffer (solana program close $BUFFER, signed by the vault)
   returns the SOL.
EOF
}

case "$CMD" in
  status) status ;;
  prepare) prepare ;;
  *) sed -n '2,42p' "$0" >&2; exit 2 ;;
esac
