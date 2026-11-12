#!/bin/bash
# Anti-rollback / anti-takeover attacks on real devnets (docs/ANTI-ROLLBACK-CHAIN.md).
# Every attack must be refused or detected; the script fails on the first one that is not.
#
#   bash test-anti-rollback.sh <new zetaphyd> <old zetaphyd (without zetaphy-guard)> [workdir] [zetaphyd without zetaphy-shield]
#   ONLY=3 runs devnet 3 alone (the second binary is then not used).
#
# Devnet 1: validators A (60%) and B (40%), both needed for a block, and a full node C.
#   0. mixed binaries before the upgrade height: A runs the OLD binary, B and C the new
#      one; bank, staking and a failing chain-guard proposal run on both, and both nodes
#      report the same app hash at the same heights (a difference would stop the chain)
#   1. the "zetaphy-guard" upgrade: B runs it early, A (old) stops at the height asking
#      for it, A switches to the new binary and the chain goes on with the guard active
#   2. 2 validators: a delegation taking A far above 1/3 is accepted (no cap below 4)
#   3. attack: the old binary after the upgrade: upgrade-check refuses it, and started
#      on C it stops at its first block ("upgrade handler is missing for zetaphy-guard")
#   4. attack: B's data/ put back from an old copy (old priv_validator_state.json and
#      block store): B refuses to start; with a wrong ZETAPHY_ALLOW_DOWNGRADE too;
#      the newest data back: B starts, blocks continue
#   5. attack: governance re-enables a retired signature algorithm: the proposal fails
#   6. attack: the circuit breaker tripped by a non-authority: refused; by the 2-of-3
#      multisig authority: bank sends are refused until it resets
#   7. attack: with the constitution on, a proposal that shortens unbonding, or turns
#      the constitution off, is refused at submission
# Devnet 2: four equal validators (25% each), chain guard on from genesis.
#   8. attack: a delegation taking one validator above 33.33%: refused; a small one passes
# Devnet 3 (with the 4th argument): A runs the binary without "zetaphy-shield", B and C the new one;
# v5, the firewall and the chain guard on from genesis (as on the testnet).
#   9. mixed binaries before the shield height: txs with 65 messages (bank sends, and inside an
#      authz MsgExec) are accepted by both, and both report the same app hash
#  10. the "zetaphy-shield" upgrade: B runs it early, A stops asking for it, switches, the chain goes on
#  11. attack: a tx with more messages than the account guard and the threat gate read (65, or 64
#      inside a MsgExec) is refused; 64 pass; the old binary is refused by upgrade-check
set -euo pipefail
NEW=$(readlink -f "$1"); OLD=$(readlink -f "$2"); W=${3:-$(mktemp -d)}; OLDS=${4:+$(readlink -f "$4")}
D=azetaphy; CHAIN=zetaphy-ar-1
pids() { for f in "$W"/*/*/pid; do [ -f "$f" ] && cat "$f"; done 2>/dev/null || true; }
cleanup() { [ -n "${KEEP:-}" ] || for p in $(pids); do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; for n in "$W"/*/*/node.log; do echo "--- $n"; tail -8 "$n"; done; exit 1; }
ok() { echo "ok $*"; }
seed() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }
rm -rf "$W"; mkdir -p "$W"

# ---- devnet helpers (net <dir> <chain> <base port>)
NET=; PBASE=
node_dir() { echo "$W/$NET/$1"; }
rpc() { echo $((PBASE + 100 + 110 * $1)); }        # node index -> CometBFT RPC port
idx() { case $1 in A) echo 0 ;; B) echo 1 ;; C) echo 2 ;; D) echo 3 ;; E) echo 4 ;; esac; }
port() { rpc "$(idx "$1")"; }
F() { echo "--keyring-backend test --chain-id $CHAIN --node tcp://127.0.0.1:$(port A) --gas 900000 --gas-prices 1000000000$D -y -o json"; }
hgt() { curl -s "127.0.0.1:$(port "${1:-A}")/status" | jq -r '.result.sync_info.latest_block_height // 0' 2>/dev/null || echo 0; }
moving() { local h; h=$(hgt "${2:-A}"); sleep "$1"; [ "$(hgt "${2:-A}")" -gt "$h" ]; }
wait_h() { for _ in $(seq 1 "${3:-90}"); do [ "$(hgt "${2:-A}")" -ge "$1" ] && return 0; sleep 1; done; return 1; }
start() { # start <node> <binary> [env...]
  local n=$1 b=$2 d; shift 2; d=$(node_dir "$n")
  env "$@" "$b" start --home "$d" --chain-id "$CHAIN" < /dev/null >> "$d/node.log" 2>&1 &
  echo $! > "$d/pid"
}
stop() { local p; p=$(cat "$(node_dir "$1")/pid" 2>/dev/null || true); [ -z "$p" ] || { kill "$p" 2>/dev/null || true; for _ in $(seq 1 30); do kill -0 "$p" 2>/dev/null || break; sleep 1; done; }; rm -f "$(node_dir "$1")/pid"; }
alive() { local p; p=$(cat "$(node_dir "$1")/pid" 2>/dev/null || true); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }
addr() { "$NEW" keys show "$1" -a --keyring-backend test --home "$(node_dir "$2")"; }
txok() { # txok <json output of a tx>: wait for it, print its code; its log goes to $W/txlog
  local h q c; echo "$1" > "$W/txlog"
  h=$(echo "$1" | jq -r '.txhash // empty' 2>/dev/null || true); [ -n "$h" ] || { echo "$1" | jq -r '.code // 1' 2>/dev/null || echo 1; return; }
  [ "$(echo "$1" | jq -r '.code')" = 0 ] || { echo "$1" | jq -r .code; return; }
  for _ in $(seq 1 20); do
    q=$("$NEW" q tx "$h" --node "tcp://127.0.0.1:$(port A)" -o json 2>/dev/null || true); c=$(echo "$q" | jq -r '.code // empty' 2>/dev/null || true)
    [ -n "$c" ] && { echo "$q" | jq -r .raw_log > "$W/txlog"; echo "$c"; return; }; sleep 1
  done; echo timeout
}
last_prop() { "$NEW" q gov proposals --node "tcp://127.0.0.1:$(port A)" -o json 2>/dev/null | jq -r '[.proposals[]?.id | tonumber] | max // empty'; }
vote_all() { local n; for n in "$@"; do "$NEW" tx gov vote "$PROP" yes --from "val$n" --home "$(node_dir "$n")" $(F) >/dev/null; done; }
prop_status() { "$NEW" q gov proposal "$1" --node "tcp://127.0.0.1:$(port A)" -o json | jq -r '.proposal.status // .status'; }
prop_reason() { "$NEW" q gov proposal "$1" --node "tcp://127.0.0.1:$(port A)" -o json | jq -r '.proposal.failed_reason // .failed_reason // ""'; }
wait_prop() { for _ in $(seq 1 40); do s=$(prop_status "$1"); case $s in *PASSED|*FAILED|*REJECTED) echo "$s"; return ;; esac; sleep 1; done; echo "$s"; }
propose() { # propose <from node> <zetaphyd args...>: submit, all vote yes, wait; sets PROP and s (its final status)
  local n=$1; shift
  "$NEW" "$@" --from "val$n" --home "$(node_dir "$n")" $(F) > "$W/prop.out" 2>&1 || { cat "$W/prop.out"; return 1; }
  [ "$(txok "$(tail -1 "$W/prop.out")")" = 0 ] || { tail -1 "$W/prop.out"; return 1; }
  PROP=$(last_prop); vote_all $VOTERS; s=$(wait_prop "$PROP")
}
store_key() { curl -s "127.0.0.1:$(port A)/abci_query?path=%22/store/zetaphypq/key%22&data=0x$1" | jq -r '.result.response.value // empty'; }

# mknet <name> <base port> <genesis binary> <powers...>: one validator per power (A, B, ...), plus a full node
mknet() {
  NET=$1; PBASE=$2; local gbin=$3; shift 3
  local names=(A B C D E) pw=("$@") i=0 n G nv=$#
  local all=("${names[@]:0:$((nv + 1))}")   # validators + one full node
  for n in "${all[@]}"; do "$gbin" init "$n" --chain-id "$CHAIN" --home "$(node_dir "$n")" >/dev/null 2>&1; done
  G=$(node_dir A)/config/genesis.json
  jq ".app_state.staking.params.bond_denom=\"$D\" | .app_state.evm.params.evm_denom=\"$D\" | .app_state.mint.params.mint_denom=\"$D\" | .app_state.gov.params.min_deposit[0].denom=\"$D\" | .app_state.gov.params.expedited_min_deposit[0].denom=\"$D\"
    | .app_state.bank.denom_metadata=[{description:\"ZETAPHY\",denom_units:[{denom:\"$D\",exponent:0},{denom:\"zetaphy\",exponent:18}],base:\"$D\",display:\"zetaphy\",name:\"ZETAPHY\",symbol:\"ZETAPHY\"}]
    | .consensus.params.abci.vote_extensions_enable_height=\"1\"
    | .app_state.gov.params.voting_period=\"8s\" | .app_state.gov.params.expedited_voting_period=\"4s\" | .app_state.gov.params.max_deposit_period=\"8s\" ${GENESIS_EXTRA:-}" "$G" > "$G.t" && mv "$G.t" "$G"
  for n in "${all[@]:0:$nv}"; do
    "$gbin" keys add "val$n" --keyring-backend test --home "$(node_dir "$n")" --algo eth_secp256k1 >/dev/null 2>&1
    "$gbin" genesis add-genesis-account "$("$gbin" keys show "val$n" -a --keyring-backend test --home "$(node_dir "$n")")" "100000000000000000000000000$D" --home "$(node_dir A)"
  done
  for n in "${all[@]:1:$((nv - 1))}"; do cp "$G" "$(node_dir "$n")/config/genesis.json"; done
  i=0
  for n in "${all[@]:0:$nv}"; do
    "$gbin" genesis gentx "val$n" "${pw[$i]}" --keyring-backend test --home "$(node_dir "$n")" --chain-id "$CHAIN" --gas-prices "1000000000$D" >/dev/null 2>&1
    i=$((i + 1))
  done
  for n in "${all[@]:1:$((nv - 1))}"; do cp "$(node_dir "$n")"/config/gentx/*.json "$(node_dir A)/config/gentx/"; done
  "$gbin" genesis collect-gentxs --home "$(node_dir A)" >/dev/null 2>&1
  for n in "${all[@]:1}"; do cp "$G" "$(node_dir "$n")/config/genesis.json"; done
  i=0
  for n in "${all[@]}"; do
    local P=$((PBASE + 110 * i))
    sed -i -E "s/^timeout_commit = .*/timeout_commit = \"1s\"/; s/^type = \"flood\"/type = \"app\"/; s#^laddr = \"tcp://127.0.0.1:26657\"#laddr = \"tcp://127.0.0.1:$((P+100))\"#; s#^laddr = \"tcp://0.0.0.0:26656\"#laddr = \"tcp://127.0.0.1:$((P+101))\"#; s/^addr_book_strict = .*/addr_book_strict = false/; s/^allow_duplicate_ip = .*/allow_duplicate_ip = true/; s#^proxy_app = .*#proxy_app = \"tcp://127.0.0.1:$((P+104))\"#; s#^pprof_laddr = .*#pprof_laddr = \"\"#" "$(node_dir "$n")/config/config.toml"
    python3 - "$(node_dir "$n")/config/app.toml" "$P" "$D" <<'PY'
import re, sys
p, port, d = sys.argv[1], int(sys.argv[2]), sys.argv[3]; s = open(p).read()
s = re.sub(r'(?m)^minimum-gas-prices = .*', f'minimum-gas-prices = "1000000000{d}"', s)
for sec, key, val in [('json-rpc', 'enable', 'false'), ('grpc', 'enable', 'false'), ('grpc', 'address', f'"127.0.0.1:{port+102}"'), ('api', 'address', f'"tcp://127.0.0.1:{port+103}"')]:
    s = re.sub(rf'(?ms)(^\[{sec}\].*?^{key} = )\S+', rf'\g<1>{val}', s)
open(p, 'w').write(s)
PY
    seed > "$(node_dir "$n")/config/pq_vote_key.seed"
    i=$((i + 1))
  done
  local peer; peer="$("$gbin" comet show-node-id --home "$(node_dir A)")@127.0.0.1:$((PBASE + 101))"
  for n in "${all[@]:1}"; do sed -i -E "s/^persistent_peers = .*/persistent_peers = \"$peer\"/" "$(node_dir "$n")/config/config.toml"; done
}

# multi <node> <n> [exec]: one tx with n one-unit bank sends from val<node> (inside one authz MsgExec
# with "exec"), signed and broadcast; prints its code (log in $W/txlog)
multi() {
  local n=$1 k=$2 a d; a=$(addr "val$n" "$n"); d=$(node_dir "$n")
  "$NEW" tx bank send "val$n" "$a" 1$D --from "val$n" --home "$d" --generate-only --keyring-backend test --chain-id "$CHAIN" \
    --gas 3000000 --gas-prices "1000000000$D" -o json > "$W/one.json" 2>/dev/null
  if [ -n "${3:-}" ]; then
    jq --argjson k "$k" --arg g "$a" '.body.messages = [{"@type":"/cosmos.authz.v1beta1.MsgExec",grantee:$g,msgs:[range($k) as $i | .body.messages[0]]}]' "$W/one.json" > "$W/multi.json"
  else
    jq --argjson k "$k" '.body.messages = [range($k) as $i | .body.messages[0]]' "$W/one.json" > "$W/multi.json"
  fi
  "$NEW" tx sign "$W/multi.json" --from "val$n" --home "$d" --keyring-backend test --chain-id "$CHAIN" --node "tcp://127.0.0.1:$(port A)" -o json > "$W/multi.signed.json" 2>/dev/null
  txok "$("$NEW" tx broadcast "$W/multi.signed.json" --node "tcp://127.0.0.1:$(port A)" -o json 2>&1 | tail -1)"
}

same_hash() { # same_hash <step> <node> <node>: the two report the same app hash at 5 common heights
  local same=0 a b
  for _ in $(seq 1 30); do
    a=$(curl -s "127.0.0.1:$(port "$2")/abci_info" | jq -r '"\(.result.response.last_block_height) \(.result.response.last_block_app_hash)"')
    b=$(curl -s "127.0.0.1:$(port "$3")/abci_info" | jq -r '"\(.result.response.last_block_height) \(.result.response.last_block_app_hash)"')
    if [ "${a%% *}" = "${b%% *}" ]; then [ "$a" = "$b" ] || fail "$1: app hash differs at ${a%% *}: $2 $a, $3 $b"; same=$((same + 1)); fi
    [ "$same" -ge 5 ] && { echo "$same heights, last $a"; return 0; }; sleep 1
  done
  fail "$1: could not compare app hashes"
}

if [ "${ONLY:-}" != 3 ]; then
# =========================== devnet 1: mixed binaries, the upgrade, attacks 3-7
GENESIS_EXTRA=""
set -- 6000000000000000000000000$D 4000000000000000000000000$D
mknet net1 29545 "$OLD" "$@"
VOTERS="A B"
start A "$OLD"; start B "$NEW"; start C "$NEW"
wait_h 3 || fail "0: devnet 1 does not start"
VA=$("$NEW" keys show valA --bech val -a --keyring-backend test --home "$(node_dir A)")
r=$("$NEW" tx bank send valA "$(addr valB B)" 1000$D --from valA --home "$(node_dir A)" $(F))
[ "$(txok "$r")" = 0 ] || fail "0: bank send"
r=$("$NEW" tx staking delegate "$VA" 1000000000000000000$D --from valB --home "$(node_dir B)" $(F))
[ "$(txok "$r")" = 0 ] || fail "0: delegation"
propose A tx security-proposal circuit-trip /cosmos.bank.v1beta1.MsgSend --deposit "10000000$D" || fail "0: proposal not submitted"
[ "$s" = PROPOSAL_STATUS_FAILED ] || fail "0: a chain-guard proposal before the upgrade must fail (got $s)"
reason=$(prop_reason "$PROP")
echo "$reason" | grep -q 'kind "circuit-trip": ai-model, immune, breaker, breaker-rearm, model-epochs or invariant-firewall' || fail "0: unexpected failure reason: $reason"
same=0
for _ in $(seq 1 30); do
  a=$(curl -s "127.0.0.1:$(port A)/abci_info" | jq -r '"\(.result.response.last_block_height) \(.result.response.last_block_app_hash)"')
  b=$(curl -s "127.0.0.1:$(port B)/abci_info" | jq -r '"\(.result.response.last_block_height) \(.result.response.last_block_app_hash)"')
  if [ "${a%% *}" = "${b%% *}" ]; then [ "$a" = "$b" ] || fail "0: app hash differs at ${a%% *}: A(old) $a, B(new) $b"; same=$((same + 1)); fi
  [ "$same" -ge 5 ] && break; sleep 1
done
[ "$same" -ge 5 ] || fail "0: could not compare app hashes"
moving 3 || fail "0: blocks stopped with mixed binaries"
grep -qiE 'wrong Block.Header.AppHash|CONSENSUS FAILURE' "$(node_dir A)/node.log" "$(node_dir B)/node.log" "$(node_dir C)/node.log" && fail "0: consensus failure"
ok "0 mixed old (A) / new (B, C) binaries: same app hash at $same heights (last $a), proposal $PROP failed identically"
# the copy of B's data/ the attack in 4 puts back (B stopped for a moment: blocks pause)
stop B; cp -a "$(node_dir B)/data" "$W/B-data-old"; start B "$NEW"; moving 4 || fail "0: blocks did not resume"

UH=$(( $(hgt) + 25 ))
GOV=$("$NEW" q auth module-account gov --node "tcp://127.0.0.1:$(port A)" -o json | jq -r '.account.value.address // .account.base_account.address')
jq -n --arg gov "$GOV" --arg h "$UH" --arg d "10000000$D" '{messages:[{"@type":"/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade",authority:$gov,plan:{name:"zetaphy-guard",height:$h,info:""}}],metadata:"",deposit:$d,title:"zetaphy-guard",summary:"chain guard",expedited:false}' > "$W/upg.json"
propose A tx gov submit-proposal "$W/upg.json" || fail "1: upgrade proposal"
[ "$s" = PROPOSAL_STATUS_PASSED ] || fail "1: the upgrade proposal did not pass ($s)"
wait_h $((UH - 1)) || fail "1: never reached $((UH - 1))"
for _ in $(seq 1 60); do grep -q "UPGRADE \"zetaphy-guard\" NEEDED" "$(node_dir A)/node.log" && break; sleep 1; done
grep -q "UPGRADE \"zetaphy-guard\" NEEDED" "$(node_dir A)/node.log" || fail "1: the old binary did not stop at the upgrade height"
alive B || fail "1: B (new binary, installed early) stopped"
stop A; start A "$NEW"
wait_h $((UH + 5)) || fail "1: the chain did not go on after the upgrade"
v=$(store_key 40 | base64 -d | od -An -tu8 --endian=big | tr -d ' ')
[ "$v" = $((UH + 1)) ] || fail "1: guard height $v, want $((UH + 1))"
ok "1 zetaphy-guard applied at $UH (old A stopped asking for it, new B ran it early), guard active from $v"

r=$("$NEW" tx staking delegate "$VA" 30000000000000000000000000$D --from valB --home "$(node_dir B)" $(F))
[ "$(txok "$r")" = 0 ] || fail "2: a delegation on a 2-validator chain was refused"
ok "2 two validators: A delegated far above 1/3, accepted (the cap needs 4+ validators)"

out=$("$OLD" upgrade-check --node "tcp://127.0.0.1:$(port A)" --home "$(node_dir C)" 2>&1 || true)
echo "$out" | grep -q 'REFUSED: this binary has no handler for "zetaphy-guard"' || fail "3: upgrade-check accepted the old binary: $out"
stop C; start C "$OLD"
for _ in $(seq 1 60); do grep -q "upgrade handler is missing for zetaphy-guard upgrade plan" "$(node_dir C)/node.log" && break; sleep 1; done
grep -q "upgrade handler is missing for zetaphy-guard upgrade plan" "$(node_dir C)/node.log" || fail "3: the old binary ran past the upgrade"
stop C; start C "$NEW"
ok "3 old binary after the upgrade: upgrade-check REFUSED, and it stops at its first block"

stop B; mv "$(node_dir B)/data" "$W/B-data-new"; cp -a "$W/B-data-old" "$(node_dir B)/data"
: > "$(node_dir B)/node.log"; start B "$NEW"; sleep 8
alive B && fail "4: B started on an old copy of its data"
grep -q "double sign" "$(node_dir B)/node.log" || fail "4: no refusal message"
: > "$(node_dir B)/node.log"; start B "$NEW" ZETAPHY_ALLOW_DOWNGRADE="$CHAIN:1"; sleep 8
alive B && fail "4: B started with a wrong ZETAPHY_ALLOW_DOWNGRADE"
grep -q "does not match this node" "$(node_dir B)/node.log" || fail "4: no message for the wrong override"
rm -rf "$(node_dir B)/data"; mv "$W/B-data-new" "$(node_dir B)/data"; start B "$NEW"
moving 5 || fail "4: blocks did not resume with B's newest data"
ok "4 restored old priv_validator_state + block store: B refused (also with a wrong override); newest data: blocks continue"

propose A tx security-proposal sig-algos '{"version":1,"retire":["secp256k1"]}' --deposit "10000000$D" || fail "5: proposal"
[ "$s" = PROPOSAL_STATUS_PASSED ] || fail "5: retiring secp256k1 did not pass ($s): $(prop_reason "$PROP")"
propose A tx security-proposal sig-algos '{"version":2,"enable":["secp256k1"]}' --deposit "10000000$D" || fail "5: proposal"
[ "$s" = PROPOSAL_STATUS_FAILED ] || fail "5: re-enabling a retired algorithm: $s"
prop_reason "$PROP" | grep -q "can never be enabled again" || fail "5: reason: $(prop_reason "$PROP")"
store_key 41 | base64 -d | grep -q '"retired":\["secp256k1"\]' || fail "5: list"
ok "5 secp256k1 retired (version 1); the proposal to enable it again failed: $(prop_reason "$PROP" | head -c 80)"

KB="--keyring-backend test --home $(node_dir A)"
for k in k1 k2 k3; do "$NEW" keys add $k $KB --algo eth_secp256k1 >/dev/null 2>&1; done
"$NEW" keys add ms --multisig k1,k2,k3 --multisig-threshold 2 $KB >/dev/null 2>&1
MS=$("$NEW" keys show ms -a $KB)
r=$("$NEW" tx bank send valA "$MS" 10000000000000000000$D --from valA --home "$(node_dir A)" $(F))
[ "$(txok "$r")" = 0 ] || fail "6: funding the multisig"
propose A tx security-proposal circuit-authority "$MS" --deposit "10000000$D" || fail "6: proposal"
[ "$s" = PROPOSAL_STATUS_PASSED ] || fail "6: circuit authority not set ($s): $(prop_reason "$PROP")"
r=$("$NEW" tx circuit trip /cosmos.bank.v1beta1.MsgSend --from valB --home "$(node_dir B)" $(F) 2>&1 | tail -1)
c=$(txok "$r"); [ "$c" != 0 ] || fail "6: a non-authority tripped the breaker"
ms_tx() { # ms_tx trip|reset <url>: the 2-of-3 multisig signs and broadcasts
  # (the CLI prints ZETAPHY messages in JSON without their fields; they are put back
  # with their Go field names, which is what the JSON decoder reads, as gov.sh does)
  local NF="--chain-id $CHAIN --node tcp://127.0.0.1:$(port A)" k
  "$NEW" tx circuit "$1" "$2" --from ms $KB $NF --gas 600000 --gas-prices 1000000000$D --generate-only > "$W/u0.json"
  jq --arg a "$MS" --arg k "circuit-$1" --arg d "$(printf '{"msgs":["%s"]}' "$2" | base64 -w0)" \
    '.body.messages=[{"@type":"/zetaphy.pq.v1.MsgSetFuture",Authority:$a,Kind:$k,Data:$d}]' "$W/u0.json" > "$W/u.json"
  for k in k1 k2; do "$NEW" tx sign "$W/u.json" --multisig "$MS" --from $k $KB $NF --sign-mode amino-json --output-document "$W/$k.json"; done
  "$NEW" tx multisign "$W/u.json" ms "$W/k1.json" "$W/k2.json" $KB $NF > "$W/s0.json"
  jq --slurpfile u "$W/u.json" '.body.messages=$u[0].body.messages' "$W/s0.json" > "$W/s.json"
  # The app mempool answers "tx already seen" when the same bytes arrive twice, so the
  # result is looked up by the tx hash, whatever the broadcast printed.
  "$NEW" tx broadcast "$W/s.json" --node "tcp://127.0.0.1:$(port A)" -o json > "$W/b.json" 2>&1 || true
  if jq -e '.code != 0' "$W/b.json" >/dev/null 2>&1; then tail -1 "$W/b.json"; return; fi
  printf '{"code":0,"txhash":"%s"}\n' "$("$NEW" tx encode "$W/s.json" | base64 -d | sha256sum | cut -c1-64 | tr a-f A-F)"
}
r=$(ms_tx trip /cosmos.bank.v1beta1.MsgSend 2>&1 | tail -1)
[ "$(txok "$r")" = 0 ] || fail "6: the multisig authority could not trip: $r"
r=$("$NEW" tx bank send valA "$(addr valB B)" 1$D --from valA --home "$(node_dir A)" $(F) 2>&1 | tail -1)
[ "$(txok "$r")" != 0 ] || fail "6: a bank send went through the tripped breaker"
grep -q "circuit breaker" "$W/txlog" || fail "6: refusal: $(cat "$W/txlog")"
r=$(ms_tx reset /cosmos.bank.v1beta1.MsgSend 2>&1 | tail -1)
[ "$(txok "$r")" = 0 ] || fail "6: reset: $r"
# (2, not 1: the app mempool remembers the bytes of the refused send as already seen)
r=$("$NEW" tx bank send valA "$(addr valB B)" 2$D --from valA --home "$(node_dir A)" $(F))
[ "$(txok "$r")" = 0 ] || fail "6: bank send after reset"
ok "6 circuit breaker: non-authority trip refused (code $c); 2-of-3 multisig tripped MsgSend (sends refused), then reset"

propose A tx security-proposal constitution on --deposit "10000000$D" || fail "7: proposal"
[ "$s" = PROPOSAL_STATUS_PASSED ] || fail "7: constitution not on ($s): $(prop_reason "$PROP")"
SP=$("$NEW" q staking params --node "tcp://127.0.0.1:$(port A)" -o json | jq '.params // .')
jq -n --arg gov "$GOV" --arg d "10000000$D" --argjson p "$SP" '{messages:[{"@type":"/cosmos.staking.v1beta1.MsgUpdateParams",authority:$gov,params:($p | .unbonding_time = "60s")}],metadata:"",deposit:$d,title:"short unbonding",summary:"attack",expedited:false}' > "$W/bad.json"
r=$("$NEW" tx gov submit-proposal "$W/bad.json" --from valA --home "$(node_dir A)" $(F) 2>&1 | tail -1)
[ "$(txok "$r")" != 0 ] || fail "7: a proposal shortening unbonding was accepted"
grep -q "constitution" "$W/txlog" || fail "7: refusal: $(cat "$W/txlog")"
r=$("$NEW" tx security-proposal circuit-trip /cosmos.bank.v1beta1.MsgSend --deposit "10000000$D" --from valA --home "$(node_dir A)" $(F) 2>&1 | tail -1)
[ "$(txok "$r")" = 0 ] || fail "7: an ordinary chain-guard proposal was refused: $r"
jq -n --arg gov "$GOV" --arg d "10000000$D" '{messages:[{"@type":"/zetaphy.pq.v1.MsgSetFuture",Authority:$gov,Kind:"constitution",Data:("{\"enabled\":false}"|@base64)}],metadata:"",deposit:$d,title:"off",summary:"attack",expedited:false}' > "$W/off.json"
r=$("$NEW" tx gov submit-proposal "$W/off.json" --from valA --home "$(node_dir A)" $(F) 2>&1 | tail -1)
[ "$(txok "$r")" != 0 ] || fail "7: a proposal turning the constitution off was accepted"
moving 3 || fail "7: blocks stopped"
ok "7 constitution on: shorter unbonding and constitution-off proposals refused at submission"
for n in A B C; do stop $n; done

# =========================== devnet 2: four validators, the voting-power cap
GENESIS_EXTRA='| .app_state.zetaphypq += [{"key":"40","value":"0000000000000001"}]'
set -- 1000000000000000000000000$D 1000000000000000000000000$D 1000000000000000000000000$D 1000000000000000000000000$D
mknet net2 31545 "$NEW" "$@"
VOTERS="A B C D"
for n in A B C D; do start $n "$NEW"; done
wait_h 3 || fail "8: devnet 2 does not start"
VA=$("$NEW" keys show valA --bech val -a --keyring-backend test --home "$(node_dir A)")
r=$("$NEW" tx staking delegate "$VA" 1000000000000000000000000$D --from valB --home "$(node_dir B)" $(F) 2>&1 | tail -1)
[ "$(txok "$r")" != 0 ] || fail "8: a delegation to 40% of the power was accepted"
grep -q "voting power cap" "$W/txlog" || fail "8: refusal: $(cat "$W/txlog")"
r=$("$NEW" tx staking delegate "$VA" 200000000000000000000000$D --from valB --home "$(node_dir B)" $(F))
[ "$(txok "$r")" = 0 ] || fail "8: a delegation to 28.6% was refused"
moving 3 || fail "8: blocks stopped"
ok "8 four validators: a delegation to 40% refused (cap 3333 bps), one to 28.6% accepted"
for n in A B C D E; do stop $n; done
fi

# =========================== devnet 3: the zetaphy-shield upgrade (internal review 2026-11-10, Z-02)
if [ -n "$OLDS" ]; then
GENESIS_EXTRA='| .app_state.zetaphypq += [{"key":"33","value":"0000000000000001"},{"key":"40","value":"0000000000000001"}]'
set -- 6000000000000000000000000$D 4000000000000000000000000$D
mknet net3 33545 "$OLDS" "$@"
VOTERS="A B"
start A "$OLDS"; start B "$NEW"; start C "$NEW"
wait_h 3 || fail "9: devnet 3 does not start"
[ "$(multi A 65)" = 0 ] || fail "9: before the shield height a 65-message tx must be accepted as before: $(cat "$W/txlog")"
[ "$(multi B 65 exec)" = 0 ] || fail "9: before the shield height a MsgExec with 65 messages must be accepted as before: $(cat "$W/txlog")"
r=$(same_hash 9 A B)
moving 3 || fail "9: blocks stopped with mixed binaries"
grep -qiE 'wrong Block.Header.AppHash|CONSENSUS FAILURE' "$(node_dir A)/node.log" "$(node_dir B)/node.log" "$(node_dir C)/node.log" && fail "9: consensus failure"
ok "9 mixed binaries without (A) / with (B, C) zetaphy-shield: 65-message txs accepted by both, same app hash at $r"

UH=$(( $(hgt) + 25 ))
GOV=$("$NEW" q auth module-account gov --node "tcp://127.0.0.1:$(port A)" -o json | jq -r '.account.value.address // .account.base_account.address')
jq -n --arg gov "$GOV" --arg h "$UH" --arg d "10000000$D" '{messages:[{"@type":"/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade",authority:$gov,plan:{name:"zetaphy-shield",height:$h,info:""}}],metadata:"",deposit:$d,title:"zetaphy-shield",summary:"shield",expedited:false}' > "$W/upg.json"
propose A tx gov submit-proposal "$W/upg.json" || fail "10: upgrade proposal"
[ "$s" = PROPOSAL_STATUS_PASSED ] || fail "10: the upgrade proposal did not pass ($s)"
wait_h $((UH - 1)) || fail "10: never reached $((UH - 1))"
for _ in $(seq 1 60); do grep -q "UPGRADE \"zetaphy-shield\" NEEDED" "$(node_dir A)/node.log" && break; sleep 1; done
grep -q "UPGRADE \"zetaphy-shield\" NEEDED" "$(node_dir A)/node.log" || fail "10: the old binary did not stop at the upgrade height"
alive B || fail "10: B (new binary, installed early) stopped"
stop A; start A "$NEW"
wait_h $((UH + 5)) || fail "10: the chain did not go on after the upgrade"
v=$(store_key 50 | base64 -d | od -An -tu8 --endian=big | tr -d ' ')
[ "$v" = $((UH + 1)) ] || fail "10: shield height $v, want $((UH + 1))"
ok "10 zetaphy-shield applied at $UH (old A stopped asking for it, new B ran it early), active from $v"

[ "$(multi A 65)" != 0 ] || fail "11: a 65-message tx was accepted after the shield height"
grep -q "at most 64 messages" "$W/txlog" || fail "11: refusal: $(cat "$W/txlog")"
[ "$(multi B 64 exec)" != 0 ] || fail "11: a MsgExec with 64 inner messages (65 in all) was accepted"
grep -q "at most 64 messages" "$W/txlog" || fail "11: refusal: $(cat "$W/txlog")"
[ "$(multi A 64)" = 0 ] || fail "11: a 64-message tx was refused: $(cat "$W/txlog")"
out=$("$OLDS" upgrade-check --node "tcp://127.0.0.1:$(port A)" --home "$(node_dir C)" 2>&1 || true)
echo "$out" | grep -q 'REFUSED: this binary has no handler for "zetaphy-shield"' || fail "11: upgrade-check accepted the old binary: $out"
moving 3 || fail "11: blocks stopped"
ok "11 after zetaphy-shield: 65 messages (also 64 inside a MsgExec) refused, 64 accepted; the old binary refused by upgrade-check"
for n in A B C; do stop $n; done
fi
echo "all anti-rollback attacks refused or detected"
