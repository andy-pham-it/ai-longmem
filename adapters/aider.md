# longmem adapter — Aider

**Where it goes:** `CONVENTIONS.md` at the repo root, pinned via `.aider.conf.yml`.

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

## Wiring (Layer B only — Aider MCP support is limited)

`.aider.conf.yml`:
```yaml
read: CONVENTIONS.md
```

Or pass `--read CONVENTIONS.md` / `--system-prompt-extras` on the command line.

## Notes

- CONVENTIONS.md is NOT auto-loaded by default; it must be pinned or Aider ignores it.
- Aider has a bash tool, so `longmem lessons` / `longmem write` still work via shell.
- No built-in auto memory; longmem fills that gap.
