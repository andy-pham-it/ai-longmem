# longmem adapter — GitHub Copilot

**Where it goes:** `.github/copilot-instructions.md` (project) or user settings.

## longmem
The longmem index is already in your system prompt. Do not re-fetch it.
Before non-trivial work run: `npx tsx ~/personal/longmem/src/cli.ts lessons "<what you are about to do>"`
Capture a lesson when ANY of these happens:
- The user corrects you or rejects an approach.
- A command fails and you find the non-obvious reason.
- You discover a constraint, cost, or ordering that was not documented.
- The same mistake or confusion could recur in another session.
Before finishing a non-trivial task, run `longmem candidates` and propose one entry if a trigger matches the work just done.
Before writing an entry, run `longmem lint` on the candidate; if it flags an error, fix it first.
Rules (non-negotiable):
- Propose the entry; write it only after the user confirms.
- `trigger` is required and must name a recognisable situation.
- Body must state what happened, what it cost, and what to do instead.
- Never store a secret (password, token, API key, phone number) in a body or trigger; store where to find it.
- Never a platitude ("be careful", "verify before claiming"). Never a chat summary.
- A wrong entry is fixed by superseding it, never by deleting it.

## Wiring

- Layer B: Copilot reads `copilot-instructions.md` at session start.
- Layer C (MCP): configure in VS Code `mcp.json` (Copilot supports MCP servers).
- Copilot also has built-in Copilot Memory; longmem is the cross-agent store shared with Claude/Codex/OpenCode.

## Notes

- Custom agents and hooks are supported; a Copilot hook can inject the index like the Claude Code hook.
