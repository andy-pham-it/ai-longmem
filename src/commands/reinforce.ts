import { type Ctx, flagString } from "../context.ts";

export async function run(ctx: Ctx): Promise<number> {
  const id = ctx.positional[0] ?? flagString(ctx.flags, "id");
  if (!id) {
    ctx.out("usage: longmem reinforce <id>");
    return 1;
  }
  const entry = await ctx.client.reinforce(id);
  ctx.out(`reinforced ${entry.id} (now ${entry.reinforced_count})`);
  return 0;
}
