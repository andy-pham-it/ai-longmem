export type RouteName =
  | "health"
  | "status"
  | "index"
  | "related"
  | "recall"
  | "write"
  | "reinforce"
  | "update"
  | "supersede"
  | "promote";

type RouteMethod = "GET" | "POST";

const ROUTES: Record<RouteName, RouteMethod> = {
  health: "GET",
  status: "GET",
  index: "GET",
  related: "GET",
  recall: "POST",
  write: "POST",
  reinforce: "POST",
  update: "POST",
  supersede: "POST",
  promote: "POST",
};

export function resolveRoute(
  method: string,
  pathname: string,
): { name: RouteName; method: RouteMethod } | null {
  const segments = pathname.split("/").filter((s) => s !== "");
  const last = segments[segments.length - 1] ?? "";
  if (!Object.prototype.hasOwnProperty.call(ROUTES, last)) return null;
  const name = last as RouteName;
  if (method.toUpperCase() !== ROUTES[name]) return null;
  return { name, method: ROUTES[name] };
}

const encoder = new TextEncoder();

/**
 * Constant-time bearer check: every byte of both strings is compared before the
 * length check decides, so the response time does not leak a matching prefix.
 */
export function authorized(header: string | null, token: string): boolean {
  if (header === null || token === "") return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const provided = encoder.encode(header.slice(prefix.length));
  const expected = encoder.encode(token);

  let diff = provided.length ^ expected.length;
  const length = Math.max(provided.length, expected.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (provided[i] ?? 0) ^ (expected[i] ?? 0);
  }
  return diff === 0;
}
