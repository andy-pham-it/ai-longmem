import { describe, expect, it } from "vitest";
import {
  DEFAULT_INDEX_BYTES,
  type IndexRow,
  renderIndex,
} from "../src/core/render.ts";

function row(over: Partial<IndexRow> = {}): IndexRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    kind: "lesson",
    scope: "global",
    title: "Never claim done",
    trigger: "before saying finished",
    pinned: false,
    reinforced_count: 0,
    project_key: null,
    ...over,
  };
}

describe("renderIndex", () => {
  it("renders title and trigger on one line per entry", () => {
    const r = renderIndex(
      [row({ kind: "lesson", title: "Never claim done", trigger: "before saying finished" })],
      8192,
    );
    expect(r.block).toContain("- [lesson] Never claim done — before saying finished");
  });

  it("never cuts a line in half", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ title: `T${i}`, trigger: "x".repeat(100) }));
    const r = renderIndex(rows, 500);
    expect(r.truncated).toBe(true);
    for (const line of r.block.trim().split("\n")) {
      expect(line.startsWith("- [") || line.startsWith("## ")).toBe(true);
    }
    expect(new TextEncoder().encode(r.block).length).toBeLessThanOrEqual(500);
  });

  it("counts bytes, not code units, for Vietnamese text", () => {
    const r = renderIndex([row({ title: "Kiểm tra kỹ", trigger: "trước khi báo xong" })], 8192);
    expect(r.bytes).toBe(new TextEncoder().encode(r.block).length);
  });

  it("returns an empty catalogue without throwing", () => {
    expect(renderIndex([], 8192)).toMatchObject({ total: 0, truncated: false });
  });

  it("reports the full count even when truncated", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ title: `T${i}`, trigger: "y".repeat(100) }));
    const r = renderIndex(rows, 400);
    expect(r.total).toBe(30);
    expect(r.truncated).toBe(true);
  });

  it("defaults to 8192 bytes", () => {
    expect(DEFAULT_INDEX_BYTES).toBe(8192);
  });

  it("never emits a partial UTF-8 character at the cut", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ title: `Kiểm ${i}`, trigger: "ử".repeat(80) }));
    const block = renderIndex(rows, 300).block;
    expect(() => new TextEncoder().encode(block)).not.toThrow();
    expect(block).not.toContain("\uFFFD");
    expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(block))).toBe(block);
  });
});
