#!/usr/bin/env bash
# Installs the longmem plugin into the directory OpenCode scans automatically.
# No opencode.json change is needed.
set -euo pipefail

target_dir="${HOME}/.config/opencode/plugins"
mkdir -p "$target_dir"
cp "$(dirname "$0")/../plugin/longmem.ts" "$target_dir/longmem.ts"
echo "installed -> ${target_dir}/longmem.ts"
