import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/cli.ts";

describe("parseArgs", () => {
  test("a bare --flag is recorded as true", () => {
    const { flags, positional } = parseArgs(["write", "--pinned", "--title", "t"]);
    expect(flags.pinned).toBe(true);
    expect(flags.title).toBe("t");
    expect(positional).toEqual(["write"]);
  });

  test("a repeated flag becomes an array", () => {
    const { flags } = parseArgs(["--tag", "a", "--tag", "b"]);
    expect(flags.tag).toEqual(["a", "b"]);
  });

  test("--k=v and --k v both bind the value", () => {
    expect(parseArgs(["--bytes=4096"]).flags.bytes).toBe("4096");
    expect(parseArgs(["--bytes", "4096"]).flags.bytes).toBe("4096");
  });

  test("--body - keeps the dash instead of treating it as a flag", () => {
    const { flags } = parseArgs(["--body", "-"]);
    expect(flags.body).toBe("-");
  });

  test("a bare flag followed by a flag stays boolean", () => {
    const { flags } = parseArgs(["--json", "--kind", "lesson"]);
    expect(flags.json).toBe(true);
    expect(flags.kind).toBe("lesson");
  });
});
