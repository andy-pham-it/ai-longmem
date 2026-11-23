import { request } from "../client.ts";
import { type Ctx, flagBool, flagNumber } from "../context.ts";
import { type IndexRow, renderIndex } from "../../supabase/functions/_shared/render.ts";

type RowsResponse = { rows: IndexRow[]; total: number };

/**
 * Renders a paste-ready block for the agent-memory `human`/`project` block from
 * the store's own rows, so the block is a cache of longmem and never a hand
 * edit. The bytes are enforced by the same renderer the hook uses.
 */
export async function run(ctx: Ctx): Promise<number> {
  const maxBytes = flagNumber(ctx.flags, "max-bytes") ?? 1500;
  const pinnedOnly = flagBool(ctx.flags, "pinned-only");

  const response = await request<RowsResponse>(ctx.cfg, "/index", {
    query: { project_key: ctx.projectKey, format: "rows" },
  });

  const rows = pinnedOnly ? response.rows.filter((row) => row.pinned) : response.rows;
  const rendered = renderIndex(rows, maxBytes);
  ctx.out(rendered.block);
  return 0;
}
