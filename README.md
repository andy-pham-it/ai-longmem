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
- **One store, two scopes.** `global` for how to work with Andy; `project` for
  facts that name a repository, file or service.
- **One invariant.** The index never exceeds 8 KB. Bytes, not rows.
- **One way to recall.** `longmem lessons "<situation>"` returns the entries whose
  trigger matches what you are about to do.

An entry is only worth keeping if it has a **trigger** (a situation you can
recognise while it is happening) and a **cost** you already paid once. Platitudes
("be careful", "verify before claiming") are rejected at write time — there is no
such thing as an entry without a trigger.

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
4. When Andy corrects the agent, it proposes one entry and writes it only on
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
| `recall "<query>" [-k N] [--kind K] [--tag T]` | full-text search over title, trigger and body |
| `status` | health, counts by kind, index size |
| `write --kind K --title "…" --trigger "…" --body "…"` | add an entry (`--body -` reads stdin) |
| `reinforce <id>` | this came up again; bumps the rank |
| `supersede <id> --kind K --title "…" --trigger "…" --body "…"` | replace a wrong entry, keeping the history |
| `promote <id>` | project entry → global |
| `candidates` | the checklist and the newest titles, for deciding what to write |
| `render-block [--max-bytes N] [--pinned-only]` | a compact block for the agent-memory offline floor |

Exit code `2` from `write` means a similar entry already exists: the CLI prints the
existing entry and the three ways forward (reinforce, supersede, or reword). A
duplicate is a question, not an error.

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

`scope` defaults to `global` because most experience of working with Andy is global;
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

## Backup

```bash
supabase db dump -f longmem-$(date +%F).sql
```

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
