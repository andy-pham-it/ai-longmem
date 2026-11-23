import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMEOUT_MS,
  UnauthorizedError,
  UnreachableError,
  request,
} from "../src/client.ts";

const cfg = { endpoint: "https://x", token: "a".repeat(32) };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("sends the bearer token and returns parsed JSON", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const out = await request<{ ok: boolean }>(cfg, "/health", {});
    expect(out).toEqual({ ok: true });
    expect(f.mock.calls[0][1].headers.authorization).toBe(`Bearer ${cfg.token}`);
    expect(f.mock.calls[0][0]).toBe("https://x/health");
  });

  it("appends query parameters to the path", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await request(cfg, "/index", { query: { project_key: "github.com/a/b", bytes: "1024" } });
    expect(f.mock.calls[0][0]).toBe("https://x/index?project_key=github.com%2Fa%2Fb&bytes=1024");
  });

  it("maps 401 to UnauthorizedError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    await expect(request(cfg, "/health", {})).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps other non-2xx responses to a RequestError carrying status and body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"bad"}', { status: 400 })));
    await expect(request(cfg, "/write", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "RequestError",
      status: 400,
    });
  });

  it("aborts and throws UnreachableError after timeoutMs", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    await expect(request(cfg, "/health", { timeoutMs: 10 })).rejects.toBeInstanceOf(UnreachableError);
  });

  it("defaults to a 10 s timeout: a cold start must not report failure for a write that happened", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});
