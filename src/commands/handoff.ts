import { type Ctx, flagBool, flagString } from "../context.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function run(ctx: Ctx): Promise<number> {
  const sub = ctx.positional[1];
  if (sub === "done") {
    const h = await ctx.client.resume(ctx.projectKey);
    if (!h) {
      ctx.out("no active handoff");
      return 0;
    }
    await ctx.client.completeHandoff(h.id);
    ctx.out(`handoff ${h.id.slice(0, 8)} completed`);
    return 0;
  }

  // write new handoff
  let summary = flagString(ctx.flags, "summary") ?? ctx.positional.slice(1).join(" ").trim();
  if (flagString(ctx.flags, "body") === "-") {
    summary = (await readStdin()).trim();
  }

  if (!summary) {
    ctx.out('usage: longmem handoff "summary" [--next "..."] [--blocked "..."] [--context "..."] [--plan FILE] [--task N] [--total N] [--base COMMIT] [--project] [--body -]');
    return 1;
  }

  const input: any = {
    summary,
    next: flagString(ctx.flags, "next") ?? undefined,
    blocked: flagString(ctx.flags, "blocked") ?? undefined,
    context: flagString(ctx.flags, "context") ?? undefined,
    scope: flagBool(ctx.flags, "project") ? "project" : "global",
    project_key: flagBool(ctx.flags, "project") ? ctx.projectKey : null,
  };

  const plan = flagString(ctx.flags, "plan");
  const task = flagString(ctx.flags, "task");
  const total = flagString(ctx.flags, "total");
  const base = flagString(ctx.flags, "base");
  if (plan || task || total || base) {
    input.task_ref = {};
    if (plan) input.task_ref.plan_file = plan;
    if (task) input.task_ref.task_number = Number(task);
    if (total) input.task_ref.total_tasks = Number(total);
    if (base) input.task_ref.base_commit = base;
  }

  try {
    const h = await ctx.client.handoff(input);
    ctx.out(`handoff ${h.id.slice(0, 8)} created (expires ${h.expires_at.slice(0, 10)})`);
    return 0;
  } catch (err: any) {
    ctx.out(`error: ${err?.message ?? String(err)}`);
    return 1;
  }
}