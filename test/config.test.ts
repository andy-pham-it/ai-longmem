import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

function writeConfig(body: unknown, mode: number): string {
  const dir = mkdtempSync(join(tmpdir(), "longmem-test-"));
  const p = join(dir, "longmem.json");
  writeFileSync(p, JSON.stringify(body));
  chmodSync(p, mode);
  return p;
}

describe("loadConfig", () => {
  it("throws ConfigError naming the path when the config file is missing", () => {
    const env = { LONGMEM_CONFIG: "/tmp/nope/longmem.json" };
    expect(() => loadConfig(env)).toThrow(/\/tmp\/nope\/longmem\.json/);
  });

  it("throws when the config file is group- or world-readable", () => {
    const p = writeConfig({ endpoint: "https://x", token: "a".repeat(32) }, 0o644);
    expect(() => loadConfig({ LONGMEM_CONFIG: p })).toThrow(/0600/);
  });

  it("returns endpoint and token for a valid 0600 file", () => {
    const p = writeConfig({ endpoint: "https://x", token: "a".repeat(32) }, 0o600);
    expect(loadConfig({ LONGMEM_CONFIG: p })).toEqual({
      kind: "http",
      endpoint: "https://x",
      token: "a".repeat(32),
    });
  });

  it("rejects a token shorter than 32 characters", () => {
    const p = writeConfig({ endpoint: "https://x", token: "short" }, 0o600);
    expect(() => loadConfig({ LONGMEM_CONFIG: p })).toThrow(/token/);
  });

  it("rejects a non-https endpoint", () => {
    const p = writeConfig({ endpoint: "http://x", token: "a".repeat(32) }, 0o600);
    expect(() => loadConfig({ LONGMEM_CONFIG: p })).toThrow(/https/);
  });
});
