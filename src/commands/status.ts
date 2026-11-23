import { request } from "../client.ts";
import { type Ctx } from "../context.ts";

type Health = { ok: boolean; db: string };
type StatusResponse = {
  ok: boolean;
  counts: Record<string, unknown>;
  index: { bytes: number; total: number; truncated: boolean };
};

export async function run(ctx: Ctx): Promise<number> {
  ctx.out(`endpoint: ${ctx.cfg.endpoint}`);
  ctx.out(`project:  ${ctx.projectKey}`);

  let health: Health;
  try {
    health = await request<Health>(ctx.cfg, "/health", { timeoutMs: 5000 });
  } catch (error) {
    ctx.out(`health:   unreachable (${(error as Error).message})`);
    return 1;
  }
  ctx.out(`health:   ${health.ok ? "ok" : "down"}`);

  const status = await request<StatusResponse>(ctx.cfg, "/status", {
    query: { project_key: ctx.projectKey },
    timeoutMs: 5000,
  });
  const counts = status.counts as Record<string, number | Record<string, number>>;
  ctx.out(`entries:  ${counts.active ?? 0} active / ${counts.total ?? 0} total`);
  ctx.out(`pinned:   ${counts.pinned ?? 0}`);
  ctx.out(`index:    ${status.index.bytes} bytes, ${status.index.total} entries${status.index.truncated ? " (truncated)" : ""}`);
  const byKind = counts.by_kind;
  if (byKind && typeof byKind === "object") {
    for (const [kind, n] of Object.entries(byKind)) ctx.out(`  ${kind}: ${n}`);
  }
  return health.ok ? 0 : 1;
}
