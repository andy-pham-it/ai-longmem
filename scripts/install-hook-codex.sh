#!/usr/bin/env bash
# Install longmem SessionStart hook into Codex (~/.codex/hooks.json).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_SCRIPT="$REPO_ROOT/scripts/hooks/inject-index.ts"

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

HOOKS_FILE="${HOME}/.codex/hooks.json"
mkdir -p "$(dirname "$HOOKS_FILE")"
if [ ! -f "$HOOKS_FILE" ]; then echo '{"hooks":{}}' > "$HOOKS_FILE"; fi

if [ ! -f "${HOOKS_FILE}.bak-longmem" ]; then
  cp "$HOOKS_FILE" "${HOOKS_FILE}.bak-longmem"
fi

if grep -q "inject-index.ts" "$HOOKS_FILE" 2>/dev/null; then
  echo "longmem hook already installed in $HOOKS_FILE"
  exit 0
fi

"$NODE_BIN/node" - "$HOOKS_FILE" "$NPX" "$HOOK_SCRIPT" <<'NODE'
const fs = require("node:fs");
const hooksPath = process.argv[1];
const npx = process.argv[2];
const hookScript = process.argv[3];
const data = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
data.hooks = data.hooks || {};
data.hooks.SessionStart = data.hooks.SessionStart || [];
data.hooks.SessionStart.push({
  matcher: "startup|resume",
  hooks: [{ type: "command", command: `${npx} tsx ${hookScript}`, timeout: 5, additionalContextLimit: 0 }],
});
fs.writeFileSync(hooksPath, JSON.stringify(data, null, 2) + "\n");
console.log("installed longmem hook into", hooksPath);
NODE