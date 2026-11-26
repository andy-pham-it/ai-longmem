# longmem — experiential memory for working with the user

Date: 2026-11-23
Status: design, awaiting approval
Supersedes: earlier draft of the same date that modelled this as a decision log.

## 1. Intent and why

The agent forgets, and what it forgets is not facts — it is **experience**.

Three specific things get lost between sessions:

1. **Mistakes we paid for.** The wrong fix, the hour burned on a bad assumption, the
   config that looked right and was not.
2. **Misunderstandings.** Times the agent read the request as X when it meant Y. These
   are the most expensive, because the correction is invisible: the agent believes it
   did what was asked.
3. **Lessons.** The rule that should have prevented 1 and 2 — stated once, forgotten
   within a week.

The store that should hold these has a ceiling. The injected `project` block for
`my-porfolio` sits at 4,740 / 5,000 chars; adding a lesson means deleting an older one.
The journal has semantic search but nothing calls it at session start. And
`opencode-supermemory` is registered in `~/.config/opencode/opencode.json` but was never
authenticated — it has never run.

`longmem` is the store the blocks cannot be: **unbounded, scoped, human-editable, and
written in a shape that can be recognised mid-task rather than only at session start.**

Success: a month from now, the agent makes a mistake it has already made, and I can say
"you have this written down" — and it does, and it acted on it before I said anything.

Secondary success: a different agent (Claude Code, Codex, whatever comes next) inherits
the same experience instead of re-earning it.

## 2. What an entry is

The unit is an episode, not a fact. It needs three parts, because each fails alone:

| Field | Question it answers | Failure it prevents |
| --- | --- | --- |
| `title` | What is the rule, in one imperative line? | A lesson nobody can act on |
| `trigger` | How do I recognise the moment it applies? | A correct lesson that never fires |
| `body` | What happened, what it cost, what to do instead? | Re-litigating the same argument |

Example:

```
title:    Never promise a privacy property before checking where the text goes
trigger:  about to say "X never leaves the machine" / "that data stays local"
body:     2026-11-23. Claimed memory bodies would never leave the machine while
          designing longmem, in the same message that proposed sending embeddings
          out. Embedding = sending the text to the provider. Andy caught it.
          Cost: a design decision built on a false premise, one round of rework.
          Do instead: trace the data path to the actual API call before stating a
          privacy property; if a component is remote, say what it sees.
```

A lesson without a `trigger` is a platitude. "Be careful", "verify before claiming",
"communicate clearly" are rejected at write time — they are not recognisable situations,
and the agent performs them instead of doing them.

## 3. Goals and non-goals

Goals:

1. No practical ceiling on stored experience.
2. A bounded, fixed-size session-start payload.
3. Entries that fire mid-task, not just at boot.
4. Human-editable: Andy must be able to open a table and fix a bad entry, because a wrong
   lesson is worse than no lesson.
5. Works for any agent that can make an HTTP call; OpenCode first.
6. Zero local compute, free tier only.

Non-goals:

- Auto-ingesting chat transcripts or session logs wholesale.
- Being a general knowledge base for docs, PDFs, or code.
- Replacing the journal (narrative, append-only) or the small blocks (always-true rules).
- Multi-user or sharing.
- Vector/semantic search in v0 (see §11).

Anti-goals — each means the design failed even if the code runs:

- **Platitude accumulation.** Entries with no trigger, no episode, no checkable behaviour.
  They make the agent worse: it performs diligence instead of being diligent.
- **A complaint log.** An entry that records "Andy was annoyed" without a correction is
  noise. Every entry must change a behaviour.
- **Payload growth with corpus size.** That is the 5,000-char ceiling again.
- **Lessons about the person scattered per repo**, so each project relearns the same thing.
- **Capture that depends on discipline.** If writing requires remembering to write, it
  stops in week two.

## 4. Constraints

- Free tier only: Supabase free plan.
- No local compute, no local database.
- Session start requires network; it must fail silently and degrade to the existing blocks.
- The content is personal: hiring context, compensation floors, judgement about people.
  It must not be public, and it should not leave Supabase (see §11).
- Work happens in short evening sessions; v0 must be useful before it is complete.
- Andy will also work with other agents; the write and read contracts must not be
  OpenCode-specific even if the first client is.

## 5. Approaches considered

**A. Supabase + Edge Function + Studio (chosen).** Postgres as the store, one Edge
Function as the only API, Supabase Studio as the free browsing and editing UI. Chosen
because the missing piece that hurts most is a place to *read and correct* the memory:
a wrong lesson must be fixable in seconds, and Studio gives that for free. Writing a UI
would have doubled the scope.

**B. Cloudflare (D1 + Workers).** No pause risk and no vendor that idles. Rejected as the
starting point: no free data UI, so the correction path becomes a second project. Stays
viable as a fallback if Supabase's pausing annoys in practice.

**C. Hugging Face Space, all-in-one.** FastAPI + SQLite on a Space. Rejected: ephemeral
disk, sleeping containers, cold starts on a path that runs at every session start.

**D. Fully local (SQLite + local embeddings).** Rejected by explicit constraint: no local
resource use.

Superseded by events: the first draft pinned `BAAI/bge-m3` on the Hugging Face free tier.
HF removed free Inference Providers credits on 2026-10-15 ("Free Users: None"), so that
premise is gone. The replacement considered was Gemini's embedding models; §11 explains
why v0 drops embeddings entirely instead of migrating them.

## 6. Architecture

```
  agent session (OpenCode today, others later)
        │
        ├─ start:  hook (not the model) ──► GET  /index    titles + triggers, active
        │                                   appended to the system prompt
        ├─ mid-task: longmem lessons "…" ──► GET  /related  trigger-matched entries
        ├─ decide: longmem recall "…"    ──► POST /recall   keyword search, bodies
        └─ end:    longmem candidates    ──► proposes entries; nothing written unconfirmed
                                                 │
                                    Supabase Edge Function (Deno)
                                                 │
                                    Postgres + Studio (free tier)
```

Client config at `~/.config/opencode/longmem.json`, mode 0600:
`{ "endpoint": "https://<ref>.supabase.co/functions/v1/longmem", "token": "<32B random>" }`.
`token` is also a Supabase secret; the client never holds an anon key.

`project_key` comes from the normalised git `origin` remote
(`github.com/admin/my-porfolio`), falling back to the absolute path when there is no
remote — the same derivation `opencode-supermemory` uses, so a future migration stays open.

Other agents get their own config file and the same two calls. Only the config path is
agent-specific.

## 7. Data model

```sql
create extension if not exists pg_trgm;
create extension if not exists unaccent;

create table public.memories (
  id                 uuid primary key default gen_random_uuid(),
  scope              text not null check (scope in ('global','project')),
  project_key        text,
  kind               text not null check (kind in
                       ('lesson','mistake','misunderstanding','preference','fact')),
  title              text not null check (char_length(title) <= 120),
  trigger            text not null check (char_length(trigger) <= 200),
  body               text not null,
  tags               text[] not null default '{}',
  status             text not null default 'active'
                       check (status in ('active','superseded','archived')),
  superseded_by      uuid references public.memories(id),
  pinned             boolean not null default false,
  sensitive          boolean not null default false,
  source             text,   -- 'opencode:<session>' | 'claude-code' | 'manual' | ...
  agent_session      text,
  reinforced_count   integer not null default 0,
  last_reinforced_at timestamptz,
  recall_count       integer not null default 0,
  last_recalled_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_text        text generated always as (lower(unaccent(title || ' ' || trigger || ' ' || body))) stored,
  embedding          vector(768),
  constraint scope_project_key check (
    (scope = 'global' and project_key is null) or
    (scope = 'project' and project_key is not null)
  )
);

create index memories_scope_idx on public.memories (scope, project_key, status);
create index memories_tags_idx  on public.memories using gin (tags);
create index memories_trgm_idx  on public.memories using gin (search_text gin_trgm_ops);
```

Notes:

- `trigger` is the field that makes the store different from a notes app. It is rendered
  in the index, so the agent can pattern-match during work.
- `embedding` exists as `vector(768)` for a future v2 and is never written in v0. Left in
  place so enabling semantic search later is not a migration.
- `search_text` uses `unaccent` + `lower` so Vietnamese is findable with and without tone
  marks. Postgres rejects `unaccent` in a generated column (not immutable), so this is a
  trigger-maintained column, not a generated one. Detail, not a design question.
- `reinforced_count` rises when the same lesson recurs: it ranks entries that keep biting.

## 8. Read paths

**Session start — `GET /index`.** No search, no guessing. Returns active `global` entries
plus active entries for the caller's `project_key`, ordered:
`pinned desc, reinforced_count desc, kind priority (preference, lesson, mistake,
misunderstanding, fact), updated_at desc`.

**The invariant is bytes, not rows**: default 8 KB for the rendered block, configurable.
Row count is whatever fits (~50–70 entries at 120 + 200 chars). Rendering is
`title — trigger`. The response carries `truncated: true, total: N` when clipped, so the
agent knows there is more and can call `/related` instead of assuming the list is complete.

This path is the fix for "it should already know this": it does not depend on the agent
inventing the right query. It sees the catalogue and pulls what it needs.

**Mid-task — `GET /related?context=…`.** Given a free-text description of what the agent
is about to do ("about to add an index to Postgres", "about to claim a deployment is
done"), return the 5 active entries whose `trigger` has the highest trigram similarity plus
tag overlap, same scope filter. This is the path that makes lessons fire when they matter
rather than at boot. Keyword only, deliberately: it must be fast and it must not need a model.

**On demand — `POST /recall`.** Body: `{query, project_key, k?, kinds?, tags?}`. Trigram
similarity over `search_text` plus tag filter, hard filter `status='active'` and
`scope='global' or project_key=$1`. Returns up to `k` bodies (default 5), each with
`replaces: {id, title, created_at}` when the entry superseded an earlier one — one hop
back, so "we used to do X, changed on Y" is answerable without dragging the graveyard in.
Bumps `recall_count` / `last_recalled_at`.

## 9. Write path

Three ways an entry appears, in order of how much it is trusted:

1. **Andy corrects the agent.** Strongest signal, and the cheapest capture: the correction
   already exists as text. The agent proposes an entry immediately and writes on confirm.
2. **Session end.** `longmem candidates` reviews the session's corrections and dead ends
   and proposes at most 3 entries. Nothing is inserted without confirmation.
3. **Manual.** Andy writes one himself in Studio or via CLI. This is the escape hatch and
   it must stay easy, or the store dies with the client.

Validation at write time, enforced server-side and by the CLI:

- `trigger` is required and must describe a recognisable situation, not a mood. Reject
  "when being careful" and accept "before claiming a deploy succeeded".
- The body must contain what happened and what to do instead. "Andy was unhappy" alone is
  rejected.
- Default `scope` is **global** — this is the flip from the first draft. Experience about
  how to work with Andy is global by default; a lesson about one codebase is `project`
  with an explicit `--project` flag. Getting this backwards scatters the person's lessons
  across repos.
- Dedupe: if an active entry in the same scope has title trigram similarity > 0.7, do not
  insert. Reinforce the existing one (`reinforced_count += 1`, `last_reinforced_at = now()`)
  or supersede it. Repeated lessons are the system working, not an error.
- Supersede, never delete: a wrong lesson must remain visible as wrong, or the same
  mistake gets re-argued from scratch.

Endpoints: `POST /write`, `POST /reinforce`, `POST /update` (same claim, clearer wording;
sets nothing else), `POST /supersede` (`replaces: <id>`, bypasses dedupe by design — it is a
distinct path, not a collision), `POST /promote`, `GET /health`.

## 10. Scope rules

| Entry | Scope |
| --- | --- |
| How to work with Andy — intent, tone, verification habits, what angered him | `global` |
| A mistake made while working on one codebase, with that codebase's detail | `project` |
| A rule that emerged in one repo but is general ("don't claim done without running it") | `global` |
| Unsure | `global`, unless it names a file, service, or repo |

The write path warns when a new `project` entry's title is > 0.7 similar to an existing
entry in a *different* project — that is evidence the lesson was never project-specific.

## 11. Why v0 has no embeddings

No model is needed, because the agent is the semantic layer. `/index` hands it 8 KB of
`title — trigger` lines; the agent reads them and decides what to load. It already
understands negation, proper nouns, and mixed Vietnamese/English — all three of which
embedding similarity handles badly. `/related` is keyword-only on purpose.

This removes, in one decision: a second vendor, an API key, a free-tier quota, an async
embedding queue, a re-embed backfill job, and a class of silent wrongness where the
nearest vector is confidently irrelevant.

Accepted boundary: this works to roughly **500–1,000 entries**. Past that, the index no
longer fits the byte budget and agent-side selection degrades. That is when embeddings
earn their complexity — with `embedding` and `search_text` already in schema, adding them
is a backfill, not a redesign.

Data path consequence: nothing leaves Supabase. Content goes in, rendered lines come out,
no third party sees either.

## 12. Privacy and auth

- Edge Function requires `Authorization: Bearer <token>`, constant-time compare.
- Service role key lives only in the function environment; the table has RLS on with no
  policy for `anon` or `authenticated`.
- Studio is the owner's account only.
- `sensitive = true` records a decision to keep an entry out of any future external call
  (embeddings in v2, exports); in v0 there is no external call to gate.

Known and accepted: Supabase sees plaintext. This is a single-person private store, not a
vault.

## 13. Supabase operational notes

- Keep-alive: GitHub Actions cron daily, `GET /health` doing `select 1`. Free projects
  pause after 7 days of low activity; daily gives a week of buffer.
- `vector(768)` typed now to match the likely v2 model; changing dimension later is a
  column rewrite, so the choice is pinned deliberately rather than left open.
- Studio edits do not go through the app, so a trigger maintains `search_text` and sets
  `updated_at` on any row edit. Without it, an edited entry stops being findable.

## 14. Client integration

**The index is injected, not fetched.** Andy's requirement is explicit: the agent must not
be able to *decide* to skip the memory. So v0 ships an OpenCode plugin hook, and the CLI
exists for the things a hook cannot do.

v0 — plugin hook plus CLI:

- `session.created` hook fetches `GET /index` and appends the block to the system prompt.
  Two implementation paths, in order: mutate the system prompt through the plugin's chat
  hook if the current OpenCode version exposes one; otherwise the hook refreshes a
  generated `~/.config/opencode/LONGMEM-INDEX.md`, and a two-line unconditional rule in
  `AGENTS.md` says it is the first thing to read every session. The second path is weaker
  in theory and near-equivalent in practice, and it survives OpenCode API changes.
- Hook failure is silent: no index, session proceeds. The existing blocks remain the
  offline floor.
- CLI for what a hook cannot do: `longmem lessons "<what I'm about to do>"` (mid-task),
  `recall`, `write`, `reinforce`, `supersede`, `promote`, `candidates`, `render-block`,
  `status`.
- AGENTS.md, ~8 lines: the index is already loaded, do not re-fetch it; run `lessons`
  before non-trivial work; after being corrected, propose an entry; never write a
  platitude; never write a chat summary.

v1 — once v0 is running:

- A hook on the `/compact` boundary that surfaces one candidate: the correction most
  likely to repeat. Never a silent insert.
- Adapters for other agents. The contract is two HTTP calls and a config file, so this is
  glue, not design.
- `related` called automatically when the hook sees a new task boundary, if manual
  `lessons` usage proves it is being forgotten.

## 15. Migration of what exists

1. Global `human` block → `preference` entries (language, scope rules, budget tier, job
   constraints). Keep the block under ~2 KB as a cache of the highest-frequency rules,
   regenerated by `longmem render-block` from `pinned` entries — never hand-edited, so it
   cannot drift silently.
2. Each project block (portfolio first, it is 95% full) → `project` entries, then shrink
   to a pointer plus the two or three rules that must survive an offline session.
3. Seed from this conversation, as the first real test: the privacy claim corrected in
   §2's example, and the "5000 chars is not enough" premise that started the project.
4. Leave the journal alone. It is narrative history; longmem is the index into lessons.
5. Disable `opencode-supermemory` explicitly. A plugin that is listed but unauthenticated
   is a trap for future me.

## 16. What is left to the builder

- CLI flag surface and output formatting; the exact markdown shape of the injected block.
- Deno module layout inside the Edge Function.
- Whether `/related` should also return the one-hop `replaces` chain, or only active rows.
- How `candidates` collects "dead ends" from a session without reading the whole transcript.
- Test strategy: pure functions for trigram matching and block rendering are obvious; the
  question is whether to test against a local Postgres or a mocked DB layer.
- Whether `render-block` should be a CLI command or an endpoint.

## 17. Effort

- v0 (schema, function, CLI, plugin hook, migration of the portfolio block, seeding): 3.5
  evenings. The hook is the half evening that makes the rest worth having.
- v1 (compact-boundary candidate, one more agent adapter): +2 evenings.

## 18. Decisions log for this doc

Calls made here rather than in conversation, listed so they can be overruled:

- English for repo docs and code; Vietnamese for discussion.
- Separate repo (`longmem`), not a folder in the portfolio.
- Default scope is `global` for experiential entries — a reversal of the first draft.
- `trigger` is a required column, not optional metadata.
- No embeddings in v0; the agent is the retriever.
- Byte budget (8 KB) is the invariant; row count is derived.
- The index is injected by a hook in v0, not fetched by the agent on its own initiative.
- Auto-capture never inserts without confirmation, even though it is the most tempting
  shortcut for adoption.
