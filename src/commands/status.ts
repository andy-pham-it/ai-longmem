import { type Ctx } from "../context.ts";

export async function run(ctx: Ctx): Promise<number> {
  const health = await ctx.client.health();
  const status = await ctx.client.status();
  const rendered = await ctx.client.index(ctx.projectKey);
  ctx.out(`health:   ${health ? "ok" : "down"}`);
  ctx.out(`entries:  ${status.counts.active ?? 0} active / ${status.counts.total ?? 0} total`);
  ctx.out(`  global: ${status.counts.global ?? 0}  project: ${status.counts.project ?? 0}  pinned: ${status.counts.pinned ?? 0}`);
  const byKind = (status.counts.by_kind as unknown) as Record<string, number> ?? {};
  for (const [kind, n] of Object.entries(byKind)) ctx.out(`  ${kind}: ${n}`);
  ctx.out(`index:    ${rendered.bytes} bytes, ${rendered.total} entries${rendered.truncated ? " (truncated)" : ""}`);
  return 0;
}
