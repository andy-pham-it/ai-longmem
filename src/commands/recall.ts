import { request } from "../client.ts";
import { type Ctx, flagBool, flagList, flagNumber } from "../context.ts";
import { type Entry, formatEntries } from "../format.ts";

type RecallResponse = { entries: Entry[]; total: number };

export async function run(ctx: Ctx): Promise<number> {
  const query = ctx.positional.join(" ").trim();
  if (query === "") {
    ctx.out('usage: longmem recall "<words you remember>"');
    return 1;
  }

  const body = {
    query,
    project_key: ctx.projectKey,
    k: flagNumber(ctx.flags, "k") ?? 5,
    kinds: flagList(ctx.flags, "kind"),
    tags: flagList(ctx.flags, "tag"),
  };

  const response = await request<RecallResponse>(ctx.cfg, "/recall", { method: "POST", body });
  if (flagBool(ctx.flags, "json")) {
    ctx.out(JSON.stringify(response, null, 2));
  } else {
    ctx.out(formatEntries(response.entries));
  }
  return 0;
}
