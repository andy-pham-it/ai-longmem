import { type Ctx, flagBool } from "../context.ts";
import { SECRET_PATTERNS } from "../core/validate.ts";

type Issue = { severity: "error" | "warn"; id: string; title: string; message: string };

export async function run(ctx: Ctx): Promise<number> {
  const response = await ctx.client.list({ status: "all", limit: 500 });
  const rows = response.entries as Array<{
    id: string;
    scope: string;
    project_key: string | null;
    kind: string;
    title: string;
    trigger: string;
    body: string;
    status: string;
    pinned: boolean;
    sensitive: boolean;
    reinforced_count: number;
  }>;

  const issues: Issue[] = [];

  for (const r of rows) {
    if (r.pinned && r.status !== "active") {
      issues.push({ severity: "error", id: r.id, title: r.title, message: "pinned but not active (auto-unpin should have cleared this)" });
    }
    if (r.body === "-" || r.body.trim().length < 20) {
      issues.push({ severity: "error", id: r.id, title: r.title, message: "body is empty or broken ('-')" });
    }
    const secretHit = SECRET_PATTERNS.find((p) => p.test(r.trigger) || p.test(r.body));
    if (secretHit) {
      issues.push({ severity: "error", id: r.id, title: r.title, message: `possible secret in ${secretHit.test(r.trigger) ? "trigger" : "body"}` });
    }
    if (r.trigger.trim().length < 10) {
      issues.push({ severity: "warn", id: r.id, title: r.title, message: "trigger is very short (< 10 chars)" });
    }
    if (/[^\x00-\x7F]/.test(r.title) || /[^\x00-\x7F]/.test(r.trigger)) {
      issues.push({ severity: "warn", id: r.id, title: r.title, message: "non-ASCII characters (possible non-English entry)" });
    }
    if (/^(smoke (pinned|project|entry)|probe of|review fix|test entry)/i.test(r.title)) {
      issues.push({ severity: "warn", id: r.id, title: r.title, message: "looks like a test/acceptance artifact" });
    }
  }

  if (issues.length === 0) {
    ctx.out("lint: no issues found");
    return 0;
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");

  if (errors.length > 0) {
    ctx.out(`lint: ${errors.length} error(s), ${warns.length} warning(s)`);
    for (const i of errors) ctx.out(`  ERROR ${i.id.slice(0, 8)} ${i.title} — ${i.message}`);
  }
  if (warns.length > 0) {
    if (errors.length === 0) ctx.out(`lint: 0 errors, ${warns.length} warning(s)`);
    for (const i of warns) ctx.out(`  WARN  ${i.id.slice(0, 8)} ${i.title} — ${i.message}`);
  }

  return errors.length > 0 ? 1 : 0;
}