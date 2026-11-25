#!/usr/bin/env bash
# Install longmem SessionStart hook into Claude Code (~/.claude/settings.json).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_SCRIPT="$REPO_ROOT/scripts/hooks/inject-index.ts"

# Find a working node/npx (prefer nvm, then PATH)
NODE_BIN=""
for cand in /Users/admin/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin /usr/bin; do
  if [ -x "$cand/node" ] && [ -x "$cand/npx" ]; then
    NODE_BIN="$cand"; break
  fi
done
if [ -z "$NODE_BIN" ]; then
  echo "No node/npx found. Install Node 22+ first." >&2
  exit 1
fi
NPX="$NODE_BIN/npx"

SETTINGS="${HOME}/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
if [ ! -f "$SETTINGS" ]; then echo '{}' > "$SETTINGS"; fi

# Backup on first run
if [ ! -f "${SETTINGS}.bak-longmem" ]; then
  cp "$SETTINGS" "${SETTINGS}.bak-longmem"
fi

# Idempotency: skip if already installed
if grep -q "inject-index.ts" "$SETTINGS" 2>/dev/null; then
  echo "longmem hook already installed in $SETTINGS"
  exit 0
fi

# Merge using node
"$NODE_BIN/node" - "$SETTINGS" "$NPX" "$HOOK_SCRIPT" <<'NODE'
const fs = require("node:fs");
const settingsPath = process.argv[1];
const npx = process.argv[2];
const hookScript = process.argv[3];
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
settings.hooks = settings.hooks || {};
settings.hooks.SessionStart = settings.hooks.SessionStart || [];
settings.hooks.SessionStart.push({
  matcher: "startup|resume|clear|compact",
  hooks: [{ type: "command", command: `${npx} tsx ${hookScript}`, timeout: 5 }],
});
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log("installed longmem hook into", settingsPath);
NODE