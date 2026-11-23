# longmem v1 — hybrid recall without an external model

**Date:** 2026-11-24
**Status:** draft, awaiting approval
**Supersedes:** §11 of `2026-11-23-longmem-design.md` (which deferred all semantic search to "v2 = embeddings").
**Spec:** `docs/superpowers/specs/2026-11-23-longmem-design.md` (v0) remains the authority for everything not restated here.

## 1. Why v1 exists

v0 recall is trigram similarity over `search_text` (title + trigger + body). That misses
the case where the query and the entry share no surface words but describe the same
situation — "đổi host" vs "IPv6-only database host", or a Vietnamese query against an
English entry. The agent already reads the 8 KB index, so this only bites on entries that
fell out of the index, which is exactly when `/recall` is used.

v0's answer was "embeddings, later." Two things changed that:

- Embeddings cost a vendor, a key, a quota, a 429 retry path, and a privacy leak on every
  write. For a single-person tool that is a lot of moving parts for a benefit that only
  shows up past ~200 entries.
- Postgres already has full-text search (`tsvector`/`tsquery`) that is good enough for
  recall at this scale, runs inside the database, and leaks nothing.

So v1 is **better recall using only what is already in Supabase.** No model, no key, no
external call. The `embedding` column stays in schema, unused, so a future v2 with real
embeddings is still a backfill.

## 2. What changes

| Surface | v0 | v1 |
|---|---|---|
| `/recall` scoring | trigram over `search_text` | FTS rank + trigram, combined, with `reinforced_count` and `pinned` boosts |
| `/related` scoring | trigram over trigger only | FTS over trigger + trigram over trigger |
| `/index` | unchanged | unchanged — agent is still the semantic layer |
| Schema | `search_text` (trigger-maintained) | adds `search_vector tsvector` (trigger-maintained) + GIN index |
| External calls | none | none |

Nothing leaves Supabase. `sensitive` keeps its v0 meaning (no external call to gate); with
v1 there is still no external call, so the flag's second half — "keep out of exports" —
remains the only live one.

## 3. Data model change

Add one column and one index, in migration `0004_fts_recall.sql`:

```sql
alter table public.memories add column search_vector tsvector not null default '';
create index memories_search_vector_idx on public.memories using gin (search_vector);

-- Backfill existing rows.
update public.memories
set search_vector = to_tsvector('simple', public.unaccent(coalesce(title,'') || ' ' || coalesce(trigger,'') || ' ' || coalesce(body,'')));
```

The touch trigger (`memories_touch`) gains one line:

```sql
new.search_vector := to_tsvector('simple',
  public.unaccent(coalesce(new.title,'') || ' ' || coalesce(new.trigger,'') || ' ' || coalesce(new.body,'')));
```

`'simple'` config is chosen over `'english'`/`'vietnamese'`: it does no stemming, which is
what we want for mixed-language, proper-noun-heavy text. `unaccent` folds Vietnamese tone
marks so a query typed without tones still matches.

`search_text` stays: trigram similarity needs it. The two columns serve different scorers.

## 4. Scoring

`longmem_search` returns a `score real` in [0, 1]. v1 combines:

```
score =
  0.5 * ts_rank(search_vector, plainto_tsquery('simple', unaccent(query)))   -- meaning
+ 0.3 * similarity(search_text, unaccent(query))                              -- fuzzy words
+ 0.1 * least(reinforced_count, 5) / 5                                       -- keeps biting
+ (pinned ? 0.1 : 0)
```

Weights are a starting guess, not a tuned model. They are constants in the SQL function,
documented here, and adjustable without a migration (just `create or replace function`).

`/related` (p_by='related') scores trigger only, so its FTS term uses `to_tsvector('simple', unaccent(trigger))` instead of the full `search_vector`. This keeps a situation query from being drowned by body text.

Results ordered by `score desc, reinforced_count desc, updated_at desc`, `limit greatest(1, least(p_k, 50))`. A row whose FTS rank and trigram are both ~0 still appears at the bottom rather than disappearing — recall should be forgiving, and the agent can ignore low scores.

## 5. Sensitive handling (unchanged)

`/recall` is explicit and human-initiated, so it returns sensitive rows (as in v0).
`/related` is agent-pushed, so it excludes them (as in v0, via the `p_by <> 'related' or m.sensitive = false` clause from migration 0003). No change.

## 6. Migration of existing rows

Migration 0004 backfills `search_vector` for all rows (see §3). Existing entries get
vectors on the next deploy; no CLI command needed. `longmem embed` is not added — there
is nothing to embed.

## 7. Effort

One evening: migration + trigger update + `longmem_search` rewrite + verify assertions +
deploy + smoke. No client, CLI, or plugin changes — the response shape is identical.

## 8. Decisions log (additions to v0 §18)

- **No external model in v1.** Postgres FTS + trigram covers the recall gap at this scale.
  Embeddings deferred until ≥200 entries and ≥3 measured recall misses in a month.
- **`'simple'` config, not `'english'`/`'vietnamese'`.** No stemmer is safe for mixed
  language and proper nouns; unaccent + trigram handle the rest.
- **`search_text` kept alongside `search_vector`.** Different scorers need different shapes.
- **`sensitive` still has no embedding to gate.** Its only live meaning remains "keep out
  of exports"; the external-call half stays dormant until v2.
- **Scoring weights are constants, not learned.** Tunable by editing the function.

## 9. What is NOT in v1

- No embeddings, no vector column writes, no embedding provider, no key.
- No change to `/index`, the 8 KB budget, or the plugin.
- No new CLI command.
- No change to sensitive semantics.
