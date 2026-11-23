export type Entry = {
  id: string;
  kind: string;
  title: string;
  trigger: string;
  body: string;
  scope?: string;
  project_key?: string | null;
  status?: string;
  tags?: string[];
  pinned?: boolean;
  reinforced_count?: number;
  recall_count?: number;
  created_at?: string;
  updated_at?: string;
  score?: number;
  replaces?: { id: string; title: string; created_at: string } | null;
};

function indent(text: string, prefix = "  "): string {
  return text
    .trim()
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

export function formatEntry(entry: Entry): string {
  const lines = [`[${entry.kind}] ${entry.title}`];
  if (entry.scope === "project" && entry.project_key) lines.push(`  project: ${entry.project_key}`);
  if (typeof entry.score === "number") lines.push(`  score: ${entry.score.toFixed(3)}`);
  lines.push(`  when: ${entry.trigger}`);
  lines.push(indent(entry.body));
  if (entry.reinforced_count && entry.reinforced_count > 0) {
    lines.push(`  reinforced: ${entry.reinforced_count}`);
  }
  if (entry.replaces) {
    lines.push(`  replaces: ${entry.replaces.title} (${entry.replaces.id})`);
  }
  lines.push(`  id: ${entry.id}`);
  return lines.join("\n");
}

export function formatEntries(entries: Entry[]): string {
  if (entries.length === 0) return "no entries";
  return entries.map(formatEntry).join("\n\n");
}
