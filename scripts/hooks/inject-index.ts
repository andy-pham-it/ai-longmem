import { detectProjectKey } from "../../src/projectKey.ts";
import { loadConfig } from "../../src/config.ts";
import { createClient } from "../../src/transport.ts";
import { LONGMEM_RULES } from "../../src/instructions.ts";

async function main(): Promise<void> {
  let cwd = process.cwd();
  // Read hook input from stdin if present
  try {
    const chunks: Buffer[] = [];
    if (!process.stdin.isTTY) {
      for await (const c of process.stdin) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw) {
        const parsed = JSON.parse(raw) as { cwd?: string };
        if (typeof parsed.cwd === "string" && parsed.cwd.trim() !== "") cwd = parsed.cwd;
      }
    }
  } catch {
    // ignore
  }

  let block = "";
  let configured = false;
  let hadError = false;
  try {
    const cfg = loadConfig();
    configured = true;
    const client = await createClient(cfg);
    const projectKey = detectProjectKey(cwd);
    const r = await client.index(projectKey, 8192);
    block = r.block || "";
  } catch {
    hadError = true;
    block = "";
  }

  const parts: string[] = [];
  if (block.trim() !== "") parts.push(block.trim());
  parts.push(LONGMEM_RULES);
  let additionalContext = parts.join("\n\n");
  if (additionalContext.length > 10000) {
    // truncate the rules portion, never the index
    const maxRules = Math.max(0, 10000 - (block.trim().length + 2));
    additionalContext = (block.trim() !== "" ? block.trim() + "\n\n" : "") + LONGMEM_RULES.slice(0, maxRules);
  }

  if (!configured || hadError || additionalContext.trim() === "") {
    process.exitCode = 0;
    return;
  }

  const out = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  });
  console.log(out);
  process.exitCode = 0;
}

main().catch(() => { process.exitCode = 0; });
