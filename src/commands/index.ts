import { type Ctx, flagBool, flagString } from "../context.ts";

export type IndexResponse = { block: string; bytes: number; total: number; truncated: boolean };

export async function run(ctx: Ctx): Promise<number> {
  const bytes = flagString(ctx.flags, "bytes");
  const maxBytes = bytes ? Number(bytes) : undefined;
  const rendered = await ctx.client.index(ctx.projectKey, maxBytes);
  ctx.out(flagBool(ctx.flags, "json") ? JSON.stringify(rendered, null, 2) : rendered.block);
  return 0;
}
