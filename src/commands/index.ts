import { request } from "../client.ts";
import { type Ctx, flagBool, flagString } from "../context.ts";

export type IndexResponse = {
  block: string;
  bytes: number;
  total: number;
  truncated: boolean;
};

export async function run(ctx: Ctx): Promise<number> {
  const query: Record<string, string> = { project_key: ctx.projectKey };
  const bytes = flagString(ctx.flags, "bytes");
  if (bytes) query.bytes = bytes;

  const response = await request<IndexResponse>(ctx.cfg, "/index", { query });
  ctx.out(flagBool(ctx.flags, "json") ? JSON.stringify(response, null, 2) : response.block);
  return 0;
}
