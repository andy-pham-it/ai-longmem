# longmem adapter — Aider

**Where it goes:** `CONVENTIONS.md` at the repo root, pinned via `.aider.conf.yml`.

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
