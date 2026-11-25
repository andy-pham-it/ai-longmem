# longmem — agent adapters, auto-inject hooks, MCP server

**Date:** 2026-11-26
**Status:** Draft — awaiting approval
**Spec:** supersedes nothing; extends `docs/superpowers/specs/2026-11-23-longmem-design.md` (§6, §14, §346 adapters) and the portability design.
**Depends on:** v1 (hybrid recall) + portability (createClient transport) already shipped.

## 1. Intent

v0/v1/portability made longmem work for **OpenCode only**. The plugin injects the index into OpenCode's system prompt, and the global `~/.config/opencode/AGENTS.md` carries the capture rules. Every other agent Andy uses (Claude Code, Codex, Cursor, Gemini CLI, Copilot, Aider, …) gets nothing unless Andy hand-copies snippets.

This spec delivers three things that close that gap, in one plan:

1. **MCP server** — one universal adapter. Every MCP-capable agent gets `longmem_*` tools natively, no shelling out, no per-agent code.
2. **Adapter instruction files** — ready-to-drop snippets for the agents that still need an instructions file (and for agents without MCP).
3. **Auto-inject hooks** for Claude Code and Codex — deterministic index injection at session start, matching the OpenCode plugin's "index is injected, not fetched" guarantee, instead of relying on the agent to read an instructions file.

Secondary success (design doc §1): a different agent inherits the same experience.

## 2. Goals, non-goals, anti-goals

**Goals**
- Any MCP-capable agent (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Cline, Roo Code, Kiro, OpenCode) can read and write longmem without an OpenCode plugin.
- Claude Code and Codex sessions start with the index already in context (no "run lessons first" reliance).
- One install command per agent; one source of truth for the LONGMEM rules block.
- Works with every backend (http / sqlite / postgres) — the MCP server and hooks go through `createClient`, not the Supabase HTTP path directly.
- Fail-silent everywhere: a broken memory store never blocks a session.

**Non-goals**
- No new storage, schema, or RPC. This spec consumes the existing store contract.
- No sync between backends (still out of scope; portability design §non-goals).
- No GUI. Supabase Studio / agent-native UI remain the editors.
- No change to the OpenCode plugin's behavior. It stays as-is.
- No agent-specific business logic in the core. Adapters are thin.

**Anti-goals**
- A hook or MCP server that crashes a session because the store is down. (Plugin already proves fail-silent is non-negotiable.)
- Duplicating the LONGMEM rules in N places. One constant, many consumers.
- Re-fetching the index on every prompt. Inject once per session (hooks fire on `SessionStart`).

## 3. Constraints (carried from v0/v1/portability)

- Config is `{endpoint,token}` (http) / `{databaseUrl}` (postgres) / `{path,cliPath?}` (sqlite), mode 0600, path from `$LONGMEM_CONFIG` or `~/.config/opencode/longmem.json`.
- `createClient(cfg)` returns a `Core` with `index`, `related`, `recall`, `write`, `reinforce`, `supersede`, `promote`, `update`, `list`, `candidates`, `status`, `counts`.
- 8 KB byte budget on `/index`; hook injection cap is 10,000 chars (Claude Code) — index (≤8192) + rules (~600) fits.
- Codex `additionalContextLimit` defaults to 5000 — must be raised to 0 (full) or ≥10000 in the hook config, otherwise the index is truncated.
- MCP stdio transport: server must not write to stdout except JSON-RPC frames. All logging to stderr.
- Node 22 (nvm). No new runtime beyond `@modelcontextprotocol/sdk`.

## 4. Approaches considered

**A. One MCP server + thin adapters + two hook scripts (chosen).** MCP server wraps `createClient` and exposes tools/resources. Adapter files are static markdown snippets. Hooks are two small scripts (Claude Code, Codex) that call the CLI and print the injection. Chosen: maximum reuse, minimum per-agent code, matches the portability design's "shared core" principle.

**B. Per-agent plugins (OpenCode-style) for each agent.** Rejected: Claude Code has no plugin API equivalent to OpenCode's `experimental.chat.system.transform`; Codex has no plugin system. Hooks + MCP cover them.

**C. Only instructions files (no MCP, no hooks).** Rejected: relies on the agent remembering to run `lessons`; violates Andy's explicit "injected, not fetched" requirement. Instructions files remain as the fallback for agents without hooks/MCP (Aider).

**D. MCP server over HTTP (remote).** Rejected for v1: requires hosting, auth, and a running daemon. stdio MCP runs on demand from the agent's process, needs no daemon, and works offline with sqlite/postgres backends. HTTP MCP can be added later.

## 5. Architecture

```
                         ┌─────────────────────────────┐
                         │   longmem core (src/core)    │
                         │  + transport (createClient)  │
                         └──────────────┬──────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        │               │               │               │               │
   ┌────┴────┐    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐   ┌────┴────┐
   │ MCP srv │    │ CLI (tsx) │   │ OC plugin │   │ Claude hook│   │ Codex   │
   │ src/mcp │    │ src/cli   │   │ plugin/   │   │ scripts/   │   │ hook    │
   │  stdio  │    │           │   │ longmem.ts│   │ hooks/     │   │         │
   └────┬────┘    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └────┬────┘
        │               │               │               │               │
        └───────────────┴───────────────┴───────────────┴───────────────┘
                                        │
                          ┌─────────────┴─────────────┐
                          │  Adapter instruction files │
                          │  adapters/*.md (static)    │
                          └───────────────────────────┘
```

Data flow:
- **MCP**: agent → stdio JSON-RPC → `src/mcp.ts` → `createClient` → store. Tools return text content. Resources expose `longmem://index` and `longmem://status`.
- **Hooks**: agent `SessionStart` → runs `scripts/hooks/inject-index.*` → CLI `longmem index --json` → parses `.block` + appends LONGMEM rules block → prints JSON `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }`.
- **Adapters**: static files copied/shown to the user; no runtime.

## 6. Component 1 — MCP server

**File:** `src/mcp.ts` (new). Entry: `npx tsx /abs/path/src/mcp.ts` (stdio).

**Dependencies:** add `@modelcontextprotocol/sdk` to `package.json` devDependencies (and a runtime dep entry, since the server runs via tsx from the repo, not bundled — same as CLI).

**Server metadata:** name `longmem`, version from `package.json`.

**Tools** (each maps to a `Core` method; input validated with zod or plain checks):

| Tool | Params | Returns |
|---|---|---|
| `longmem_index` | `project_key?`, `max_bytes?` (default 8192) | text block + total/truncated as a trailing footer |
| `longmem_lessons` | `context` (required), `project_key?` | formatted entries (uses `formatEntries`) |
| `longmem_recall` | `query`, `kinds?`, `tags?`, `limit?` (default 5), `project_key?` | formatted entries |
| `longmem_write` | `kind`, `title`, `trigger`, `body`, `tags?`, `pinned?`, `sensitive?`, `scope?`, `project_key?`, `force?` | `{action, id}` or needs_decision payload |
| `longmem_reinforce` | `id` | new reinforced_count |
| `longmem_supersede` | `id` (old), plus the same fields as write | `{action, id, replaces}` |
| `longmem_promote` | `id`, `scope` (`global`/`project`), `project_key?` | `{id, scope, project_key}` |
| `longmem_update` | `id`, patch fields | `{id}` |
| `longmem_list` | `scope?`, `project_key?`, `kind?`, `tag?`, `status?`, `limit?` | formatted list rows |
| `longmem_candidates` | `limit?` (default 10) | checklist (5 lines) + newest titles |
| `longmem_status` | — | health, counts, index bytes |

**Resources:**
- `longmem://index` → text (the index block, default project key from cwd)
- `longmem://status` → text (counts)

**Behavior:**
- On startup: `loadConfig()`. If it throws, the server still starts (MCP `initialize` succeeds) but every tool returns `{ isError: true, content: [{ type: "text", text: "longmem not configured: <msg>" }] }`. This keeps the agent usable.
- `createClient(cfg)` is called lazily per tool invocation (or once at startup and reused). Reuse a single client for the server's lifetime; recreate on config error.
- `project_key` resolution: if not provided, derive from `process.cwd()` via `projectKeyFromRemote` (same as CLI). Tools accept an optional `project_key` override.
- All tool results are `{ content: [{ type: "text", text }] }`. Errors set `isError: true`.
- Server logs to stderr only (`console.error`).
- Graceful shutdown on SIGINT/SIGTERM.

**Config for MCP clients (documented):**
```json
{
  "mcpServers": {
    "longmem": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/longmem/src/mcp.ts"],
      "env": { "LONGMEM_CONFIG": "/path/to/longmem.json" }
    }
  }
}
```
Cursor uses `.cursor/mcp.json` with the same shape. Copilot uses VS Code `mcp.json`.

## 7. Component 2 — Adapter instruction files

**Directory:** `adapters/` (new), one file per agent:

- `adapters/claude-code.md`
- `adapters/codex.md`
- `adapters/cursor.mdc` (with frontmatter `alwaysApply: true`)
- `adapters/gemini.md`
- `adapters/copilot.md`
- `adapters/aider.md`
- `adapters/generic.md` (fallback for any agent with an instructions file)

Each file contains:
1. A header: what it is, where to put it, how longmem is invoked.
2. The LONGMEM rules block (single source: `src/instructions.ts` exports `LONGMEM_RULES`; the adapter files are generated? Or hand-maintained with a CI check? Decision: hand-maintained but a test asserts every adapter file contains the exact `LONGMEM_RULES` string. Simpler and keeps adapters readable. A `longmem adapter <agent>` CLI command prints the file.)
3. Agent-specific wiring notes (e.g., "For auto-inject, use the hook instead — see scripts/hooks").

**CLI addition:** `longmem adapter <agent>` prints the adapter to stdout; `longmem adapter list` lists available agents. This lets users do `longmem adapter claude-code > ~/.claude/CLAUDE.md` (append) without hunting for files.

**README section:** "Adapters for other agents" with a table (agent → file location → method A/B/C).

## 8. Component 3 — Auto-inject hooks (Claude Code + Codex)

**Shared script:** `scripts/hooks/inject-index.ts` (run via `npx tsx`). Behavior:
1. Parse hook input from stdin (JSON) if present; extract `cwd` (fall back to `process.cwd()`).
2. Resolve project key from `cwd` (git remote, same as CLI).
3. Call `loadConfig()` + `createClient(cfg)` → `client.index(projectKey, 8192)`. On any error, print nothing and exit 0 (fail-silent).
4. Build `additionalContext` = `block` (from index) + `\n\n` + `LONGMEM_RULES` (short form, ~600 chars). If block is empty, still print rules (so capture guidance survives even with an empty store).
5. Print JSON to stdout:
   ```json
   { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }
   ```
6. Exit 0 always.

**Claude Code wiring** (`scripts/install-hook-claude.sh`):
- Idempotently merge into `~/.claude/settings.json`:
  ```json
  { "hooks": { "SessionStart": [ { "matcher": "startup|resume|clear|compact", "hooks": [ { "type": "command", "command": "npx tsx /abs/path/scripts/hooks/inject-index.ts", "timeout": 5 } ] } ] } }
  ```
- Uses `node` to merge JSON safely (preserve existing hooks).
- Backup `settings.json.bak-longmem` on first run.

**Codex wiring** (`scripts/install-hook-codex.sh`):
- Idempotently merge into `~/.codex/config.toml` (or `~/.codex/hooks.json`):
  ```toml
  [[hooks.SessionStart]]
  matcher = "startup|resume"

  [[hooks.SessionStart.hooks]]
  type = "command"
  command = "npx tsx /abs/path/scripts/hooks/inject-index.ts"
  timeout = 5
  additionalContextLimit = 0
  ```
- Backup on first run.

**Important:** the hook must run with `cwd` = the project directory. Claude Code and Codex run SessionStart hooks with the project cwd by default. The script also reads `cwd` from stdin JSON as a fallback.

## 9. Shared constant: `LONGMEM_RULES`

**File:** `src/instructions.ts` (new). Exports:
```ts
export const LONGMEM_RULES = `## longmem
The longmem index is already in your system prompt. Do not re-fetch it.
Before non-trivial work run: \`npx tsx ~/personal/longmem/src/cli.ts lessons "<what you are about to do>"\`
Capture a lesson when ANY of these happens:
- Andy corrects you or rejects an approach.
- A command fails and you find the non-obvious reason.
- You discover a constraint, cost, or ordering that was not documented.
- The same mistake or confusion could recur in another session.
Before finishing a non-trivial task, run \`longmem candidates\` and propose one entry if a trigger matches the work just done.
Rules (non-negotiable):
- Propose the entry; write it only after Andy confirms.
- \`trigger\` is required and must name a recognisable situation.
- Body must state what happened, what it cost, and what to do instead.
- Never a platitude ("be careful", "verify before claiming"). Never a chat summary.
- A wrong entry is fixed by superseding it, never by deleting it.`;
```

This is the single source. The global `~/.config/opencode/AGENTS.md` block, the adapter files, and the hook injection all derive from it. A test asserts the AGENTS.md block matches `LONGMEM_RULES` (or a documented subset) so drift is caught.

Note: the AGENTS.md block currently in `~/.config/opencode/AGENTS.md` is already this content (updated 2026-11-25). We'll keep it; the test checks the repo's `adapters/opencode.md` matches.

## 10. File structure

```
longmem/
├── src/
│   ├── mcp.ts                  # NEW: MCP server (stdio)
│   ├── instructions.ts         # NEW: LONGMEM_RULES constant
│   └── ... (existing)
├── adapters/                   # NEW
│   ├── claude-code.md
│   ├── codex.md
│   ├── cursor.mdc
│   ├── gemini.md
│   ├── copilot.md
│   ├── aider.md
│   └── generic.md
├── scripts/
│   ├── hooks/
│   │   └── inject-index.ts     # NEW: shared hook script
│   ├── install-hook-claude.sh  # NEW
│   └── install-hook-codex.sh   # NEW
├── test/
│   ├── mcp.test.ts             # NEW: tool dispatch + fail-silent
│   ├── instructions.test.ts    # NEW: AGENTS.md block matches constant
│   └── adapter.test.ts         # NEW: every adapter contains LONGMEM_RULES
└── package.json                # add @modelcontextprotocol/sdk, bin entry
```

## 11. Effort

- Component 1 (MCP server): 1 evening (SDK wiring + 11 tools + resources + fail-silent + tests)
- Component 2 (adapters + CLI command + README): 0.5 evening
- Component 3 (hooks + install scripts): 1 evening
- Tests + docs + verification: 0.5 evening
- **Total: ~3 evenings**

## 12. Decisions log (settled here)

1. **MCP over stdio, not HTTP.** stdio runs on demand from the agent process, no daemon, works offline with sqlite/postgres. HTTP MCP can be added later without breaking stdio clients.
2. **MCP server reuses `createClient`.** No second store implementation. The same transport that powers the CLI powers MCP.
3. **Hooks inject index + rules, once per session.** `SessionStart` only. No per-prompt injection (cost + latency).
4. **Hook prints JSON `hookSpecificOutput.additionalContext`** for both Claude Code and Codex. Both support it. Claude Code also accepts plain stdout, but JSON is consistent and lets us set `additionalContextLimit` on Codex.
5. **Codex `additionalContextLimit = 0`** in the hook config (full context). Default 5000 would truncate the 8 KB index.
6. **Hook is fail-silent.** Any error → exit 0, no output. Never block a session.
7. **Adapter files are static, not generated.** A test asserts they contain `LONGMEM_RULES`. Simpler than a generator; keeps them readable and editable.
8. **`longmem adapter <agent>` CLI command** added for discoverability and piping.
9. **No change to the OpenCode plugin.** It already does injection; the new `src/instructions.ts` constant is the source for adapters and hooks, and the OpenCode AGENTS.md block is verified against it by test.
10. **MCP server fails gracefully when unconfigured.** `initialize` succeeds; tools return `isError: true` with a message. The agent stays usable.

## 13. Review focus (for the final reviewer)

1. **MCP server must never write to stdout except JSON-RPC frames.** A stray `console.log` breaks every MCP client. (Test: capture stdout during a tool call, assert it parses as JSON-RPC.)
2. **Hook must never block a session.** Any thrown error, missing config, or store timeout → exit 0. (Test: point `LONGMEM_CONFIG` at a nonexistent file, run the hook, assert exit 0 and empty stdout.)
3. **Hook output must fit Claude Code's 10,000-char cap.** Index (≤8192) + rules (~600) ≈ 8800. If a future change grows rules, the hook must truncate rules, not the index. (Test: assert output length ≤ 10000.)
4. **Codex `additionalContextLimit` must be set to 0** in the install script. A default of 5000 silently truncates. (Test: parse the generated config, assert the value.)
5. **MCP tool `longmem_write` needs_decision path.** When dedupe fires, the tool must return the existing entry + options as text (not throw), so the agent can decide. (Test: write a duplicate, assert `isError` is false and text contains "needs_decision".)
6. **Adapter files must contain the exact `LONGMEM_RULES` string.** Drift between adapters and the canonical block is the failure mode. (Test: for each adapter, assert `content.includes(LONGMEM_RULES)` or a documented subset marker.)
7. **`project_key` derivation in hooks must use the hook's cwd, not the repo's install dir.** Otherwise every project gets the longmem repo's own key. (Test: run hook with `cwd` set to a temp git repo, assert the index call uses that repo's key.)
8. **MCP server must work with sqlite and postgres backends**, not just http. (Test: set `LONGMEM_CONFIG` to a sqlite config, call `longmem_status`, assert success.)

## 14. Verification plan

- Unit tests: `test/mcp.test.ts` (tool dispatch, fail-silent, output format), `test/instructions.test.ts`, `test/adapter.test.ts`.
- Integration: install Claude Code hook in a temp `HOME`, run a session, confirm index appears in context (manual, documented in README).
- `npx tsc --noEmit` clean, full suite green.
- Manual smoke: `longmem adapter claude-code`, `longmem adapter list`, `scripts/install-hook-claude.sh`, `scripts/install-hook-codex.sh`.

## 15. Left to the builder (plan phase)

- Exact zod schema for each MCP tool param (types, defaults).
- Whether `longmem_candidates` is a separate tool or folded into `longmem_list` (recommend: separate, matches CLI).
- Hook input parsing details (stdin JSON shape differs between Claude Code and Codex; document both).
- MCP resource URI scheme and whether to expose `longmem://entries/{id}`.
- Whether to add a `bin` entry to package.json for `longmem-mcp` (recommend: yes, for cleaner MCP client config).
- Adapter file exact wording (follow `LONGMEM_RULES` + per-agent wiring).

---

**Approval requested:** does this spec capture what you want for items 1+2+3? If yes, I'll invoke `superpowers:writing-plans` next.