import { request, RequestError } from "../client.ts";
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

  const payload: Record<string, unknown> = {
    kind,
    title,
    trigger,
    body: body.trim(),
    tags: flagList(ctx.flags, "tag"),
  };
  if (flagBool(ctx.flags, "project")) {
    payload.scope = "project";
    payload.project_key = ctx.projectKey;
  }
  if (flagBool(ctx.flags, "pinned")) payload.pinned = true;
  if (flagBool(ctx.flags, "sensitive")) payload.sensitive = true;
  if (flagBool(ctx.flags, "force")) payload.force = true;
  const replaces = flagString(ctx.flags, "replaces");
  if (replaces) payload.replaces = replaces;

  try {
    const response = await request<{ entry: { id: string }; warning?: string }>(ctx.cfg, "/write", {
      method: "POST",
      body: payload,
    });
    ctx.out(`created ${response.entry.id}`);
    if (response.warning) ctx.out(`warning: ${response.warning}`);
    return 0;
  } catch (error) {
    if (error instanceof RequestError && error.status === 409) {
      let decision: { existing?: { id: string; title: string; similarity: number }; options?: string[] } = {};
      try {
        decision = JSON.parse(error.body);
      } catch {
        // fall through with an empty decision
      }
      ctx.out("needs_decision: a similar entry already exists");
      if (decision.existing) {
        ctx.out(`  ${decision.existing.title} (${decision.existing.id}) similarity ${decision.existing.similarity.toFixed(2)}`);
      }
      ctx.out(`  options: ${(decision.options ?? ["reinforce", "supersede", "force"]).join(" | ")}`);
      return 2;
    }
    throw error;
  }
}
