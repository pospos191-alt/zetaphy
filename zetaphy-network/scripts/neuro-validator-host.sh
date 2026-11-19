#!/bin/bash
# The Neuro validator on its own machine (docs/SAPHAN-NEURO-VALIDATOR.md): a Google Cloud e2-micro VM (free tier),
# NOT the sentry, with a key made on the VM itself and its signed checkpoints in a public-read Cloud Storage bucket.
# It runs scripts/neuro-validator.js in Docker (node:20-bookworm-slim) as a systemd service, restarted on failure.
#
#   sudo bash neuro-validator-host.sh install gs://BUCKET/neuro   [เปลี่ยนการตั้งค่า] Docker + git, checkout, key (once), service
#   sudo bash neuro-validator-host.sh address                     [อ่าน] the validator address (fund it with 0.1 ZTPHY, then announce)
#   sudo bash neuro-validator-host.sh announce [--send yes]       [เปลี่ยนเชน] ValidatorAnnounce on ZETAPHY (where its signatures are)
#   sudo bash neuro-validator-host.sh status                      [อ่าน] the service and its last lines
#   sudo bash neuro-validator-host.sh update                      [เปลี่ยนการตั้งค่า] pull main, restart
#   sudo bash neuro-validator-host.sh uninstall                   [เปลี่ยนการตั้งค่า] stop and remove (the key stays in /etc/neuro-validator unless --wipe)
set -euo pipefail

BASE=/opt/neuro-validator
REPO_DIR=$BASE/repo
ETC=/etc/neuro-validator
STATE=/var/lib/neuro-validator
REPO_URL=${NEURO_REPO:-https://github.com/pospos191-alt/zetaphy.git}
IMAGE=${NEURO_IMAGE:-node:20-bookworm-slim}
UNIT=neuro-validator

root() { [ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }; }
location() { cat "$ETC/location" 2>/dev/null || { echo "STOP: no location yet (install gs://BUCKET/neuro first)"; exit 1; }; }
dk() { docker run --rm --network host -v "$REPO_DIR:/w:ro" -v "$ETC:/etc/neuro-validator" -v "$STATE:/state" "$IMAGE" node /w/zetaphy-network/scripts/neuro-validator.js "$@" --key /etc/neuro-validator/key; }

checkout() {
  if [ ! -d "$REPO_DIR/.git" ]; then
    install -d -m 755 "$BASE"
    git clone -q --depth 1 --filter=blob:none --sparse "$REPO_URL" "$REPO_DIR"
    git -C "$REPO_DIR" sparse-checkout set zetaphy-network zetaphy-chain/hyperlane
  else
    git -C "$REPO_DIR" fetch -q --depth 1 origin main && git -C "$REPO_DIR" reset -q --hard FETCH_HEAD
  fi
  docker run --rm --memory 600m -v "$REPO_DIR:/w" -w /w/zetaphy-network "$IMAGE" npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null
}

case "${1:-}" in
  install)
    root
    loc=${2:-}
    [[ "$loc" =~ ^gs://[a-z0-9][a-z0-9._-]{1,61}[a-z0-9](/[A-Za-z0-9._/-]+)?$ ]] || { echo "usage: install gs://BUCKET/neuro"; exit 2; }
    command -v docker >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io >/dev/null; }
    command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null; }
    install -d -m 700 "$ETC"; install -d -m 755 "$STATE"
    echo "$loc" > "$ETC/location"
    checkout
    if [ -f "$ETC/key" ]; then echo "keeping the existing key ($ETC/key)"; else
      docker run --rm -v "$REPO_DIR:/w:ro" -v "$ETC:/etc/neuro-validator" "$IMAGE" node /w/zetaphy-network/scripts/neuro-validator.js keygen --key /etc/neuro-validator/key
      chmod 600 "$ETC/key"
    fi
    cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=ZETAPHY Neuro validator (second signer of Saphan ZETAPHY -> BSC/Base messages)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
ExecStartPre=-/usr/bin/docker rm -f $UNIT
ExecStart=/usr/bin/docker run --rm --name $UNIT --network host --memory 400m -v $REPO_DIR:/w:ro -v $ETC:/etc/neuro-validator:ro -v $STATE:/state $IMAGE node /w/zetaphy-network/scripts/neuro-validator.js run --key /etc/neuro-validator/key --location $loc --state /state/state.json
ExecStop=/usr/bin/docker stop $UNIT
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$UNIT" >/dev/null
    echo "installed. The validator address (fund it with 0.1 ZTPHY on ZETAPHY, then: announce --send yes):"
    dk address
    ;;
  address) root; dk address ;;
  announce) root; shift; dk announce --location "$(location)" "$@" ;;
  status)
    systemctl status "$UNIT" --no-pager -n 0 2>/dev/null | sed -n '1,4p' || true
    journalctl -u "$UNIT" -n 12 --no-pager 2>/dev/null | grep -E 'signed|NOT signed|pass|failed|Neuro validator' || echo "(nothing logged yet)"
    ;;
  update) root; checkout; systemctl restart "$UNIT"; echo "updated and restarted" ;;
  uninstall)
    root
    systemctl disable --now "$UNIT" 2>/dev/null || true
    rm -f "/etc/systemd/system/$UNIT.service"; systemctl daemon-reload
    rm -rf "$BASE" "$STATE"
    if [ "${2:-}" = "--wipe" ]; then shred -u "$ETC/key" 2>/dev/null || true; rm -rf "$ETC"; echo "removed, key wiped"; else echo "removed (the key is kept in $ETC; add --wipe to destroy it)"; fi
    ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
