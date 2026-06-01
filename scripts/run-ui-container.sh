#!/usr/bin/env bash
#
# Start + provision a linux/arm64 container that runs the full Harness Electron
# UI on a virtual display (Xvfb), exposed to the host over VNC.
#
# Unlike run-headless-container.sh (which runs the standalone harness-server +
# web client), this builds and launches the desktop app itself under Xvfb +
# fluxbox + x11vnc, so you can drive the real GUI from a VNC viewer on the host.
#
# Usage: ./scripts/run-ui-container.sh
#
# Connect from the host once it's up (macOS ships a VNC client):
#   open vnc://localhost:5901        # then enter the VNC password
#
# Env overrides:
#   HARNESS_CLONE_URL       repo to build (default: upstream frenchie4111/harness)
#   HARNESS_VNC_PORT        host port to map to the container's :5900 (default 5901)
#   HARNESS_VNC_PASSWORD    VNC password (default: harness)
#   HARNESS_UI_GEOMETRY     Xvfb screen geometry (default: 1600x1000)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

err() { printf 'error: %s\n' "$*" >&2; exit 1; }
log() { printf '\n=== %s ===\n' "$*"; }

command -v docker >/dev/null 2>&1 || err "docker is required but not installed"

# linux/arm64 only — VM-native on Apple Silicon, so the Electron build is quick.
PLATFORM="linux/arm64"
IMAGE="ubuntu:24.04"
NAME="harness_ui"

VNC_HOST_PORT="${HARNESS_VNC_PORT:-5901}"     # host side; x11vnc listens on 5900 inside
NOVNC_HOST_PORT="${HARNESS_NOVNC_PORT:-6080}"  # browser noVNC endpoint (websockify -> 5900)
VNC_PW="${HARNESS_VNC_PASSWORD:-harness}"
GEOMETRY="${HARNESS_UI_GEOMETRY:-1600x1000}"
CLONE_URL="${HARNESS_CLONE_URL:-https://github.com/frenchie4111/harness.git}"
CLONE_DEST="$(basename "$CLONE_URL" .git)"

# --- guard against an existing container of the same name ---
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  err "container '$NAME' already exists — remove it first: docker rm -f $NAME"
fi

# --- start the container (detached, keepalive). --shm-size avoids Chromium's
#     /dev/shm exhaustion crashes. ---
log "starting container $NAME ($PLATFORM, VNC $VNC_HOST_PORT, noVNC $NOVNC_HOST_PORT)"
docker run -dit --name "$NAME" \
  --platform "$PLATFORM" \
  --shm-size=1g \
  -p "$VNC_HOST_PORT:5900" \
  -p "$NOVNC_HOST_PORT:6080" \
  "$IMAGE" sleep infinity >/dev/null

# --- prerequisites: virtual display + VNC + Electron's runtime libs + Node 22.
#     The *t64 package names are the Ubuntu 24.04 (time_t transition) variants. ---
log "installing prerequisites (Xvfb, x11vnc, Electron libs, Node 22)"
docker exec "$NAME" bash -lc '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    xvfb x11vnc fluxbox feh x11-utils autocutsel novnc websockify dbus dbus-x11 \
    zsh curl ca-certificates git python3 make g++ \
    libgtk-3-0t64 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0t64 \
    libdrm2 libgbm1 libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 \
    libcups2t64 libxkbcommon0 libpango-1.0-0 libcairo2 libxcomposite1 \
    libxdamage1 libxrandr2 libxfixes3
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs'

# --- claude + codex: the UI's terminal/chat tabs spawn `claude` from PATH ---
log "installing claude + codex"
docker exec "$NAME" bash -lc '
  set -e
  npm install -g @anthropic-ai/claude-code @openai/codex
  claude --version && codex --version'

# --- build the Harness UI from source (electron-vite build -> out/) ---
log "cloning $CLONE_URL and building the UI (npm install + electron-vite build)"
docker exec "$NAME" bash -lc "
  set -e
  git clone '$CLONE_URL' ~/$CLONE_DEST
  cd ~/$CLONE_DEST
  npm install --legacy-peer-deps
  npx electron-vite build"

# --- store the VNC password ---
log "configuring VNC (password auth)"
docker exec "$NAME" bash -lc "mkdir -p ~/.vnc && x11vnc -storepasswd '$VNC_PW' ~/.vnc/passwd"

# --- install the display+UI launcher ---
# Brings up Xvfb, a window manager, x11vnc, then the Electron app. The app runs
# as root with the sandbox disabled (same ELECTRON_DISABLE_SANDBOX the repo's
# dev script uses) and software GL, since there's no GPU under Xvfb.
docker exec -i "$NAME" bash -lc 'cat > /usr/local/bin/start-ui.sh && chmod +x /usr/local/bin/start-ui.sh' <<LAUNCH
#!/bin/bash
set -e
export DISPLAY=:99
export ELECTRON_DISABLE_SANDBOX=1
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 ${GEOMETRY}x24 -nolisten tcp >/var/log/xvfb.log 2>&1 &
for _ in \$(seq 1 30); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.5; done
# Paint the root window with fluxbox's own fbsetroot (bundled, no deps) so it
# doesn't fall back to fbsetbg — which warns when no image-setter is installed.
mkdir -p /root/.fluxbox
printf 'session.screen0.rootCommand: fbsetroot -solid #1e1e1e\n' > /root/.fluxbox/init
fluxbox >/var/log/fluxbox.log 2>&1 &
# Keep the X CLIPBOARD (what Electron uses) and PRIMARY selections in sync with
# the cut buffer x11vnc bridges to VNC, so copy+paste works to/from the host.
autocutsel -fork
autocutsel -selection PRIMARY -fork
x11vnc -display :99 -forever -shared -rfbport 5900 -rfbauth /root/.vnc/passwd \
  -bg -o /var/log/x11vnc.log
# noVNC: serve the browser VNC client and proxy its WebSocket to x11vnc:5900.
websockify --web=/usr/share/novnc 6080 localhost:5900 >/var/log/websockify.log 2>&1 &
cd /root/${CLONE_DEST}
dbus-run-session -- node_modules/.bin/electron . \
  --no-sandbox --disable-gpu --disable-dev-shm-usage \
  >/var/log/harness-ui.log 2>&1
LAUNCH

# --- launch the UI stack (detached; container PID 1 stays sleep infinity) ---
log "launching the Harness UI"
docker exec -d "$NAME" /usr/local/bin/start-ui.sh

cat <<EOF

=== container '$NAME' is up and the Harness UI is starting ===

Connect from the host (give Electron a few seconds to paint). Password: $VNC_PW

  Browser (noVNC):  http://localhost:$NOVNC_HOST_PORT/vnc.html
  VNC client:       localhost:$VNC_HOST_PORT   (e.g. open vnc://localhost:$VNC_HOST_PORT)

For copy+paste prefer the browser (noVNC's clipboard panel) or a real VNC
client like TigerVNC/RealVNC — macOS Screen Sharing greys out shared
clipboard for non-Apple VNC servers.

Logs (inside the container):

  docker exec $NAME tail -f /var/log/harness-ui.log   # Electron stdout/stderr
  docker exec $NAME cat /var/log/x11vnc.log           # VNC server
  docker exec $NAME cat /var/log/websockify.log       # noVNC proxy

Restart the UI (e.g. after a crash):

  docker exec -d $NAME /usr/local/bin/start-ui.sh

Shell in:

  docker exec -it $NAME bash

Tear down when finished:

  docker rm -f $NAME
EOF
