# longmem adapter — OpenAI Codex CLI

**Where it goes:** `~/.codex/AGENTS.md` (global) or `./AGENTS.md` (project, 3-level hierarchy).

## longmem
The longmem index is already in your system prompt. Do not re-fetch it.
At session start, run `npx tsx ~/personal/longmem/src/cli.ts resume` to check for unfinished work from the last session.
Before non-trivial work run: `npx tsx ~/personal/longmem/src/cli.ts lessons "<what you are about to do>"`
Capture a lesson when ANY of these happens:
- The user corrects you or rejects an approach.
- A command fails and you find the non-obvious reason.
- You discover a constraint, cost, or ordering that was not documented.
- The same mistake or confusion could recur in another session.
Before finishing a non-trivial task, run `longmem candidates` and propose one entry if a trigger matches the work just done.
Before ending a session with unfinished work, write a handoff: `longmem handoff "summary" --next "..." --plan FILE --task N`. Write only after the user confirms.
Before writing an entry, run `longmem lint` on the candidate; if it flags an error, fix it first.
Rules (non-negotiable):
- Propose the entry; write it only after the user confirms.
- `trigger` is required and must name a recognisable situation.
- Body must state what happened, what it cost, and what to do instead.
- Never store a secret (password, token, API key, phone number) in a body or trigger; store where to find it.
- Never a platitude ("be careful", "verify before claiming"). Never a chat summary.
- A wrong entry is fixed by superseding it, never by deleting it.

## Wiring

- Layer A (auto-inject): run `scripts/install-hook-codex.sh` to add a `SessionStart` hook that injects the index + rules. Sets `additionalContextLimit = 0` (full context; default 5000 truncates the 8 KB index).
- Layer B (fallback): Codex reads AGENTS.md at session start (up to `project_doc_max_bytes`, default 32 KiB).
- Layer C (MCP): add to `~/.codex/config.toml`:
  ```toml
  [mcp_servers.longmem]
  command = "npx"
  args = ["tsx", "/abs/path/to/longmem/src/mcp.ts"]
  ```

## Notes

- Codex built-in memories (`~/.codex/memories/`) are a recall layer, not a rule store. Longmem is the rule store: put rules in AGENTS.md, use memory for personal recall.
- `model_instructions_file` can point at a file containing the injected index if you prefer static injection.
