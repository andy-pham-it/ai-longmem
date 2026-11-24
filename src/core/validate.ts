export const KINDS = ["lesson", "mistake", "misunderstanding", "preference", "fact"] as const;
export type Kind = (typeof KINDS)[number];

export const TITLE_MAX = 120;
export const TRIGGER_MAX = 200;
export const BODY_MIN_WITHOUT_CORRECTION = 80;

/** A trigger that names no situation is not an entry. */
export const PLATITUDES: RegExp[] = [
  /\bbe careful\b/i,
  /\bpay attention\b/i,
  /\bcommunicate clearly\b/i,
  /\bverify\b[^.]*\b(before claiming|things)\b/i,
  /\bdouble[- ]?check\b/i,
  /\bthink before\b/i,
  /\bbe thorough\b/i,
  /\bmind the details\b/i,
];

/** A body that only reports a mood is a complaint log entry, not a lesson. */
const COMPLAINT_ONLY = /(was|is)\s+(annoyed|unhappy|angry|frustrated)\.?$/i;

export type NewEntry = {
  scope?: "global" | "project";
  project_key?: string | null;
  kind: string;
  title: string;
  trigger: string;
  body: string;
  tags?: string[];
  pinned?: boolean;
  sensitive?: boolean;
  source?: string | null;
  agent_session?: string | null;
  force?: boolean;
  replaces?: string;
};

export type ValidatedEntry =
  | {
      ok: true;
      value: Required<Pick<NewEntry, "scope" | "kind" | "title" | "trigger" | "body">> & NewEntry;
    }
  | { ok: false; error: string; field: string };

function fail(field: string, error: string): ValidatedEntry {
  return { ok: false, field, error };
}

export function validateEntry(entry: NewEntry): ValidatedEntry {
  const kind = (entry.kind ?? "").trim();
  if (!(KINDS as readonly string[]).includes(kind)) {
    return fail("kind", `kind must be one of ${KINDS.join(", ")}`);
  }

  const title = (entry.title ?? "").trim();
  if (title === "") return fail("title", "title is required");
  if (title.length > TITLE_MAX) return fail("title", `title exceeds ${TITLE_MAX} characters`);

  const trigger = (entry.trigger ?? "").trim();
  if (trigger === "") {
    return fail("trigger", "trigger is required: name the situation this entry applies to");
  }
  if (trigger.length > TRIGGER_MAX) return fail("trigger", `trigger exceeds ${TRIGGER_MAX} characters`);
  const platitude = PLATITUDES.find((pattern) => pattern.test(trigger));
  if (platitude) {
    return fail(
      "trigger",
      `trigger is a platitude (${String(platitude)}): name the concrete situation instead`,
    );
  }

  const body = (entry.body ?? "").trim();
  if (body === "") return fail("body", "body is required");
  if (body.length < BODY_MIN_WITHOUT_CORRECTION && COMPLAINT_ONLY.test(body)) {
    return fail("body", "body must say what to do instead, not only what went wrong");
  }

  const scope = entry.scope ?? "global";
  if (scope !== "global" && scope !== "project") {
    return fail("scope", "scope must be global or project");
  }
  const projectKey = entry.project_key ?? null;
  if (scope === "project" && (projectKey === null || projectKey.trim() === "")) {
    return fail("project_key", "project scope needs a project_key");
  }
  if (scope === "global" && projectKey !== null) {
    return fail("project_key", "global scope must not carry a project_key");
  }

  return {
    ok: true,
    value: {
      ...entry,
      scope,
      kind,
      title,
      trigger,
      body,
      project_key: scope === "project" ? projectKey?.trim() ?? null : null,
      tags: Array.isArray(entry.tags) ? entry.tags.map((t) => t.trim()).filter((t) => t !== "") : [],
    },
  };
}
