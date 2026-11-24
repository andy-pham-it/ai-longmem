import type { ListFilter, MemoryRow, NewMemoryRow } from "../../src/core/types.ts";
import type { MemoryStore } from "../../src/stores/memory-store.ts";

let counter = 0;
function now() { return new Date().toISOString(); }
function makeRow(input: NewMemoryRow): MemoryRow {
  const id = `fake-${++counter}`;
  return {
    id,
    scope: input.scope,
    project_key: input.project_key,
    kind: input.kind,
    title: input.title,
    trigger: input.trigger,
    body: input.body,
    tags: [...input.tags],
    status: "active",
    superseded_by: null,
    pinned: input.pinned,
    sensitive: input.sensitive,
    source: input.source,
    agent_session: input.agent_session,
    reinforced_count: 0,
    last_reinforced_at: null,
    recall_count: 0,
    last_recalled_at: null,
    created_at: now(),
    updated_at: now(),
  };
}

export function makeFakeStore(): MemoryStore {
  const rows: MemoryRow[] = [];
  const store: MemoryStore = {
    name: "fake",
    async transaction<T>(fn: (tx: MemoryStore) => Promise<T>) { return fn(store); },
    async insert(input) { const r = makeRow(input); rows.push(r); return { ...r }; },
    async get(id) { return rows.find((r) => r.id === id) ?? null; },
    async list(filter) {
      let out = [...rows];
      if (filter.scope) out = out.filter((r) => r.scope === filter.scope);
      if (filter.project_key !== undefined && filter.project_key !== null) out = out.filter((r) => r.project_key === filter.project_key);
      if (filter.kind) out = out.filter((r) => r.kind === filter.kind);
      if (filter.tag) out = out.filter((r) => r.tags.includes(filter.tag!));
      if (filter.status && filter.status !== "all") out = out.filter((r) => r.status === filter.status);
      out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.updated_at < b.updated_at ? 1 : -1));
      if (filter.limit) out = out.slice(0, filter.limit);
      return out.map((r) => ({ ...r }));
    },
    async update(id, patch) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error("not found");
      const cur = rows[i];
      const next: MemoryRow = { ...cur, ...patch, updated_at: now() } as MemoryRow;
      rows[i] = next;
      return { ...next };
    },
    async reinforce(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error("not found");
      const cur = rows[i];
      const next: MemoryRow = { ...cur, reinforced_count: cur.reinforced_count + 1, last_reinforced_at: now(), updated_at: now() };
      rows[i] = next;
      return { ...next };
    },
    async supersede(oldId, input) {
      const old = rows.find((r) => r.id === oldId);
      if (!old) throw new Error("not found");
      old.status = "superseded";
      old.superseded_by = null; // set below
      const created = makeRow(input);
      old.superseded_by = created.id;
      rows.push(created);
      return { ...created };
    },
    async predecessorOf(id) {
      const row = rows.find((r) => r.superseded_by === id);
      return row ? { ...row } : null;
    },
    async counts() {
      const out: Record<string, number> = { total: rows.length };
      for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + 1;
      return out;
    },
    async close() {},
  };
  return store;
}
