import type { Config } from "./config.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;

export type RequestInit = {
  method?: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

export class UnauthorizedError extends Error {
  readonly status = 401;
  readonly body: string;

  constructor(message: string, body: string) {
    super(message);
    this.name = "UnauthorizedError";
    this.body = body;
  }
}

export class RequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`request failed with ${status}: ${body.slice(0, 500)}`);
    this.name = "RequestError";
    this.status = status;
    this.body = body;
  }
}

export class UnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreachableError";
  }
}

export async function request<T>(cfg: Config, path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const url = new URL(`${cfg.endpoint}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = { authorization: `Bearer ${cfg.token}` };
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (payload !== undefined) headers["content-type"] = "application/json";

  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new UnreachableError(`${method} ${path} timed out after ${timeoutMs} ms`)),
      { once: true },
    );
  });

  let response: Response;
  try {
    response = await Promise.race([
      fetch(url.toString(), { method, headers, body: payload, signal }),
      timedOut,
    ]);
  } catch (error) {
    if (error instanceof UnreachableError) throw error;
    throw new UnreachableError(`${method} ${path} failed: ${(error as Error).message}`);
  }

  const text = await response.text();

  if (response.status === 401) {
    throw new UnauthorizedError(`unauthorized: ${path}`, text);
  }
  if (!response.ok) {
    throw new RequestError(response.status, text);
  }

  if (text.trim() === "") return undefined as T;
  return JSON.parse(text) as T;
}
