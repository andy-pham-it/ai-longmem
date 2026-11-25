import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LONGMEM_RULES } from "../src/instructions.ts";

const AGENTS = ["claude-code", "codex", "cursor", "gemini", "copilot", "aider", "generic"];

describe("adapters", () => {
  for (const agent of AGENTS) {
    it(`adapters/${agent} exists and contains LONGMEM_RULES`, () => {
      const ext = agent === "cursor" ? "mdc" : "md";
      const path = join(process.cwd(), "adapters", `${agent}.${ext}`);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf8");
      expect(content).toContain(LONGMEM_RULES);
    });
  }

  it("adapters/cursor.mdc has alwaysApply frontmatter", () => {
    const content = readFileSync(join(process.cwd(), "adapters", "cursor.mdc"), "utf8");
    expect(content).toMatch(/^---\n[\s\S]*alwaysApply:\s*true[\s\S]*\n---/);
  });
});
