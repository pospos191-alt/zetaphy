#!/usr/bin/env bash
# SWD AMM — mainnet deploy kit (2026-11-08). PREPARED, NOT RUN.
#
# DRY RUN BY DEFAULT: prints every command and changes nothing. Add --execute to run; every step that spends SOL
# or changes on-chain state then asks you to type "yes". Runs on YOUR machine with YOUR keypair files — never paste
# a private key anywhere, never put one in this repo or in CI. Thai guide: docs/DEFI_LISTING.th.md.
#
# Order (each is a sub-command; `all` runs them in this order):
#   preflight  tools, versions, cluster = mainnet-beta, keypair files, declare_id == program keypair, clean git tree
#   build      verified (Docker) build with --features mainnet,v2-only (the audited scope; --all-pools for
#              --features mainnet = CP + DLMM too)  -> target/deploy/swd_amm.so + hash, then the IDL
#   estimate   cost from the real .so size (program rent, temporary buffer, IDL, fees)
#   deploy     solana program deploy with the FRESH program keypair (deployer = temporary upgrade authority)
#   idl        anchor idl init (IDL on-chain, so Solscan decodes instructions)
#   verify     solana-verify: write the verify PDA + submit the remote job to OtterSec  -> "Verified" on explorers
#   governance init GlobalConfig + GovernanceSettings (only the upgrade authority may, so BEFORE handover)
#   handover   propose governance -> Squads vault, IDL authority -> vault, upgrade authority -> vault, then PRINT the
#              Squads steps: after the timelock (24 h) the vault itself accepts governance (two-step rotation, K-3)
#   check      read-only: program show, hashes, IDL fetch, governance status
#
# Usage:
#   RPC=https://<private mainnet rpc> DEPLOYER_KEYPAIR=~/keys/deployer.json PROGRAM_KEYPAIR=~/keys/swd_amm-program.json \
#   SQUADS_VAULT=<vault pda> EMERGENCY_AUTHORITY=<pubkey> bash scripts/deploy-mainnet.sh all            # dry run
#   ... bash scripts/deploy-mainnet.sh all --execute                                                   # real
#   ... bash scripts/deploy-mainnet.sh all --all-pools   # ALSO ship CP + DLMM (only if THEY were audited too)
#
# Optional: PRIORITY_FEE (micro-lamports per CU, default 50000), TIMELOCK_SECS (86400), PROTOCOL_FEE_BPS (1000),
#           TREASURY (default SQUADS_VAULT), AUDITED_SHA256 (sha256 of the audited .so; build refuses a mismatch),
#           REPO_URL (default https://github.com/pospos191-alt/zetaphy).
set -euo pipefail

MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
WANT_SOLANA="3.1.10"
WANT_ANCHOR="0.31.1"
LIB=swd_amm
SO="target/deploy/${LIB}.so"
IDL="target/idl/${LIB}.json"
REPO_URL="${REPO_URL:-https://github.com/pospos191-alt/zetaphy}"
PRIORITY_FEE="${PRIORITY_FEE:-50000}"
TIMELOCK_SECS="${TIMELOCK_SECS:-86400}"
PROTOCOL_FEE_BPS="${PROTOCOL_FEE_BPS:-1000}"

EXECUTE=0
# Default = the reduced audit scope: SWDMM v2 + governance, CP and DLMM compiled out (AUDIT_README.md).
FEATURES="mainnet,v2-only"
ARGS=()
for a in "$@"; do
  case "$a" in
    --execute) EXECUTE=1 ;;
    --all-pools) FEATURES="mainnet" ;;
    *) ARGS+=("$a") ;;
  esac
done
CMD="${ARGS[0]:-}"

cd "$(git rev-parse --show-toplevel)"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
need() { [ -n "${!1:-}" ] || die "set $1 (see the header of this script)"; }

# run CMD... : prints it; with --execute asks for "yes" and runs it.
run() {
  printf '   $ %s\n' "$*"
  if [ "$EXECUTE" -eq 0 ]; then return 0; fi
  read -r -p "   Type yes to run this (anything else skips): " ok
  if [ "$ok" = "yes" ]; then "$@"; else info "skipped"; fi
}
# readonly commands always run (when the tool exists)
ro() { printf '   $ %s\n' "$*"; "$@"; }

pubkey_of() { solana-keygen pubkey "$1"; }
program_id() { pubkey_of "$PROGRAM_KEYPAIR"; }
rent_lamports() { # bytes -> lamports (cluster value if reachable, else the 2-year formula)
  local v
  v=$(solana rent "$1" --lamports -u "$RPC" 2>/dev/null | awk '/Rent-exempt minimum/{print $3}') || true
  if [ -n "$v" ]; then echo "$v"; else echo $(( ($1 + 128) * 6960 )); fi
}
sol() { awk -v l="$1" 'BEGIN{printf "%.4f", l/1e9}'; }

preflight() {
  say "preflight"
  local missing=0
  for t in solana solana-keygen anchor solana-verify docker git yarn; do
    if command -v "$t" >/dev/null 2>&1; then info "ok  $t"; else info "MISSING $t"; missing=1; fi
  done
  [ "$missing" -eq 0 ] || die "install the missing tools (solana-verify: cargo install solana-verify)"
  solana --version | grep -q "$WANT_SOLANA" || info "WARNING: solana CLI is not $WANT_SOLANA ($(solana --version))"
  anchor --version | grep -q "$WANT_ANCHOR" || info "WARNING: anchor is not $WANT_ANCHOR ($(anchor --version))"

  need RPC; need DEPLOYER_KEYPAIR; need PROGRAM_KEYPAIR; need SQUADS_VAULT; need EMERGENCY_AUTHORITY
  local g; g=$(solana genesis-hash -u "$RPC") || die "RPC unreachable: $RPC"
  [ "$g" = "$MAINNET_GENESIS" ] || die "RPC is not mainnet-beta (genesis $g)"
  info "cluster: mainnet-beta ($RPC)"
  [ -f "$DEPLOYER_KEYPAIR" ] || die "DEPLOYER_KEYPAIR file not found"
  [ -f "$PROGRAM_KEYPAIR" ] || die "PROGRAM_KEYPAIR file not found"
  case "$(realpath "$PROGRAM_KEYPAIR")" in "$(pwd)"/*) die "keep PROGRAM_KEYPAIR outside the repo";; esac
  case "$(realpath "$DEPLOYER_KEYPAIR")" in "$(pwd)"/*) die "keep DEPLOYER_KEYPAIR outside the repo";; esac

  local pid dep declared
  pid=$(program_id); dep=$(pubkey_of "$DEPLOYER_KEYPAIR")
  declared=$(grep -oP 'declare_id!\("\K[1-9A-HJ-NP-Za-km-z]+' programs/swd_amm/src/lib.rs)
  info "program id (from PROGRAM_KEYPAIR): $pid"
  info "deployer: $dep  balance: $(solana balance "$dep" -u "$RPC")"
  info "squads vault: $SQUADS_VAULT   emergency: $EMERGENCY_AUTHORITY   treasury: ${TREASURY:-$SQUADS_VAULT}"
  [ "$declared" = "$pid" ] || die "declare_id! in lib.rs is $declared, not $pid — set it (and [programs.mainnet] in Anchor.toml), commit, push, rerun"
  [ "$SQUADS_VAULT" != "$dep" ] || die "SQUADS_VAULT must not be the deployer"
  [ "$EMERGENCY_AUTHORITY" != "$SQUADS_VAULT" ] || die "emergency authority must not be the Squads vault"
  if solana account "$pid" -u "$RPC" >/dev/null 2>&1; then info "NOTE: $pid already exists on mainnet (deploy = upgrade)"; fi

  [ -z "$(git status --porcelain)" ] || die "git tree not clean — the verified build is checked against a commit"
  git fetch -q origin || true
  git branch -r --contains HEAD | grep -q . || die "HEAD $(git rev-parse --short HEAD) is not pushed — OtterSec rebuilds from the public repo"
  info "commit: $(git rev-parse HEAD) (pushed)"
}

build() {
  say "build (verified, --features $FEATURES)"
  [ "$FEATURES" = "mainnet,v2-only" ] || info "WARNING: --all-pools ships the CP + DLMM pool types; deploy this only if the audit covered them"
  run solana-verify build --library-name "$LIB" -- --features "$FEATURES"
  if [ -f "$SO" ]; then
    local h="(solana-verify not installed)"
    command -v solana-verify >/dev/null 2>&1 && h=$(solana-verify get-executable-hash "$SO")
    info "executable hash: $h   sha256: $(sha256sum "$SO" | cut -d' ' -f1)"
    [ "$EXECUTE" -eq 1 ] || info "(dry run: this is the .so already in target/, not a fresh verified build)"
    if [ -n "${AUDITED_SHA256:-}" ] && [ "$(sha256sum "$SO" | cut -d' ' -f1)" != "$AUDITED_SHA256" ]; then
      die "the .so does not match AUDITED_SHA256 — do not deploy an unaudited build"
    fi
  fi
  # The IDL must carry the mainnet address (governance.ts reads it). Building it does not touch the .so.
  run anchor idl build -o "$IDL" -- --features "$FEATURES"
}

estimate() {
  say "cost estimate"
  [ -f "$SO" ] || die "$SO not found — run the build step first"
  local so pd prog buf idl_len idl_bytes writes fee_tx prio
  so=$(stat -c %s "$SO")
  pd=$(( so + 45 ))                       # ProgramData header 45 bytes
  local r_pd r_prog r_idl
  r_pd=$(rent_lamports "$pd"); r_prog=$(rent_lamports 36)
  if [ -f "$IDL" ]; then idl_len=$(python3 -c "import zlib,sys;print(len(zlib.compress(open(sys.argv[1],'rb').read())))" "$IDL"); else idl_len=13000; fi
  idl_bytes=$(( idl_len * 2 + 44 ))        # anchor allocates ~2x the compressed IDL (approx.)
  r_idl=$(rent_lamports "$idl_bytes")
  writes=$(( (so + 1011) / 1012 ))         # ~1012 bytes per write transaction
  prio=$(( writes * 200000 * PRIORITY_FEE / 1000000 ))   # ~200k CU budget per write (upper bound)
  fee_tx=$(( writes * 5000 + prio ))
  info ".so size:                      $so bytes"
  info "program data account rent:     $(sol "$r_pd") SOL  (locked while the program exists)"
  info "program account rent:          $(sol "$r_prog") SOL"
  info "temporary buffer (refunded):   $(sol "$r_pd") SOL  (needed in the wallet DURING deploy)"
  info "IDL account rent (approx.):    $(sol "$r_idl") SOL  ($idl_len bytes compressed)"
  info "write transactions:            ~$writes  -> fees up to ~$(sol "$fee_tx") SOL at PRIORITY_FEE=$PRIORITY_FEE"
  info "verify PDA, governance, misc:  ~0.02 SOL"
  local total=$(( r_pd * 2 + r_prog + r_idl + fee_tx + 20000000 ))
  info "HAVE IN THE DEPLOYER WALLET:   >= $(sol "$total") SOL  (about $(sol $(( total - r_pd ))) SOL stays spent/locked)"
  info "To grow the program later: solana program extend <PROGRAM_ID> <BYTES> (more rent)."
}

deploy() {
  say "deploy"
  [ -f "$SO" ] || die "$SO not found — run the build step first"
  run solana program deploy "$SO" --program-id "$PROGRAM_KEYPAIR" --keypair "$DEPLOYER_KEYPAIR" \
    --upgrade-authority "$DEPLOYER_KEYPAIR" --url "$RPC" --with-compute-unit-price "$PRIORITY_FEE" \
    --max-sign-attempts 50 --use-rpc
  info "If it stops half way: rerun the same command with --buffer <BUFFER_KEYPAIR_PRINTED> to resume, or"
  info "'solana program close --buffers --keypair \$DEPLOYER_KEYPAIR -u \$RPC' to get the buffer rent back."
}

idl() {
  say "IDL on-chain"
  [ -f "$IDL" ] || die "$IDL not found — run the build step first"
  local pid; pid=$(program_id)
  grep -q "\"address\": \"$pid\"" "$IDL" || die "$IDL has another address — rebuild it after setting declare_id!"
  run anchor idl init --filepath "$IDL" "$pid" --provider.cluster "$RPC" --provider.wallet "$DEPLOYER_KEYPAIR" \
    --priority-fee "$PRIORITY_FEE"
}

verify() {
  say "verified build -> OtterSec (explorers show Verified)"
  local pid commit; pid=$(program_id); commit=$(git rev-parse HEAD)
  info "on-chain hash vs local build:"
  if [ "$EXECUTE" -eq 1 ]; then ro solana-verify get-program-hash -u "$RPC" "$pid" || true; fi
  # 1) rebuild from the public repo at this commit, compare with the chain, write the verify PDA (signed by the
  #    upgrade authority = still the deployer at this point; after handover use `solana-verify export-pda-tx` and
  #    a Squads proposal instead). solana-verify 0.5.x removed --remote from this command.
  run solana-verify -u "$RPC" verify-from-repo --program-id "$pid" --library-name "$LIB" --commit-hash "$commit" \
    --mount-path . --keypair "$DEPLOYER_KEYPAIR" "$REPO_URL" -- --features "$FEATURES"
  # 2) queue OtterSec's remote build; explorers read its result.
  run solana-verify -u "$RPC" remote submit-job --program-id "$pid" --uploader "$(pubkey_of "$DEPLOYER_KEYPAIR")"
  info "check: solana-verify -u \$RPC remote get-status --program-id $pid"
  info "status: https://verify.osec.io/status/$pid   (and the program page on solscan.io)"
}

governance() {
  say "governance bootstrap (deployer = upgrade authority, so this must happen before handover)"
  local dep; dep=$(pubkey_of "$DEPLOYER_KEYPAIR")
  export ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET="$DEPLOYER_KEYPAIR"
  info "governance.ts submits only with --yes; without it it prints what it would do."
  local yes=(); [ "$EXECUTE" -eq 1 ] && yes=(--yes)
  run yarn -s governance init-global-config "$dep" "$EMERGENCY_AUTHORITY" "${yes[@]}"
  run yarn -s governance init-settings "$TIMELOCK_SECS" "$PROTOCOL_FEE_BPS" "${TREASURY:-$SQUADS_VAULT}" "${yes[@]}"
  info "The init-settings transaction log must show mainnet_build: true (Gate 6 of docs/MAINNET_RUNBOOK.md)."
}

handover() {
  say "hand everything to the Squads vault (do this LAST; afterwards only a 2-of-3 proposal can change anything)"
  local pid; pid=$(program_id)
  export ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET="$DEPLOYER_KEYPAIR"
  local yes=(); [ "$EXECUTE" -eq 1 ] && yes=(--yes)
  # Governance moves in two steps (K-3): the deployer proposes the vault now (timelocked, 24 h on a mainnet build);
  # the vault ACCEPTS later through a Squads proposal. The emergency key was set at init-global-config.
  info "note the action id this prints (\"Would propose governance action #N\"); the vault accepts #N"
  run yarn -s governance propose-governance-authority "$SQUADS_VAULT" "${yes[@]}"
  run anchor idl set-authority --program-id "$pid" --new-authority "$SQUADS_VAULT" \
    --provider.cluster "$RPC" --provider.wallet "$DEPLOYER_KEYPAIR"
  run solana program set-upgrade-authority "$pid" --new-upgrade-authority "$SQUADS_VAULT" \
    --skip-new-upgrade-authority-signer-check --keypair "$DEPLOYER_KEYPAIR" --upgrade-authority "$DEPLOYER_KEYPAIR" --url "$RPC"
  say "handover, part 2 — the Squads vault accepts governance (after ${TIMELOCK_SECS}s, within 7 days)"
  info "Until then the deployer is still governance_authority: keep its key offline, use it for nothing else, and do"
  info "not destroy it before step 4 (it must re-propose if the 7-day accept window is missed)."
  info "1. Fund the vault with ~0.02 SOL (it pays rent for the PendingAction accounts it later proposes)."
  info "2. Print the accept instruction (read-only; nothing is sent because the wallet is not the vault):"
  info "     ANCHOR_PROVIDER_URL=\$RPC ANCHOR_WALLET=\$DEPLOYER_KEYPAIR yarn -s governance accept-authority <N>"
  info "3. In the Squads app (multisig of vault $SQUADS_VAULT): new transaction -> add the printed instruction"
  info "   (program $pid, accounts: GlobalConfig [writable], vault [signer], PendingAction #N [writable];"
  info "   the vault must be the only signer), propose, 2 of 3 members approve, execute."
  info "4. yarn governance status          -> governance_authority == $SQUADS_VAULT"
  info "   yarn governance verify-multisig <MULTISIG_PDA> 0   -> threshold 2 of 3"
  info "   yarn governance settings        -> no other pending action from the deployer (cancel any via Squads)"
  info "5. Retire the deployer key. If step 3 is missed for 7 days the proposal expires: propose again (step 1 of handover)."
}

check() {
  say "check (read-only)"
  need RPC; need PROGRAM_KEYPAIR
  local pid; pid=$(program_id)
  ro solana program show "$pid" --url "$RPC" || true
  ro solana-verify get-program-hash -u "$RPC" "$pid" || true
  [ -f "$SO" ] && ro solana-verify get-executable-hash "$SO" || true
  ro anchor idl fetch "$pid" --provider.cluster "$RPC" >/dev/null && info "IDL on-chain: ok" || info "IDL on-chain: not found"
  ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET="${DEPLOYER_KEYPAIR:-$HOME/.config/solana/id.json}" ro yarn -s governance status || true
  info "Expected after handover: Authority == ${SQUADS_VAULT:-<vault>}, hashes equal, IDL present;"
  info "governance_authority == the vault only after the vault accepted (handover part 2)."
}

[ "$EXECUTE" -eq 1 ] && say "EXECUTE MODE — real mainnet transactions, each one asks first" || say "DRY RUN — nothing is sent (add --execute to run)"
case "$CMD" in
  preflight) preflight ;;
  build) build ;;
  estimate) need RPC; estimate ;;
  deploy) preflight; deploy ;;
  idl) need RPC; need PROGRAM_KEYPAIR; need DEPLOYER_KEYPAIR; idl ;;
  verify) need RPC; need PROGRAM_KEYPAIR; need DEPLOYER_KEYPAIR; verify ;;
  governance) need RPC; need DEPLOYER_KEYPAIR; need EMERGENCY_AUTHORITY; need SQUADS_VAULT; governance ;;
  handover) need RPC; need PROGRAM_KEYPAIR; need DEPLOYER_KEYPAIR; need SQUADS_VAULT; need EMERGENCY_AUTHORITY; handover ;;
  check) check ;;
  all) preflight; build; estimate; deploy; idl; verify; governance; handover; check ;;
  *) sed -n '2,28p' "$0"; exit 2 ;;
esac
