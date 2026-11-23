# longmem

Experiential memory for working with one person: the lessons, mistakes and
misunderstandings that should not have to be relearned every session.

It is not a chat log and not a knowledge base. An entry is only worth
keeping if it has a **trigger** — a situation you can recognise while it is
happening — and a **cost** you already paid once.

- **Not** a transcript: summaries of what happened belong in a journal.
- **Not** a document store: prose without a trigger is not an entry.
- **One** store, two scopes: `global` for how to work with Andy, `project`
  for facts that name a repository, file or service.

The index (every active entry as `title — trigger`, capped at 8 KB) is
injected into the agent's system prompt by an OpenCode plugin, so the agent
starts every session knowing what it knows. Entries are loaded on demand.

## Setup

Requires a Supabase project and the Supabase CLI (`brew install supabase/tap/supabase`).

```bash
supabase login
supabase link --project-ref <ref>
supabase db push --remote --password '<db-password>' --yes
supabase functions deploy longmem --project-ref <ref> --yes
supabase secrets set LONGMEM_TOKEN=<64-hex-token> --yes
```

Verify the schema (every row must read `ok`):

```bash
supabase db query --remote -f supabase/verify/0001_verify.sql --yes
```

Create the client config at `~/.config/opencode/longmem.json`, mode `0600`
(the CLI refuses group/world-readable files):

```json
{ "endpoint": "https://<ref>.supabase.co/functions/v1/longmem", "token": "<64-hex-token>" }
```

```bash
chmod 600 ~/.config/opencode/longmem.json
npm run install:plugin     # copies plugin/longmem.ts into ~/.config/opencode/plugins/
```

The plugin hooks `experimental.chat.system.transform`, fetches the index once
per session (1.5 s timeout, cached), and appends it to the system prompt. It
swallows every error: a broken longmem must never break a session.

## Commands

`npm run longmem -- <command>` — or `npx tsx src/cli.ts <command>`.

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

Exit code `2` from `write` means a similar entry already exists: the CLI
prints the existing entry and the three ways forward (reinforce, supersede,
or reword). A duplicate is a question, not an error.

```bash
npm run longmem -- write --kind lesson \
  --title "Check the flag reaches the parser before trusting the smoke test" \
  --trigger "After adding a CLI flag" \
  --body "…what it cost the last time it was missing…"

npm run longmem -- lessons "about to deploy an edge function"
```

## Fixing a wrong entry

Entries are superseded, never deleted — a mistake that is silently erased is
a mistake that returns. In Supabase Studio, open `public.memories`:

- **Wrong body or trigger, same claim** → edit the row. A trigger refreshes
  `search_text` and `updated_at`.
- **Wrong claim** → insert the corrected entry with `supersedes` set to the
  old id, and set the old row to `status = 'superseded'`,
  `superseded_by = <new id>`.

Prefer the CLI: `longmem supersede <old-id> …` does both in one transaction.

## Sensitive entries

`write --sensitive` marks an entry that must never reach a model prompt. The
flag is enforced in the database, not in the client: `longmem_index_rows` and
`related` exclude sensitive rows, so the entry is absent from the injected
index and from `longmem lessons`. `recall` still returns it, because that is
an explicit query you typed, and Studio still shows it.

Use it for a secret that has to be remembered (a hostname, an account number,
the shape of a private contract), not for a claim you merely dislike. If the
entry is not safe in a prompt, it is not safe in `recall` either — that one is
your call to make, and the flag does not make it for you.

## Budget

The index is capped by **bytes**, not rows: 8 KB by default, roughly 50–70
entries at 160 characters each. Order is pinned, then most reinforced, then
kind (preference, lesson, mistake, misunderstanding, fact), then newest.
When the cap is hit the response carries `truncated: true` and the total, and
the least valuable lines are the ones missing.

Raise it with `--bytes` (clamped 1024–32768) or by pinning what must never
fall out. If entries stop fitting at all, that is the signal to supersede —
consolidate two lessons into one — not to raise the cap again.

## Recall (v1: hybrid)

`longmem recall` and `longmem lessons` rank entries with Postgres full-text search
(`tsvector`/`tsquery`, config `simple`, unaccented) combined with trigram similarity,
plus `reinforced_count` and `pinned` boosts. Nothing leaves Supabase: no model, no key,
no quota, no 429. FTS is word-based, so paraphrase and cross-language matching still
have limits; the upgrade trigger to real embeddings is ≥200 entries and ≥3 measured
recall misses in a month (tracked via `recall_count` / `last_recalled_at`).

```bash
supabase db dump -f longmem-$(date +%F).sql
```

## Troubleshooting

- **A command prints only `ok` and does nothing** — your `PATH` resolves
  `npm` to `~/.local/bin/npm`, a shim whose target is missing. Use
  `npx tsx src/cli.ts`, or `/Users/admin/.nvm/versions/node/v22.22.3/bin/npm`.
- **`supabase db push` rejects `--password`** — it needs `--remote`.
- **Direct database connections refuse** — `db.<ref>.supabase.co` is
  IPv6-only here. Use `supabase db query --remote`.
- **The index is missing from a session** — `longmem status` first; the
  plugin fails silently by design, so the CLI is the only place errors show.
