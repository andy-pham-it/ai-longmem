import { type Ctx, flagBool, flagList, flagString } from "../context.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function run(ctx: Ctx): Promise<number> {
  const kind = flagString(ctx.flags, "kind");
  const title = flagString(ctx.flags, "title");
  const trigger = flagString(ctx.flags, "trigger");
  let body = flagString(ctx.flags, "body");
  if (body === "-") body = await readStdin();

  if (!kind || !title || !trigger || body === undefined || body.trim() === "") {
    ctx.out('usage: longmem write --kind lesson --title "..." --trigger "..." --body "..." | --body -');
    return 1;
  }

  const result = await ctx.client.write({
    kind,
    title,
    trigger,
    body: body.trim(),
    tags: flagList(ctx.flags, "tag"),
    scope: flagBool(ctx.flags, "project") ? "project" : "global",
    project_key: flagBool(ctx.flags, "project") ? ctx.projectKey : null,
    pinned: flagBool(ctx.flags, "pinned"),
    sensitive: flagBool(ctx.flags, "sensitive"),
    force: flagBool(ctx.flags, "force"),
    replaces: flagString(ctx.flags, "replaces"),
  });

  if (result.action === "needs_decision") {
    ctx.out("needs_decision: a similar entry already exists");
    if (result.existing) {
      ctx.out(`  ${result.existing.title} (${result.existing.id}) similarity ${(result.similarity ?? 0).toFixed(2)}`);
    }
    ctx.out("  options: reinforce | supersede | force");
    return 2;
  }
  ctx.out(`${result.action} ${result.id ?? result.entry?.id}`);
  if (result.warning) ctx.out(`warning: ${result.warning}`);
  return 0;
}
