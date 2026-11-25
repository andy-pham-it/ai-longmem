# longmem adapter — Gemini CLI

**Where it goes:** `~/.gemini/GEMINI.md` (global) or `./GEMINI.md` (project).

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

- Layer B: Gemini CLI loads GEMINI.md at session start; `/memory reload` to refresh, `/memory add` to append.
- Layer C (MCP): configure in `~/.gemini/settings.json` under `mcpServers`.
- Caveat: individual free users moved to Antigravity CLI in June 2026; verify your account route.

## Notes

- Gemini CLI has its own memory; longmem is the cross-agent experiential store.
