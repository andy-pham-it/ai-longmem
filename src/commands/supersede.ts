import { type Ctx, flagBool, flagList, flagString } from "../context.ts";

export async function run(ctx: Ctx): Promise<number> {
  const id = ctx.positional[0];
  const kind = flagString(ctx.flags, "kind");
  const title = flagString(ctx.flags, "title");
  const trigger = flagString(ctx.flags, "trigger");
  const body = flagString(ctx.flags, "body");

  if (!id || !kind || !title || !trigger || !body) {
    ctx.out('usage: longmem supersede <id> --kind lesson --title "..." --trigger "..." --body "..."');
    return 1;
  }

  const entry = await ctx.client.supersede(id, {
    kind,
    title,
    trigger,
    body,
    tags: flagList(ctx.flags, "tag"),
    scope: flagBool(ctx.flags, "project") ? "project" : "global",
    project_key: flagBool(ctx.flags, "project") ? ctx.projectKey : null,
    pinned: flagBool(ctx.flags, "pinned"),
    sensitive: flagBool(ctx.flags, "sensitive"),
  });
  ctx.out(`superseded ${id} with ${entry.id}`);
  return 0;
}
