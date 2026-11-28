import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { HandoffRow, ListFilter, MemoryRow, NewHandoffRow, NewMemoryRow } from "../core/types.ts";
import type { MemoryStore } from "./memory-store.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "postgres", "migrations");

function now() { return new Date().toISOString(); }
function newId() { return crypto.randomUUID(); }

function rowFromDb(r: any): MemoryRow {
  return {
    id: r.id,
    scope: r.scope,
    project_key: r.project_key ?? null,
    kind: r.kind,
    title: r.title,
    trigger: r.trigger,
    body: r.body,
    tags: Array.isArray(r.tags) ? r.tags : [],
    status: r.status,
    superseded_by: r.superseded_by ?? null,
    pinned: r.pinned === true,
    sensitive: r.sensitive === true,
    source: r.source ?? null,
    agent_session: r.agent_session ?? null,
    reinforced_count: r.reinforced_count,
    last_reinforced_at: r.last_reinforced_at ?? null,
    recall_count: r.recall_count,
    last_recalled_at: r.last_recalled_at ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

function handoffFromDb(r: any): HandoffRow {
  return {
    id: r.id,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    expires_at: r.expires_at instanceof Date ? r.expires_at.toISOString() : r.expires_at,
    summary: r.summary,
    next: r.next ?? null,
    blocked: r.blocked ?? null,
    context: r.context ?? null,
    task_ref: r.task_ref ?? null,
    scope: r.scope,
    project_key: r.project_key ?? null,
    status: r.status,
  };
}

async function applyMigrations(sql: ReturnType<typeof postgres>) {
  await sql`create table if not exists _longmem_migrations (name text primary key, applied_at timestamptz not null)`;
  const applied = new Set((await sql`select name from _longmem_migrations`).map((r: any) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const content = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    await sql.unsafe(content);
    await sql`insert into _longmem_migrations (name, applied_at) values (${f}, ${now()})`;
  }
}

function createStore(sql: ReturnType<typeof postgres>): MemoryStore {
  return {
    name: "postgres",
    async transaction<T>(fn: (tx: MemoryStore) => Promise<T>) {
      return sql.begin(async (tx) => fn(createStore(tx as any))) as Promise<T>;
    },
    async insert(input: NewMemoryRow) {
      const id = newId();
      const t = now();
      const [r] = await sql`
        insert into memories (id,scope,project_key,kind,title,trigger,body,tags,status,superseded_by,pinned,sensitive,source,agent_session,reinforced_count,last_reinforced_at,recall_count,last_recalled_at,created_at,updated_at,search_text)
        values (${id},${input.scope},${input.project_key},${input.kind},${input.title},${input.trigger},${input.body},${input.tags},${"active"},null,${input.pinned},${input.sensitive},${input.source},${input.agent_session},0,null,0,null,${t},${t},'')
        returning *`;
      return rowFromDb(r);
    },
    async get(id: string) {
      const [r] = await sql`select * from memories where id = ${id}`;
      return r ? rowFromDb(r) : null;
    },
    async list(filter: ListFilter) {
      const rows = await sql`
        select * from memories
        where (${filter.scope ?? null}::text is null or scope = ${filter.scope ?? null})
          and (${filter.project_key ?? null}::text is null or project_key = ${filter.project_key ?? null})
          and (${filter.kind ?? null}::text is null or kind = ${filter.kind ?? null})
          and (${filter.status ?? null}::text is null or ${filter.status ?? null} = 'all' or status = ${filter.status ?? null})
        order by pinned desc, updated_at desc
        limit ${Math.max(1, Math.min(filter.limit ?? 500, 500))}`;
      let out = rows.map(rowFromDb);
      if (filter.tag) out = out.filter((r) => r.tags.includes(filter.tag!));
      return out;
    },
    async update(id: string, patch: Partial<NewMemoryRow>) {
      const [curRow] = await sql`select * from memories where id = ${id}`;
      if (!curRow) throw new Error("not found");
      const cur = rowFromDb(curRow);
      const next = { ...cur, ...patch };
      const t = now();
      const [r] = await sql`
        update memories set scope=${next.scope}, project_key=${next.project_key}, kind=${next.kind}, title=${next.title}, trigger=${next.trigger}, body=${next.body}, tags=${next.tags}, status=${next.status}, superseded_by=${next.superseded_by}, pinned=${next.pinned}, sensitive=${next.sensitive}, source=${next.source}, agent_session=${next.agent_session}, reinforced_count=${next.reinforced_count}, last_reinforced_at=${next.last_reinforced_at}, recall_count=${next.recall_count}, last_recalled_at=${next.last_recalled_at}, updated_at=${t}
        where id=${id} returning *`;
      return rowFromDb(r);
    },
    async reinforce(id: string) {
      const t = now();
      const [r] = await sql`
        update memories set reinforced_count = reinforced_count + 1, last_reinforced_at = ${t}, updated_at = ${t}
        where id = ${id} returning *`;
      if (!r) throw new Error("not found");
      return rowFromDb(r);
    },
    async supersede(oldId: string, input: NewMemoryRow) {
      const old = await (async () => {
        const [r] = await sql`select * from memories where id = ${oldId}`;
        return r ? rowFromDb(r) : null;
      })();
      if (!old) throw new Error("not found");
      const created = await this.insert(input);
      const t = now();
      await sql`update memories set status='superseded', superseded_by=${created.id}, updated_at=${t} where id=${oldId}`;
      return created;
    },
    async predecessorOf(id: string) {
      const [r] = await sql`select * from memories where superseded_by = ${id} order by created_at desc limit 1`;
      return r ? rowFromDb(r) : null;
    },
    async counts() {
      const total = (await sql`select count(*)::int as n from memories`)[0].n;
      const active = (await sql`select count(*)::int as n from memories where status = 'active'`)[0].n;
      const superseded = (await sql`select count(*)::int as n from memories where status = 'superseded'`)[0].n;
      const archived = (await sql`select count(*)::int as n from memories where status = 'archived'`)[0].n;
      const global = (await sql`select count(*)::int as n from memories where status = 'active' and scope = 'global'`)[0].n;
      const project = (await sql`select count(*)::int as n from memories where status = 'active' and scope = 'project'`)[0].n;
      const pinned = (await sql`select count(*)::int as n from memories where status = 'active' and pinned = true`)[0].n;
      const rows = await sql`select kind, count(*)::int as n from memories group by kind`;
      const by_kind: Record<string, number> = {};
      for (const r of rows) by_kind[r.kind] = r.n;
      return { total, active, superseded, archived, global, project, pinned, by_kind };
    },
    async insertHandoff(input: NewHandoffRow) {
      const id = newId();
      const t = now();
      let r: any;
      await sql.begin(async (tx: any) => {
        await tx`update handoffs set status='completed' where status='active' and scope=${input.scope} and (project_key is not distinct from ${input.project_key})`;
        const [row] = await tx`
          insert into handoffs (id,created_at,expires_at,summary,next,blocked,context,task_ref,scope,project_key,status)
          values (${id},${t},${input.expires_at},${input.summary},${input.next},${input.blocked},${input.context},${input.task_ref ? JSON.stringify(input.task_ref) : null},${input.scope},${input.project_key},'active')
          returning *`;
        r = row;
      });
      return handoffFromDb(r);
    },
    async getLatestHandoff(projectKey: string | null) {
      const t = now();
      const rows = await sql`
        select * from handoffs
        where status='active' and expires_at > ${t}
          and (scope='global' or (scope='project' and project_key = ${projectKey}))
        order by case when scope='project' and project_key=${projectKey} then 0 else 1 end, created_at desc
        limit 1`;
      if (rows.length === 0) return null;
      const h = handoffFromDb(rows[0]);
      if (new Date(h.expires_at) <= new Date()) {
        await sql`update handoffs set status='expired' where id=${h.id}`;
        return null;
      }
      return h;
    },
    async completeHandoff(id: string) {
      await sql`update handoffs set status='completed' where id=${id}`;
    },
    async listHandoffs(filter) {
      const f = filter ?? {};
      const status = f.status ?? "all";
      const limit = Math.max(1, Math.min(f.limit ?? 100, 500));
      const rows = await sql`
        select * from handoffs
        where (${f.scope ?? null}::text is null or scope = ${f.scope ?? null})
          and (${f.project_key ?? null}::text is null or project_key = ${f.project_key ?? null})
          and (${status} = 'all' or status = ${status})
        order by created_at desc
        limit ${limit}`;
      return rows.map(handoffFromDb);
    },
    async close() { await sql.end(); },
  };
}

export async function createPostgresStore(databaseUrl: string): Promise<MemoryStore> {
  const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("sslmode=require") ? "require" : undefined, max: 5, onnotice: () => {} });
  await applyMigrations(sql);
  return createStore(sql);
}
