import { describe, expect, it } from "vitest";
import { PLATITUDES, type NewEntry, validateEntry } from "../src/core/validate.ts";

function entry(over: Partial<NewEntry> = {}): NewEntry {
  return {
    kind: "lesson",
    title: "Check the rewrite before calling a deploy live",
    trigger: "before claiming a deployment succeeded",
    body:
      "2026-11-20. Reported a deploy as live from the CLI exit code; the page 404d for ten minutes " +
      "because the rewrite was missing. Do instead: load the URL and check the response first.",
    ...over,
  };
}

describe("validateEntry", () => {
  it("rejects a missing trigger", () => {
    expect(validateEntry(entry({ trigger: "" }))).toMatchObject({ ok: false, field: "trigger" });
  });

  it("rejects a platitude trigger", () => {
    for (const t of ["be careful", "double-check everything", "pay attention to details"]) {
      expect(validateEntry(entry({ trigger: t }))).toMatchObject({ ok: false, field: "trigger" });
    }
  });

  it("rejects a body with no correction", () => {
    expect(validateEntry(entry({ body: "The user was annoyed." }))).toMatchObject({ ok: false, field: "body" });
  });

  it("rejects project scope without project_key and global scope with one", () => {
    expect(validateEntry(entry({ scope: "project", project_key: null }))).toMatchObject({ ok: false });
    expect(validateEntry(entry({ scope: "global", project_key: "x" }))).toMatchObject({ ok: false });
  });

  it("accepts a concrete situation trigger", () => {
    expect(validateEntry(entry({ trigger: "before claiming a deployment succeeded" })).ok).toBe(true);
  });

  it("defaults scope to global", () => {
    const r = validateEntry(entry({ scope: undefined }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.scope).toBe("global");
  });

  it("rejects an unknown kind", () => {
    expect(validateEntry(entry({ kind: "rant" }))).toMatchObject({ ok: false, field: "kind" });
  });

  it("rejects a title over 120 characters and a trigger over 200", () => {
    expect(validateEntry(entry({ title: "x".repeat(121) }))).toMatchObject({ ok: false, field: "title" });
    expect(validateEntry(entry({ trigger: "y".repeat(201) }))).toMatchObject({ ok: false, field: "trigger" });
  });

  it("exposes the platitude patterns", () => {
    expect(PLATITUDES.some((re) => re.test("be careful"))).toBe(true);
  });
});
