# longmem adapter — Claude Code

**Where it goes:** append to `~/.claude/CLAUDE.md` (global) or `./CLAUDE.md` (project).

## longmem
The longmem index is already in your system prompt. Do not re-fetch it.
Before non-trivial work run: `npx tsx ~/personal/longmem/src/cli.ts lessons "<what you are about to do>"`
Capture a lesson when ANY of these happens:
- Andy corrects you or rejects an approach.
- A command fails and you find the non-obvious reason.
- You discover a constraint, cost, or ordering that was not documented.
- The same mistake or confusion could recur in another session.
Before finishing a non-trivial task, run `longmem candidates` and propose one entry if a trigger matches the work just done.
Rules (non-negotiable):
- Propose the entry; write it only after Andy confirms.
- `trigger` is required and must name a recognisable situation.
- Body must state what happened, what it cost, and what to do instead.
- Never a platitude ("be careful", "verify before claiming"). Never a chat summary.
- A wrong entry is fixed by superseding it, never by deleting it.

## Wiring

- Layer A (auto-inject): run `scripts/install-hook-claude.sh` to add a `SessionStart` hook that injects the index + rules into every session deterministically.
- Layer B (fallback): this file alone works if the hook is not installed; Claude reads CLAUDE.md at session start.
- Layer C (MCP): add to `~/.claude/settings.json` under `mcpServers`:
  ```json
  { "longmem": { "command": "npx", "args": ["tsx", "/abs/path/to/longmem/src/mcp.ts"] } }
  ```
  then call `longmem_lessons` / `longmem_recall` / `longmem_write` as tools.

## Notes

- CLAUDE.md is delivered as a user message after the system prompt; for rules that must hold every time, prefer the hook (Layer A).
- Auto memory (`~/.claude/projects/<proj>/memory/MEMORY.md`) stays separate; longmem is the cross-project experiential store.
