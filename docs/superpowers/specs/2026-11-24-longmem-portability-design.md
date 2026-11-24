# longmem portability — run the same memory on SQLite, Postgres, Neon or Supabase

**Date:** 2026-11-24
**Status:** draft, awaiting approval
**Approach:** A — shared TypeScript core + thin store adapters (approved in conversation)

## 1. Intent and why

The package currently works only against one Supabase project. The CLI and the OpenCode
plugin both speak HTTP to a single Deno Edge Function; that function calls ten Postgres
RPCs that own validation, dedupe, scoring, supersede and the byte budget. A user who
wants the same tool offline, on a self-hosted server, or on Neon cannot use it without
standing up a Supabase project.

The goal is **portability, not replication**. One deployment picks one backend. Nothing
syncs between backends; a user who chooses SQLite keeps their memory in a local file, and
a user who chooses Neon keeps it in Neon. This matches the existing design rule that the
agent reads one memory source at session start.

## 2. Goals / non-goals / anti-goals

**Goals**
- Same observable behaviour on four backends: SQLite (local), self-hosted Postgres, Neon, and the existing Supabase project.
- The user picks the backend at setup; changing it is a deliberate migration, not a config toggle with silent data loss.
- CLI and OpenCode plugin work in both local and cloud deployment.
- One behaviour contract, tested against every backend.

**Non-goals**
- Sync, replication, offline merge, conflict resolution.
- Automatic data migration between backends (provide an export/import path, not magic).
- New memory features. v0/v1 semantics are frozen for this change.
- A web UI.

**Anti-goals**
- Two implementations of "what an entry means" drifting apart.
- Requiring a running server for local use.
- Requiring Supabase credentials for local use.

## 3. Constraints carried from the earlier specs

- Entry shape: `title` (≤120), `trigger` (required, ≤200), `body` (cost named), kinds `lesson|mistake|misunderstanding|preference|fact`.
- Default scope **global**; `project` only when a file/service/repo is named.
- Index budget **8192 bytes**, lines skipped whole, `truncated`/`total` in the response.
- Dedupe at trigram similarity > 0.7 → 409 `needs_decision`; supersede never deletes; `sensitive` never enters the injected index or `related`.
- v1 hybrid ranking: FTS + trigram + reinforced + pinned, with `p_by='related'` scoring trigger only.
- Core must be importable from Deno (Edge Function) and Node (CLI/plugin): Web-standard APIs only, no `node:` imports in `src/core/`.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A** | Move logic to a pure TypeScript core; stores do persistence only | One behaviour everywhere, contract-testable; costs a rewrite of the SQL RPCs |
| B | Keep logic in SQL, write a second dialect for SQLite | Less client refactoring, but FTS5 ≠ tsvector, no pg_trgm/advisory lock; two implementations drift |
| C | Local proxy speaking the existing HTTP API | Cheapest, but "cloud" stays tied to Supabase and self-hosted Postgres still needs a server — not portability |

**Picked A.** B fails the anti-goal (one meaning of an entry), C fails the goal (four real backends).

## 5. Architecture

```
CLI / plugin
    │
    ├── createClient(config) ──▶ LocalTransport ──▶ core operations ──▶ SQLiteStore | PostgresStore
    │                                                    │
    └─────────────────────────▶ HttpTransport ──▶ Edge Function ──▶ core operations ──▶ PostgresStore
```

`src/core/` is pure TypeScript: validation, ranking, dedupe, byte-budget rendering, scope
rules, and the operations (`index`, `recall`, `related`, `write`, `reinforce`, `update`,
`supersede`, `promote`, `list`, `status`, `health`). It never imports a driver.

`src/stores/` holds drivers. Each store implements one interface and does no policy.

`src/transport/` holds the two ways to reach the core: direct (in-process) and HTTP.

### Config (discriminated union)

```ts
type Config =
  | { kind: "http"; endpoint: string; token: string }
  | { kind: "postgres"; databaseUrl: string }
  | { kind: "sqlite"; path: string };
```

Legacy configs with `endpoint` + `token` and no `kind` are read as `http`. The 0600 file
permission rule applies to all three (a connection string is a credential too).

### Deployment modes

- **Local:** CLI/plugin load config → `LocalTransport` → core → SQLite or Postgres store. No server process.
- **Cloud/server:** Edge Function receives HTTP with bearer token → core → Postgres store. Supabase, self-hosted Postgres and Neon all use this path.
- **Local server (optional):** the same Edge Function code can run on a machine; not required for SQLite use.

The OpenCode plugin follows the same split: HTTP fetch in `http` mode; in local modes it
calls this repository's CLI (`npx tsx <repo>/src/cli.ts index --json`) through
`execFileSync`, the same mechanism it already uses to read a git remote. This keeps the
installed plugin standalone — no bundled `node_modules`, no build step, no local server —
which is the anti-goal "requiring a running server for local use". Local configs carry
`cliPath`. The plugin stays fail-silent in every mode.

## 6. Store interface

```ts
export type MemoryRow = {
  id: string;
  scope: "global" | "project";
  project_key: string | null;
  kind: string;
  title: string;
  trigger: string;
  body: string;
  tags: string[];
  status: "active" | "superseded" | "archived";
  superseded_by: string | null;
  pinned: boolean;
  sensitive: boolean;
  source: string | null;
  agent_session: string | null;
  reinforced_count: number;
  last_reinforced_at: string | null;
  recall_count: number;
  last_recalled_at: string | null;
  created_at: string;
  updated_at: string;
  replaces_id?: string | null;
  replaces_title?: string | null;
  replaces_created_at?: string | null;
};

export interface MemoryStore {
  readonly name: string;
  transaction<T>(fn: (tx: MemoryStore) => Promise<T>): Promise<T>;
  insert(input: NewMemoryRow): Promise<MemoryRow>;
  get(id: string): Promise<MemoryRow | null>;
  list(filter: ListFilter): Promise<MemoryRow[]>;
  update(id: string, patch: Partial<MemoryRow>): Promise<MemoryRow>;
  supersede(oldId: string, input: NewMemoryRow): Promise<MemoryRow>;
  /** The entry this row replaced, found by scanning `superseded_by` — no schema column added. */
  predecessorOf(id: string): Promise<MemoryRow | null>;
  counts(): Promise<Record<string, number>>;
  close(): Promise<void>;
}
```

`transaction` exists so the core can perform dedupe-then-insert and supersede atomically
on every backend, replacing Postgres advisory locks with a portable primitive.

`ListFilter`: `scope?`, `project_key?`, `kind?`, `tag?`, `status?` (`"all"` = no filter), `limit?`.

## 7. Core behaviour (moved, not reinvented)

- `validateEntry()` from `_shared/validate.ts` — platitudes rejected, trigger required, scope global by default.
- `renderIndex()` from `_shared/render.ts` — byte-accurate truncation at line boundaries.
- `normalize(text)` — `NFD` → strip combining marks → lowercase, applied to query and row fields. This is the portable replacement for `lower(unaccent(...))`; it is what lets a tone-less Vietnamese query match an accented entry on **every** backend, including SQLite.
- `score(query, row, by)` — v1 ranking in TypeScript with the frozen weights: `0.5 * tokenOverlap + 0.3 * trigram + 0.1 * min(reinforced,5)/5 + (pinned ? 0.1 : 0)`. Token overlap replaces `'simple'` FTS rank; it cannot reproduce `ts_rank` numerically, so the contract asserts **ordering and membership**, never exact scores. `by='related'` scores the trigger only.
- `dedupe(title, rows)` — trigram similarity > 0.7 returns the existing row.
- Supersede — insert new row, set old row `status='superseded'` and `superseded_by`, expose one-hop `replaces` on the new row.
- `sensitive` — excluded from `index` and `related`; visible in `list` and explicit `recall`.

Ranking over fetched candidate rows is acceptable at the documented ceiling (~500–1000
entries); past that, revisit with an index per backend. This is recorded as a known limit.

## 8. Backends

### SQLite (`better-sqlite3`)
- Single table mirroring `public.memories`, no RPCs, no RLS.
- Migration `src/stores/sqlite/migrations/0001_init.sql` with a `_longmem_migrations` ledger.
- FTS5 is **not** used: ranking is in core, so an FTS index would duplicate policy. File mode 0600 enforced.
- Driver choice is mine: `better-sqlite3` has prebuilds and a synchronous API; `node:sqlite` is still experimental in the installed Node 22 and lacks FTS5.

### Postgres (self-hosted + Neon)
- Apply migrations 0001–0006 (0006 adds `longmem_list`, which the live function still calls) with a slimmed 0001: drop the `vector` extension and the unused `embedding vector(768)` column; keep `pg_trgm` and `unaccent`, both standard on Postgres and Neon. The RPCs remain in the schema but the portable core no longer calls them; pruning is deferred.
- Driver: `postgres` npm package (works in Node and as `npm:postgres` in Deno, confirmed from Supabase Edge Functions docs).
- Migration runner `scripts/migrate-postgres.ts` applies SQL files in order using a `_longmem_migrations` ledger table, because `supabase db push` only works for linked Supabase projects.
- Neon needs SSL; connection string carries it. No Neon-specific code.

### Supabase (existing HTTP) — unchanged
- The deployed Edge Function keeps its SQL RPCs, bearer token and schema. No `DATABASE_URL` secret, no pooler choice, no role/RLS migration. Ruling: the live deployment is the only path with 20 passing SQL assertions and real data; rewriting it for uniformity would put the one working backend at risk for no user-visible gain.
- Cost: Supabase keeps a SQL implementation alongside the TS core. A semantic change must be applied in both places; the contract suite pins **observable** behaviour and the remote verify script pins the SQL side, so drift shows up as a failing test rather than a silent surprise.

## 9. Security

- `http`: bearer token, unchanged, constant-time comparison.
- `postgres`: connection string in the 0600 config file (CLI) or an Edge Function secret (cloud).
- `sqlite`: file permission 0600, no auth layer needed for a single local user.
- Nothing new leaves the user's chosen backend. No embeddings, no external model (v1 decision stands).

## 10. Testing

- Existing pure unit tests move with their functions into `test/core/` and keep their assertions.
- **Contract suite** `test/contract/store.test.ts` runs the same cases against SQLite and Postgres (env-gated) at the **store/core operation layer** — insert → dedupe conflict → reinforce → supersede one-hop `predecessorOf` → sensitive excluded from index → status/list filters → byte budget. HTTP error codes (400/409) and CLI exit code 2 stay pinned by the existing client/CLI tests.
- The **live HTTP run is read-only**: `status`, `index`, `list`, `recall`. It never writes into the production store. A disposable endpoint is deliberately not created; the remote verify suite already exercises writes against a real database.
- `npx tsc --noEmit` must pass for both Node and Deno import paths (separate tsconfig if needed).

## 11. Migration & compatibility

- Existing Supabase users: no change at all — no redeploy, no new secret, no data migration.
- New SQLite/Postgres users: apply their migration files; empty store.
- Cross-backend export/import: `longmem export` / `longmem import` are **not** in this scope; document a `SELECT`/`INSERT` recipe instead. A user switching backend starts empty unless they do it manually.

## 12. Effort

About **10–12 evenings**: core extraction 3, adapters 4, transport/plugin/CLI 2, contract tests 2, docs 1. This is a project, not a small change.

## 13. Decisions log (new)

- **A over B/C** — one meaning of an entry beats a smaller diff.
- **Ranking in TypeScript, not in SQL** — portable across FTS5/tsvector/no-FTS; documented ceiling ~500–1000 entries.
- **`better-sqlite3` over `node:sqlite`** — stable and prebuilt.
- **No local server for SQLite** — the installed plugin stays standalone and shells out to the repo CLI; cost is ~0.5 s at session start and a repo path in local config.
- **Do NOT rewrite the live Supabase function** — it stays the `http` backend with its RPCs. Cost: a second implementation to keep in step, caught by the contract suite plus remote verify.
- **`normalize()` in core, contract asserts order not exact scores** — `ts_rank` cannot be reproduced numerically by token overlap; the frozen weights and the forgiving-recall behaviour are what matter.
- **`predecessorOf()` instead of a new column** — one-hop `replaces` stays derived from `superseded_by` on every backend. Cost: one extra read on supersede results.
- **Slimmed portable migrations 0001–0006** — no pgvector/embedding on plain Postgres and Neon; `pg_trgm` + `unaccent` are required.
- **Live HTTP contract run is read-only** — never write into Andy's real memory store.
- **No sync, no auto-migration** — user chooses one backend.
- **FTS5 not used in SQLite** — avoids duplicating ranking policy.

## 14. Left to the builder

Order of work: core extraction → SQLite store + contract suite → Postgres store (self-hosted/Neon) → HTTP transport (unchanged server) → CLI/plugin config union → docs. Each step stays testable; no step should wait for a live backend except the optional live HTTP contract run.
