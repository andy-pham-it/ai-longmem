# longmem

**Experiential memory for working with one person.** The lessons, mistakes and
misunderstandings that should not have to be relearned every session — stored so
they can be found again, and injected so they are not forgotten.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![status: v1](https://img.shields.io/badge/status-v1%20shipped-green.svg)

---

## The problem

An agent that works with you across many sessions accumulates four things that fight
each other:

1. **Memory blocks** (always injected, ~5 000 characters) fill up. A 4 740 / 5 000
   character block is a queue, not a memory — every new decision evicts an old one,
   and nothing records *why* the decision was made.
2. **A journal** (append-only narrative) is great for "what happened", terrible for
   "what must I remember". Nobody reads 200 entries to find the one that applies now.
3. **A dead plugin** (`opencode-supermemory`) registered but never authenticated,
   silently failing every session — weight with zero value.
4. **The agent itself** re-derives the same lesson each session, because nothing
   tells it "this situation has a name and a cost you already paid."

The result: decisions are forgotten, projects get confused with each other, and the
same mistake is made twice. `longmem` is the fix: **one store, one scope rule, one
invariant, one way to recall.**

## What longmem is

- **Not a transcript.** What happened lives in the journal. `longmem` holds what
  must be remembered.
- **Not a knowledge base.** Prose without a trigger is not an entry.
- **One store, two scopes.** `global` for how to work with the user; `project` for
  facts that name a repository, file or service.
- **One invariant.** The index never exceeds 8 KB. Bytes, not rows.
- **One way to recall.** `longmem lessons "<situation>"` returns the entries whose
  trigger matches what you are about to do.

An entry is only worth keeping if it has a **trigger** (a situation you can
recognise while it is happening) and a **cost** you already paid once. Platitudes
("be careful", "verify before claiming") are rejected at write time — there is no
such thing as an entry without a trigger.

## What it does

- **Entry model.** `title` (≤ 120) + required `trigger` (≤ 200) + `body` (what
  happened, what it cost, what to do instead) + `kind`
  (`lesson | mistake | misunderstanding | preference | fact`) + `scope`
  (`global` default | `project`).
- **Bounded index.** An 8 KB cap (bytes, not rows) injected into every session's
  system prompt once per session. Pinned → reinforced → kind → newest ordering;
  `truncated`/`total` in the payload.
- **Hybrid recall.** Postgres FTS (`tsvector`/`tsquery`, config `simple`,
  unaccented) + trigram similarity + reinforced/pinned boosts. Nothing leaves
  Supabase: no model, no key, no quota, no 429.
- **Supersede, never delete.** Dedupe by title similarity > 0.7 (reinforce the
  existing); atomic writes under `pg_advisory_xact_lock`; one-hop `replaces`
  lineage.
- **Sensitive flag.** `sensitive = true` keeps an entry out of the index and
  `lessons`; `recall` and Studio still show it.
- **Portability.** Four interchangeable stores: `http` (Supabase), `postgres`
  (self-hosted / Neon), `sqlite` (local), in-memory. No sync between them.
- **MCP server.** stdio, 11 tools + 2 resources, works with any MCP-capable
  agent (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Cline, Roo Code,
  Kiro, OpenCode).
- **Adapters.** Ready-to-drop instruction files for 7 agents
  (`claude-code, codex, cursor, gemini, copilot, aider, generic`), printed by
  `longmem adapter`.
- **Auto-inject hooks.** Deterministic index injection at session start for
  Claude Code and Codex.
- **OpenCode plugin.** Per-session cached index, session-end nudge proposing
  (never writing) candidate entries.
- **CLI.** `index, lessons, recall, status, write, reinforce, supersede,
  promote, update, list, candidates, render-block, adapter`.
- **Propose-only capture.** Auto-capture never inserts silently; a platitude
  (no trigger) is rejected at write time and by a DB `CHECK` constraint.
- **Keep-alive workflow.** Daily `/health` ping so free Supabase projects do
  not pause.
- **Verify script.** 20 SQL assertions, every row must read `ok`.

## What it does not do

By design (anti-goals — shipping any of these means the design failed):

- **No silent auto-insert.** Capture is proposed and confirmed; the agent never
  writes an entry on its own.
- **No embeddings / LLM in v0 or v1.** Recall is lexical (FTS + trigram). The
  upgrade trigger is ≥ 200 entries **and** ≥ 3 measured recall misses in a
  month.
- **No multi-user or sharing.** One user, one store. Team memory is a different
  product (see `akitaonrails/ai-memory`).
- **No memory aging, decay or compaction.** Entries do not fade; they are
  superseded when wrong.
- **No sync between backends.** You pick one per deployment; moving data is a
  manual export/import.
- **No platitude or chat-summary entries.** "Be careful" and "here is what we
  discussed" are rejected.
- **No hard delete.** A wrong entry is superseded, never erased.
- **No external calls with sensitive data.** `sensitive = true` keeps an entry
  out of prompts and recall-by-default; nothing leaves the chosen backend.
- **No rewrite of the live Supabase Edge Function.** It stays the `http`
  backend; portability adds adapters, it does not replace it.
- **No cloud/SaaS.** Self-hosted or local only.

Deferred (not built yet): v2 embeddings, a handoff protocol for cross-agent
session continuity, a git-backed markdown mirror, contradiction flagging, and
per-tier decay.

## How it works

```
┌──────────────┐     session.created     ┌──────────────────────┐
│  OpenCode    │ ──────────────────────► │  plugin/longmem.ts    │
│  session     │                         │  (installed copy)     │
└──────────────┘                         └──────────┬───────────┘
                                                     │ GET /index?project_key=…
                                                     ▼
                                          ┌──────────────────────┐
                                          │  Supabase Edge Fn    │
                                          │  (Deno, longmem)     │
                                          └──────────┬───────────┘
                                                     │
                                          ┌──────────┴───────────┐
                                          │  Postgres public.    │
                                          │  memories            │
                                          │  (RLS on, no anon)   │
                                          └──────────────────────┘
```

1. The plugin hooks `experimental.chat.system.transform`, fetches the index **once
   per session** (1.5 s timeout, cached in a per-session `Map`), and appends it to
   the system prompt. Every failure is swallowed — a broken `longmem` must never
   break a session.
2. The agent starts every session knowing what it knows (the index: every active
   entry as `title — trigger`, capped at 8 KB).
3. When the agent is about to do something non-trivial, it runs
   `longmem lessons "<situation>"` and loads the matching entries on demand.
4. When the user corrects the agent, it proposes one entry and writes it only on
   confirmation. Auto-capture never inserts silently.
5. A wrong entry is fixed by **superseding** it, never by deleting it — history is
   preserved and `replaces` points one hop back.

## Quick start

### Prerequisites

- A Supabase project and the Supabase CLI (`brew install supabase/tap/supabase`).
- Node.js ≥ 22 and `npm` (see the troubleshooting note about the `~/.local/bin/npm`
  shim before relying on `npm run …`).
- An OpenCode installation (`~/.config/opencode/`).

### 1. Link and push the schema

```bash
supabase login
supabase link --project-ref <ref>
supabase db push --remote --password '<db-password>' --yes
```

### 2. Deploy the function and set the secret

```bash
supabase functions deploy longmem --project-ref <ref> --yes
supabase secrets set LONGMEM_TOKEN=<64-hex-token> --yes
```

### 3. Verify the schema

Every row must read `ok`:

```bash
supabase db query --remote -f supabase/verify/0001_verify.sql --yes
```

### 4. Create the client config

`~/.config/opencode/longmem.json`, mode `0600` (the CLI refuses group/world-readable
files):

```json
{ "endpoint": "https://<ref>.supabase.co/functions/v1/longmem", "token": "<64-hex-token>" }
```

```bash
chmod 600 ~/.config/opencode/longmem.json
```

### 5. Install the plugin

```bash
npm run install:plugin     # copies plugin/longmem.ts into ~/.config/opencode/plugins/
```

### 6. (Optional) Keep the database awake

Supabase free projects pause after 7 days of inactivity. The included
`.github/workflows/keepalive.yml` curls `/health` daily. Push the repo to GitHub
and set two secrets: `LONGMEM_URL`, `LONGMEM_TOKEN`.

## Commands

`npm run longmem -- <command>` — or, if your `npm` is the broken shim,
`npx tsx src/cli.ts <command>`.

| Command | What it does |
|---|---|
| `index [--bytes N] [--json]` | the injected index, as markdown or JSON |
| `lessons "<situation>"` | entries whose trigger matches what you are about to do |
| `list [--scope S] [--status S] [--project KEY] [--kind K] [--tag T] [--limit N] [--json]` | audit every row, including sensitive and superseded |
| `lint` | scan the store for issues: archived-but-pinned, empty/broken bodies, possible secrets, short triggers, non-English entries, test artifacts |
| `recall "<query>" [-k N] [--kind K] [--tag T]` | full-text search over title, trigger and body |
| `status` | health, counts by kind, index size |
| `write --kind K --title "…" --trigger "…" --body "…"` | add an entry (`--body -` reads stdin) |
| `reinforce <id>` | this came up again; bumps the rank |
| `supersede <id> --kind K --title "…" --trigger "…" --body "…"` | replace a wrong entry, keeping the history |
| `promote <id>` | project entry → global |
| `candidates` | the checklist and the newest titles, for deciding what to write |
| `handoff "summary" [--next ...] [--blocked ...] [--context ...] [--plan FILE] [--task N] [--total N] [--base COMMIT] [--project] [--body -]` | write a session handoff (state snapshot for the next session) |
| `handoff done` | mark the current handoff as completed |
| `render-block [--max-bytes N] [--pinned-only]` | a compact block for the agent-memory offline floor |
| `resume [--json]` | read the latest session handoff |

Exit code `2` from `write` means a similar entry already exists: the CLI prints the
existing entry and the three ways forward (reinforce, supersede, or reword). A
duplicate is a question, not an error.

`list` is the audit view. Unlike `index` and `lessons`, it shows every row — sensitive,
superseded and archived — because you cannot fix what you cannot see. By default it shows
active entries only; pass `--status all` to see history, `--scope global` or `--project
KEY` to narrow, and `--limit N` (1–500) to page. Each line carries the eight-character id
needed by `reinforce`, `supersede`, `promote` and `update`. `PINNED` and `SENSITIVE` are
printed so a mis-flagged entry is visible at a glance; `r=` and `c=` are reinforce and
recall counts. `--json` returns `{entries, total}` for scripting.

```bash
npm run longmem -- write --kind lesson \
  --title "Check the flag reaches the parser before trusting the smoke test" \
  --trigger "After adding a CLI flag" \
  --body "…what it cost the last time it was missing…"

npm run longmem -- lessons "about to deploy an edge function"
npm run longmem -- status
```

## The shape of an entry

```text
title   (imperative, ≤ 120 chars)   "Name every hop data takes before claiming where it lives"
trigger (required, ≤ 200 chars)     "When writing a design doc that claims 'nothing leaves X'"
body    (what happened, the cost, what to do instead)
kind    lesson | mistake | misunderstanding | preference | fact
scope   global (default) | project
```

`scope` defaults to `global` because most experience of working with the user is global;
`project` is only for entries that name a file, service or repository. A new project
entry whose title is > 0.7 trigram-similar to one in another project triggers a
warning.

## Design rules

1. **Trigger required.** No trigger → not an entry. This is what separates
   `longmem` from a document store.
2. **Cost named.** The body must say what it cost. "Be careful" is not an entry.
3. **Platitudes rejected at write time.** `write`, `supersede` and `/update` all run
   `validateEntry`; the database also has a `CHECK` constraint so Studio cannot
   bypass it.
4. **Supersede, never delete.** A mistake that is silently erased is a mistake that
   returns. History is kept and `replaces` points one hop back.
5. **Dedupe by title.** Similarity > 0.7 → the write returns `409 needs_decision`
   with the existing entry; reinforce or supersede, do not duplicate.
6. **Atomic writes.** Dedupe + insert happen under `pg_advisory_xact_lock` per scope,
   so two concurrent writers cannot both insert.
7. **Bytes, not rows.** The 8 KB cap is the invariant; row count is derived
   (~50–70). When the cap is hit, the least valuable lines drop first (pinned →
   reinforced → kind → newest) and the response carries `truncated: true`.

## Fixing a wrong entry

Entries are superseded, never deleted. In Supabase Studio, open `public.memories`:

- **Wrong body or trigger, same claim** → edit the row. The trigger refreshes
  `search_text`, `search_vector` and `updated_at`.
- **Wrong claim** → insert the corrected entry with `supersedes` set to the old id,
  and set the old row to `status = 'superseded'`, `superseded_by = <new id>`.

Prefer the CLI: `longmem supersede <old-id> …` does both in one transaction.

## Sensitive entries

`write --sensitive` marks an entry that must never reach a model prompt. The flag is
enforced in the database, not the client: `longmem_index_rows` and `related` exclude
sensitive rows, so the entry is absent from the injected index and from
`longmem lessons`. `recall` still returns it, because that is an explicit query you
typed, and Studio still shows it.

Use it for a secret that has to be remembered (a hostname, an account number, the
shape of a private contract), not for a claim you merely dislike. If the entry is not
safe in a prompt, it is not safe in `recall` either — that judgement is yours; the
flag does not make it for you.

## Budget

The index is capped by **bytes**, not rows: 8 KB by default, roughly 50–70 entries
at 160 characters each. Order is pinned, then most reinforced, then kind
(preference, lesson, mistake, misunderstanding, fact), then newest. When the cap is
hit the response carries `truncated: true` and the total, and the least valuable
lines are the ones missing.

Raise it with `--bytes` (clamped 1024–32768) or by pinning what must never fall out.
If entries stop fitting at all, that is the signal to supersede — consolidate two
lessons into one — not to raise the cap again.

## Recall (v1: hybrid)

`longmem recall` and `longmem lessons` rank entries with Postgres full-text search
(`tsvector`/`tsquery`, config `simple`, unaccented) combined with trigram
similarity, plus `reinforced_count` and `pinned` boosts. Nothing leaves Supabase:
no model, no key, no quota, no 429.

FTS is word-based, so paraphrase and cross-language matching still have limits. The
upgrade trigger to real embeddings is ≥ 200 entries **and** ≥ 3 measured recall
misses in a month (tracked via `recall_count` / `last_recalled_at`).

## Session handoff (ephemeral state)

Longmem stores *lessons* — reusable patterns that survive across sessions. What it does not
store is *state* — what was done, what is next, what is blocked. A new session starts cold:
the agent reads the 8 KB index of lessons but has no idea where the previous session left off.

**Session handoff** fills that gap. A handoff is a single structured snapshot:

- `summary` — what was done (1–3 sentences, concrete).
- `next` — what the next session should do first.
- `blocked` — what is blocking progress (optional).
- `context` — files, branches, commits involved (optional).
- `task_ref` — optional pointer into a plan: `{plan_file, task_number, total_tasks, base_commit}`.

Handoffs are **ephemeral**: they expire after 7 days (configurable via `LONGMEM_HANDOFF_TTL_DAYS`)
and are archived when a newer one is written. Only one handoff is active at a time per
`(scope, project_key)`. Handoffs never enter the 8 KB index or exports.

```bash
# Write a handoff (propose first, write only after confirmation)
npm run longmem -- handoff "Implemented Core.handoff() and store methods; 3 tests green" \
  --next "Wire CLI and plugin injection; run full suite" \
  --plan docs/superpowers/plans/2026-11-28-longmem-handoff.md --task 4 --total 10 \
  --base abc1234

# Read the latest handoff (injected automatically by the plugin at session start)
npm run longmem -- resume
npm run longmem -- resume --json

# Mark the current handoff as completed
npm run longmem -- handoff done
```

The plugin fetches `/resume` alongside `/index` at session start and injects the handoff
as a second system-prompt block (≤500 bytes). If no active handoff exists, nothing is
injected.

## Backends

longmem runs against four interchangeable stores. There is **no sync** between them:
you pick one per deployment and the data stays there.

| Backend | Config `kind` | When to use |
|---|---|---|
| Supabase (existing) | `http` | Cloud, shared across machines and agents. The deployed Edge Function is the `http` backend. |
| Self-hosted Postgres | `postgres` | Your own server or a managed Postgres (Neon, RDS, …). Run `scripts/migrate-postgres.ts`. |
| SQLite | `sqlite` | Local only, no server, no credentials. Good for offline work and tests. |
| (in-memory) | `sqlite` with `path: ":memory:"` | Tests and spikes. |

Config examples (always mode `0600`):

```json
// http (default, what the plugin uses today)
{ "kind": "http", "endpoint": "https://<ref>.supabase.co/functions/v1/longmem", "token": "<64 hex>" }

// sqlite
{ "kind": "sqlite", "path": "/Users/you/.local/share/longmem/mem.sqlite", "cliPath": "/Users/you/personal/longmem/src/cli.ts" }

// postgres / neon
{ "kind": "postgres", "databaseUrl": "postgres://user:pass@host:5432/db?sslmode=require" }
```

For `sqlite`/`postgres` the plugin shells out to the repo CLI (`cliPath`), so the
plugin stays standalone — no bundle, no daemon. If `cliPath` is missing the plugin
fails silently and the session runs without memory.

### Scoring ceiling

Recall uses `0.5 * tokenOverlap + 0.3 * trigram + 0.1 * min(reinforced,5)/5 + (pinned ? 0.1 : 0)`.
It is lexical, not semantic: it will not paraphrase. Expect reliable recall up to roughly
500–1000 entries; past that, or after three measured recall misses in a month, revisit
real embeddings (a future v2 that adds a provider and a key).

### Migrating between backends

There is no built-in migrator and no sync (see "No sync"). Moving entries from one
store to another is a manual export/import, and it is deliberately explicit.

1. Point at the **source** store and export everything, including history:

   ```bash
   LONGMEM_CONFIG=~/.config/opencode/longmem.source.json \
     npx tsx src/cli.ts list --json --status all > entries.json
   ```

2. Point at the **target** store and re-import each entry. `--force` bypasses the
   dedupe check, so a re-run will create duplicates — use it deliberately:

   ```bash
   LONGMEM_CONFIG=~/.config/opencode/longmem.target.json \
     npx tsx src/cli.ts write --kind lesson \
       --title "..." --trigger "..." --body "..." \
       --tag a --tag b --pinned --force
   ```

   Repeat per entry, or script it: the JSON from step 1 is `{entries, total}`, so a
   short `node`/`jq` loop over `.entries` is enough. `scope`, `project_key`,
   `pinned` and `sensitive` must be passed explicitly because they are not inferred
   from the body.

3. Verify on the target:

   ```bash
   LONGMEM_CONFIG=~/.config/opencode/longmem.target.json npx tsx src/cli.ts status
   LONGMEM_CONFIG=~/.config/opencode/longmem.target.json npx tsx src/cli.ts list --status all
   ```

Notes:
- `created_at` / `updated_at` are regenerated on import; history of *when* an entry
  was first learned is not preserved. Reinforce/supersede chains (`replaces_id`) are
  not carried over either — supersede the wrong one again after import if needed.
- `recall_count` and `reinforced_count` reset to 0 on import (the CLI has no flag
  to set them); re-run `reinforce` afterwards if the old count mattered.
- Moving from Supabase to SQLite/Postgres loses the remote `search_vector` but the
  target builds its own on insert, so recall keeps working.

### Backing up

```bash
supabase db dump -f longmem-$(date +%F).sql
```

For SQLite, copy the `.sqlite` file while no process is writing to it. For
Postgres, use `pg_dump`.

## Troubleshooting

- **A command prints only `ok` and does nothing** — your `PATH` resolves `npm` to
  `~/.local/bin/npm`, a shim whose target is missing. Use `npx tsx src/cli.ts`, or
  `/Users/admin/.nvm/versions/node/v22.22.3/bin/npm`.
- **`supabase db push` rejects `--password`** — it needs `--remote`.
- **Direct database connections refuse** — `db.<ref>.supabase.co` is IPv6-only
  here. Use `supabase db query --remote`.
- **The index is missing from a session** — run `longmem status` first; the plugin
  fails silently by design, so the CLI is the only place errors show.
- **`npm run install:plugin` does nothing** — same shim problem; run
  `bash scripts/install-plugin.sh` directly.
- **SQLite `SQLITE_BUSY` / "database is locked"** — two processes writing the
  same `.sqlite` file. longmem uses a single connection per process; close any
  other `longmem` invocation, or point each deployment at its own file.
- **SQLite file is not mode 0600** — the loader refuses world-readable configs;
  `chmod 600` the `.json` and the `.sqlite`.
- **Postgres "permission denied for table"** — the role in `databaseUrl` needs
  `CREATE` on the schema for the first migration and `USAGE`/`DML` afterwards.
  Run `scripts/migrate-postgres.ts` once as the owner, then connect as a
  least-privilege role.
- **Postgres connection fails with SSL** — Neon needs `?sslmode=require`; a local
  server usually needs `?sslmode=disable`. The store only enables SSL when the URL
  says so.
- **`list --status all` is empty on a fresh SQLite/Postgres store** — expected:
  nothing has been written yet. Run `status` to confirm the schema exists.
- **Local plugin injection is missing** — `cliPath` in the config must point at
  `src/cli.ts` of a checked-out repo, and `npx` must be on `PATH` for the user
  OpenCode runs as. The plugin fails silently, so `longmem status` is the only
  diagnostic.

## Project layout

```
longmem/
├── src/                # Node CLI + shared client/config
│   ├── cli.ts
│   ├── commands/       # one file per command
│   ├── client.ts       # authenticated HTTP client
│   ├── config.ts       # 0600 config loader
│   ├── context.ts      # flag parsing
│   ├── format.ts       # entry formatting
│   └── projectKey.ts   # git remote → project key
├── plugin/longmem.ts   # OpenCode plugin (installed copy is what runs)
├── supabase/
│   ├── migrations/     # 0001_init … 0005
│   ├── functions/longmem/  # Deno edge function
│   ├── verify/         # SQL assertions (must all read ok)
│   └── config.toml
├── test/               # vitest, 45 tests
├── docs/superpowers/
│   ├── specs/          # design docs (v0, v1)
│   └── plans/          # implementation plans
└── .github/workflows/  # keepalive (daily /health ping)
```

## License

MIT.

## MCP server (universal adapter)

longmem ships a stdio MCP server that exposes every operation as a tool, so any
MCP-capable agent (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Cline, Roo
Code, Kiro, OpenCode) can read and write longmem without shelling out.

Run it directly:

```bash
npx tsx /abs/path/to/longmem/src/mcp.ts
```

Client config (same shape for Claude Code, Cursor, Copilot, Gemini CLI):

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

Tools: `longmem_index`, `longmem_lessons`, `longmem_recall`, `longmem_write`,
`longmem_reinforce`, `longmem_supersede`, `longmem_promote`, `longmem_update`,
`longmem_list`, `longmem_candidates`, `longmem_status`. Resources:
`longmem://index`, `longmem://status`.

The server reuses `createClient`, so it works with http, sqlite, and postgres
backends. It fails silently when unconfigured: `initialize` succeeds and tools
return `isError: true` with a message.

## Adapters for other agents

Ready-to-drop instruction files live in `adapters/`. Print one with:

```bash
npx tsx src/cli.ts adapter claude-code     # or: codex, cursor, gemini, copilot, aider, generic
npx tsx src/cli.ts adapter list
```

Each adapter contains the canonical LONGMEM rules block plus agent-specific
wiring (where to put the file, how to inject the index). Keep the rules block
intact when copying.

| Agent | File location | Auto-inject? |
|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | Yes, via hook (below) |
| Codex | `~/.codex/AGENTS.md` or `./AGENTS.md` | Yes, via hook (below) |
| Cursor | `.cursor/rules/longmem.mdc` | `alwaysApply: true` |
| Gemini CLI | `~/.gemini/GEMINI.md` | No (file only) |
| Copilot | `.github/copilot-instructions.md` | No (file only) |
| Aider | `CONVENTIONS.md` + `.aider.conf.yml` | No (file only; pin with `read:`) |
| Any other | agent's instructions file | No |

## Auto-inject hooks (Claude Code + Codex)

Deterministic index injection at session start, matching the OpenCode plugin's
"index is injected, not fetched" guarantee:

```bash
npm run install:hooks:claude     # merges ~/.claude/settings.json
npm run install:hooks:codex      # merges ~/.codex/hooks.json
```

Both scripts are idempotent and back up the original config on first run. The
hook runs `scripts/hooks/inject-index.ts`, which calls `longmem index` for the
current project and prints `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }`.
It exits 0 on any error (fail-silent) and never blocks a session.

Note: the hook uses the absolute path to a working `npx`. If your shell's
`npx` is a broken shim (see Troubleshooting), edit the generated config to point
at the working binary.

## Seed entries for new users

longmem ships with an empty store. To bootstrap a new user, propose (do not
auto-write) a small set of `preference` entries that capture how they want
to be worked with. Example template:

```bash
npx tsx src/cli.ts write --kind preference \
  --title "Reply in the user's preferred language" \
  --trigger "First session in a new repo" \
  --body "The user prefers replies in <language>. Code, identifiers, comments, file names and commit messages stay in English. Confirm the language on the first correction." \
  --pinned
```

Other useful seeds: verification habits, budget/tier constraints, and any
correction the user has already made in the first session. Never seed a
platitude ("be careful", "verify before claiming") — a seed without a
recognisable trigger is not an entry.
