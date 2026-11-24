import { describe, expect, test } from "vitest";
import { formatListRow, type ListRow } from "../src/commands/list.ts";

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    id: "714353b5-6f0e-40e8-a626-13efc1fac913",
    scope: "global",
    project_key: null,
    kind: "lesson",
    title: "Verify the image",
    trigger: "After revert",
    status: "active",
    pinned: false,
    sensitive: false,
    reinforced_count: 0,
    recall_count: 0,
    created_at: "2026-11-24T00:00:00Z",
    updated_at: "2026-11-24T00:00:00Z",
    ...overrides,
  };
}

describe("formatListRow", () => {
  test("shows scope, status and title for a plain global entry", () => {
    const line = formatListRow(row());
    expect(line).toContain("714353b5");
    expect(line).toContain("[global] [active] [lesson]");
    expect(line).toContain("Verify the image");
    expect(line).not.toContain("KEY=");
    expect(line).not.toContain("SENSITIVE");
    expect(line).not.toContain("PINNED");
  });

  test("marks a sensitive, pinned project entry and shows its counts", () => {
    const line = formatListRow(row({
      scope: "project",
      project_key: "github.com/andy-pham-it/andy-porfolio",
      sensitive: true,
      pinned: true,
      reinforced_count: 3,
      recall_count: 7,
    }));
    expect(line).toContain("KEY=github.com/andy-pham-it/andy-porfolio");
    expect(line).toContain("SENSITIVE");
    expect(line).toContain("PINNED");
    expect(line).toContain("r=3 c=7");
  });
});
