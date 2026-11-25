import { describe, expect, it, vi } from "vitest";
import { callTool, type ToolResult } from "../src/mcp.ts";

function fakeCore(over: Partial<any> = {}) {
  return {
    index: vi.fn(async () => ({ block: "## Longmem (1 entry)\\n- [lesson] t — trig", bytes: 40, total: 1, truncated: false })),
    related: vi.fn(async () => [{ id: "r1", kind: "lesson", title: "t", trigger: "trig", body: "b", scope: "global", project_key: null, tags: [], status: "active", superseded_by: null, pinned: false, sensitive: false, source: null, agent_session: null, reinforced_count: 0, last_reinforced_at: null, recall_count: 0, last_recalled_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]),
    recall: vi.fn(async () => []),
    write: vi.fn(async () => ({ action: "created", id: "new-id" })),
    reinforce: vi.fn(async () => ({ id: "r1", reinforced_count: 1 })),
    supersede: vi.fn(async () => ({ id: "new-id" })),
    promote: vi.fn(async () => ({ id: "x", scope: "global", project_key: null })),
    update: vi.fn(async () => ({ id: "x" })),
    list: vi.fn(async () => ({ entries: [], total: 0 })),
    status: vi.fn(async () => ({ counts: { total: 0, active: 0 } })),
    health: vi.fn(async () => true),
    ...over,
  } as any;
}

describe("callTool", () => {
  it("longmem_index returns the block", async () => {
    const r: ToolResult = await callTool(fakeCore(), null, "longmem_index", {}, "proj");
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("## Longmem");
  });

  it("longmem_status works", async () => {
    const r = await callTool(fakeCore(), null, "longmem_status", {}, null);
    expect(r.isError).toBeFalsy();
  });

  it("returns isError when unconfigured", async () => {
    const r = await callTool(null, "config missing", "longmem_index", {}, null);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("config missing");
  });

  it("longmem_write needs_decision returns text not throw", async () => {
    const core = fakeCore({ write: vi.fn(async () => ({ action: "needs_decision", existing: { id: "e1", title: "dup" }, similarity: 0.9 })) });
    const r = await callTool(core, null, "longmem_write", { kind: "lesson", title: "dup", trigger: "t", body: "b".repeat(90) }, null);
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("needs_decision");
  });

  it("unknown tool returns isError", async () => {
    const r = await callTool(fakeCore(), null, "nope", {}, null);
    expect(r.isError).toBe(true);
  });

  it("longmem_recall with no results returns 'no entries'", async () => {
    const r = await callTool(fakeCore(), null, "longmem_recall", { query: "x" }, null);
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text.toLowerCase()).toContain("no");
  });

  it("longmem_lessons with no context returns error", async () => {
    const r = await callTool(fakeCore(), null, "longmem_lessons", {}, null);
    expect(r.isError).toBe(true);
  });

  it("longmem_list with empty result returns 'no entries'", async () => {
    const r = await callTool(fakeCore(), null, "longmem_list", {}, null);
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("no entries");
  });
});
