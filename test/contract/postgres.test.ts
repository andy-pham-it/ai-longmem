import { test } from "vitest";
import { createPostgresStore } from "../../src/stores/postgres.ts";
import { runStoreContract } from "./store.test.ts";

const url = process.env.LONGMEM_TEST_DATABASE_URL;
if (url) {
  runStoreContract("postgres", () => createPostgresStore(url));
} else {
  test.skip("postgres contract (LONGMEM_TEST_DATABASE_URL unset)", () => {});
}
