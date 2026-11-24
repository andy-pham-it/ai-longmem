import { type Ctx, flagString } from "../context.ts";

export async function run(ctx: Ctx): Promise<number> {
  const id = ctx.positional[0] ?? flagString(ctx.flags, "id");
  if (!id) {
    ctx.out("usage: longmem promote <id>");
    return 1;
  }
  const entry = await ctx.client.promote(id);
  ctx.out(`promoted ${entry.id} to global`);
  return 0;
}
