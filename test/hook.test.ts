import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "hooks", "inject-index.ts");
const TSX = "/Users/admin/.nvm/versions/node/v22.22.3/bin/npx";
const NODE_BIN = "/Users/admin/.nvm/versions/node/v22.22.3/bin";

describe("inject-index hook", () => {
  it("exits 0 and produces no stdout when config is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "hook-"));
    const res = spawnSync(TSX, ["tsx", SCRIPT], { cwd: dir, env: { ...process.env, LONGMEM_CONFIG: join(dir, "nope.json") }, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
    rmSync(dir, { recursive: true, force: true });
  });

  it("output (when configured) is valid JSON with additionalContext and <=10000 chars", () => {
    const cfg = process.env.LONGMEM_CONFIG;
    if (!cfg) return;
    const dir = mkdtempSync(join(tmpdir(), "hook-"));
    const input = JSON.stringify({ cwd: dir });
    const res = spawnSync(TSX, ["tsx", SCRIPT], { cwd: dir, input, env: process.env, encoding: "utf8" });
    expect(res.status).toBe(0);
    if (res.stdout.trim() === "") return;
    const parsed = JSON.parse(res.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
    expect(parsed.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(10000);
    rmSync(dir, { recursive: true, force: true });
  });
});
