import { expect, test } from "vitest";
import { server } from "../plugin/longmem.ts";

test("a local config with no cliPath fails silently", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "longmem-"));
  const file = join(dir, "longmem.json");
  writeFileSync(file, JSON.stringify({ kind: "sqlite", path: ":memory:" }));
  process.env.LONGMEM_CONFIG = file;
  try {
    const hooks = await (server as any)({ directory: "/tmp" });
    const hook = hooks?.["experimental.chat.system.transform"];
    const output = { system: ["base"] };
    await hook({ sessionID: "test", model: {} }, output);
    expect(output.system).toEqual(["base"]);
  } finally {
    delete process.env.LONGMEM_CONFIG;
  }
});
