# longmem list/audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audit command that lists every entry with scope/tag/status filters, then pin and promote the entries Andy approved.

**Architecture:** A new Postgres RPC `longmem_list` returns rows across all scopes/statuses; the existing Deno edge function exposes it as `GET /list`; a new CLI command `longmem list` formats the response. No schema change beyond the function. The data fixes are SQL updates applied after deployment.

**Tech Stack:** Postgres 17 (SQL function), Supabase Edge Functions (Deno), Node 22 + tsx CLI, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-longmem-design.md` (§7–§10), plus the approved audit proposal in this session.

**Execution:** Native, per the standing hybrid agreement (Tasks 1–10 were native; this is the same coupled core).

## Global Constraints

- Repo content in English; chat replies in Vietnamese.
- Every write path must reject platitudes and keep `sensitive` entries out of the injected index; this plan adds a read path only.
- Index cap remains 8 KB bytes; `longmem list` does not touch `/index`.
- Migrations are files in `supabase/migrations/`, applied with `supabase db push --remote --yes`.
- Verify assertions live in `supabase/verify/0001_verify.sql`; every result row must start `ok`.
- `supabase db query --remote` is the only working SQL path (direct host is IPv6-only).

## Review Focus

- `--status all` must include `superseded` and `archived` rows — the whole point of an audit. Pin: verify assertion 15 inserts one row of each status and asserts `longmem_list` returns all three.
- `--scope project` with no `--project` must list across every project, not silently filter to the current repo's project key. Pin: live smoke asserts the response includes at least two distinct `project_key` values.
- `--project` must match the exact key, not a substring. Pin: live smoke with `--project github.com/andy-pham-it/andy-porfolio` returns only rows with that exact key.
- Sensitive entries must appear in `list` (it is an explicit human audit) but be visibly marked. Pin: `formatListRow` test asserts a `sensitive: true` row renders `SENSITIVE`.
- `limit` must be clamped 1–500 so an audit cannot dump unbounded data. Pin: formatter test plus live smoke with `--limit 999` returns at most 500 rows.

---

### Task 1: `longmem_list` RPC and verify assertion

**Files:**
- Create: `supabase/migrations/0006_list_audit.sql`
- Modify: `supabase/verify/0001_verify.sql`

**Interfaces:**
- Consumes: `public.memories` columns from migration 0001–0005.
- Produces: `public.longmem_list(p_scope text default null, p_project_key text default null, p_kind text default null, p_tag text default null, p_status text default null, p_limit integer default 100)` returns `id uuid, scope text, project_key text, kind text, title text, trigger text, status text, pinned boolean, sensitive boolean, reinforced_count integer, recall_count integer, created_at timestamptz, updated_at timestamptz`.

- [ ] **Step 1: Write the failing verify assertion**

Add to `supabase/verify/0001_verify.sql` as assertion 15, before the cleanup `delete`: insert three rows with `status` `active`, `superseded`, `archived`, then assert `longmem_list(null, null, null, null, 'all', 100)` returns all three titles. Add the three titles to the cleanup list.

- [ ] **Step 2: Run verify to see it fail**

Run: `supabase db query --remote --read-only -f supabase/verify/0001_verify.sql`
Expected: row 15 reads `FAIL: function longmem_list(...) does not exist`.

- [ ] **Step 3: Implement the RPC in `supabase/migrations/0006_list_audit.sql`**

`language sql stable security definer set search_path = public`. NULL parameter means "no filter"; `p_status='all'` means no status filter; `p_tag` uses `p_tag = any(tags)`; order `pinned desc, updated_at desc`; `limit greatest(1, least(p_limit, 500))`.

- [ ] **Step 4: Apply the migration and re-run verify**

Run: `supabase db push --remote --yes` then the verify query.
Expected: all rows read `ok`, including assertion 15.

- [ ] **Step 5: Commit**

`git add supabase/migrations/0006_list_audit.sql supabase/verify/0001_verify.sql && git commit -m "feat: list rpc with scope, tag and status filters"`

### Task 2: `/list` route, CLI command and formatter test

**Files:**
- Modify: `supabase/functions/longmem/index.ts`, `src/cli.ts`
- Create: `src/commands/list.ts`, `test/list.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `public.longmem_list(...)` from Task 1; `Ctx`, `flagString`, `flagBool`, `flagNumber`, `request` from the existing CLI.
- Produces: `GET /list?scope=&project_key=&kind=&tag=&status=&limit=` → `{ entries: ListRow[], total: number }`; CLI `longmem list [--scope all|global|project] [--project KEY] [--kind K] [--tag T] [--status all|active|superseded|archived] [--limit N] [--json]`; `formatListRow(row: ListRow): string`.

- [ ] **Step 1: Write the failing formatter test**

`test/list.test.ts` — two tests: a global active row renders `[global] [active]` and its title; a project sensitive row renders `SENSITIVE` and its project key. Import `formatListRow` from `../src/commands/list.ts`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/list.test.ts`
Expected: FAIL with `Cannot find module '../src/commands/list.ts'`.

- [ ] **Step 3: Implement the edge route**

Add `list` to `RouteName` and `resolveRoute`, then `handleList(url: URL): Promise<Response>` calling `db.rpc("longmem_list", {...})` with query params mapped as above; route it in the handler switch alongside `index`. No new auth branch — the existing auth check covers it.

- [ ] **Step 4: Implement `formatListRow` and the CLI command in `src/commands/list.ts`**

`formatListRow(row: ListRow): string` — one line: short id, `[scope]`, `[status]`, `[kind]`, title, `KEY=<project_key>` when present, `PINNED` and `SENSITIVE` flags, `r=<reinforced_count> c=<recall_count>`. `run(ctx)` calls `/list`, prints one line per entry and a trailing `total`, or raw JSON with `--json`.

- [ ] **Step 5: Register the command in `src/cli.ts`**

Import `listCmd`, add `list: listCmd.run` to `COMMANDS`, and add one help line.

- [ ] **Step 6: Run the test and the whole suite**

Run: `npx vitest run test/list.test.ts` then `npx vitest run` and `npx tsc --noEmit`.
Expected: 2 new tests pass; full suite green; typecheck clean.

- [ ] **Step 7: Document and commit**

Add one `longmem list` row to the README command table and a short "Auditing entries" paragraph. Commit: `git commit -m "feat: list command for auditing entries"`

### Task 3: Deploy, data fixes, live smoke

**Files:** none (data + deployed function).

**Interfaces:**
- Consumes: `longmem_list` RPC, `GET /list`, `longmem list` from Tasks 1–2.

- [ ] **Step 1: Deploy the function**

Run: `supabase functions deploy longmem --project-ref tzperbqwgsufufmheezn --yes`
Expected: deployed.

- [ ] **Step 2: Pin the two approved 6zb entries**

Run: `supabase db query --remote "update public.memories set pinned = true where title in ('Verify the image, not the branch, when a reverted route still misbehaves', 'Diff running containers against the compose file before debugging a 500');"`
Expected: `UPDATE 2`.

- [ ] **Step 3: Promote "6ZB is staging/UAT" to global**

Run: `supabase db query --remote "update public.memories set scope='global', project_key=null where title = '6ZB is staging/UAT, never launched or in production';"`
Expected: `UPDATE 1` (the check constraint requires `project_key is null` when scope is global).

- [ ] **Step 4: Smoke the four Review Focus cases**

Run `longmem list --status all`, `longmem list --scope project`, `longmem list --project github.com/andy-pham-it/andy-porfolio`, `longmem list --limit 999`.
Expected: superseded/archived appear with `--status all`; `--scope project` shows ≥2 project keys; `--project` shows only that exact key; `--limit 999` returns ≤500 rows.

- [ ] **Step 5: Re-check the injected index and commit nothing**

Run `longmem status`.
Expected: health ok; index bytes still under 8192; the promoted 6ZB entry now appears in the global index.

- [ ] **Step 6: Push**

Run: `git push origin main`.
Expected: remote updated.
