import { expect, test } from "vitest";
import { createClient, loadConfig } from "../src/transport.ts";

test("sqlite config yields an in-process client with no endpoint or token", async () => {
  const client = await createClient({ kind: "sqlite", path: ":memory:" });
  expect((await client.status()).counts).toBeDefined();
  expect((await client.write({ kind: "lesson", title: "Local entry", trigger: "Working offline", body: "The local store worked without cloud credentials." })).action).toBe("created");
  expect((await client.index(null)).block).toContain("Local entry");
});

test("legacy config without kind is read as http", async () => {
  const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "longmem-")), "longmem.json");
  writeFileSync(file, JSON.stringify({ endpoint: "https://example.invalid/functions/v1/longmem", token: "x".repeat(64) }));
  chmodSync(file, 0o600);
  expect(loadConfig({ LONGMEM_CONFIG: file }).kind).toBe("http");
});

test("the http client never writes in the read-only contract", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(JSON.stringify({ ok: true, counts: {} }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = await createClient({ kind: "http", endpoint: "https://example.invalid/functions/v1/longmem", token: "x".repeat(64) });
    await client.status();
    await client.index(null);
    await client.list({ status: "active", limit: 10 });
    await client.recall("example");
    const mutating = calls.filter((c) => /\/(write|supersede|update|promote|reinforce)\b/.test(c));
    expect(mutating).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
