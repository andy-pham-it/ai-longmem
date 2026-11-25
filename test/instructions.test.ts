import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LONGMEM_RULES } from "../src/instructions.ts";

describe("LONGMEM_RULES", () => {
  it("is non-empty and mentions the capture conditions", () => {
    expect(LONGMEM_RULES).toContain("Capture a lesson when");
    expect(LONGMEM_RULES).toContain("trigger");
    expect(LONGMEM_RULES).toContain("superseding");
  });

  it("matches the installed AGENTS.md block (no drift)", () => {
    const agentsPath = join(homedir(), ".config", "opencode", "AGENTS.md");
    let content = "";
    try { content = readFileSync(agentsPath, "utf8"); } catch { return; }
    const start = content.indexOf("<!-- LONGMEM_START -->");
    const end = content.indexOf("<!-- LONGMEM_END -->");
    if (start === -1 || end === -1) return;
    const block = content.slice(start, end + "<!-- LONGMEM_END -->".length);
    for (const line of LONGMEM_RULES.split("\n")) {
      if (line.trim() === "" || line.startsWith("##")) continue;
      expect(block).toContain(line.trim());
    }
  });
});