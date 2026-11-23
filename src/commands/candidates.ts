import { request } from "../client.ts";
import { type Ctx } from "../context.ts";

type Row = {
  id: string;
  kind: string;
  title: string;
  trigger: string;
  updated_at?: string;
};

type RowsResponse = { rows: Row[]; total: number };

export async function run(ctx: Ctx): Promise<number> {
  ctx.out("Before writing, the entry must pass all five:");
  ctx.out("  1. The trigger names a situation you will recognise later, not a mood.");
  ctx.out("  2. The body names what it cost and what to do instead.");
  ctx.out("  3. One claim per entry. A chat summary is not an entry.");
  ctx.out("  4. If it names a file, service or repo, pass --project.");
  ctx.out("  5. If a similar title exists, reinforce or supersede instead of adding.");
  ctx.out("");
  ctx.out("Newest active entries (avoid duplicating these):");

  const response = await request<RowsResponse>(ctx.cfg, "/index", {
    query: { project_key: ctx.projectKey, format: "rows" },
  });
  const newest = [...response.rows]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 10);

  if (newest.length === 0) {
    ctx.out("  (none)");
    return 0;
  }
  for (const row of newest) {
    ctx.out(`  - [${row.kind}] ${row.title} — ${row.trigger}`);
    ctx.out(`    ${row.id}`);
  }
  return 0;
}
