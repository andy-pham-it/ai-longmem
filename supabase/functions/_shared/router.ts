export type RouteName =
  | "health"
  | "status"
  | "index"
  | "list"
  | "related"
  | "recall"
  | "write"
  | "reinforce"
  | "update"
  | "supersede"
  | "promote"
  | "handoff"
  | "resume"
  | "handoffs"
  | "handoff_complete";

type RouteMethod = "GET" | "POST";

const ROUTES: Record<RouteName, RouteMethod> = {
  health: "GET",
  status: "GET",
  index: "GET",
  list: "GET",
  related: "GET",
  recall: "POST",
  write: "POST",
  reinforce: "POST",
  update: "POST",
  supersede: "POST",
  promote: "POST",
  handoff: "POST",
  resume: "GET",
  handoffs: "GET",
  handoff_complete: "POST",
};

export function resolveRoute(
  method: string,
  pathname: string,
): { name: RouteName; method: RouteMethod } | null {
  const segments = pathname.split("/").filter((s) => s !== "");
  const last = segments[segments.length - 1] ?? "";
  // Support both `/handoff_complete` and `/handoff/complete` (spec/plan).
  let name = last;
  if (last === "complete" && segments.length >= 2 && segments[segments.length - 2] === "handoff") {
    name = "handoff_complete";
  }
  if (!Object.prototype.hasOwnProperty.call(ROUTES, name)) return null;
  if (method.toUpperCase() !== ROUTES[name as RouteName]) return null;
  return { name: name as RouteName, method: ROUTES[name as RouteName] };
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
