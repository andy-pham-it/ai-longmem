import { request } from "../client.ts";
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

  const payload: Record<string, unknown> = { id, kind, title, trigger, body, tags: flagList(ctx.flags, "tag") };
  if (flagBool(ctx.flags, "project")) {
    payload.scope = "project";
    payload.project_key = ctx.projectKey;
  }
  if (flagBool(ctx.flags, "pinned")) payload.pinned = true;
  if (flagBool(ctx.flags, "sensitive")) payload.sensitive = true;

  const response = await request<{ id: string }>(ctx.cfg, "/supersede", { method: "POST", body: payload });
  ctx.out(`superseded ${id} with ${response.id}`);
  return 0;
}
