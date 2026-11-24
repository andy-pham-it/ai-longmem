import { type Ctx, flagBool, flagNumber, flagString } from "../context.ts";
import { type Entry, formatEntries } from "../format.ts";

export async function run(ctx: Ctx): Promise<number> {
  const query = ctx.positional.join(" ").trim();
  if (query === "") {
    ctx.out('usage: longmem recall "<query>"');
    return 1;
  }
  const entries = await ctx.client.recall(query, {
    projectKey: ctx.projectKey,
    kinds: flagString(ctx.flags, "kind") ? [flagString(ctx.flags, "kind")!] : undefined,
    tags: flagString(ctx.flags, "tag") ? [flagString(ctx.flags, "tag")!] : undefined,
    limit: flagNumber(ctx.flags, "k") ?? flagNumber(ctx.flags, "limit"),
  });
  if (flagBool(ctx.flags, "json")) {
    ctx.out(JSON.stringify(entries, null, 2));
    return 0;
  }
  ctx.out(formatEntries(entries as unknown as Entry[]));
  return 0;
}
