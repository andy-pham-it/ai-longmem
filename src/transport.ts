import { RequestError, UnreachableError, UnauthorizedError, request } from "./client.ts";
import { ConfigError, loadConfig as loadConfigImpl, type Config } from "./config.ts";
import { createCore, type Core } from "./core/operations.ts";
import { createSqliteStore } from "./stores/sqlite.ts";
import { createPostgresStore } from "./stores/postgres.ts";
import type { ListFilter, MemoryRow, NewEntry } from "./core/types.ts";

export type { Config };
export { loadConfigImpl as loadConfig };

function row(x: unknown): MemoryRow { return x as MemoryRow; }

async function httpCore(cfg: Extract<Config, { kind: "http" }>): Promise<Core> {
  const base = cfg.endpoint;
  const tok = cfg.token;
  const cfgObj = { endpoint: base, token: tok };
  // adapt old Config shape for request()
  const rcfg = cfgObj as any;

  async function get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return request<T>(rcfg, path, { query });
  }
  async function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(rcfg, path, { method: "POST", body });
  }

  return {
    async index(projectKey: string | null, maxBytes = 8192) {
      const q: Record<string, string> = { project_key: projectKey ?? "" };
      if (maxBytes) q.bytes = String(maxBytes);
      const r = await get<{ block: string; bytes: number; total: number; truncated: boolean }>("/index", q);
      return r;
    },
    async related(context: string, projectKey: string | null = null) {
      const q: Record<string, string> = { context };
      if (projectKey) q.project_key = projectKey;
      const r = await get<{ entries: unknown[]; total: number }>("/related", q);
      return (r.entries ?? []).map(row);
    },
    async recall(query: string, opts?: { kinds?: string[]; tags?: string[]; limit?: number; projectKey?: string | null; status?: "active"|"superseded"|"archived"|"all" }) {
      const r = await post<{ entries: unknown[]; total: number }>("/recall", {
        query,
        project_key: opts?.projectKey ?? null,
        k: opts?.limit ?? 5,
        kinds: opts?.kinds ?? null,
        tags: opts?.tags ?? null,
      });
      return (r.entries ?? []).map(row);
    },
    async write(input: NewEntry) {
      if (input.replaces) {
        const r = await post<{ action: string; id: string; entry: unknown }>("/supersede", {
          id: input.replaces,
          kind: input.kind,
          title: input.title,
          trigger: input.trigger,
          body: input.body,
          tags: input.tags,
          pinned: input.pinned,
          sensitive: input.sensitive,
          source: input.source,
          agent_session: input.agent_session,
        });
        return { action: "superseded", id: r.id, entry: row(r.entry) };
      }
      try {
        const r = await post<{ action: string; id: string; entry: unknown; warning?: string }>("/write", {
          kind: input.kind,
          title: input.title,
          trigger: input.trigger,
          body: input.body,
          tags: input.tags,
          pinned: input.pinned,
          sensitive: input.sensitive,
          source: input.source,
          agent_session: input.agent_session,
          scope: input.scope,
          project_key: input.project_key,
          force: input.force,
        });
        return { action: (r.action as any) ?? "created", id: r.id, entry: r.entry ? row(r.entry) : undefined, warning: r.warning };
      } catch (e) {
        if (e instanceof RequestError && e.status === 409) {
          const body = e.body as { existing?: unknown; similarity?: number };
          return { action: "needs_decision", existing: body.existing ? row(body.existing) : undefined, similarity: body.similarity };
        }
        throw e;
      }
    },
    async reinforce(id: string) {
      const r = await post<{ entry?: unknown; id?: string }>("/reinforce", { id });
      return row(r.entry ?? r);
    },
    async update(id: string, patch: Partial<NewEntry>) {
      const r = await post<{ entry?: unknown }>("/update", { id, ...patch });
      return row(r.entry ?? r);
    },
    async supersede(oldId: string, input: NewEntry) {
      const r = await post<{ entry?: unknown; id?: string }>("/supersede", {
        id: oldId,
        kind: input.kind,
        title: input.title,
        trigger: input.trigger,
        body: input.body,
        tags: input.tags,
        pinned: input.pinned,
        sensitive: input.sensitive,
        source: input.source,
        agent_session: input.agent_session,
      });
      const entry = row(r.entry ?? r) as MemoryRow;
      if (!entry.replaces_id) entry.replaces_id = oldId;
      if (!entry.replaces) entry.replaces = { id: oldId, title: "", created_at: "" };
      return entry;
    },
    async promote(id: string) {
      const r = await post<{ entry?: unknown }>("/promote", { id });
      return row(r.entry ?? r);
    },
    async list(filter: ListFilter) {
      const q: Record<string, string> = {};
      if (filter.scope) q.scope = filter.scope;
      if (filter.project_key) q.project_key = filter.project_key;
      if (filter.kind) q.kind = filter.kind;
      if (filter.tag) q.tag = filter.tag;
      if (filter.status && filter.status !== "all") q.status = filter.status;
      if (filter.limit) q.limit = String(filter.limit);
      const r = await get<{ entries: unknown[]; total: number }>("/list", q);
      return { entries: (r.entries ?? []).map(row), total: r.total ?? (r.entries ?? []).length };
    },
    async status() {
      const r = await get<{ counts: Record<string, number>; index?: { bytes: number; total: number; truncated: boolean } }>("/status");
      return { counts: r.counts ?? {} };
    },
    async health() {
      try {
        await get("/health");
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      // no-op: HTTP has no persistent connection
    },
  };
}

export async function createClient(config: Config): Promise<Core> {
  if (config.kind === "http") return httpCore(config);
  if (config.kind === "sqlite") return createCore(await createSqliteStore(config.path));
  if (config.kind === "postgres") return createCore(await createPostgresStore(config.databaseUrl));
  throw new Error("unknown config kind");
}

// loadConfig re-exported from config.ts (see line 9)
