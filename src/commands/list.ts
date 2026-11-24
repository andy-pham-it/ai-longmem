import { request } from "../client.ts";
import { flagBool, flagNumber, flagString, type Ctx } from "../context.ts";

export type ListRow = {
  id: string;
  scope: string;
  project_key: string | null;
  kind: string;
  title: string;
  trigger: string;
  status: string;
  pinned: boolean;
  sensitive: boolean;
  reinforced_count: number;
  recall_count: number;
  created_at: string;
  updated_at: string;
};

type ListResponse = { entries: ListRow[]; total: number };

/** One line per entry. Sensitive rows stay visible because this is an explicit audit. */
export function formatListRow(row: ListRow): string {
  const tags = [
    `[${row.scope}]`,
    `[${row.status}]`,
    `[${row.kind}]`,
    ...(row.pinned ? ["PINNED"] : []),
    ...(row.sensitive ? ["SENSITIVE"] : []),
  ].join(" ");
  const key = row.project_key ? ` KEY=${row.project_key}` : "";
  return `${row.id.slice(0, 8)} ${tags}${key} ${row.title} r=${row.reinforced_count} c=${row.recall_count}`;
}

export async function run(ctx: Ctx): Promise<number> {
  const scope = flagString(ctx.flags, "scope") ?? "all";
  const status = flagString(ctx.flags, "status") ?? "active";
  const project = flagString(ctx.flags, "project");
  const kind = flagString(ctx.flags, "kind");
  const tag = flagString(ctx.flags, "tag");
  const limit = flagNumber(ctx.flags, "limit") ?? 100;

  const response = await request<ListResponse>(ctx.cfg, "/list", {
    query: {
      ...(scope !== "all" ? { scope } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(project ? { project_key: project } : {}),
      ...(kind ? { kind } : {}),
      ...(tag ? { tag } : {}),
      limit: String(limit),
    },
  });

  if (flagBool(ctx.flags, "json")) {
    ctx.out(JSON.stringify(response, null, 2));
    return 0;
  }
  for (const row of response.entries) ctx.out(formatListRow(row));
  ctx.out(`total ${response.total}`);
  return 0;
}
