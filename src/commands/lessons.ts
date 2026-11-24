import { type Ctx, flagBool, flagString } from "../context.ts";
import { type Entry, formatEntries } from "../format.ts";

export async function run(ctx: Ctx): Promise<number> {
  const context = ctx.positional.join(" ").trim();
  if (context === "") {
    ctx.out('usage: longmem lessons "<situation you are about to handle>"');
    return 1;
  }
  const entries = await ctx.client.related(context, ctx.projectKey);
  ctx.out(formatEntries(entries as unknown as Entry[]));
  return 0;
}
