#!/usr/bin/env bash
# Tests make-genesis.sh: a good config makes a draft and a final genesis that verify; each unsafe input is refused;
# a tampered genesis fails `verify`. With --e2e it also starts the final genesis as a one-validator chain (validator
# key in a file keyring with a passphrase, not the test backend) and checks it while it runs.
#   bash zetaphy-chain/mainnet/test-make-genesis.sh <zetaphyd> [--e2e]
# The fund keys made here are throwaway TEST keys (a test keyring in a temporary directory, deleted at the end):
# make-genesis.sh itself only ever sees their addresses.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
Z=$(readlink -f "${1:?usage: test-make-genesis.sh <zetaphyd> [--e2e]}")
E2E=${2:-}
export ZETAPHYD=$Z
T=$(mktemp -d "${TMPDIR:-/tmp}/mg-test.XXXXXX")
NODE_PID=""
cleanup() { [ -z "$NODE_PID" ] || kill "$NODE_PID" 2>/dev/null || true; rm -rf "$T"; }
trap cleanup EXIT
cd "$T"   # the binary may create data/ in its working directory
MG="$here/make-genesis.sh"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok   $*"; }

K="$T/keys"; KT="--keyring-backend test --keyring-dir $K"
for n in rewards airdrop community liquidity team m1 m2 m3 other; do "$Z" keys add $n $KT --algo eth_secp256k1 >/dev/null 2>&1; done
addr() { "$Z" keys show "$1" -a $KT; }
pub() { "$Z" keys show "$1" -p $KT; }
P="--keyring-backend test --keyring-dir $K/pub"
for n in m1 m2 m3; do "$Z" keys add $n --pubkey "$(pub $n)" $P >/dev/null 2>&1; done
"$Z" keys add cms --multisig m1,m2,m3 --multisig-threshold 2 $P >/dev/null 2>&1
"$Z" keys show cms -p $P > "$T/ca.json"
MS=$("$Z" keys show cms -a $P)

# The validator's key: a file keyring with a passphrase (as on the validator machine), never the test backend.
VH="$T/validator"; PASS="test-only-passphrase-$$"
VK="--keyring-backend file --keyring-dir $VH/keys"
printf '%s\n%s\n' "$PASS" "$PASS" | "$Z" keys add validator $VK --algo eth_secp256k1 --output json > /dev/null 2>&1
VAL=$(printf '%s\n' "$PASS" | "$Z" keys show validator -a $VK)
[ -f "$VH/keys/keyring-file/validator.info" ] || fail "no file-keyring entry"

base() { # the good config, with the real (test) addresses
  sed -e "s|^ALLOC_REWARDS=0x1*|ALLOC_REWARDS=$(addr rewards)|" -e "s|^ALLOC_SWD_AIRDROP=0x2*|ALLOC_SWD_AIRDROP=$(addr airdrop)|" \
      -e "s|^ALLOC_COMMUNITY=0x3*|ALLOC_COMMUNITY=$(addr community)|" -e "s|^ALLOC_LIQUIDITY=0x4*|ALLOC_LIQUIDITY=$(addr liquidity)|" \
      -e "s|^ALLOC_VALIDATOR=0x5*|ALLOC_VALIDATOR=$VAL|" -e "s|^ALLOC_CIRCUIT=0x6*|ALLOC_CIRCUIT=$MS|" \
      -e "s|^CIRCUIT_AUTHORITY=0x6*|CIRCUIT_AUTHORITY=$MS|" -e "s|^ALLOC_TEAM=0x7*|ALLOC_TEAM=$(addr team)|" \
      -e "s|^GENESIS_TIME=.*|GENESIS_TIME=${GT:-2027-01-15T12:00:00Z}|" \
      -e "s|^CIRCUIT_AUTHORITY_PUBKEY_FILE=.*|CIRCUIT_AUTHORITY_PUBKEY_FILE=$T/ca.json|" "$here/mainnet.example.env"
}
n=0
refused() { # refused <what> <expected message part> <sed expression | -> [config file]
  n=$((n + 1)); local c="$T/bad$n.env" out
  if [ "$3" = - ]; then cat > "$c"; else base | sed -e "$3" > "$c"; fi
  if out=$(bash "$MG" draft "$c" "$T/bad$n" 2>&1); then fail "$1: accepted"; fi
  grep -q "REFUSED: .*$2" <<<"$out" || fail "$1: refused for another reason: $out"
  [ ! -e "$T/bad$n/genesis.draft.json" ] || fail "$1: wrote a genesis"
  ok "refused: $1"
}

# ---- unsafe inputs
cp "$here/mainnet.example.env" "$T/example.env"
out=$(bash "$MG" draft "$T/example.env" "$T/ex" 2>&1) && fail "the example as it is: accepted"
grep -q 'placeholder' <<<"$out" || fail "the example: $out"; ok "refused: the example config as shipped (placeholders)"
refused "no circuit authority" "CIRCUIT_AUTHORITY is required" '/^CIRCUIT_AUTHORITY=/d'
refused "no multisig key file" "CIRCUIT_AUTHORITY_PUBKEY_FILE is required" '/^CIRCUIT_AUTHORITY_PUBKEY_FILE=/d'
pub m1 > "$T/single.json"
refused "a single key as circuit authority" "not a multisig" "s|^CIRCUIT_AUTHORITY_PUBKEY_FILE=.*|CIRCUIT_AUTHORITY_PUBKEY_FILE=$T/single.json|"
jq '.threshold = 1' "$T/ca.json" > "$T/t1.json"
refused "a 1-of-3 multisig" "at least 2 of at least 2" "s|^CIRCUIT_AUTHORITY_PUBKEY_FILE=.*|CIRCUIT_AUTHORITY_PUBKEY_FILE=$T/t1.json|"
jq '.public_keys[1] = .public_keys[0]' "$T/ca.json" > "$T/dup.json"
refused "a multisig that repeats a key" "repeats a key" "s|^CIRCUIT_AUTHORITY_PUBKEY_FILE=.*|CIRCUIT_AUTHORITY_PUBKEY_FILE=$T/dup.json|"
refused "circuit authority address not the multisig's account" "is not CIRCUIT_AUTHORITY" "s|^CIRCUIT_AUTHORITY=.*|CIRCUIT_AUTHORITY=$(addr other)|"
refused "the testnet chain id" "is the testnet's" 's/^CHAIN_ID=.*/CHAIN_ID=zetaphy_77390-1/'
refused "the testnet EVM chain id" "is taken" 's/^EVM_CHAIN_ID=.*/EVM_CHAIN_ID=77390/; s/^CHAIN_ID=.*/CHAIN_ID=zetaphy_77390-2/'
refused "the cosmos/evm default EVM chain id" "is taken" 's/^EVM_CHAIN_ID=.*/EVM_CHAIN_ID=262144/; s/^CHAIN_ID=.*/CHAIN_ID=zetaphy_262144-1/'
refused "chain id and EVM chain id disagree" "must agree" 's/^EVM_CHAIN_ID=.*/EVM_CHAIN_ID=3660/'
refused "allocations below the supply" "add up to 999,999,999" 's/^\(ALLOC_LIQUIDITY=[^ ]*\) 98999000/\1 98998999/'
refused "allocations above the supply" "must be equal" 's/^TOTAL_SUPPLY=.*/TOTAL_SUPPLY=999000000/'
refused "a placeholder address" "placeholder" 's/^\(ALLOC_REWARDS=\)[^ ]*/\10x1111111111111111111111111111111111111111/'
refused "an address with a bad checksum" "not a zetaphy1" "s/^\(ALLOC_REWARDS=zetaphy1[a-z0-9]*\)[a-z0-9] /\1q /;s/^\(ALLOC_REWARDS=zetaphy1[a-z0-9]*\)qq /\1pp /"
refused "the same address twice" "one allocation per address" "s|^\(ALLOC_COMMUNITY=\)[^ ]*|\1$(addr rewards)|"
refused "a faucet allocation" "no faucet" "s|^ALLOC_LIQUIDITY=\([^ ]*\) 98999000|ALLOC_LIQUIDITY=\1 98998000\nALLOC_FAUCET=$(addr other) 1000|"
refused "no validator account" "ALLOC_VALIDATOR is required" 's/^ALLOC_VALIDATOR=.*//; s/^TOTAL_SUPPLY=.*/TOTAL_SUPPLY=999000000/'
refused "the testnet's 600 s voting period" "at least 1 day" 's/^GOV_VOTING_PERIOD=.*/GOV_VOTING_PERIOD=600s/'
refused "a 1-day unbonding time" "at least 7 days" 's/^STAKING_UNBONDING_TIME=.*/STAKING_UNBONDING_TIME=1d/'
refused "a tiny proposal deposit" "at least 100" 's/^GOV_MIN_DEPOSIT=.*/GOV_MIN_DEPOSIT=1/'
refused "a power cap above 1/3" "at most 3333" 's/^POWER_CAP_BPS=.*/POWER_CAP_BPS=5000/'
refused "vesting that ends before it starts" "vesting must start" 's/genesis+365d genesis+1460d/genesis+365d genesis+100d/'
refused "a self-bond of the whole validator allocation" "must be below" 's/^SELF_BOND=.*/SELF_BOND=1000000/'
refused "a zero minimum gas price" "MIN_GAS_PRICE" 's/^MIN_GAS_PRICE=.*/MIN_GAS_PRICE=0/'
refused "an unknown key (typo)" "unknown key GOV_VOTING_PERIODS" 's/^GOV_VOTING_PERIOD=/GOV_VOTING_PERIODS=/'
refused "shell syntax in a value" "shell syntax" 's/^SYMBOL=.*/SYMBOL=$(id)/'
refused "a private key in the config" "unknown key" '$ a PRIVATE_KEY=0xabc'

# ---- the good config
GT=$(date -u -d '+40 seconds' +%Y-%m-%dT%H:%M:%SZ)
base > "$T/good.env"
bash "$MG" draft "$T/good.env" "$T/out" > "$T/draft.log" 2>&1 || { cat "$T/draft.log"; fail "the good config was refused"; }
cat "$T/draft.log"
[ -f "$T/out/genesis.draft.json" ] || fail "no draft"
grep -rqi 'mnemonic\|priv_key\|private' "$T/out" && fail "the output holds key material"
ok "draft from the good config"
bash "$MG" verify "$T/good.env" "$T/out/genesis.draft.json" --draft > /dev/null || fail "the draft does not verify"
ok "the draft verifies"

# ---- tampered genesis files fail verify
tamper() { # tamper <what> <jq filter> <expected>
  jq "$2" "$T/out/genesis.draft.json" > "$T/tampered.json"
  out=$(bash "$MG" verify "$T/good.env" "$T/tampered.json" --draft 2>&1) && fail "tampered ($1): verified"
  grep -q "$3" <<<"$out" || fail "tampered ($1): $out"
  ok "verify refuses a genesis with $1"
}
tamper "a faucet account added" '.app_state.bank.balances += [{"address":"'"$(addr other)"'","coins":[{"denom":"azetaphy","amount":"1"}]}]' "unexpected balance\|add up\|rejected"
tamper "the constitution removed" '.app_state.zetaphypq |= map(select(.key != "45"))' "zetaphypq key 45"
tamper "the chain guard off" '.app_state.zetaphypq |= map(select(.key != "40"))' "zetaphypq key 40"
tamper "another circuit authority" '.app_state.zetaphypq |= map(if .key == "43" then .value = "'"$(printf '%040x' 7)"'" else . end)' "zetaphypq key 43"
tamper "a 600 s voting period" '.app_state.gov.params.voting_period = "600s" | .app_state.gov.params.expedited_voting_period = "300s"' "voting_period"
tamper "the testnet chain id" '.chain_id = "zetaphy_77390-1"' "chain_id"
tamper "inflation" '.app_state.mint.params.inflation_max = "0.100000000000000000"' "inflation"
tamper "a lower min gas price" '.app_state.feemarket.params.min_gas_price = "1.000000000000000000"' "feemarket"

# ---- the validator's gentx (on the validator machine, against the draft), then finalize
"$Z" init zetaphy-validator-0 --chain-id zetaphy_3659-1 --home "$VH" > /dev/null 2>&1
cp "$T/out/genesis.draft.json" "$VH/config/genesis.json"
printf '%s\n' "$PASS" | "$Z" genesis gentx validator 500000000000000000000000azetaphy $VK --chain-id zetaphy_3659-1 --home "$VH" \
  --moniker zetaphy-validator-0 --commission-rate 0.05 --commission-max-rate 0.2 --commission-max-change-rate 0.01 \
  --gas-prices 1000000000azetaphy --ip 127.0.0.1 --output-document "$T/gentx.json" > /dev/null 2>&1 || fail "gentx"
ok "gentx with the file keyring"
# a gentx bonding another amount is refused
printf '%s\n' "$PASS" | "$Z" genesis gentx validator 400000000000000000000000azetaphy $VK --chain-id zetaphy_3659-1 --home "$VH" \
  --moniker x --gas-prices 1000000000azetaphy --ip 127.0.0.1 --output-document "$T/gentx-other.json" > /dev/null 2>&1
mkdir -p "$T/out2" && cp "$T/out/genesis.draft.json" "$T/out2/"
out=$(bash "$MG" finalize "$T/good.env" "$T/out2" "$T/gentx-other.json" 2>&1) && fail "a gentx with another self-bond: accepted"
grep -q 'SELF_BOND' <<<"$out" && [ ! -e "$T/out2/genesis.json" ] || fail "gentx amount: $out"
ok "finalize refuses a gentx that bonds another amount than SELF_BOND"
bash "$MG" finalize "$T/good.env" "$T/out" "$T/gentx.json" > "$T/final.log" 2>&1 || { cat "$T/final.log"; fail "finalize"; }
cat "$T/final.log"
SHA=$(sed -n 's/^GENESIS_SHA256=//p' "$T/final.log")
[ "$SHA" = "$(sha256sum "$T/out/genesis.json" | cut -d' ' -f1)" ] && grep -q "^$SHA  genesis.json$" "$T/out/genesis.sha256" || fail "sha256"
jq -e '.evm_chain_id == 3659 and .chain_id == "zetaphy_3659-1"' "$T/out/chain.json" > /dev/null || fail "chain.json"
bash "$MG" verify "$T/good.env" "$T/out/genesis.json" | tail -1
ok "final genesis verifies; GENESIS_SHA256=$SHA"

[ "$E2E" = --e2e ] || { echo "PASS (unit; --e2e also runs the chain)"; exit 0; }

# ---- end to end: the final genesis as a one-validator chain
cp "$T/out/genesis.json" "$VH/config/genesis.json"
echo "$SHA  $VH/config/genesis.json" | sha256sum -c --quiet - || fail "installed genesis differs"
od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$VH/config/pq_vote_key.seed"; chmod 600 "$VH/config/pq_vote_key.seed"
C="$VH/config/config.toml" A="$VH/config/app.toml"
sed -i -E 's/^timeout_commit = .*/timeout_commit = "1s"/; s/^type = "flood"/type = "app"/; s#^laddr = "tcp://0.0.0.0:26656"#laddr = "tcp://127.0.0.1:36656"#; s#^laddr = "tcp://127.0.0.1:26657"#laddr = "tcp://127.0.0.1:36657"#; s#^pprof_laddr = .*#pprof_laddr = ""#' "$C"
sed -i -E 's/^minimum-gas-prices = .*/minimum-gas-prices = "1000000000azetaphy"/; s/^evm-chain-id = .*/evm-chain-id = 3659/' "$A"
python3 - "$A" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
for sec, kv in (("json-rpc", {"enable": "true", "address": '"127.0.0.1:38545"', "ws-address": '"127.0.0.1:38546"', "api": '"eth,net,web3,txpool,zetaphy"'}),
                ("api", {"enable": "false", "address": '"tcp://127.0.0.1:31317"'}), ("grpc", {"enable": "true", "address": '"127.0.0.1:39090"'})):
    m = re.search(r'(?ms)^\[' + sec + r'\].*?(?=^\[|\Z)', s); new = m.group(0)
    for k, v in kv.items():
        new = re.sub(r'(?m)^' + re.escape(k) + r' = .*', k + ' = ' + v, new)
    s = s.replace(m.group(0), new)
open(p, 'w').write(s)
PY
(cd "$VH" && exec "$Z" start --home "$VH" --chain-id zetaphy_3659-1 --json-rpc.api eth,net,web3,txpool,zetaphy > "$T/node.log" 2>&1) &
NODE_PID=$!
N="--node tcp://127.0.0.1:36657 --home $VH"
q() { "$Z" q "$@" $N -o json 2>/dev/null; }
height() { "$Z" status $N 2>/dev/null | jq -r '.sync_info.latest_block_height // 0' 2>/dev/null || echo 0; }
for _ in $(seq 1 180); do h=$(height); [ "${h:-0}" -ge 20 ] 2>/dev/null && break; sleep 1; done
[ "${h:-0}" -ge 20 ] || { tail -40 "$T/node.log"; fail "the chain did not reach 20 blocks"; }
echo "--- e2e: the chain made $h blocks"
st=$("$Z" status $N)
echo "chain id:        $(jq -r .node_info.network <<<"$st")"
[ "$(jq -r .node_info.network <<<"$st")" = zetaphy_3659-1 ] || fail "chain id"
evm=$(curl -fsS -m 5 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:38545 | jq -r .result)
echo "eth_chainId:     $evm ($((evm)))"; [ "$((evm))" = 3659 ] || fail "EVM chain id"
md=$(q bank denom-metadata-by-query-string --denom azetaphy || q bank denom-metadata azetaphy)
echo "denom metadata:  $(jq -c '.metadata | {base, display, symbol, name, units: [.denom_units[] | "\(.denom)/\(.exponent)"]}' <<<"$md")"
[ "$(jq -r .metadata.symbol <<<"$md")" = ZTPHY ] || fail "denom metadata"
gp=$(q gov params)
echo "gov params:      $(jq -c '.params | {voting_period, expedited_voting_period, max_deposit_period, min_deposit, quorum, threshold}' <<<"$gp")"
case "$(jq -r .params.voting_period <<<"$gp")" in 432000s|120h0m0s) ;; *) fail "gov voting period" ;; esac
echo "staking:         $(q staking params | jq -c '.params | {unbonding_time, bond_denom, min_commission_rate}')"
vals=$(q staking validators | jq -c '[.validators[] | {moniker: .description.moniker, status, tokens}]')
echo "validators:      $vals"; [ "$(jq length <<<"$vals")" = 1 ] || fail "validators"
echo "feemarket:       $(q feemarket params | jq -c '.params | {base_fee, min_gas_price, no_base_fee}')  base fee now $(q feemarket base-fee | jq -r '.base_fee // .')"
for x in rewards airdrop community liquidity team; do
  b=$(q bank balance "$(addr $x)" azetaphy | jq -r .balance.amount); printf 'balance %-10s %s %s\n' "$x" "$(addr $x)" "$b"
done
want_bal() { [ "$(q bank balance "$1" azetaphy | jq -r .balance.amount)" = "$2" ] || fail "balance of $1"; }
want_bal "$(addr rewards)" 500000000000000000000000000; want_bal "$(addr airdrop)" 200000000000000000000000000
want_bal "$(addr community)" 150000000000000000000000000; want_bal "$(addr liquidity)" 98999000000000000000000000
want_bal "$(addr team)" 50000000000000000000000000; want_bal "$MS" 1000000000000000000000
echo "team account:    $(q auth account "$(addr team)" | jq -c '.account | {type: (."@type" // .type), start: (.value.start_time // .start_time)}')"
sup=$(q bank total-supply-of azetaphy 2>/dev/null || q bank total --denom azetaphy)
echo "total supply:    $(jq -r '.amount.amount // .amount' <<<"$sup") (fees burned so far lower it)"
ca=$(q auth account "$MS")
echo "circuit auth.:   $MS $(jq -c '[.. | objects | select(has("threshold"))][0] | {"@type", threshold, keys: ([.[] | arrays | length] | add)}' <<<"$ca")"
curl -fsS -m 5 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"zetaphy_faucetPowInfo","params":[]}' http://127.0.0.1:38545 > "$T/faucet.json" || true
echo "faucet:          $(jq -c '{enabled: .result.enabled, error: .error.message}' "$T/faucet.json")"
[ "$(jq -r '.result.enabled // false' "$T/faucet.json")" = false ] || fail "a faucet is on"
grep -q 'faucet' "$VH/config/"*.key 2>/dev/null && fail "faucet key"; [ ! -e "$VH/config/faucet.key" ] || fail "faucet.key"

# The guards are active: proposals that break the constitution are refused at submission (chain guard on, constitution on)
printf '%s\n' "$PASS" | "$Z" tx pq-vote-key --from validator $VK $N --chain-id zetaphy_3659-1 --gas 600000 --gas-prices 1000000000azetaphy -y -o json > "$T/vk.json" 2>&1 || true
echo "pq-vote-key tx:  $(jq -c '{code, txhash}' "$T/vk.json" 2>/dev/null || tail -1 "$T/vk.json")"
sleep 3
GOV=$("$Z" q auth module-account gov $N -o json | jq -r '.account.value.address // .account.base_account.address // .account.address')
cat > "$T/prop.json" <<J
{"messages":[{"@type":"/cosmos.gov.v1.MsgUpdateParams","authority":"$GOV","params":$(jq -c '.params | .voting_period = "600s"' <<<"$gp")}],
 "deposit":"10000000000000000000000azetaphy","title":"shorter voting","summary":"must be refused by the constitution","metadata":""}
J
out=$(printf '%s\n' "$PASS" | "$Z" tx gov submit-proposal "$T/prop.json" --from validator $VK $N --chain-id zetaphy_3659-1 --gas 900000 --gas-prices 1000000000azetaphy -y -o json 2>&1 || true)
echo "constitution:    voting_period 600s proposal -> $(grep -o 'constitution[^"]*' <<<"$out" | head -1)"
grep -q 'constitution' <<<"$out" || fail "the constitution did not refuse a shorter voting period: $out"
# The circuit breaker: the authority is the genesis multisig. A single key (the validator) cannot trip it; the
# 2-of-3 multisig can (bank sends then fail), and can reset it.
out=$(printf '%s\n' "$PASS" | "$Z" tx circuit trip /cosmos.bank.v1beta1.MsgSend --from validator $VK $N --chain-id zetaphy_3659-1 --gas 600000 --gas-prices 1000000000azetaphy -y -o json 2>&1 || true)
sleep 3
h1=$(jq -r .txhash <<<"$out" 2>/dev/null || true)
r=$([ -n "$h1" ] && "$Z" q tx "$h1" $N -o json 2>/dev/null | jq -r '"code \(.code) \(.raw_log)"' || echo "$out" | tail -1)
echo "circuit (1 key): $(cut -c1-160 <<<"$r")"
case "$r" in "code 0 "*) fail "a single key tripped the circuit breaker" ;; esac
"$Z" keys add cms --multisig m1,m2,m3 --multisig-threshold 2 $KT > /dev/null 2>&1
[ "$("$Z" keys show cms -a $KT)" = "$MS" ] || fail "multisig address"
W="$T/ms"; mkdir -p "$W"; NF="--chain-id zetaphy_3659-1 $N"
ms_tx() { # ms_tx trip|reset <url>: the 2-of-3 multisig signs and broadcasts (as test-anti-rollback.sh)
  "$Z" tx circuit "$1" "$2" --from cms $KT $NF --gas 600000 --gas-prices 1000000000azetaphy --generate-only > "$W/u0.json"
  jq --arg a "$MS" --arg k "circuit-$1" --arg d "$(printf '{"msgs":["%s"]}' "$2" | base64 -w0)" \
    '.body.messages=[{"@type":"/zetaphy.pq.v1.MsgSetFuture",Authority:$a,Kind:$k,Data:$d}]' "$W/u0.json" > "$W/u.json"
  for k in m1 m2; do "$Z" tx sign "$W/u.json" --multisig "$MS" --from $k $KT $NF --sign-mode amino-json --output-document "$W/$k.json"; done
  "$Z" tx multisign "$W/u.json" cms "$W/m1.json" "$W/m2.json" $KT $NF > "$W/s0.json"
  jq --slurpfile u "$W/u.json" '.body.messages=$u[0].body.messages' "$W/s0.json" > "$W/s.json"
  "$Z" tx broadcast "$W/s.json" $N -o json > "$W/b.json" 2>&1 || true
  sleep 3
  "$Z" q tx "$(jq -r .txhash "$W/b.json")" $N -o json | jq -r '"code \(.code) \(.raw_log)"'
}
r=$(ms_tx trip /cosmos.bank.v1beta1.MsgSend 2>&1 | tail -1)
echo "circuit (2of3):  trip -> $(cut -c1-80 <<<"$r")"
case "$r" in "code 0 "*) ;; *) fail "the multisig could not trip: $r" ;; esac
out=$(printf '%s\n' "$PASS" | "$Z" tx bank send validator "$(addr other)" 3azetaphy $VK $NF --gas 200000 --gas-prices 1000000000azetaphy -y -o json 2>&1 || true)
echo "bank send:       $(jq -r '"code \(.code) \(.raw_log)"' <<<"$out" 2>/dev/null | cut -c1-120 || tail -1 <<<"$out")"
grep -q 'circuit breaker' <<<"$out" || fail "a bank send went through the tripped breaker: $out"
r=$(ms_tx reset /cosmos.bank.v1beta1.MsgSend 2>&1 | tail -1)
echo "circuit (2of3):  reset -> $(cut -c1-80 <<<"$r")"
case "$r" in "code 0 "*) ;; *) fail "the multisig could not reset: $r" ;; esac
ok "circuit breaker: single key refused, the genesis multisig trips and resets"
# fees: below the minimum gas price refused, at it accepted
out=$(printf '%s\n' "$PASS" | "$Z" tx bank send validator "$(addr other)" 1azetaphy $VK $N --chain-id zetaphy_3659-1 --gas 200000 --gas-prices 999999999azetaphy -y -o json 2>&1 || true)
echo "fee 0.999 gwei:  $(jq -r '"code \(.code) \(.raw_log)"' <<<"$out" 2>/dev/null | cut -c1-150 || echo "$out" | tail -1)"
[ "$(jq -r .code <<<"$out" 2>/dev/null)" != 0 ] || fail "a tx below the minimum gas price was accepted"
sleep 2
out=$(printf '%s\n' "$PASS" | "$Z" tx bank send validator "$(addr other)" 1azetaphy $VK $N --chain-id zetaphy_3659-1 --gas 200000 --gas-prices 1000000000azetaphy -y -o json 2>&1 || true)
echo "fee 1 gwei:      $(jq -r '"code \(.code) txhash \(.txhash)"' <<<"$out" 2>/dev/null || echo "$out" | tail -1)"
[ "$(jq -r .code <<<"$out")" = 0 ] || fail "a tx at the minimum gas price was refused: $out"
sleep 3
want_bal "$(addr other)" 1
ok "1 gwei accepted, below refused"
bf1=$(q feemarket base-fee | jq -r '.base_fee // .'); sleep 4; bf2=$(q feemarket base-fee | jq -r '.base_fee // .')
echo "base fee:        $bf1 -> $bf2 after empty blocks (floor 1000000000)"
python3 -c "import sys; from decimal import Decimal as D; sys.exit(0 if D(sys.argv[1]) >= D('1000000000') else 1)" "$bf2" || fail "base fee fell below the minimum"
grep -iE 'start guard|CONSENSUS FAILURE|panic' "$T/node.log" | head -5 || true
echo "final height:    $(height)"
kill "$NODE_PID"; wait "$NODE_PID" 2>/dev/null || true; NODE_PID=""
"$Z" export --home "$VH" --output-document "$T/export.json" > /dev/null 2>&1 || fail "export"
echo "zetaphypq store: $(jq -c '[.app_state.zetaphypq[] | select(.key | test("^(08|0f|20|33|40|42|43|45|50)$")) | {(.key): (if .key == "45" then (.value | length | tostring) + " hex chars (constitution JSON)" else .value end)}] | add' "$T/export.json")"
for k in 08 0f 20 33 40 50; do jq -e --arg k $k '.app_state.zetaphypq[] | select(.key == $k)' "$T/export.json" > /dev/null || fail "key $k not in the state"; done
echo "PASS (unit + e2e)"
