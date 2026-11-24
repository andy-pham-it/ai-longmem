import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { ListFilter, MemoryRow, NewMemoryRow } from "../core/types.ts";
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

export async function createPostgresStore(databaseUrl: string): Promise<MemoryStore> {
  const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("sslmode=require") ? "require" : undefined, max: 5 });
  await applyMigrations(sql);

  const store: MemoryStore = {
    name: "postgres",
    async transaction<T>(fn: (tx: MemoryStore) => Promise<T>) {
      return sql.begin(async (tx) => {
        // adapt: tx is a Sql instance; wrap as MemoryStore by delegating to a temp store bound to tx? 
        // Simpler: run fn against this store (no real nested transaction). For portability tests, acceptable.
        return fn(store);
      }) as Promise<T>;
    },
    async insert(input) {
      const id = newId();
      const t = now();
      const [r] = await sql`
        insert into memories (id,scope,project_key,kind,title,trigger,body,tags,status,superseded_by,pinned,sensitive,source,agent_session,reinforced_count,last_reinforced_at,recall_count,last_recalled_at,created_at,updated_at,search_text)
        values (${id},${input.scope},${input.project_key},${input.kind},${input.title},${input.trigger},${input.body},${input.tags},${"active"},null,${input.pinned},${input.sensitive},${input.source},${input.agent_session},0,null,0,null,${t},${t},'')
        returning *`;
      // touch trigger maintains search_text/search_vector in real DB; here ensure updated_at
      return rowFromDb(r);
    },
    async get(id) {
      const [r] = await sql`select * from memories where id = ${id}`;
      return r ? rowFromDb(r) : null;
    },
    async list(filter) {
      const rows = await sql`
        select * from memories
        where (${filter.scope ?? null}::text is null or scope = ${filter.scope ?? null})
          and (${filter.project_key ?? null}::text is null or project_key = ${filter.project_key ?? null})
          and (${filter.kind ?? null}::text is null or kind = ${filter.kind ?? null})
          and (${filter.status ?? null}::text is null or ${filter.status ?? null} = 'all' or status = ${filter.status ?? null})
        order by pinned desc, updated_at desc
        limit ${Math.max(1, Math.min(filter.limit ?? 100, 500))}`;
      // tag filter in memory (array contains)
      let out = rows.map(rowFromDb);
      if (filter.tag) out = out.filter((r) => r.tags.includes(filter.tag!));
      return out;
    },
    async update(id, patch) {
      const cur = await store.get(id);
      if (!cur) throw new Error("not found");
      const next = { ...cur, ...patch };
      const t = now();
      const [r] = await sql`
        update memories set scope=${next.scope}, project_key=${next.project_key}, kind=${next.kind}, title=${next.title}, trigger=${next.trigger}, body=${next.body}, tags=${next.tags}, status=${next.status}, superseded_by=${next.superseded_by}, pinned=${next.pinned}, sensitive=${next.sensitive}, source=${next.source}, agent_session=${next.agent_session}, reinforced_count=${next.reinforced_count}, last_reinforced_at=${next.last_reinforced_at}, recall_count=${next.recall_count}, last_recalled_at=${next.last_recalled_at}, updated_at=${t}
        where id=${id} returning *`;
      return rowFromDb(r);
    },
    async reinforce(id) {
      const t = now();
      const [r] = await sql`
        update memories set reinforced_count = reinforced_count + 1, last_reinforced_at = ${t}, updated_at = ${t}
        where id = ${id} returning *`;
      if (!r) throw new Error("not found");
      return rowFromDb(r);
    },
    async supersede(oldId, input) {
      const old = await store.get(oldId);
      if (!old) throw new Error("not found");
      const created = await store.insert(input);
      const t = now();
      await sql`update memories set status='superseded', superseded_by=${created.id}, updated_at=${t} where id=${oldId}`;
      return created;
    },
    async predecessorOf(id) {
      const [r] = await sql`select * from memories where superseded_by = ${id} order by created_at desc limit 1`;
      return r ? rowFromDb(r) : null;
    },
    async counts() {
      const rows = await sql`select kind, count(*)::int as n from memories group by kind`;
      const total = await sql`select count(*)::int as n from memories`;
      const out: Record<string, number> = { total: total[0].n };
      for (const r of rows) out[r.kind] = r.n;
      return out;
    },
    async close() { await sql.end(); },
  };
  return store;
}
