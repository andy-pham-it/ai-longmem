import { describe, expect, test } from "vitest";
import { normalize, tokenOverlap, trigramSimilarity, trigrams } from "../../src/core/normalize.ts";

describe("normalize", () => {
  test("strips Vietnamese tone marks and lowercases", () => {
    expect(normalize("Đổi Host")).toBe("doi host");
  });
  test("trigrams of a short word are the padded word plus its bigrams", () => {
    expect(trigrams("cat")).toContain("  c");
    expect(trigrams("cat")).toContain(" ca");
  });
  test("identical normalized strings have similarity 1", () => {
    expect(trigramSimilarity("Database Host", "database host")).toBe(1);
  });
  test("token overlap is containment of the smaller token set", () => {
    expect(tokenOverlap("docker host", "docker host unreachable")).toBe(1);
    expect(tokenOverlap("mysql proxy", "docker host unreachable")).toBe(0);
  });
});
