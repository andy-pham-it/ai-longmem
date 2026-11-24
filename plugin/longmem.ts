// longmem OpenCode plugin: puts the memory catalogue in the system prompt of
// every session, without the agent having to ask for it.
//
// Self-contained on purpose: this file is copied into ~/.config/opencode/plugins/
// and runs with no node_modules, no build step and no relative imports beyond
// node built-ins. Every failure is silent — a memory store that can block a
// session is worse than no memory store.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

const TIMEOUT_MS = 1500;
const MAX_CACHED_SESSIONS = 64;

type LongmemConfig =
  | { kind?: "http"; endpoint: string; token: string }
  | { kind: "sqlite" | "postgres" | "local"; cliPath?: string };

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function configPath(): string {
  const fromEnv = process.env.LONGMEM_CONFIG;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv;
  return join(homedir(), ".config", "opencode", "longmem.json");
}

function readConfig(): LongmemConfig | null {
  const path = configPath();
  try {
    statSync(path);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as any;
    const kind = typeof parsed.kind === "string" ? parsed.kind : (parsed.endpoint && parsed.token ? "http" : undefined);
    if (kind === "http" || kind === undefined) {
      if (typeof parsed.endpoint !== "string" || typeof parsed.token !== "string") return null;
      if (parsed.token.length < 32) return null;
      return { kind: "http", endpoint: parsed.endpoint.replace(/\/+$/, ""), token: parsed.token };
    }
    if (kind === "sqlite" || kind === "postgres" || kind === "local") {
      if (typeof parsed.cliPath !== "string" || parsed.cliPath.trim() === "") return null;
      return { kind, cliPath: parsed.cliPath };
    }
    return null;
  } catch {
    return null;
  }
}

/** Same derivation as src/projectKey.ts, inlined so the plugin stays standalone. */
function projectKeyFor(directory: string): string | null {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 400,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const cleaned = remote.replace(/\/+$/, "").replace(/\.git$/i, "");
    if (cleaned === "") return null;

    const scp = /^(?:[^@/\s]+@)?([A-Za-z0-9.-]+\.[A-Za-z]{2,}):(.+)$/.exec(cleaned);
    if (scp) {
      return `${scp[1].toLowerCase()}/${scp[2].replace(/^\/+|\/+$/g, "").toLowerCase()}`;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) {
      const url = new URL(cleaned);
      if (url.hostname === "") return null;
      return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+/, "").toLowerCase()}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchIndex(directory: string, config: LongmemConfig): Promise<string> {
  if (config.kind !== "http") {
    const cliPath = (config as { cliPath?: string }).cliPath;
    if (typeof cliPath !== "string" || cliPath.trim() === "") return "";
    try {
      const raw = execFileSync("npx", ["tsx", cliPath, "index", "--json"], {
        cwd: directory,
        encoding: "utf8",
        timeout: TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env },
      }).trim();
      const body = JSON.parse(raw) as { block?: unknown };
      return typeof body.block === "string" ? body.block : "";
    } catch {
      return "";
    }
  }
  try {
    const url = new URL(`${config.endpoint}/index`);
    const key = projectKeyFor(directory);
    if (key) url.searchParams.set("project_key", key);

    const response = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const body = (await response.json()) as { block?: unknown };
    return typeof body.block === "string" ? body.block : "";
  } catch {
    return "";
  }
}

export const server: Plugin = async ({ directory }) => {
  const config = readConfig();

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (config === null) return;

      const sessionKey = input.sessionID ?? "default";
      let block = cache.get(sessionKey);

      if (block === undefined) {
        let pending = inflight.get(sessionKey);
        if (pending === undefined) {
          pending = fetchIndex(directory, config);
          inflight.set(sessionKey, pending);
        }
        block = await pending.catch(() => "");
        inflight.delete(sessionKey);
        if (cache.size > MAX_CACHED_SESSIONS) cache.clear();
        cache.set(sessionKey, block);
      }

      if (block !== "") output.system.push(block);
    },
  };
};

export default { id: "longmem", server };
