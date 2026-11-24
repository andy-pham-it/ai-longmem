import { expect, test } from "vitest";
// runner only; real suites live in sqlite.test.ts / postgres.test.ts
test.skip("contract runner (no direct suite)", () => {});
import { createCore } from "../../src/core/operations.ts";
import type { MemoryStore } from "../../src/stores/memory-store.ts";

export function runStoreContract(name: string, makeStore: () => Promise<MemoryStore>): void {
  test(`${name}: dedupe conflict then force`, async () => {
    const core = createCore(await makeStore());
    const input = { kind: "lesson", title: "Check the flag", trigger: "After adding a CLI flag", body: "The flag was dropped silently; the smoke test lied." };
    expect((await core.write(input)).action).toBe("created");
    const dup = await core.write({ ...input, title: "Check the flags" });
    expect(dup.action).toBe("needs_decision");
    expect((await core.write({ ...input, title: "Check the flags", force: true })).action).toBe("created");
  });

  test(`${name}: one-hop replaces and byte budget`, async () => {
    const core = createCore(await makeStore());
    const first = await core.write({ kind: "lesson", title: "Old claim", trigger: "Before the fix", body: "This was wrong and cost a confused session." });
    const second = await core.supersede(first.entry!.id, { kind: "lesson", title: "New claim", trigger: "After the fix", body: "This is the corrected claim with its cost." });
    expect(second.replaces_id).toBe(first.entry!.id);
    expect((await core.index(null)).bytes).toBeLessThanOrEqual(8192);
  });

  test(`${name}: counts has http shape`, async () => {
    const c = await (await makeStore()).counts();
    for (const k of ["total", "active", "superseded", "archived", "global", "project", "pinned"]) {
      expect(typeof c[k]).toBe("number");
    }
    expect(typeof c.by_kind).toBe("object");
  });
  test(`${name}: accented entry is found by a tone-less query`, async () => {
    const core = createCore(await makeStore());
    await core.write({ kind: "lesson", title: "Không thể kết nối database host", trigger: "Khi database host không reachable", body: "The direct host was IPv6-only and refused connections from this machine." });
    expect((await core.recall("docker host khong the ket noi"))[0].title).toContain("database host");
  });
}
