import { type Ctx, flagBool, flagNumber } from "../context.ts";
import { type IndexRow, renderIndex } from "../../src/core/render.ts";

export async function run(ctx: Ctx): Promise<number> {
  const maxBytes = flagNumber(ctx.flags, "max-bytes") ?? 1500;
  const pinnedOnly = flagBool(ctx.flags, "pinned-only");

  const result = await ctx.client.list({ status: "active", limit: 500 });
  const rows: IndexRow[] = result.entries
    .filter((r) => r.scope === "global" || r.project_key === ctx.projectKey)
    .filter((r) => !pinnedOnly || r.pinned)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      scope: r.scope,
      title: r.title,
      trigger: r.trigger,
      pinned: r.pinned,
      reinforced_count: r.reinforced_count,
      project_key: r.project_key,
    }));
  const rendered = renderIndex(rows, maxBytes);
  ctx.out(rendered.block);
  return 0;
}
