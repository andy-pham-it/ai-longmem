import { applyMigrations } from "../src/stores/postgres.ts";

// Re-export not possible (applyMigrations not exported). Instead duplicate minimal runner:
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "stores", "postgres", "migrations");

async function main() {
  const url = process.env.DATABASE_URL ?? process.argv[2];
  if (!url) { console.error("DATABASE_URL or argv[1] required"); process.exit(1); }
  const sql = postgres(url, { ssl: url.includes("sslmode=require") ? "require" : undefined });
  await sql`create table if not exists _longmem_migrations (name text primary key, applied_at timestamptz not null)`;
  const applied = new Set((await sql`select name from _longmem_migrations`).map((r: any) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (applied.has(f)) { console.log("skip", f); continue; }
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    await sql`insert into _longmem_migrations (name, applied_at) values (${f}, ${new Date().toISOString()})`;
    console.log("applied", f);
  }
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
