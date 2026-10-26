#!/usr/bin/env bash
# End-to-end checks of background work in the real UI: a throwaway OpenCode
# server (its own HOME, config and data under .dev/e2e) on a scripted model,
# the app from `vite`, and Playwright driving both.
#
#   scripts/e2e/run.sh                 every scenario
#   scripts/e2e/run.sh s2 s9           only those (by name prefix)
#
# Needs: bun, node with Playwright, and an OpenCode v2 binary: $OPENCODE_BIN,
# else .dev/oc/package/bin/opencode, else `opencode` on PATH.
# KEEP=1 leaves everything running afterwards (the UI stays at :1420).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
E2E=$ROOT/.dev/e2e
OC_PORT=${OC_PORT:-4917}
LLM_PORT=${FAKE_LLM_PORT:-4918}
APP_PORT=1420
BIN=${OPENCODE_BIN:-}
[ -z "$BIN" ] && [ -x "$ROOT/.dev/oc/package/bin/opencode" ] && BIN=$ROOT/.dev/oc/package/bin/opencode
BIN=${BIN:-opencode}

# A clean slate every run: no sessions or shells left from the last one.
rm -rf "$E2E/home" "$E2E/work" "$E2E/shots"
mkdir -p "$E2E/home/.config/opencode" "$E2E/work"
cat > "$E2E/home/.config/opencode/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "fake/m",
  "provider": { "fake": { "npm": "@ai-sdk/openai-compatible", "name": "Fake", "options": { "baseURL": "http://127.0.0.1:$LLM_PORT/v1", "apiKey": "x" }, "models": { "m": { "name": "Fake model" } } } },
  "permission": "allow",
  "experimental": { "subagent_depth": 2 }
}
EOF
git -C "$E2E/work" init -q 2>/dev/null || true

PIDS=()
cleanup() { [ "${KEEP:-}" = 1 ] || for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() { for _ in $(seq 1 100); do curl -s -o /dev/null "$@" && return 0; sleep 0.3; done; echo "never came up: $*" >&2; exit 1; }

FAKE_LLM_PORT=$LLM_PORT bun scripts/e2e/fake-llm.ts > "$E2E/fake-llm.log" 2>&1 &
PIDS+=($!)
(
  cd "$E2E/work"
  XDG_CONFIG_HOME=$E2E/home/.config XDG_DATA_HOME=$E2E/home/.local/share XDG_STATE_HOME=$E2E/home/.local/state XDG_CACHE_HOME=$E2E/home/.cache HOME=$E2E/home \
    OPENCODE_SERVER_PASSWORD=pw exec "$BIN" serve --hostname 127.0.0.1 --port "$OC_PORT" --cors "http://localhost:$APP_PORT"
) > "$E2E/server.log" 2>&1 &
PIDS+=($!)
if ! curl -s -o /dev/null "http://localhost:$APP_PORT"; then
  bun run dev > "$E2E/vite.log" 2>&1 &
  PIDS+=($!)
fi
wait_for "http://127.0.0.1:$LLM_PORT/v1/models"
wait_for -u opencode:pw "http://127.0.0.1:$OC_PORT/api/info"
wait_for "http://localhost:$APP_PORT"

OC_URL=http://127.0.0.1:$OC_PORT APP_URL=http://localhost:$APP_PORT SHOTS=$E2E/shots node scripts/e2e/background.cjs "$@"
