#!/usr/bin/env bash
# Local OpenCode v2 server for testing Otto without a cloud sandbox.
# Usage: bun run oc:local   (then add "Your own server" in the app)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4917}"
BIN="$ROOT/.dev/opencode"
OC_VERSION=2.1.0
if [ ! -x "$BIN" ] || ! "$BIN" --version 2>/dev/null | grep -q "v$OC_VERSION"; then
  mkdir -p "$ROOT/.dev"
  arch=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64)
  curl -fsSL -o "$ROOT/.dev/oc.zip" "https://opencode.ai/files/bin/$OC_VERSION/opencode-darwin-$arch.zip"
  unzip -oq "$ROOT/.dev/oc.zip" -d "$ROOT/.dev" && rm "$ROOT/.dev/oc.zip"
fi
PW_FILE="$ROOT/.dev/password"
[ -s "$PW_FILE" ] || openssl rand -hex 12 > "$PW_FILE"
mkdir -p "$ROOT/playground"
# Isolated OpenCode config/data so settings edited from Otto never touch
# your real ~/.config/opencode. Set OTTO_REAL_CONFIG=1 to use your own.
if [ "${OTTO_REAL_CONFIG:-0}" != "1" ]; then
  export XDG_CONFIG_HOME="$ROOT/.dev/home/.config" XDG_DATA_HOME="$ROOT/.dev/home/.local/share" XDG_STATE_HOME="$ROOT/.dev/home/.local/state" XDG_CACHE_HOME="$ROOT/.dev/home/.cache"
  mkdir -p "$XDG_CONFIG_HOME/opencode"
  # Scheduled tasks write to a fake crontab (.dev/crontab.txt), not yours.
  cat > "$ROOT/.dev/fake-crontab" <<'SH'
#!/usr/bin/env bash
F="$(dirname "$0")/crontab.txt"
case "${1:-}" in -l) [ -f "$F" ] && cat "$F" || exit 1 ;; -) cat > "$F" ;; *) cat > "$F" ;; esac
SH
  chmod +x "$ROOT/.dev/fake-crontab"
  export OTTO_CRONTAB="$ROOT/.dev/fake-crontab" OTTO_HOME="$ROOT/.dev/home"
fi
echo "OpenCode $("$BIN" --version) → http://127.0.0.1:$PORT  (password in .dev/password, workspace: playground/)"
cd "$ROOT/playground"
exec env OPENCODE_SERVER_PASSWORD="$(cat "$PW_FILE")" "$BIN" serve --hostname 127.0.0.1 --port "$PORT"
