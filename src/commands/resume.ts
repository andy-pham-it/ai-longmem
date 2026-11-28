import { type Ctx, flagBool } from "../context.ts";
import type { HandoffRow } from "../core/types.ts";

function formatHandoff(h: HandoffRow): string {
  const lines: string[] = [];
  lines.push(`## Session handoff (from ${h.created_at.slice(0, 10)})`);
  lines.push(`Done: ${h.summary}`);
  if (h.next) lines.push(`Next: ${h.next}`);
  if (h.blocked) lines.push(`Blocked: ${h.blocked}`);
  if (h.task_ref?.plan_file) {
    const t = h.task_ref.task_number;
    const total = h.task_ref.total_tasks;
    const taskStr = t && total ? `Task ${t}/${total}` : t ? `Task ${t}` : "";
    lines.push(`Task: ${taskStr} of ${h.task_ref.plan_file}${h.task_ref.base_commit ? ` (base: ${h.task_ref.base_commit})` : ""}`);
  }
  if (h.context) lines.push(`Context: ${h.context}`);
  lines.push(`Expires: ${h.expires_at.slice(0, 10)}`);
  return lines.join("\n");
}

export async function run(ctx: Ctx): Promise<number> {
  const h = await ctx.client.resume(ctx.projectKey);
  if (!h) {
    ctx.out("no active handoff");
    return 0;
  }
  if (flagBool(ctx.flags, "json")) {
    ctx.out(JSON.stringify(h, null, 2));
  } else {
    ctx.out(formatHandoff(h));
  }
  return 0;
}