import { readFileSync, readdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { HandoffRow, ListFilter, MemoryRow, NewHandoffRow, NewMemoryRow } from "../core/types.ts";
import type { MemoryStore } from "./memory-store.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "sqlite", "migrations");

function now() { return new Date().toISOString(); }
function newId() { return `sqlite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function rowFromDb(r: any): MemoryRow {
  return {
    id: r.id,
    scope: r.scope,
    project_key: r.project_key ?? null,
    kind: r.kind,
    title: r.title,
    trigger: r.trigger,
    body: r.body,
    tags: JSON.parse(r.tags || "[]"),
    status: r.status,
    superseded_by: r.superseded_by ?? null,
    pinned: r.pinned === 1,
    sensitive: r.sensitive === 1,
    source: r.source ?? null,
    agent_session: r.agent_session ?? null,
    reinforced_count: r.reinforced_count,
    last_reinforced_at: r.last_reinforced_at ?? null,
    recall_count: r.recall_count,
    last_recalled_at: r.last_recalled_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function handoffFromDb(r: any): HandoffRow {
  return {
    id: r.id,
    created_at: r.created_at,
    expires_at: r.expires_at,
    summary: r.summary,
    next: r.next ?? null,
    blocked: r.blocked ?? null,
    context: r.context ?? null,
    task_ref: r.task_ref ? JSON.parse(r.task_ref) : null,
    scope: r.scope,
    project_key: r.project_key ?? null,
    status: r.status,
  };
}

function applyMigrations(db: Database.Database) {
  db.exec(`create table if not exists _longmem_migrations (name text primary key, applied_at text not null);`);
  const applied = new Set(db.prepare("select name from _longmem_migrations").all().map((r: any) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    db.prepare("insert into _longmem_migrations (name, applied_at) values (?, ?)").run(f, now());
  }
}

export async function createSqliteStore(path: string): Promise<MemoryStore> {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  applyMigrations(db);
  try { chmodSync(path, 0o600); } catch { /* :memory: has no path */ }

  const insertStmt = db.prepare(`insert into memories (id,scope,project_key,kind,title,trigger,body,tags,status,superseded_by,pinned,sensitive,source,agent_session,reinforced_count,last_reinforced_at,recall_count,last_recalled_at,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const getStmt = db.prepare("select * from memories where id = ?");
  const updateStmt = db.prepare(`update memories set scope=?,project_key=?,kind=?,title=?,trigger=?,body=?,tags=?,status=?,superseded_by=?,pinned=?,sensitive=?,source=?,agent_session=?,reinforced_count=?,last_reinforced_at=?,recall_count=?,last_recalled_at=?,updated_at=? where id=?`);
  const insertHandoffStmt = db.prepare(`insert into handoffs (id,created_at,expires_at,summary,next,blocked,context,task_ref,scope,project_key,status) values (?,?,?,?,?,?,?,?,?,?,?)`);
  const getLatestHandoffStmt = db.prepare(`select * from handoffs where status='active' and expires_at > ? and (scope='global' or (scope='project' and project_key = ?)) order by case when scope='project' and project_key=? then 0 else 1 end, created_at desc limit 1`);
  const completeHandoffStmt = db.prepare(`update handoffs set status='completed' where id=?`);
  const listHandoffsStmt = db.prepare(`select * from handoffs where (? is null or scope=?) and (? is null or project_key=?) and (? is null or ?='all' or status=?) order by created_at desc limit ?`);

  const store: MemoryStore = {
    name: "sqlite",
    async transaction<T>(fn: (tx: MemoryStore) => Promise<T>) { return fn(store); },
    async insert(input) {
      const id = newId();
      const t = now();
      insertStmt.run(id, input.scope, input.project_key, input.kind, input.title, input.trigger, input.body, JSON.stringify(input.tags), "active", null, input.pinned ? 1 : 0, input.sensitive ? 1 : 0, input.source, input.agent_session, 0, null, 0, null, t, t);
      return rowFromDb(getStmt.get(id));
    },
    async get(id) {
      const r = getStmt.get(id);
      return r ? rowFromDb(r) : null;
    },
    async list(filter) {
      let sql = "select * from memories where 1=1";
      const params: any[] = [];
      if (filter.scope) { sql += " and scope = ?"; params.push(filter.scope); }
      if (filter.project_key !== undefined && filter.project_key !== null) { sql += " and project_key = ?"; params.push(filter.project_key); }
      if (filter.kind) { sql += " and kind = ?"; params.push(filter.kind); }
      if (filter.tag) { sql += " and exists (select 1 from json_each(tags) where value = ?)"; params.push(filter.tag); }
      if (filter.status && filter.status !== "all") { sql += " and status = ?"; params.push(filter.status); }
      sql += " order by pinned desc, updated_at desc";
      if (filter.limit) { sql += " limit ?"; params.push(Math.max(1, Math.min(filter.limit, 500))); }
      return db.prepare(sql).all(...params).map(rowFromDb);
    },
    async update(id, patch) {
      const cur = await store.get(id);
      if (!cur) throw new Error("not found");
      const next = { ...cur, ...patch } as MemoryRow;
      updateStmt.run(next.scope, next.project_key, next.kind, next.title, next.trigger, next.body, JSON.stringify(next.tags), next.status, next.superseded_by, next.pinned ? 1 : 0, next.sensitive ? 1 : 0, next.source, next.agent_session, next.reinforced_count, next.last_reinforced_at, next.recall_count, next.last_recalled_at, next.updated_at === cur.updated_at ? now() : next.updated_at, id);
      // bump updated_at
      db.prepare("update memories set updated_at = ? where id = ?").run(now(), id);
      return (await store.get(id))!;
    },
    async reinforce(id) {
      const cur = await store.get(id);
      if (!cur) throw new Error("not found");
      const t = now();
      db.prepare("update memories set reinforced_count = reinforced_count + 1, last_reinforced_at = ?, updated_at = ? where id = ?").run(t, t, id);
      return (await store.get(id))!;
    },
    async supersede(oldId, input) {
      const old = await store.get(oldId);
      if (!old) throw new Error("not found");
      const created = await store.insert(input);
      const t = now();
      db.prepare("update memories set status = 'superseded', superseded_by = ?, updated_at = ? where id = ?").run(created.id, t, oldId);
      return created;
    },
    async predecessorOf(id) {
      const r = db.prepare("select * from memories where superseded_by = ? order by created_at desc limit 1").get(id);
      return r ? rowFromDb(r) : null;
    },
    async counts() {
      const total = (db.prepare("select count(*) as n from memories").get() as any).n;
      const active = (db.prepare("select count(*) as n from memories where status = 'active'").get() as any).n;
      const superseded = (db.prepare("select count(*) as n from memories where status = 'superseded'").get() as any).n;
      const archived = (db.prepare("select count(*) as n from memories where status = 'archived'").get() as any).n;
      const global = (db.prepare("select count(*) as n from memories where status = 'active' and scope = 'global'").get() as any).n;
      const project = (db.prepare("select count(*) as n from memories where status = 'active' and scope = 'project'").get() as any).n;
      const pinned = (db.prepare("select count(*) as n from memories where status = 'active' and pinned = 1").get() as any).n;
      const rows = db.prepare("select kind, count(*) as n from memories group by kind").all() as any[];
      const by_kind: Record<string, number> = {};
      for (const r of rows) by_kind[r.kind] = r.n;
      return { total, active, superseded, archived, global, project, pinned, by_kind };
    },
    async insertHandoff(input: NewHandoffRow) {
      const id = newId();
      const t = now();
      db.prepare(`update handoffs set status='completed' where status='active' and scope=? and (project_key is ? or project_key=?)`).run(input.scope, input.project_key, input.project_key);
      insertHandoffStmt.run(id, t, input.expires_at, input.summary, input.next, input.blocked, input.context, input.task_ref ? JSON.stringify(input.task_ref) : null, input.scope, input.project_key, "active");
      return handoffFromDb(db.prepare("select * from handoffs where id=?").get(id));
    },
    async getLatestHandoff(projectKey: string | null) {
      const t = now();
      const r = getLatestHandoffStmt.get(t, projectKey, projectKey);
      if (!r) return null;
      const h = handoffFromDb(r);
      if (new Date(h.expires_at) <= new Date()) {
        db.prepare(`update handoffs set status='expired' where id=?`).run(h.id);
        return null;
      }
      return h;
    },
    async completeHandoff(id: string) {
      completeHandoffStmt.run(id);
    },
    async listHandoffs(filter) {
      const f = filter ?? {};
      const rows = listHandoffsStmt.all(f.scope ?? null, f.scope ?? null, f.project_key ?? null, f.project_key ?? null, f.status ?? null, f.status ?? null, Math.max(1, Math.min(f.limit ?? 100, 500)));
      return rows.map(handoffFromDb);
    },
    async close() { db.close(); },
  };
  return store;
}
