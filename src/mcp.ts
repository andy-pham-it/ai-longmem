import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConfigError, loadConfig } from "./config.ts";
import { createClient } from "./transport.ts";
import type { Core } from "./core/operations.ts";
import { formatEntries } from "./format.ts";
import { detectProjectKey } from "./projectKey.ts";
import { type MemoryRow } from "./core/types.ts";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const KINDS = ["lesson", "mistake", "misunderstanding", "preference", "fact"] as const;

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError: isError || undefined };
}

function formatRow(r: MemoryRow): string {
  const proj = r.project_key ? `  project=${r.project_key}` : "";
  const pin = r.pinned ? "  PINNED" : "";
  const sens = r.sensitive ? "  SENSITIVE" : "";
  return `${r.id.slice(0, 8)}  [${r.scope}] [${r.status}] [${r.kind}]${pin}${sens}${proj}  ${r.title}\n  r=${r.reinforced_count} c=${r.recall_count}`;
}

export async function callTool(
  client: Core | null,
  configError: string | null,
  name: string,
  args: Record<string, unknown>,
  projectKey: string | null,
): Promise<ToolResult> {
  if (configError || !client) {
    return textResult(`longmem not configured: ${configError ?? "missing client"}`, true);
  }
  const pk = (typeof args.project_key === "string" && args.project_key.trim() !== "")
    ? args.project_key.trim()
    : projectKey;

  try {
    switch (name) {
      case "longmem_index": {
        const maxBytes = typeof args.max_bytes === "number" ? args.max_bytes : 8192;
        const r = await client.index(pk, maxBytes);
        const footer = `\n\n(${r.total} entries, ${r.bytes} bytes${r.truncated ? ", truncated" : ""})`;
        return textResult((r.block || "(empty index)") + footer);
      }
      case "longmem_lessons": {
        const context = String(args.context ?? "").trim();
        if (!context) return textResult("context is required", true);
        const rows = await client.related(context, pk);
        if (rows.length === 0) return textResult("no related entries");
        return textResult(formatEntries(rows as any));
      }
      case "longmem_recall": {
        const query = String(args.query ?? "").trim();
        if (!query) return textResult("query is required", true);
        const rows = await client.recall(query, {
          kinds: Array.isArray(args.kinds) ? (args.kinds as string[]) : undefined,
          tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
          limit: typeof args.limit === "number" ? args.limit : 5,
          projectKey: pk,
        });
        if (rows.length === 0) return textResult("no entries");
        return textResult(formatEntries(rows as any));
      }
      case "longmem_write": {
        const input: any = {
          kind: args.kind,
          title: args.title,
          trigger: args.trigger,
          body: args.body,
          tags: Array.isArray(args.tags) ? args.tags : [],
          pinned: args.pinned === true,
          sensitive: args.sensitive === true,
          scope: args.scope,
          project_key: pk,
          force: args.force === true,
        };
        const res = await client.write(input);
        if (res.action === "needs_decision") {
          const existing = res.existing as any;
          return textResult(
            `needs_decision (similarity ${((res.similarity ?? 0) * 100).toFixed(0)}%)\n` +
            `Existing: ${existing?.id ?? "?"} — ${existing?.title ?? ""}\n` +
            `Options: reinforce (longmem_reinforce), supersede (longmem_supersede), or reword + force=true.`,
          );
        }
        return textResult(`${res.action}: ${res.id ?? ""}`.trim());
      }
      case "longmem_reinforce": {
        const id = String(args.id ?? "").trim();
        if (!id) return textResult("id is required", true);
        const row = await client.reinforce(id);
        return textResult(`reinforced: ${row.id} (count=${row.reinforced_count})`);
      }
      case "longmem_supersede": {
        const id = String(args.id ?? "").trim();
        if (!id) return textResult("id is required", true);
        const row = await client.supersede(id, {
          kind: String(args.kind ?? "lesson"),
          title: String(args.title ?? ""),
          trigger: String(args.trigger ?? ""),
          body: String(args.body ?? ""),
          tags: Array.isArray(args.tags) ? args.tags : [],
          pinned: args.pinned === true,
          sensitive: args.sensitive === true,
          scope: args.scope,
          project_key: pk,
        } as any);
        return textResult(`superseded: ${row.id} (replaces ${id})`);
      }
      case "longmem_promote": {
        const id = String(args.id ?? "").trim();
        const scope = String(args.scope ?? "").trim();
        if (!id || !scope) return textResult("id and scope are required", true);
        const row = await client.promote(id);
        return textResult(`promoted: ${row.id} → scope=${row.scope} project_key=${row.project_key ?? "null"}`);
      }
      case "longmem_update": {
        const id = String(args.id ?? "").trim();
        if (!id) return textResult("id is required", true);
        const patch: any = {};
        for (const k of ["kind", "title", "trigger", "body", "scope", "pinned", "sensitive"]) {
          if (args[k] !== undefined) patch[k] = args[k];
        }
        if (Array.isArray(args.tags)) patch.tags = args.tags;
        const row = await client.update(id, patch);
        return textResult(`updated: ${row.id}`);
      }
      case "longmem_list": {
        const filter: any = {};
        if (args.scope) filter.scope = args.scope;
        if (pk) filter.project_key = pk;
        if (args.kind) filter.kind = args.kind;
        if (args.tag) filter.tag = args.tag;
        if (args.status) filter.status = args.status;
        if (typeof args.limit === "number") filter.limit = args.limit;
        const r = await client.list(filter);
        if (r.entries.length === 0) return textResult("no entries");
        const lines = r.entries.map(formatRow).join("\n");
        return textResult(`${lines}\n\ntotal ${r.total}`);
      }
      case "longmem_candidates": {
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const r = await client.list({ status: "active", limit: 500 });
        const rows = r.entries.filter((row: any) => row.scope === "global" || row.project_key === pk);
        const newest = [...rows].sort((a: any, b: any) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).slice(0, limit);
        const lines = [
          "Before writing, the entry must pass all five:",
          "  1. The trigger names a situation you will recognise later, not a mood.",
          "  2. The body names what it cost and what to do instead.",
          "  3. One claim per entry. A chat summary is not an entry.",
          "  4. If it names a file, service or repo, pass --project.",
          "  5. If a similar title exists, reinforce or supersede instead of adding.",
          "",
          "Newest active entries (avoid duplicating these):",
        ];
        if (newest.length === 0) lines.push("  (none)");
        else for (const row of newest) lines.push(`  - [${row.kind}] ${row.title} — ${row.trigger}\n    ${row.id}`);
        return textResult(lines.join("\n"));
      }
      case "longmem_status": {
        const h = await client.health();
        const c = await client.status();
        const idx = await client.index(pk, 8192);
        const lines = [
          `health: ${h ? "ok" : "down"}`,
          `counts: ${JSON.stringify(c.counts)}`,
          `index: ${idx.bytes} bytes, ${idx.total} entries${idx.truncated ? " (truncated)" : ""}`,
        ];
        return textResult(lines.join("\n"));
      }
      case "longmem_handoff": {
        const input: any = {
          summary: args.summary,
          next: args.next,
          blocked: args.blocked,
          context: args.context,
          task_ref: args.task_ref,
          scope: args.scope,
          project_key: pk,
        };
        const hr = await client.handoff(input);
        return textResult(`handoff ${hr.id.slice(0, 8)} created (expires ${hr.expires_at.slice(0, 10)})\n${hr.summary}`);
      }
      case "longmem_resume": {
        const hr = await client.resume(pk);
        if (!hr) return textResult("no active handoff");
        const lines = [
          `## Session handoff (from ${hr.created_at.slice(0, 10)})`,
          `Done: ${hr.summary}`,
        ];
        if (hr.next) lines.push(`Next: ${hr.next}`);
        if (hr.blocked) lines.push(`Blocked: ${hr.blocked}`);
        if (hr.task_ref?.plan_file) {
          const t = hr.task_ref.task_number;
          const total = hr.task_ref.total_tasks;
          const taskStr = t && total ? `Task ${t}/${total}` : t ? `Task ${t}` : "";
          lines.push(`Task: ${taskStr} of ${hr.task_ref.plan_file}`);
        }
        if (hr.context) lines.push(`Context: ${hr.context}`);
        lines.push(`Expires: ${hr.expires_at.slice(0, 10)}`);
        return textResult(lines.join("\n"));
      }
      default:
        return textResult(`unknown tool: ${name}`, true);
    }
  } catch (err: any) {
    return textResult(`longmem error: ${err?.message ?? String(err)}`, true);
  }
}

export async function buildServer(): Promise<McpServer> {
  const server = new McpServer({ name: "longmem", version: "0.1.0" });

  const projectKey = detectProjectKey(process.cwd());

  let cfgResult: any = null;
  let errResult: string | null = null;
  try {
    cfgResult = loadConfig();
  } catch (e: any) {
    errResult = e?.message ?? String(e);
  }

  let client: Core | null = null;
  if (cfgResult) {
    try { client = await createClient(cfgResult); } catch (e: any) { errResult = e?.message ?? String(e); }
  }
  const cfgErr = errResult ?? (cfgResult ? null : "not configured");

  const wrap = (name: string) => async (args: any) => {
    const r = await callTool(client, cfgErr, name, args ?? {}, projectKey);
    return { content: r.content, isError: r.isError };
  };

  const zStr = z.string().optional();
  const zStrReq = z.string();
  const zNum = z.number().optional();
  const zArr = z.array(z.string()).optional();
  const zBool = z.boolean().optional();

  server.registerTool("longmem_index", {
    description: "Return the longmem index block (titles + triggers) for the current project.",
    inputSchema: { project_key: zStr, max_bytes: zNum },
  }, wrap("longmem_index"));

  server.registerTool("longmem_lessons", {
    description: "Return longmem entries whose triggers match the given situation.",
    inputSchema: { context: zStrReq, project_key: zStr },
  }, wrap("longmem_lessons"));

  server.registerTool("longmem_recall", {
    description: "Keyword search over longmem entries; returns bodies.",
    inputSchema: { query: zStrReq, kinds: zArr, tags: zArr, limit: zNum, project_key: zStr },
  }, wrap("longmem_recall"));

  server.registerTool("longmem_write", {
    description: "Write a new longmem entry (proposes; dedupe may return needs_decision).",
    inputSchema: {
      kind: z.enum(KINDS as any),
      title: z.string(),
      trigger: z.string(),
      body: z.string(),
      tags: zArr,
      pinned: zBool,
      sensitive: zBool,
      scope: z.enum(["global", "project"]).optional(),
      project_key: zStr,
      force: zBool,
    },
  }, wrap("longmem_write"));

  server.registerTool("longmem_reinforce", {
    description: "Reinforce an existing entry (reinforced_count += 1).",
    inputSchema: { id: zStrReq },
  }, wrap("longmem_reinforce"));

  server.registerTool("longmem_supersede", {
    description: "Supersede an old entry with a new one (atomic).",
    inputSchema: {
      id: zStrReq,
      kind: z.enum(KINDS as any),
      title: z.string(),
      trigger: z.string(),
      body: z.string(),
      tags: zArr,
      pinned: zBool,
      sensitive: zBool,
      scope: z.enum(["global", "project"]).optional(),
      project_key: zStr,
    },
  }, wrap("longmem_supersede"));

  server.registerTool("longmem_promote", {
    description: "Promote an entry from project scope to global.",
    inputSchema: { id: zStrReq, scope: z.enum(["global", "project"]) },
  }, wrap("longmem_promote"));

  server.registerTool("longmem_update", {
    description: "Update fields of an existing entry (re-runs validation).",
    inputSchema: {
      id: zStrReq,
      kind: z.enum(KINDS as any).optional(),
      title: z.string().optional(),
      trigger: z.string().optional(),
      body: z.string().optional(),
      tags: zArr,
      pinned: zBool,
      sensitive: zBool,
      scope: z.enum(["global", "project"]).optional(),
    },
  }, wrap("longmem_update"));

  server.registerTool("longmem_list", {
    description: "List longmem entries with filters.",
    inputSchema: {
      scope: z.enum(["global", "project", "all"]).optional(),
      project_key: zStr,
      kind: z.string().optional(),
      tag: z.string().optional(),
      status: z.enum(["active", "superseded", "archived", "all"]).optional(),
      limit: zNum,
    },
  }, wrap("longmem_list"));

  server.registerTool("longmem_candidates", {
    description: "Print the capture checklist and the 10 newest active entries.",
    inputSchema: { limit: zNum },
  }, wrap("longmem_candidates"));

  server.registerTool("longmem_handoff", {
    description: "Write a session handoff (state snapshot for the next session).",
    inputSchema: {
      summary: z.string(),
      next: z.string().optional(),
      blocked: z.string().optional(),
      context: z.string().optional(),
      task_ref: z.object({
        plan_file: z.string().optional(),
        task_number: z.number().optional(),
        total_tasks: z.number().optional(),
        base_commit: z.string().optional(),
      }).optional(),
      scope: z.enum(["global", "project"]).optional(),
      project_key: z.string().optional(),
    },
  }, wrap("longmem_handoff"));

  server.registerTool("longmem_resume", {
    description: "Read the latest session handoff.",
    inputSchema: {},
  }, wrap("longmem_resume"));

  server.registerTool("longmem_status", {
    description: "Health, counts, and index size.",
    inputSchema: {},
  }, wrap("longmem_status"));

  server.registerResource("longmem-index", "longmem://index", { description: "The longmem index block" }, async () => ({
    contents: [{ uri: "longmem://index", mimeType: "text/plain", text: (await client?.index(projectKey, 8192))?.block ?? "" }],
  }));

  server.registerResource("longmem-status", "longmem://status", { description: "Counts and health" }, async () => ({
    contents: [{ uri: "longmem://status", mimeType: "text/plain", text: (await callTool(client, cfgErr, "longmem_status", {}, projectKey)).content[0].text }],
  }));

  return server;
}

export async function runServer(): Promise<void> {
  const server = await buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // keep alive
  process.on("SIGINT", async () => { await server.close(); process.exit(0); });
  process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
}

// entry point when run directly
const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""));
if (isMain) {
  runServer().catch((e) => { console.error(e); process.exit(1); });
}
