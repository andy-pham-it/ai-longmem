import { expect, test } from "vitest";
import { createCore } from "../../src/core/operations.ts";
import { makeFakeStore } from "./fake-store.ts";

test("write rejects a near-duplicate with needs_decision, force creates it", async () => {
  const core = createCore(makeFakeStore());
  const input = { kind: "lesson", title: "Check the flag", trigger: "After adding a CLI flag", body: "The flag was dropped silently; the smoke test lied." };
  expect((await core.write(input)).action).toBe("created");
  const dup = await core.write({ ...input, title: "Check the flags" });
  expect(dup.action).toBe("needs_decision");
  expect(dup.similarity).toBeGreaterThan(0.7);
  expect((await core.write({ ...input, title: "Check the flags", force: true })).action).toBe("created");
});

test("sensitive entries stay out of index and related but are recallable explicitly", async () => {
  const store = makeFakeStore();
  const core = createCore(store);
  await core.write({ kind: "fact", title: "SIT credential", trigger: "Logging into SIT admin", body: "Credentials live in the vault, rotate quarterly.", sensitive: true });
  expect((await core.index(null)).total).toBe(0);
  expect(await core.related("Logging into SIT admin")).toEqual([]);
  expect((await core.recall("SIT credential")).length).toBe(1);
});
