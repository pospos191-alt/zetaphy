#!/bin/bash
# Key watch on our own machine, every 5 minutes (docs/KEY-WATCH.md "On the sentry"): GitHub runs the scheduled
# workflow only every few hours, too slow for the bridge's 1-hour mint delay. Same script, same config
# (key-watch-mainnet.json), same issue; the alert markers keep the two runners from posting anything twice.
# Read only on the chains: no key, no transaction. It needs Docker and git (both on the sentry) and a GitHub token
# that can ONLY write issues of pospos191-alt/zetaphy (fine-grained, "Issues: Read and write", nothing else).
#
#   sudo bash key-watch-host.sh install     [เปลี่ยนการตั้งค่า] asks for the token (typed, not shown), installs the timer
#   sudo bash key-watch-host.sh run         [อ่าน] one run now, in the foreground
#   sudo bash key-watch-host.sh status      [อ่าน] the timer, the last run, its last lines
#   sudo bash key-watch-host.sh token       [เปลี่ยนการตั้งค่า] replace the token
#   sudo bash key-watch-host.sh uninstall   [เปลี่ยนการตั้งค่า] remove the timer, the checkout, the state and the token
set -euo pipefail

BASE=/opt/zetaphy-watch
REPO_DIR=$BASE/repo
ETC=/etc/zetaphy-watch
STATE=/var/lib/zetaphy-watch
REPO_URL=${KEY_WATCH_REPO:-https://github.com/pospos191-alt/zetaphy.git}
REPO_NAME=${KEY_WATCH_REPO_NAME:-pospos191-alt/zetaphy}
IMAGE=${KEY_WATCH_IMAGE:-node:20-bookworm-slim}
UNIT=zetaphy-watch
EVERY=${KEY_WATCH_EVERY:-5min}

need() { command -v "$1" >/dev/null || { echo "STOP: $1 is not installed on this machine"; exit 1; }; }
root() { [ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }; }

ask_token() {
  local t
  read -rs -p "GitHub token (github_pat_…, Issues: Read and write on $REPO_NAME only; not shown): " t < /dev/tty; echo
  [[ "$t" =~ ^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$ ]] || { echo "STOP: that does not look like a GitHub token; nothing saved"; exit 1; }
  # the token may open issues: check it can read this repository's issues, and nothing is written
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $t" -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO_NAME/issues?per_page=1")
  [ "$code" = 200 ] || { echo "STOP: GitHub answered HTTP $code with this token (wrong token, or no Issues permission on $REPO_NAME); nothing saved"; exit 1; }
  install -d -m 700 "$ETC"
  umask 077
  printf 'GITHUB_TOKEN=%s\nGITHUB_REPOSITORY=%s\n' "$t" "$REPO_NAME" > "$ETC/env"
  chmod 600 "$ETC/env"
  echo "token saved in $ETC/env (root only)"
}

checkout() {
  if [ ! -d "$REPO_DIR/.git" ]; then
    install -d -m 755 "$BASE"
    git clone -q --depth 1 --filter=blob:none --sparse "$REPO_URL" "$REPO_DIR"
    git -C "$REPO_DIR" sparse-checkout set zetaphy-network zetaphy-chain/hyperlane zetaphy-dex/artifacts zetaphy-nft/artifacts
  else
    git -C "$REPO_DIR" fetch -q --depth 1 origin main && git -C "$REPO_DIR" reset -q --hard FETCH_HEAD
  fi
  # runtime dependencies, again only when the lockfile changed
  local h
  h=$(sha256sum "$REPO_DIR/zetaphy-network/package-lock.json" | cut -c1-64)
  if [ "$(cat "$STATE/lock.sha256" 2>/dev/null)" != "$h" ] || [ ! -d "$REPO_DIR/zetaphy-network/node_modules" ]; then
    docker run --rm --memory 768m -v "$REPO_DIR:/w" -w /w/zetaphy-network "$IMAGE" npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null
    echo "$h" > "$STATE/lock.sha256"
  fi
}

run_once() {
  install -d -m 755 "$STATE"
  checkout
  docker run --rm --memory 384m --network host --env-file "$ETC/env" -v "$REPO_DIR:/w:ro" -v "$STATE:/state" "$IMAGE" \
    node /w/zetaphy-network/scripts/key-watch.js --config /w/zetaphy-network/key-watch-mainnet.json --state /state/state.json
}

case "${1:-}" in
  install)
    root; need docker; need git; need curl
    [ -f "$ETC/env" ] && echo "a token is already saved ($ETC/env); keeping it (replace it with: token)" || ask_token
    install -d -m 755 "$BASE" "$STATE"
    install -m 755 "$0" "$BASE/key-watch-host.sh"
    cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=ZETAPHY key watch (mainnet: ZETAPHY, BSC, Base; Saphan checks), read only
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $BASE/key-watch-host.sh run
TimeoutStartSec=15min
Nice=10
EOF
    cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=ZETAPHY key watch every $EVERY

[Timer]
OnBootSec=2min
OnUnitInactiveSec=$EVERY
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    echo "first run (takes the baseline; a minute or two)…"
    run_once
    systemctl enable --now "$UNIT.timer" >/dev/null
    echo "installed: $UNIT.timer runs every $EVERY. Check with: sudo bash $BASE/key-watch-host.sh status"
    ;;
  run) root; need docker; need git; run_once ;;
  status)
    systemctl list-timers "$UNIT.timer" --no-pager 2>/dev/null | head -3
    systemctl status "$UNIT.service" --no-pager -n 0 2>/dev/null | sed -n '1,4p' || true
    journalctl -u "$UNIT.service" -n 8 --no-pager 2>/dev/null | grep -E 'reachable|unreachable|alerts|saphan|error' || echo "(no run logged yet)"
    ;;
  token) root; need curl; ask_token ;;
  uninstall)
    root
    systemctl disable --now "$UNIT.timer" 2>/dev/null || true
    rm -f "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer"
    systemctl daemon-reload
    rm -rf "$BASE" "$STATE" "$ETC"
    echo "removed (the token in GitHub still exists: delete it at github.com/settings/personal-access-tokens)"
    ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
