export const DEFAULT_INDEX_BYTES = 8192;

export type IndexRow = {
  id: string;
  kind: string;
  scope: string;
  title: string;
  trigger: string;
  pinned: boolean;
  reinforced_count: number;
  project_key: string | null;
};

export type RenderedIndex = {
  block: string;
  bytes: number;
  total: number;
  truncated: boolean;
};

const encoder = new TextEncoder();

/**
 * Renders the catalogue under a byte budget. Lines are cut whole: a line that
 * does not fit is skipped, never split, because a half-rendered title is worse
 * than a missing one. Byte length, not string length, is the budget.
 */
export function renderIndex(rows: IndexRow[], maxBytes: number = DEFAULT_INDEX_BYTES): RenderedIndex {
  const total = rows.length;
  const header = `## Longmem (${total} ${total === 1 ? "entry" : "entries"})`;

  const headerBytes = encoder.encode(header).length;
  if (headerBytes > maxBytes) {
    return { block: "", bytes: 0, total, truncated: total > 0 };
  }

  const kept: string[] = [];
  let bytes = headerBytes;
  let truncated = false;

  for (const row of rows) {
    const line = `\n- [${row.kind}] ${row.title} — ${row.trigger}`;
    const lineBytes = encoder.encode(line).length;
    if (bytes + lineBytes > maxBytes) {
      truncated = true;
      continue;
    }
    kept.push(line);
    bytes += lineBytes;
  }

  const block = header + kept.join("");
  return { block, bytes: encoder.encode(block).length, total, truncated };
}
