import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Config = { endpoint: string; token: string };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const TOKEN_MIN_LENGTH = 32;

function resolveConfigPath(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.LONGMEM_CONFIG;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv;
  return join(homedir(), ".config", "opencode", "longmem.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const path = resolveConfigPath(env);

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    throw new ConfigError(`longmem config not found: ${path}`);
  }

  if (stat.isDirectory()) {
    throw new ConfigError(`longmem config is a directory, not a file: ${path}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new ConfigError(`${path} must be mode 0600 (group- or world-readable files leak the token)`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${(error as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ConfigError(`${path} must contain a JSON object with "endpoint" and "token"`);
  }
  const { endpoint, token } = parsed as Record<string, unknown>;

  if (typeof endpoint !== "string") {
    throw new ConfigError(`${path} is missing "endpoint"`);
  }
  let protocol: string;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    throw new ConfigError(`${path}: "endpoint" is not a URL: ${endpoint}`);
  }
  if (protocol !== "https:") {
    throw new ConfigError(`${path}: "endpoint" must use https, got ${protocol}`);
  }

  if (typeof token !== "string") {
    throw new ConfigError(`${path} is missing "token"`);
  }
  if (token.length < TOKEN_MIN_LENGTH) {
    throw new ConfigError(`${path}: token must be at least ${TOKEN_MIN_LENGTH} characters`);
  }

  return { endpoint: endpoint.replace(/\/+$/, ""), token };
}
