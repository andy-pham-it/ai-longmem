# longmem portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one longmem deployment run on SQLite, self-hosted Postgres, Neon, or the existing Supabase HTTP service, with identical observable behaviour and no sync between them.

**Architecture:** Move all policy (validation, normalize/score/dedupe, byte-budget rendering, supersede) out of SQL into a pure TypeScript core. Each backend gets a thin `MemoryStore` that only persists rows. The CLI and plugin get a `createClient(config)` that either calls the existing HTTP API or runs the core in-process. The deployed Supabase function is **not** rewritten.

**Tech Stack:** TypeScript (Node 22 + Deno-compatible core), vitest, `better-sqlite3`, `postgres` npm, existing Supabase Edge Function (unchanged), `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-11-24-longmem-portability-design.md` (read it alongside this plan).

## Global Constraints

- Core must be importable from Deno and Node: **Web-standard APIs only, no `node:` imports in `src/core/`**.
- Entry shape: `title` ≤120, `trigger` required ≤200, body names the cost; kinds `lesson|mistake|misunderstanding|preference|fact`.
- Default scope `global`; `project` only when a file/service/repo is named.
- Index budget **8192 bytes**, lines skipped whole, `truncated`/`total` in every index result.
- Dedupe at trigram similarity **> 0.7** → `needs_decision`, never a silent second copy.
- Supersede never deletes; one-hop `replaces` reachable through `predecessorOf`.
- `sensitive` excluded from `index` and `related`; visible in `list` and explicit `recall`.
- Frozen v1 weights: `0.5 * tokenOverlap + 0.3 * trigram + 0.1 * min(reinforced,5)/5 + (pinned ? 0.1 : 0)`.
- Config file stays 0600 for every kind; connection strings are credentials.
- No sync, no automatic cross-backend migration, no new memory features.
- `npm` on PATH is the broken shim — verify with `npx tsc --noEmit` and `npx vitest run` only.

## Review Focus

1. **Vietnamese tone-less query against an accented entry.** A query "docker host khong the ket noi" must still rank the entry "Không thể kết nối database host" first on SQLite, Postgres and HTTP. Pin: `test/core/normalize.test.ts` asserts `normalize("Đổi Host") === "doi host"` and `normalize` strips combining marks; `test/contract/store.test.ts` asserts the accented/tone-less pair ranks in that order on every store.
2. **Local use must not require a server or Supabase credentials.** A fresh SQLite config with only a file path must run every CLI command with no endpoint, token or daemon. Pin: `test/contract/sqlite.test.ts` constructs the client from `{kind:"sqlite",path}` and runs `write` → `index` → `recall` with no HTTP stub.
3. **Tests must never write into the live memory store.** The HTTP leg of verification is read-only. Pin: `test/contract/http.test.ts` calls only `status`, `index`, `list`, `recall` and asserts no write method is invoked (spy on `fetch` for POST).
4. **Dedupe conflict semantics identical on every backend.** A second insert with similarity > 0.7 returns `needs_decision` with the existing row; an explicit `force` creates a second row. Pin: `test/contract/store.test.ts` inserts the same title twice (conflict, then forced) against SQLite and env-gated Postgres.
5. **The installed plugin stays standalone and fail-silent.** No bundled `node_modules`, no import of repo modules, no crash when local mode has no repo path. Pin: `test/plugin.test.ts` builds the plugin with a stub `PluginInput`, forces config errors, and asserts `experimental.chat.system.transform` returns `""` rather than throwing.

---

### Task 1: Pure text primitives

**Files:**
- Create: `src/core/normalize.ts`
- Test: `test/core/normalize.test.ts`
- Create: `src/core/types.ts` (only `MemoryRow`, `NewMemoryRow`, `ListFilter` — exact shapes from spec §6)

**Interfaces:**
- Consumes: nothing.
- Produces: `normalize(text: string): string`, `trigrams(text: string): string[]`, `trigramSimilarity(a: string, b: string): number`, `tokenOverlap(a: string, b: string): number`.
- Types: `NewMemoryRow` is the persisted shape (`scope`, `project_key`, `kind`, `title`, `trigger`, `body`, `tags`, `pinned`, `sensitive`, `source`, `agent_session`); `NewEntry = NewMemoryRow` plus `force?: boolean` and `replaces?: string`. `validateEntry` (Task 2) returns `NewMemoryRow`, never a request-only field.

- [ ] **Step 1: Write the failing test**

```ts
// test/core/normalize.test.ts
import { describe, expect, test } from "vitest";
import { normalize, tokenOverlap, trigramSimilarity, trigrams } from "../src/core/normalize.ts";

describe("normalize", () => {
  test("strips Vietnamese tone marks and lowercases", () => {
    expect(normalize("Đổi Host")).toBe("doi host");
  });
  test("trigrams of a short word are the padded word plus its bigrams", () => {
    expect(trigrams("cat")).toContain("  c");
    expect(trigrams("cat")).toContain("ca ");
  });
  test("identical normalized strings have similarity 1", () => {
    expect(trigramSimilarity("Database Host", "database host")).toBe(1);
  });
  test("token overlap is containment of the smaller token set", () => {
    expect(tokenOverlap("docker host", "docker host unreachable")).toBe(1);
    expect(tokenOverlap("mysql proxy", "docker host unreachable")).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/core/normalize.test.ts`
Expected: FAIL with "Cannot find module '../src/core/normalize.ts'" (or "no exported member").

- [ ] **Step 3: Implement the four functions in `src/core/normalize.ts`**

`normalize` uses `text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()` — no locale data, no ICU config, no `node:` import. `trigrams` pads with two leading spaces and one trailing space, returns three-character windows. `trigramSimilarity` uses normalized strings and symmetric set intersection / union. `tokenOverlap` splits normalized text on non-alphanumerics and returns `|intersection| / min(|a|, |b|)`, or 0 when either set is empty.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/core/normalize.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/normalize.ts src/core/types.ts test/core/normalize.test.ts
git commit -m "feat: portable normalize and trigram primitives"
```

---

### Task 2: Move validation and index rendering into the core

**Files:**
- Create: `src/core/validate.ts`, `src/core/render.ts`
- Modify: `supabase/functions/_shared/validate.ts`, `supabase/functions/_shared/render.ts` (replace bodies with re-exports from `../../../src/core/…`)
- Modify: `test/validate.test.ts`, `test/render.test.ts` (import from `../src/core/…`)
- Test: `test/core/render.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `validateEntry(entry: NewEntry): ValidatedEntry` and `renderIndex(rows: IndexRow[], maxBytes?: number): RenderedIndex` from `src/core/`. Existing `_shared` paths keep their current exports verbatim via re-export, so the live function is untouched.

- [ ] **Step 1: Write the failing test**

```ts
// test/core/render.test.ts
import { expect, test } from "vitest";
import { renderIndex } from "../src/core/render.ts";

test("a line that would exceed the byte budget is skipped whole", () => {
  const rows = [
    { id: "1", kind: "lesson", scope: "global", title: "Short", trigger: "short trigger", pinned: false, reinforced_count: 0, project_key: null },
    { id: "2", kind: "lesson", scope: "global", title: "X".repeat(100), trigger: "Y".repeat(100), pinned: false, reinforced_count: 0, project_key: null },
  ];
  const r = renderIndex(rows, 128);
  expect(r.block).toContain("Short");
  expect(r.block).not.toContain("X".repeat(100));
  expect(r.truncated).toBe(true);
  expect(r.total).toBe(2);
  expect(new TextEncoder().encode(r.block).length).toBeLessThanOrEqual(128);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/core/render.test.ts`
Expected: FAIL with "Cannot find module '../src/core/render.ts'".

- [ ] **Step 3: Move the implementations**

Copy `supabase/functions/_shared/validate.ts` and `render.ts` into `src/core/` unchanged except for the import of `normalize` where useful; replace each original file with a one-line `export * from "../../../src/core/validate.ts";` / `render.ts`. Update the two existing test files to import from core.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run test/core/render.test.ts test/validate.test.ts test/render.test.ts`
Expected: PASS, all three files.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`
Expected: clean (Deno resolves the explicit `.ts` re-export path; Bundler tsconfig already allows it).

```bash
git add src/core test/core test/validate.test.ts test/render.test.ts supabase/functions/_shared
git commit -m "refactor: core validation and index rendering"
```

---

### Task 3: MemoryStore interface and core operations

**Files:**
- Create: `src/stores/memory-store.ts`, `src/core/operations.ts`
- Test: `test/core/operations.test.ts`

**Interfaces:**
- Consumes: `src/core/types.ts`, `normalize`/`trigramSimilarity`/`tokenOverlap`, `validateEntry`, `renderIndex`.
- Produces:

```ts
export interface MemoryStore {
  readonly name: string;
  transaction<T>(fn: (tx: MemoryStore) => Promise<T>): Promise<T>;
  insert(input: NewMemoryRow): Promise<MemoryRow>;
  get(id: string): Promise<MemoryRow | null>;
  list(filter: ListFilter): Promise<MemoryRow[]>;
  update(id: string, patch: Partial<NewMemoryRow>): Promise<MemoryRow>;
  supersede(oldId: string, input: NewMemoryRow): Promise<MemoryRow>;
  predecessorOf(id: string): Promise<MemoryRow | null>;
  counts(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

export type Core = {
  index(projectKey: string | null, maxBytes?: number): Promise<RenderedIndex>;
  related(context: string): Promise<MemoryRow[]>;
  recall(query: string, opts?: { kinds?: string[]; tags?: string[]; limit?: number }): Promise<MemoryRow[]>;
  write(input: NewEntry): Promise<{ action: "created" | "reinforced" | "needs_decision"; entry?: MemoryRow; existing?: MemoryRow; similarity?: number; warning?: string }>;
  reinforce(id: string): Promise<MemoryRow>;
  update(id: string, patch: Partial<NewEntry>): Promise<MemoryRow>;
  supersede(oldId: string, input: NewEntry): Promise<MemoryRow>;
  promote(id: string): Promise<MemoryRow>;
  list(filter: ListFilter): Promise<{ entries: MemoryRow[]; total: number }>;
  status(): Promise<{ counts: Record<string, number> }>;
  health(): Promise<boolean>;
};

export function createCore(store: MemoryStore): Core;
```

Core owns: validation, global-by-default scope, cross-project similarity warning, dedupe >0.7 inside `store.transaction`, force bypass, one-hop `replaces` via `predecessorOf`, `sensitive` exclusion from `index`/`related` only, and `score(query,row,by)` with the frozen weights. Store owns filtering and persistence only.

- [ ] **Step 1: Write the failing test with an in-memory fake store**

```ts
// test/core/operations.test.ts — minimal fake store implementing MemoryStore
import { expect, test } from "vitest";
import { createCore } from "../src/core/operations.ts";
import { makeFakeStore } from "./fake-store.ts";

test("write rejects a near-duplicate with needs_decision, force creates it", async () => {
  const core = createCore(makeFakeStore());
  const input = { kind: "lesson", title: "Check the flag", trigger: "After adding a CLI flag", body: "The flag was dropped silently; the smoke test lied." };
  expect((await core.write(input)).action).toBe("created");
  const dup = await core.write({ ...input, title: "Check the flags" });
  expect(dup.action).toBe("needs_decision");
  expect(dup.similarity).toBeGreaterThan(0.7);
  expect((await core.write({ ...input, title: "Check the flags", force: true })).action).toBe("created");
});

test("sensitive entries stay out of index and related but are recallable explicitly", async () => {
  const store = makeFakeStore();
  const core = createCore(store);
  await core.write({ kind: "fact", title: "SIT credential", trigger: "Logging into SIT admin", body: "Credentials live in the vault, rotate quarterly.", sensitive: true });
  expect((await core.index(null)).total).toBe(0);
  expect(await core.related("Logging into SIT admin")).toEqual([]);
  expect((await core.recall("SIT credential")).length).toBe(1);
});
```

`test/core/fake-store.ts` is a deterministic in-memory `MemoryStore` used only by tests; it lives in test utilities, not production code.

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/core/operations.test.ts`
Expected: FAIL with "Cannot find module '../src/core/operations.ts'".

- [ ] **Step 3: Implement `createCore(store: MemoryStore): Core` in `src/core/operations.ts`**

Use `store.transaction` for write/supersede. `recall` and `related` fetch up to 500 candidate rows from the store, score in TS, sort by `score desc, reinforced_count desc, updated_at desc`, then slice to `limit ?? 5`. `index` calls `store.list({ scope: "all", status: "active", limit: 500 })` then `renderIndex`. `write` on similarity >0.7 and no `force` returns `needs_decision` with the existing row. All errors are returned as data (`{ok:false}`/action variants), never thrown across the transport boundary except programming errors.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/core/operations.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/operations.ts src/stores/memory-store.ts test/core/operations.test.ts test/core/fake-store.ts
git commit -m "feat: portable memory store interface and core operations"
```

---

### Task 4: SQLite store and store contract suite

**Files:**
- Create: `src/stores/sqlite.ts`, `src/stores/sqlite/migrations/0001_init.sql`, `test/contract/store.test.ts`, `test/contract/sqlite.test.ts`
- Modify: `package.json` (add `better-sqlite3` and `@types/better-sqlite3` as dependencies)

**Interfaces:**
- Consumes: `MemoryStore`, `MemoryRow`, `NewMemoryRow`, `ListFilter` from Tasks 1/3.
- Produces: `createSqliteStore(path: string): Promise<MemoryStore>`, and `runStoreContract(name: string, makeStore: () => Promise<MemoryStore>): void` used by Task 5.

- [ ] **Step 1: Write the failing contract test**

```ts
// test/contract/store.test.ts — exported runner, called by sqlite.test.ts
import { expect, test } from "vitest";
import { createCore } from "../../src/core/operations.ts";
import type { MemoryStore } from "../../src/stores/memory-store.ts";

export function runStoreContract(name: string, makeStore: () => Promise<MemoryStore>): void {
  test(`${name}: dedupe conflict then force`, async () => {
    const core = createCore(await makeStore());
    const input = { kind: "lesson", title: "Check the flag", trigger: "After adding a CLI flag", body: "The flag was dropped silently; the smoke test lied." };
    expect((await core.write(input)).action).toBe("created");
    const dup = await core.write({ ...input, title: "Check the flags" });
    expect(dup.action).toBe("needs_decision");
    expect((await core.write({ ...input, force: true })).action).toBe("created");
  });

  test(`${name}: one-hop replaces and byte budget`, async () => {
    const core = createCore(await makeStore());
    const first = await core.write({ kind: "lesson", title: "Old claim", trigger: "Before the fix", body: "This was wrong and cost a confused session." });
    const second = await core.supersede(first.entry!.id, { kind: "lesson", title: "New claim", trigger: "After the fix", body: "This is the corrected claim with its cost." });
    expect(second.replaces_id).toBe(first.entry!.id);
    expect((await core.index(null)).bytes).toBeLessThanOrEqual(8192);
  });

  test(`${name}: accented entry is found by a tone-less query`, async () => {
    const core = createCore(await makeStore());
    await core.write({ kind: "lesson", title: "Không thể kết nối database host", trigger: "Khi database host không reachable", body: "The direct host was IPv6-only and refused connections from this machine." });
    expect((await core.recall("docker host khong the ket noi"))[0].title).toContain("database host");
  });
}

// test/contract/sqlite.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore } from "../../src/stores/sqlite.ts";
import { runStoreContract } from "./store.test.ts";

runStoreContract("sqlite", async () => createSqliteStore(join(mkdtempSync(join(tmpdir(), "longmem-")), "mem.sqlite")));
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/contract/sqlite.test.ts`
Expected: FAIL with "Cannot find module '../../src/stores/sqlite.ts'".

- [ ] **Step 3: Implement the store and its migration**

`src/stores/sqlite/migrations/0001_init.sql` creates `memories` with the columns in spec §6 (no `search_text`, no `search_vector`, no RPCs) plus `_longmem_migrations`. `createSqliteStore` applies pending migrations on open, sets the file mode to 0600, and implements `MemoryStore` using synchronous `better-sqlite3` calls wrapped in async methods. `transaction` nests safely by reusing the current connection when already inside a transaction. No FTS5.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/contract/sqlite.test.ts`
Expected: PASS, 3 contract cases.

- [ ] **Step 5: Commit**

Run: `npx tsc --noEmit` (clean), then:

```bash
git add src/stores/sqlite.ts src/stores/sqlite/migrations/0001_init.sql test/contract package.json package-lock.json
git commit -m "feat: sqlite store and shared store contract"
```

---

### Task 5: Postgres store and migration runner

**Files:**
- Create: `src/stores/postgres.ts`, `scripts/migrate-postgres.ts`, `test/contract/postgres.test.ts`
- Create: `src/stores/postgres/migrations/0001_init.sql` … `0006_list_audit.sql` (copies of the remote migrations with 0001 slimmed: no `vector` extension, no `embedding` column)
- Modify: `package.json` (add `postgres` dependency)

**Interfaces:**
- Consumes: `MemoryStore` from Task 3, `runStoreContract` from Task 4.
- Produces: `createPostgresStore(databaseUrl: string): Promise<MemoryStore>`; migration runner applies `0001_init.sql`…`0006_list_audit.sql` in order using a `_longmem_migrations` ledger.

- [ ] **Step 1: Write the env-gated contract test**

```ts
// test/contract/postgres.test.ts
import { createPostgresStore } from "../../src/stores/postgres.ts";
import { runStoreContract } from "./store.test.ts";

const url = process.env.LONGMEM_TEST_DATABASE_URL;
if (url) runStoreContract("postgres", () => createPostgresStore(url));
else console.log("LONGMEM_TEST_DATABASE_URL unset — postgres contract skipped");
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/contract/postgres.test.ts`
Expected: FAIL with "Cannot find module '../../src/stores/postgres.ts'".

- [ ] **Step 3: Implement the store and migration runner**

`createPostgresStore` uses `postgres(url)` with `ssl` from the connection string (Neon works with no extra code), calls the migration runner on open, and implements `MemoryStore`. `transaction` uses `sql.begin`. `predecessorOf` queries `where superseded_by = $1 order by created_at desc limit 1`. The runner in `scripts/migrate-postgres.ts` reads the six SQL files in lexicographic order, records applied filenames in `_longmem_migrations`, and is idempotent.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/contract/postgres.test.ts`
Expected: PASS with a test database URL, or a clean skip without one. Never point this test at the production Supabase database.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit` and `npx vitest run`; expected clean and all non-gated tests green.

```bash
git add src/stores/postgres.ts src/stores/postgres scripts/migrate-postgres.ts test/contract/postgres.test.ts package.json package-lock.json
git commit -m "feat: postgres store and portable migration runner"
```

---

### Task 6: Config union, client transport, CLI wiring

**Files:**
- Create: `src/transport.ts`
- Modify: `src/config.ts`, `src/context.ts`, `src/cli.ts`, and all eleven `src/commands/*.ts`
- Test: `test/transport.test.ts`

**Interfaces:**
- Consumes: `createCore` and `Core` from Task 3, both stores from Tasks 4/5, existing `request<T>` from `src/client.ts`.
- Produces:

```ts
export type Config =
  | { kind: "http"; endpoint: string; token: string }
  | { kind: "postgres"; databaseUrl: string }
  | { kind: "sqlite"; path: string; cliPath?: string };

export function createClient(config: Config): Promise<Core>;
export function loadConfig(env?: NodeJS.ProcessEnv): Config; // extended, legacy {endpoint,token} read as http
```

`Ctx` gains `client: Core`. Each command calls `ctx.client.<operation>()` instead of `request(ctx.cfg, path)`. HTTP mode implements `Core` by mapping operations to the existing endpoints (`/index`, `/list`, `/related`, `/recall`, `/write`, `/reinforce`, `/update`, `/supersede`, `/promote`, `/status`, `/health`) and keeps the existing error classes and exit codes.

- [ ] **Step 1: Write the failing transport test**

```ts
// test/transport.test.ts
import { expect, test } from "vitest";
import { createClient, loadConfig } from "../src/transport.ts";

test("sqlite config yields an in-process client with no endpoint or token", async () => {
  const client = await createClient({ kind: "sqlite", path: ":memory:" });
  expect((await client.status()).counts).toBeDefined();
  expect((await client.write({ kind: "lesson", title: "Local entry", trigger: "Working offline", body: "The local store worked without cloud credentials." })).action).toBe("created");
  expect((await client.index(null)).block).toContain("Local entry");
});

test("legacy config without kind is read as http", async () => {
  const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "longmem-")), "longmem.json");
  writeFileSync(file, JSON.stringify({ endpoint: "https://example.invalid/functions/v1/longmem", token: "x".repeat(64) }));
  chmodSync(file, 0o600);
  expect(loadConfig({ LONGMEM_CONFIG: file }).kind).toBe("http");
});

test("the http client never writes in the read-only contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(JSON.stringify({ ok: true, counts: {} }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = await createClient({ kind: "http", endpoint: "https://example.invalid/functions/v1/longmem", token: "x".repeat(64) });
    await client.status();
    await client.index(null);
    await client.list({ status: "active", limit: 10 });
    await client.recall("example");
    expect(calls.every((c) => c.startsWith("GET")), `unexpected write: ${calls.join(", ")}`).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/transport.test.ts`
Expected: FAIL with "Cannot find module '../src/transport.ts'".

- [ ] **Step 3: Implement transport and rewire commands**

`createClient` branches on `config.kind`: `http` returns the HTTP-backed `Core`, `sqlite`/`postgres` return `createCore(await create…Store(...))`. `main()` builds the client once per invocation and passes it in `Ctx`. Commands keep their flags, output format and exit codes; only the way they reach data changes. `--json` output shapes stay byte-compatible with the live API.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run test/transport.test.ts test/core test/contract/sqlite.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`, then `npx tsx src/cli.ts status` with the existing production config; expected health ok and the same counts as before.

```bash
git add src test package.json
git commit -m "feat: config union and client transport for local and cloud"
```

---

### Task 7: Plugin local mode, docs, and end-to-end verification

**Files:**
- Modify: `plugin/longmem.ts`, `scripts/install-plugin.sh`, `README.md`
- Test: `test/plugin.test.ts`
- Create: `docs/superpowers/plans/…` is already present; no new plan file.

**Interfaces:**
- Consumes: `createClient`/`Config` from Task 6; plugin input shape from `@opencode-ai/plugin@1.15.6` (`{ client, project, directory, worktree, experimental_workspace, serverUrl, $ }`).
- Produces: a plugin that injects the same index block in `http` and local modes, stays standalone after installation, and returns `""` on every failure.

- [ ] **Step 1: Write the failing plugin test**

```ts
// test/plugin.test.ts
import { expect, test } from "vitest";
import { server } from "../plugin/longmem.ts";

test("a local config with no cliPath fails silently", async () => {
  const hook = (server as any).experimental?.["chat.system.transform"];
  const output = { system: ["base"] };
  await hook({ sessionID: "test", model: {} }, output);
  expect(output.system).toEqual(["base"]);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/plugin.test.ts`
Expected: FAIL because the plugin has no local branch.

- [ ] **Step 3: Add the local branch without bundling**

In local modes the plugin calls `execFileSync("npx", ["tsx", cliPath, "index", "--json"], { timeout: 1500 })` using the `cliPath` from config, parses `{block}` and pushes it into `output.system` exactly as the HTTP branch does. Keep the file self-contained: only `node:` imports and `import type { Plugin }`. Keep every failure inside `try/catch` returning `""`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run test/plugin.test.ts` then `npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 5: Live end-to-end and docs**

Run `bash scripts/install-plugin.sh`, then verify the installed copy still hashes equal to `plugin/longmem.ts`, and that `npx tsx src/cli.ts status` reports health ok against the unchanged production config. Update README with a backend table, setup steps for SQLite/self-hosted Postgres/Neon, the "no sync" rule, and the ~500–1000 entry scoring ceiling.

- [ ] **Step 6: Commit**

```bash
git add plugin scripts README.md test/plugin.test.ts
git commit -m "docs: portability setup and plugin local mode"
```

---

## Decisions made in this plan (spec §14)

- **Supabase function untouched** — no `DATABASE_URL`, no pooler, no RLS role migration; it remains the `http` backend.
- **Core is Web-standard only** — `normalize()` uses `NFD` + `\p{M}` stripping, which is the portable `unaccent`.
- **Contract asserts order and membership, not numeric scores** — `ts_rank` cannot be reproduced by token overlap.
- **`predecessorOf(id)` replaces a schema column** — one hop stays derived from `superseded_by`.
- **Slimmed portable Postgres schema** — 0001–0006 without pgvector; `pg_trgm` + `unaccent` required.
- **Live HTTP contract run is read-only** — never writes into Andy's real store.
- **Plugin local mode shells out to the repo CLI** — no bundle, no daemon, no build step.
- **`npm run` is unusable in this environment** — every verification command uses `npx`.
