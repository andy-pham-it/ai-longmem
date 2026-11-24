import { type Ctx } from "../context.ts";

export async function run(ctx: Ctx): Promise<number> {
  const health = await ctx.client.health();
  const status = await ctx.client.status();
  const rendered = await ctx.client.index(ctx.projectKey);
  const c = status.counts as Record<string, any>;
  ctx.out(`health:   ${health ? "ok" : "down"}`);
  ctx.out(`entries:  ${c.total ?? 0} total, ${c.active ?? 0} active`);
  ctx.out(`  global: ${c.global ?? 0}, project: ${c.project ?? 0}, pinned: ${c.pinned ?? 0}`);
  ctx.out(`  superseded: ${c.superseded ?? 0}, archived: ${c.archived ?? 0}`);
  if (c.by_kind && typeof c.by_kind === "object") {
    ctx.out("  by kind:");
    for (const [kind, n] of Object.entries(c.by_kind)) ctx.out(`    ${kind}: ${n}`);
  }
  ctx.out(`index:    ${rendered.bytes} bytes, ${rendered.total} entries${rendered.truncated ? " (truncated)" : ""}`);
  return 0;
}
