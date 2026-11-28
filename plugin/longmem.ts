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
const HANDOFF_MAX_BYTES = 500;

type LongmemConfig =
  | { kind?: "http"; endpoint: string; token: string }
  | { kind: "sqlite" | "postgres" | "local"; cliPath?: string };

const cache = new Map<string, { index: string; handoff: string }>();
const inflight = new Map<string, Promise<{ index: string; handoff: string }>>();
// Sessions that went idle since the last transform: remind the agent to
// consider capturing a lesson (propose only, never silent write).
const nudgeSessions = new Set<string>();

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

function taskLineOf(h: any): string {
  if (!h?.task_ref?.plan_file) return "";
  const t = h.task_ref.task_number;
  const total = h.task_ref.total_tasks;
  const taskStr = t && total ? `Task ${t}/${total}` : t ? `Task ${t}` : "";
  return `Task: ${taskStr} of ${h.task_ref.plan_file}${h.task_ref.base_commit ? ` (base: ${h.task_ref.base_commit})` : ""}`;
}

function formatHandoffBlock(h: any): string {
  if (!h || typeof h.summary !== "string") return "";
  // defense in depth: never inject an expired handoff
  if (h.expires_at) {
    const exp = new Date(h.expires_at).getTime();
    if (Number.isFinite(exp) && exp < Date.now()) return "";
  }

  const taskLine = taskLineOf(h);
  let summary = h.summary;

  let includeContext = typeof h.context === "string" && h.context.length > 0;
  let includeBlocked = typeof h.blocked === "string" && h.blocked.length > 0;
  let includeNext = typeof h.next === "string" && h.next.length > 0;

  function make(): string {
    const lines: string[] = ["## Session handoff", `Done: ${summary}`];
    if (taskLine) lines.push(taskLine);
    if (includeNext) lines.push(`Next: ${h.next}`);
    if (includeBlocked) lines.push(`Blocked: ${h.blocked}`);
    if (includeContext) lines.push(`Context: ${h.context}`);
    return lines.join("\n");
  }

  // drop optional fields in priority order: context -> blocked -> next
  while (make().length > HANDOFF_MAX_BYTES) {
    if (includeContext) { includeContext = false; continue; }
    if (includeBlocked) { includeBlocked = false; continue; }
    if (includeNext) { includeNext = false; continue; }
    // final fallback: truncate summary (never drop task_ref)
    if (summary.length > 0) {
      summary = summary.slice(0, -1);
      continue;
    }
    break;
  }

  let block = make();
  if (block.length > HANDOFF_MAX_BYTES) block = block.slice(0, HANDOFF_MAX_BYTES);
  return block;
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

async function fetchResume(directory: string, config: LongmemConfig): Promise<string> {
  if (config.kind !== "http") {
    const cliPath = (config as { cliPath?: string }).cliPath;
    if (typeof cliPath !== "string" || cliPath.trim() === "") return "";
    try {
      const raw = execFileSync("npx", ["tsx", cliPath, "resume", "--json"], {
        cwd: directory,
        encoding: "utf8",
        timeout: TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env },
      }).trim();
      const body = JSON.parse(raw) as { handoff?: unknown };
      return formatHandoffBlock(body.handoff);
    } catch {
      return "";
    }
  }
  try {
    const url = new URL(`${config.endpoint}/resume`);
    const key = projectKeyFor(directory);
    if (key) url.searchParams.set("project_key", key);

    const response = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const body = (await response.json()) as { handoff?: unknown };
    return formatHandoffBlock(body.handoff);
  } catch {
    return "";
  }
}

async function fetchAll(directory: string, config: LongmemConfig): Promise<{ index: string; handoff: string }> {
  const [index, handoff] = await Promise.all([
    fetchIndex(directory, config).catch(() => ""),
    fetchResume(directory, config).catch(() => ""),
  ]);
  return { index, handoff };
}

export const server: Plugin = async ({ directory }) => {
  const config = readConfig();

  return {
    event: async ({ event }) => {
      try {
        if (event?.type === "session.idle" && typeof event.properties?.sessionID === "string") {
          nudgeSessions.add(event.properties.sessionID);
        }
      } catch {
        // fail silent
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (config === null) return;

      const sessionKey = input.sessionID ?? "default";
      let cached = cache.get(sessionKey);

      if (cached === undefined) {
        let pending = inflight.get(sessionKey);
        if (pending === undefined) {
          pending = fetchAll(directory, config);
          inflight.set(sessionKey, pending);
        }
        cached = await pending.catch(() => ({ index: "", handoff: "" }));
        inflight.delete(sessionKey);
        if (cache.size > MAX_CACHED_SESSIONS) cache.clear();
        cache.set(sessionKey, cached);
      }

      if (cached.index !== "") output.system.push(cached.index);
      if (cached.handoff !== "") output.system.push(cached.handoff);

      // Session-end nudge: propose a lesson, never write silently.
      if (input.sessionID !== undefined && nudgeSessions.has(input.sessionID)) {
        nudgeSessions.delete(input.sessionID);
        output.system.push(
          "## longmem — session nudge\n" +
            "This session may have produced a lesson. Run `longmem candidates` and propose one entry if a trigger matches the work just done. Write only after the user confirms. Never a platitude or a chat summary.",
        );
      }
    },
  };
};

export default { id: "longmem", server };