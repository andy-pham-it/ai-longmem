import { expect, test } from "vitest";
import { renderIndex } from "../../src/core/render.ts";

test("a line that would exceed the byte budget is skipped whole", () => {
  const rows = [
    { id: "1", kind: "lesson", scope: "global", title: "Short", trigger: "short trigger", pinned: false, reinforced_count: 0, project_key: null },
    { id: "2", kind: "lesson", scope: "global", title: "X".repeat(100), trigger: "Y".repeat(100), pinned: false, reinforced_count: 0, project_key: null },
  ];
  const r = renderIndex(rows, 128);
  expect(r.block).toContain("Short");
  expect(r.block).not.toContain("X".repeat(100));
  expect(r.truncated).toBe(true);
  expect(r.total).toBe(2);
  expect(new TextEncoder().encode(r.block).length).toBeLessThanOrEqual(128);
});
