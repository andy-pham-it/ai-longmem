#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { ConfigError, type Config, loadConfig } from "./config.ts";
import { createClient } from "./transport.ts";
import { RequestError, UnauthorizedError, UnreachableError } from "./client.ts";
import { CoreError } from "./core/operations.ts";
import { type Ctx, type FlagValue, type Flags } from "./context.ts";
import { detectProjectKey } from "./projectKey.ts";
import * as adapterCmd from "./commands/adapter.ts";
import * as candidatesCmd from "./commands/candidates.ts";
import * as indexCmd from "./commands/index.ts";
import * as lessonsCmd from "./commands/lessons.ts";
import * as listCmd from "./commands/list.ts";
import * as promoteCmd from "./commands/promote.ts";
import * as recallCmd from "./commands/recall.ts";
import * as reinforceCmd from "./commands/reinforce.ts";
import * as renderBlockCmd from "./commands/render-block.ts";
import * as statusCmd from "./commands/status.ts";
import * as supersedeCmd from "./commands/supersede.ts";
import * as writeCmd from "./commands/write.ts";

const COMMANDS: Record<string, (ctx: Ctx) => Promise<number>> = {
  adapter: adapterCmd.run,
  index: indexCmd.run,
  lessons: lessonsCmd.run,
  list: listCmd.run,
  recall: recallCmd.run,
  status: statusCmd.run,
  write: writeCmd.run,
  reinforce: reinforceCmd.run,
  supersede: supersedeCmd.run,
  promote: promoteCmd.run,
  candidates: candidatesCmd.run,
  "render-block": renderBlockCmd.run,
};

export function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];

  const set = (name: string, value: string | true): void => {
    if (value === true) {
      if (flags[name] === undefined) flags[name] = true;
      return;
    }
    const existing = flags[name];
    if (existing === undefined || existing === true) {
      flags[name] = value;
      return;
    }
    if (Array.isArray(existing)) {
      flags[name] = [...existing, value];
      return;
    }
    flags[name] = [existing, value];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-k" || arg === "-n") {
      set(arg.slice(1), argv[i + 1] ?? true);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && (next === "-" || !next.startsWith("-"))) {
        set(body, next);
        i += 1;
      } else {
        set(body, true);
      }
      continue;
    }
    positional.push(arg);
  }
  return { flags, positional };
}

function printHelp(): void {
  console.log(`longmem — experiential memory for working with Andy

  longmem adapter <agent>   Print an agent adapter (list to see all)
  longmem index [--bytes N] [--project] [--json]
  longmem lessons "<situation>" [--project]
  longmem list [--scope all|global|project] [--status all|active|superseded|archived]
              [--project KEY] [--kind KIND] [--tag TAG] [--limit N] [--json]
  longmem recall "<query>" [-k N] [--kind KIND] [--tag TAG] [--project] [--json]
  longmem status
  longmem write --kind KIND --title "..." --trigger "..." --body "..."| -
                [--tag TAG] [--project] [--pinned] [--sensitive] [--force] [--replaces ID]
  longmem reinforce <id>
  longmem supersede <id> --kind KIND --title "..." --trigger "..." --body "..."
  longmem promote <id>
  longmem candidates
  longmem render-block [--max-bytes 1500] [--pinned-only]

Exit codes: 0 ok, 1 error, 2 needs a decision (similar entry exists).`);
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  const handler = COMMANDS[command];
  if (handler === undefined) {
    console.error(`unknown command: ${command}`);
    printHelp();
    return 1;
  }

  const { flags, positional } = parseArgs(rest);

  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const client = await createClient(cfg);

  const ctx: Ctx = {
    cfg,
    client,
    flags,
    positional,
    projectKey: detectProjectKey(),
    out: (line: string) => console.log(line),
  };

  try {
    return await handler(ctx);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      console.error("unauthorized: ~/.config/opencode/longmem.json holds a token the API rejects");
      return 1;
    }
    if (error instanceof UnreachableError) {
      console.error(`unreachable: ${error.message}`);
      return 1;
    }
    if (error instanceof RequestError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof CoreError) {
      console.error(`${error.field}: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
