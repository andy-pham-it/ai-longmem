import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Ctx } from "../context.ts";

const ADAPTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "adapters");

export async function run(ctx: Ctx): Promise<number> {
  const agent = ctx.positional[0];
  if (!agent || agent === "list") {
    let files: string[] = [];
    try {
      files = readdirSync(ADAPTERS_DIR).map((f) => f.replace(/\.(md|mdc)$/, ""));
    } catch {
      ctx.out("adapters directory not found");
      return 1;
    }
    ctx.out("Available adapters:");
    for (const a of files.sort()) ctx.out(`  ${a}`);
    ctx.out("");
    ctx.out("Usage: longmem adapter <agent>  (prints the adapter to stdout)");
    return 0;
  }
  const ext = agent === "cursor" ? "mdc" : "md";
  const path = join(ADAPTERS_DIR, `${agent}.${ext}`);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    ctx.out(`Unknown adapter: ${agent}. Run 'longmem adapter list'.`);
    return 1;
  }
  ctx.out(content);
  return 0;
}
