import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore } from "../../src/stores/sqlite.ts";
import { runStoreContract } from "./store.test.ts";

runStoreContract("sqlite", async () => createSqliteStore(join(mkdtempSync(join(tmpdir(), "longmem-")), "mem.sqlite")));
