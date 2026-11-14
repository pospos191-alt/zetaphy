#!/bin/bash
# ZETAPHY Saphan MAINNET: the Hyperlane validator(s) and the relayer for ZTPHY ZETAPHY (3659) <-> Base (8453).
# Runbook (EN/TH): docs/SAPHAN-MAINNET.md "Agents". Ubuntu 22.04/24.04, x86_64 or arm64, run with sudo.
#
#   sudo bash setup-agents-mainnet.sh install            [เปลี่ยนการตั้งค่า] Docker, the pinned agent image, swap on small
#                                                         machines, folders; the keys are made HERE and never printed;
#                                                         prints the addresses only (put them in saphan-mainnet.json)
#   sudo AGENT_CONFIG=<file> [CONFIG_SHA256=<hex>] bash setup-agents-mainnet.sh config
#                                                         [เปลี่ยนการตั้งค่า] the agent config written by
#                                                         `node scripts/saphan-mainnet.js agent-config` (no secrets in it)
#   sudo bash setup-agents-mainnet.sh start-validators   [เปลี่ยนการตั้งค่า] our ZETAPHY validator (+ the Base one with VALIDATE_BASE=yes)
#   sudo RELAYER_ENV=<file> bash setup-agents-mainnet.sh start-relayer
#                                                         [เปลี่ยนการตั้งค่า] the relayer; RELAYER_ENV = the output of
#                                                         `node scripts/saphan-mainnet.js relayer-env` (whitelist: the vault
#                                                         and the synthetic only, so nobody can spend its Base ETH)
#   sudo DOMAIN=<host> bash setup-agents-mainnet.sh publish-checkpoints
#                                                         [เปลี่ยนการตั้งค่า] optional: a read-only public copy of the signed
#                                                         checkpoints over HTTPS (Caddy), so anyone can audit what we signed
#   sudo bash setup-agents-mainnet.sh status | addresses | logs <agent> | stop      [อ่าน] / stop: [เปลี่ยนการตั้งค่า]
#
# Machine: see the runbook. On a 1 GB Oracle E2.1.Micro the validators fit (with the 2 GB swap made here); the relayer
# with them is tight and may be restarted by the kernel under memory pressure (it resumes from its database, nothing is
# lost, deliveries wait). The free Ampere A1 (arm64, up to 24 GB) runs all three comfortably: prefer it.
#
# Checkpoints: local storage (free). The validators write /var/lib/hyperlane-mainnet/checkpoints/<origin>; the relayer
# on this same machine reads them (the same path inside the containers). Keys: 32 bytes from /dev/urandom, written once
# to /etc/hyperlane-mainnet (root only, mode 600) and passed to the containers in root-only env files. Nothing secret is
# printed, logged or sent anywhere. Safe to re-run.
set -euo pipefail

# ---- pinned ------------------------------------------------------------------
# ghcr.io/hyperlane-xyz/hyperlane-agent:agents-v2.3.0 (multi-arch index digest, 23 Oct 2026; the same as setup-agents.sh)
IMAGE="${IMAGE:-ghcr.io/hyperlane-xyz/hyperlane-agent@sha256:6414aecfdc1b6ea2e364019f672004c113c2a347dd4d1343aa856921d1e0a685}"

ETC=/etc/hyperlane-mainnet
DATA=/var/lib/hyperlane-mainnet
SETTINGS=$ETC/settings.env
AGENT_UID=10392   # the containers run as this uid, never root
# memory caps (MB): small enough for a 1 GB machine with swap; raise them on a bigger one (MEM_RELAYER=1500 etc.)
MEM_VALIDATOR="${MEM_VALIDATOR:-220}"
MEM_RELAYER="${MEM_RELAYER:-480}"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run with sudo"

[ -f "$SETTINGS" ] && { while IFS='=' read -r k v; do [ -n "$k" ] && [ -z "${!k:-}" ] && export "$k=$v"; done < "$SETTINGS"; }
save() { mkdir -p "$ETC"; touch "$SETTINGS"; chmod 600 "$SETTINGS"; grep -v "^$1=" "$SETTINGS" > "$SETTINGS.new" || true; echo "$1=$2" >> "$SETTINGS.new"; mv "$SETTINGS.new" "$SETTINGS"; }

# ---- key + address (pure Python: keccak-256 and secp256k1; the same code as setup-agents.sh, checked against ethers) ----
keytool() {
python3 -I - "$@" <<'PY'
import os, sys
RC=[0x1,0x8082,0x800000000000808A,0x8000000080008000,0x808B,0x80000001,0x8000000080008081,0x8000000000008009,0x8A,0x88,0x80008009,0x8000000A,0x8000808B,0x800000000000008B,0x8000000000008089,0x8000000000008003,0x8000000000008002,0x8000000000000080,0x800A,0x800000008000000A,0x8000000080008081,0x8000000000008080,0x80000001,0x8000000080008008]
ROT=[[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]]
M=(1<<64)-1
def rol(x,n): return ((x<<n)|(x>>(64-n)))&M if n else x
def f(A):
    for rc in RC:
        C=[A[x][0]^A[x][1]^A[x][2]^A[x][3]^A[x][4] for x in range(5)]
        D=[C[(x-1)%5]^rol(C[(x+1)%5],1) for x in range(5)]
        A=[[A[x][y]^D[x] for y in range(5)] for x in range(5)]
        B=[[0]*5 for _ in range(5)]
        for x in range(5):
            for y in range(5): B[y][(2*x+3*y)%5]=rol(A[x][y],ROT[x][y])
        A=[[B[x][y]^((~B[(x+1)%5][y])&B[(x+2)%5][y]) for y in range(5)] for x in range(5)]
        A[0][0]^=rc
    return A
def keccak(data):
    r=136; p=bytearray(data)+b'\x01'
    while len(p)%r: p+=b'\x00'
    p[-1]|=0x80
    A=[[0]*5 for _ in range(5)]
    for i in range(0,len(p),r):
        for j in range(r//8): A[j%5][j//5]^=int.from_bytes(p[i+8*j:i+8*j+8],'little')
        A=f(A)
    return b''.join(A[j%5][j//5].to_bytes(8,'little') for j in range(4))
P=2**256-2**32-977; N=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G=(0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
def add(a,b):
    if a is None: return b
    if b is None: return a
    if a[0]==b[0] and (a[1]+b[1])%P==0: return None
    l=(3*a[0]*a[0]*pow(2*a[1],-1,P) if a==b else (b[1]-a[1])*pow(b[0]-a[0],-1,P))%P
    x=(l*l-a[0]-b[0])%P; return (x,(l*(a[0]-x)-a[1])%P)
def mul(k,pt=G):
    r=None
    while k:
        if k&1: r=add(r,pt)
        pt=add(pt,pt); k>>=1
    return r
def address(key):
    k=int.from_bytes(key,'big'); assert 0<k<N
    x,y=mul(k); h=keccak(x.to_bytes(32,'big')+y.to_bytes(32,'big'))[-20:].hex()
    c=keccak(h.encode()).hex()  # EIP-55 checksum
    return '0x'+''.join(ch.upper() if int(c[i],16)>=8 else ch for i,ch in enumerate(h))
cmd, path = sys.argv[1], sys.argv[2]
if cmd == 'new' and not os.path.exists(path):
    while True:
        key=os.urandom(32)
        if 0<int.from_bytes(key,'big')<N: break
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    os.write(fd,('0x'+key.hex()).encode()); os.close(fd)
print(address(bytes.fromhex(open(path).read().strip()[2:])))
PY
}
addr_of() { keytool addr "$ETC/$1.key"; }
rpc() { curl -fsS --max-time 20 -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":$3}" "$1" | jq -r '.result // empty'; }
cfg() { jq -r "$1" "$ETC/agent-config.json"; }
eth() { local w; w=$(rpc "$1" eth_getBalance "[\"$2\",\"latest\"]" 2>/dev/null) || { echo '?'; return; }
  [ -n "$w" ] && python3 -c "print(f'{int(\"$w\",16)/1e18:.6f}')" || echo '?'; }
validators() { echo zetaphy; [ "${VALIDATE_BASE:-no}" = yes ] && echo base; true; }

install_all() {
  say "packages (Docker, jq, curl, python3)"
  command -v apt-get >/dev/null || die "this script needs Ubuntu (apt-get)"
  need=(); for p in docker.io jq curl python3 ca-certificates; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
  if command -v docker >/dev/null; then need=("${need[@]/docker.io}"); fi
  if [ -n "${need[*]// /}" ]; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${need[*]}; fi
  systemctl enable --now docker >/dev/null 2>&1 || true

  mem=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$mem" -lt 2000 ] && ! swapon --show | grep -q .; then
    say "swap (2 GB: this machine has ${mem} MB of RAM)"
    [ -f /swapfile ] || { fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
    swapon /swapfile; grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  say "agent image (pinned by digest)"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull -q "$IMAGE"

  say "folders"
  install -d -m 700 "$ETC"; install -d -m 755 "$DATA" "$DATA/checkpoints"
  for d in validator-zetaphy validator-base relayer checkpoints/zetaphy checkpoints/base; do install -d -m 750 -o "$AGENT_UID" -g "$AGENT_UID" "$DATA/$d"; done
  chown "$AGENT_UID:$AGENT_UID" "$DATA/checkpoints"

  say "keys (made here, never printed)"
  [ -n "${VALIDATE_BASE:-}" ] && save VALIDATE_BASE "$VALIDATE_BASE"
  for v in $(validators); do keytool new "$ETC/validator-$v.key" >/dev/null; done
  keytool new "$ETC/relayer.key" >/dev/null
  chmod 600 "$ETC"/*.key
  show_addresses
  cat <<EOF

Next (docs/SAPHAN-MAINNET.md "Agents"):
  1. put the validator address(es) in zetaphy-chain/hyperlane/mainnet/saphan-mainnet.json (validators.*), pull request
  2. after the deploy: node scripts/saphan-mainnet.js agent-config --out agent-config.json   (copy it here)
       sudo AGENT_CONFIG=agent-config.json bash setup-agents-mainnet.sh config
  3. send 0.1 ZTPHY to the ZETAPHY validator$( [ "${VALIDATE_BASE:-no}" = yes ] && echo ', 0.0002 ETH on Base to the Base validator'), then start-validators
  4. ETH on Base to the relayer (the plan's float), then start-relayer
EOF
}

env_file() { local f="$ETC/$1.env"; shift; umask 077; printf '%s\n' "$@" > "$f.new"; mv "$f.new" "$f"; chmod 600 "$f"; }

unit() { # unit <name> <metrics port> <extra mounts> <memory MB> <binary>
  cat > "/etc/systemd/system/hyperlane-mainnet-$1.service" <<EOF
[Unit]
Description=Hyperlane $1 (ZETAPHY Saphan mainnet)
After=docker.service network-online.target
Requires=docker.service

[Service]
ExecStartPre=-/usr/bin/docker rm -f hypm-$1
ExecStart=/usr/bin/docker run --rm --name hypm-$1 --user $AGENT_UID:$AGENT_UID --memory ${4}m --memory-swap $(( $4 * 2 ))m \\
  --cap-drop ALL --security-opt no-new-privileges --env-file $ETC/$1.env \\
  -v $ETC/agent-config.json:/config/agent-config.json:ro -v $DATA/$1:/data $3 \\
  -p 127.0.0.1:$2:$2 $IMAGE ./$5
ExecStop=/usr/bin/docker stop -t 30 hypm-$1
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

need_config() { [ -f "$ETC/agent-config.json" ] || die "no agent config yet: sudo AGENT_CONFIG=<file> bash setup-agents-mainnet.sh config"; }

write_validator() { # write_validator <origin> <metrics port>
  local o=$1 k up; k=$(tr -d '[:space:]' < "$ETC/validator-$o.key"); up=$(echo "$o" | tr a-z A-Z)
  # the chain signer sends the validator's one-time announce on its origin chain: the validator key itself
  env_file "validator-$o" CONFIG_FILES=/config/agent-config.json HYP_ORIGINCHAINNAME="$o" HYP_DB=/data \
    HYP_VALIDATOR_TYPE=hexKey "HYP_VALIDATOR_KEY=$k" "HYP_CHAINS_${up}_SIGNER_TYPE=hexKey" "HYP_CHAINS_${up}_SIGNER_KEY=$k" \
    HYP_CHECKPOINTSYNCER_TYPE=localStorage "HYP_CHECKPOINTSYNCER_PATH=/checkpoints/$o" \
    HYP_CHAINS_ZETAPHY_INDEX_CHUNK=499 "HYP_METRICSPORT=$2" HYP_LOG_FORMAT=pretty HYP_LOG_LEVEL=info
  unit "validator-$o" "$2" "-v $DATA/checkpoints/$o:/checkpoints/$o" "$MEM_VALIDATOR" validator
  unset k
}

write_relayer() {
  local rk; rk=$(tr -d '[:space:]' < "$ETC/relayer.key")
  [ -f "${RELAYER_ENV:-}" ] || die "RELAYER_ENV=<file>: the output of node scripts/saphan-mainnet.js relayer-env"
  # only the settings the tool writes: chains, whitelist, start blocks, no gas payment; never a key from that file
  grep -Eq '^HYP_WHITELIST=\[' "$RELAYER_ENV" || die "$RELAYER_ENV has no HYP_WHITELIST"
  if grep -Eiq 'KEY|SIGNER' "$RELAYER_ENV"; then die "$RELAYER_ENV names a key or signer: refused"; fi
  mapfile -t lines < <(grep -E '^HYP_(RELAYCHAINS|WHITELIST|CHAINS_[A-Z]+_INDEX_(FROM|CHUNK)|GASPAYMENTENFORCEMENT)=' "$RELAYER_ENV")
  env_file relayer CONFIG_FILES=/config/agent-config.json HYP_DB=/data HYP_DEFAULTSIGNER_TYPE=hexKey "HYP_DEFAULTSIGNER_KEY=$rk" \
    HYP_ALLOWLOCALCHECKPOINTSYNCERS=true "${lines[@]}" HYP_METRICSPORT=9101 HYP_LOG_FORMAT=pretty HYP_LOG_LEVEL=info
  unit relayer 9101 "-v $DATA/checkpoints:/checkpoints:ro" "$MEM_RELAYER" relayer
  unset rk
}

started() { systemctl is-active --quiet "hyperlane-mainnet-$1" && [ "$(docker inspect -f '{{.State.Running}}' "hypm-$1" 2>/dev/null)" = true ]; }
start() { systemctl enable "hyperlane-mainnet-$1" >/dev/null 2>&1; systemctl restart "hyperlane-mainnet-$1"
  for _ in $(seq 1 15); do sleep 2; started "$1" && { echo "$1 started"; return; }; done
  journalctl -u "hyperlane-mainnet-$1" -n 30 --no-pager; die "$1 did not start"; }

show_addresses() {
  say "addresses (fund these; the keys stay in $ETC)"
  for v in $(validators); do echo "validator-$v  $(addr_of "validator-$v")   $( [ "$v" = zetaphy ] && echo 'ZETAPHY: 0.1 ZTPHY once (announce)' || echo 'Base: 0.0002 ETH once (announce)')"; done
  echo "relayer            $(addr_of relayer)   Base: ETH for ZETAPHY -> Base deliveries; ZETAPHY: 1 ZTPHY for Base -> ZETAPHY"
}

status() {
  for a in $(validators | sed 's/^/validator-/') relayer; do printf '%-18s %s\n' "$a" "$(systemctl is-active "hyperlane-mainnet-$a" 2>/dev/null || true)"; done
  [ -f "$ETC/relayer.key" ] || { echo "not installed: sudo bash setup-agents-mainnet.sh install"; return; }
  [ -f "$ETC/agent-config.json" ] || { echo "no agent config yet"; show_addresses; return; }
  local zr br; zr=$(cfg '.chains.zetaphy.rpcUrls[0].http'); br=$(cfg '.chains.base.rpcUrls[0].http')
  for v in $(validators); do
    local cp; cp=$(ls "$DATA/checkpoints/$v" 2>/dev/null | grep -E '^[0-9]+_with_id\.json$' | sort -n | tail -1 || true)
    echo "checkpoint $v  ${cp:-none yet}"
  done
  local va me; va=$(cfg .chains.zetaphy.validatorAnnounce); me=$(addr_of validator-zetaphy | tr 'A-F' 'a-f')
  # getAnnouncedValidators()
  if rpc "$zr" eth_call "[{\"to\":\"$va\",\"data\":\"0x690cb786\"},\"latest\"]" 2>/dev/null | grep -q "${me#0x}"; then
    echo "announced zetaphy  yes"; else echo "announced zetaphy  not yet (needs 0.1 ZTPHY on the validator address)"; fi
  echo "validator-zetaphy  ZETAPHY $(eth "$zr" "$(addr_of validator-zetaphy)") ZTPHY"
  [ "${VALIDATE_BASE:-no}" = yes ] && echo "validator-base     Base $(eth "$br" "$(addr_of validator-base)") ETH"
  echo "relayer            Base $(eth "$br" "$(addr_of relayer)") ETH   ZETAPHY $(eth "$zr" "$(addr_of relayer)") ZTPHY"
  free -m | awk 'NR==2 {print "memory used " $3 " MB of " $2 " MB"} NR==3 {print "swap used   " $3 " MB of " $2 " MB"}'
}

publish() {
  [ -n "${DOMAIN:-}" ] || die "DOMAIN=<host name pointing at this machine> (e.g. checkpoints.example.org)"
  command -v caddy >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy; }
  cat > /etc/caddy/Caddyfile <<EOF
# ZETAPHY Saphan mainnet: our validators' signed checkpoints, read only (public data: signatures over Merkle roots)
$DOMAIN {
	root * $DATA/checkpoints
	file_server browse
	header Cache-Control "public, max-age=10"
	@write not method GET HEAD
	respond @write 405
}
EOF
  chmod o+rx "$DATA" "$DATA/checkpoints" "$DATA"/checkpoints/*
  systemctl enable --now caddy >/dev/null 2>&1; systemctl reload caddy
  echo "published: https://$DOMAIN/ (open ports 80 and 443 in the Oracle security list)"
}

case "${1:-}" in
  install) install_all ;;
  config)
    [ -f "${AGENT_CONFIG:-}" ] || die "AGENT_CONFIG=<file from saphan-mainnet.js agent-config>"
    if [ -n "${CONFIG_SHA256:-}" ]; then echo "$CONFIG_SHA256  $AGENT_CONFIG" | sha256sum -c --quiet - || die "agent config hash mismatch: refused"; fi
    jq -e '.chains.zetaphy.domainId == 3659 and .chains.base.domainId == 8453 and (.chains.zetaphy.mailbox | test("^0x[0-9a-fA-F]{40}$"))' "$AGENT_CONFIG" >/dev/null \
      || die "not a ZETAPHY mainnet (3659) + Base (8453) agent config"
    if grep -Eiq '"(key|privateKey)"' "$AGENT_CONFIG"; then die "the agent config names a key: refused"; fi
    install -m 644 "$AGENT_CONFIG" "$ETC/agent-config.json"; echo "agent config installed (sha256 $(sha256sum "$ETC/agent-config.json" | cut -c1-16)…)" ;;
  start-validators)
    need_config; port=9100
    for v in $(validators); do write_validator "$v" "$port"; start "validator-$v"; port=$((port + 2)); done ;;
  start-relayer) need_config; [ -f "${RELAYER_ENV:-}" ] || die "RELAYER_ENV=<file>: the output of node scripts/saphan-mainnet.js relayer-env"
    save RELAYER_ENV "$(readlink -f "$RELAYER_ENV")"; write_relayer; start relayer ;;
  publish-checkpoints) publish ;;
  status) status ;;
  addresses) show_addresses ;;
  logs) journalctl -u "hyperlane-mainnet-${2:-validator-zetaphy}" -n 80 --no-pager ;;
  stop) for a in validator-zetaphy validator-base relayer; do systemctl stop "hyperlane-mainnet-$a" 2>/dev/null || true; done; echo stopped ;;
  *) sed -n '2,24p' "$0"; exit 1 ;;
esac
