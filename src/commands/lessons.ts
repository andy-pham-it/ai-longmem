import { request } from "../client.ts";
import { type Ctx } from "../context.ts";
import { type Entry, formatEntries } from "../format.ts";

type RelatedResponse = { entries: Entry[]; total: number };

export async function run(ctx: Ctx): Promise<number> {
  const context = ctx.positional.join(" ").trim();
  if (context === "") {
    ctx.out('usage: longmem lessons "<situation you are about to handle>"');
    return 1;
  }
  const response = await request<RelatedResponse>(ctx.cfg, "/related", {
    query: { context, project_key: ctx.projectKey },
  });
  ctx.out(formatEntries(response.entries));
  return 0;
}
