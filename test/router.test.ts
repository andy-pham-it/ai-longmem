import { describe, expect, it } from "vitest";
import { authorized, resolveRoute } from "../supabase/functions/_shared/router.ts";

describe("resolveRoute", () => {
  it("resolves the function subpath", () => {
    expect(resolveRoute("GET", "/functions/v1/longmem/index")).toEqual({ name: "index", method: "GET" });
  });

  it("resolves a bare path", () => {
    expect(resolveRoute("POST", "/write")).toEqual({ name: "write", method: "POST" });
  });

  it("rejects a method mismatch", () => {
    expect(resolveRoute("GET", "/write")).toBeNull();
  });

  it("rejects an unknown route", () => {
    expect(resolveRoute("GET", "/nope")).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(resolveRoute("GET", "/health/")).toEqual({ name: "health", method: "GET" });
  });
});

describe("authorized", () => {
  it("accepts only the exact bearer token", () => {
    expect(authorized("Bearer abc", "abc")).toBe(true);
    expect(authorized("Bearer abd", "abc")).toBe(false);
    expect(authorized(null, "abc")).toBe(false);
    expect(authorized("Basic abc", "abc")).toBe(false);
  });

  it("rejects a token of a different length", () => {
    expect(authorized("Bearer abcd", "abc")).toBe(false);
  });

  it("rejects an empty configured token", () => {
    expect(authorized("Bearer ", "")).toBe(false);
  });
});
