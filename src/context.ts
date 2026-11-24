import type { Config } from "./config.ts";
import type { Core } from "./core/operations.ts";

export type FlagValue = string | true | string[];

export type Flags = Record<string, FlagValue>;

export type Ctx = {
  cfg: Config;
  client: Core;
  flags: Flags;
  positional: string[];
  /** Project key of the directory the command ran in. */
  projectKey: string;
  out: (line: string) => void;
};

function values(raw: FlagValue | undefined): string[] {
  if (raw === undefined || raw === true) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export function flagString(flags: Flags, name: string): string | undefined {
  return values(flags[name])[0];
}

export function flagBool(flags: Flags, name: string): boolean {
  return flags[name] !== undefined;
}

export function flagList(flags: Flags, name: string): string[] {
  return values(flags[name]);
}

export function flagNumber(flags: Flags, name: string): number | undefined {
  const raw = flagString(flags, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
