import { type Ctx, flagBool, flagList, flagString } from "../context.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function run(ctx: Ctx): Promise<number> {
  const id = ctx.positional[0];
  const kind = flagString(ctx.flags, "kind");
  const title = flagString(ctx.flags, "title");
  const trigger = flagString(ctx.flags, "trigger");
  let body = flagString(ctx.flags, "body");
  if (body === "-") body = await readStdin();

  if (!id || !kind || !title || !trigger || body === undefined || body.trim() === "") {
    ctx.out('usage: longmem supersede <id> --kind lesson --title "..." --trigger "..." --body "..." | --body -');
    return 1;
  }

  const entry = await ctx.client.supersede(id, {
    kind,
    title,
    trigger,
    body: body.trim(),
    tags: flagList(ctx.flags, "tag"),
    scope: flagBool(ctx.flags, "project") ? "project" : "global",
    project_key: flagBool(ctx.flags, "project") ? ctx.projectKey : null,
    pinned: flagBool(ctx.flags, "pinned"),
    sensitive: flagBool(ctx.flags, "sensitive"),
  });
  ctx.out(`superseded ${id} with ${entry.id}`);
  return 0;
}
