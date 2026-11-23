import { request } from "../client.ts";
import { type Ctx } from "../context.ts";

export async function run(ctx: Ctx): Promise<number> {
  const id = ctx.positional[0];
  if (!id) {
    ctx.out("usage: longmem promote <id>");
    return 1;
  }
  const response = await request<{ entry: { id: string; scope: string } }>(ctx.cfg, "/promote", {
    method: "POST",
    body: { id },
  });
  ctx.out(`promoted ${response.entry.id} to ${response.entry.scope}`);
  return 0;
}
