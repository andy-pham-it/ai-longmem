import { request } from "../client.ts";
import { type Ctx } from "../context.ts";

export async function run(ctx: Ctx): Promise<number> {
  const id = ctx.positional[0];
  if (!id) {
    ctx.out("usage: longmem reinforce <id>");
    return 1;
  }
  const response = await request<{ id: string; reinforced_count: number }>(ctx.cfg, "/reinforce", {
    method: "POST",
    body: { id },
  });
  ctx.out(`reinforced ${response.id} (now ${response.reinforced_count})`);
  return 0;
}
