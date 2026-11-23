import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function normaliseRemote(remote: string): { host: string; path: string } | null {
  const trimmed = remote.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  if (trimmed === "") return null;

  // scp-like: git@github.com:owner/repo
  const scp = /^(?:[^@/\s]+@)?([A-Za-z0-9.-]+\.[A-Za-z]{2,}):(.+)$/.exec(trimmed);
  if (scp) return { host: scp[1], path: scp[2] };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname === "") return null;
      return { host: url.hostname, path: url.pathname.replace(/^\/+/, "") };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * `github.com/owner/repo`, lowercased, from any git remote form. A remote that
 * names no host (a bare path) is not a project identity, so it falls back to the
 * absolute directory.
 */
export function projectKeyFromRemote(remote: string | null, dir: string): string {
  const parsed = remote === null ? null : normaliseRemote(remote);
  const fallback = `path:${resolve(dir)}`;
  if (parsed === null) return fallback;

  const path = parsed.path.replace(/^\/+|\/+$/g, "");
  if (path === "") return fallback;
  return `${parsed.host.toLowerCase()}/${path.toLowerCase()}`;
}

export function detectProjectKey(dir: string = process.cwd()): string {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return projectKeyFromRemote(remote, dir);
  } catch {
    return projectKeyFromRemote(null, dir);
  }
}
