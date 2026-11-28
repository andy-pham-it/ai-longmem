// longmem HTTP API: the only door into the memories table.
// Deployed with `supabase functions deploy longmem`; verify_jwt is false because
// the bearer token below is ours, not a Supabase JWT.

import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_INDEX_BYTES, type IndexRow, renderIndex } from "../_shared/render.ts";
import { authorized, resolveRoute } from "../_shared/router.ts";
import { type NewEntry, validateEntry } from "../_shared/validate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LONGMEM_TOKEN = Deno.env.get("LONGMEM_TOKEN") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`http ${status}`);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function dbFailure(error: { code?: string | null; message: string }): never {
  // check_violation (23514) and no_data_found (P0002) come from our own
  // functions and carry readable messages.
  if (error.code === "23514") throw new HttpError(409, { error: error.message });
  if (error.code === "P0002") throw new HttpError(404, { error: error.message });
  throw new HttpError(500, { error: error.message });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new HttpError(400, { error: "invalid json body" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, { error: "body must be a json object" });
  }
  return parsed as Record<string, unknown>;
}

type Row = Record<string, unknown> & { id: string };

function toEntry(row: Row): Record<string, unknown> {
  const { replaces_id, replaces_title, replaces_created_at, ...rest } = row as Record<string, unknown>;
  if (!replaces_id) return rest;
  return {
    ...rest,
    replaces: { id: replaces_id, title: replaces_title, created_at: replaces_created_at },
  };
}

function rowFrom(value: Extract<ReturnType<typeof validateEntry>, { ok: true }>["value"]) {
  return {
    scope: value.scope,
    project_key: value.project_key ?? null,
    kind: value.kind,
    title: value.title,
    trigger: value.trigger,
    body: value.body,
    tags: value.tags ?? [],
    pinned: value.pinned ?? false,
    sensitive: value.sensitive ?? false,
    source: value.source ?? "api",
    agent_session: value.agent_session ?? null,
  };
}

function clampK(raw: unknown, fallback = 5): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 50);
}

function stringOrNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function stringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  return list.length === 0 ? null : list;
}

function asEntry(body: Record<string, unknown>): NewEntry {
  return {
    scope: body.scope === "project" ? "project" : body.scope === "global" ? "global" : undefined,
    project_key: stringOrNull(body.project_key),
    kind: typeof body.kind === "string" ? body.kind : "",
    title: typeof body.title === "string" ? body.title : "",
    trigger: typeof body.trigger === "string" ? body.trigger : "",
    body: typeof body.body === "string" ? body.body : "",
    tags: stringList(body.tags) ?? undefined,
    pinned: body.pinned === true,
    sensitive: body.sensitive === true,
    source: stringOrNull(body.source) ?? undefined,
    agent_session: stringOrNull(body.agent_session) ?? undefined,
    force: body.force === true,
    replaces: stringOrNull(body.replaces) ?? undefined,
  };
}

// ---------------------------------------------------------------------------

async function handleHealth(): Promise<Response> {
  const { error } = await db.rpc("longmem_counts");
  if (error) return json({ ok: false, db: "down" }, 503);
  return json({ ok: true, db: "ok" });
}

async function handleIndex(url: URL): Promise<Response> {
  const projectKey = stringOrNull(url.searchParams.get("project_key"));
  const requested = Number(url.searchParams.get("bytes") ?? DEFAULT_INDEX_BYTES);
  const maxBytes = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1024), 32768)
    : DEFAULT_INDEX_BYTES;

  const { data, error } = await db.rpc("longmem_index_rows", { p_project_key: projectKey });
  if (error) dbFailure(error);

  const rendered = renderIndex((data ?? []) as IndexRow[], maxBytes);
  if (url.searchParams.get("format") === "rows") {
    return json({ rows: data ?? [], total: (data ?? []).length });
  }
  if (url.searchParams.get("format") === "markdown") {
    return new Response(rendered.block, {
      headers: { "content-type": "text/markdown; charset=utf-8", ...CORS },
    });
  }
  return json(rendered);
}

/** Audit view: every row, including sensitive and superseded, by explicit filter. */
async function handleList(url: URL): Promise<Response> {
  const requested = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 500)
    : 100;
  const { data, error } = await db.rpc("longmem_list", {
    p_scope: stringOrNull(url.searchParams.get("scope")),
    p_project_key: stringOrNull(url.searchParams.get("project_key")),
    p_kind: stringOrNull(url.searchParams.get("kind")),
    p_tag: stringOrNull(url.searchParams.get("tag")),
    p_status: stringOrNull(url.searchParams.get("status")),
    p_limit: limit,
  });
  if (error) dbFailure(error);
  return json({ entries: data ?? [], total: (data ?? []).length });
}

async function handleStatus(url: URL): Promise<Response> {
  const projectKey = stringOrNull(url.searchParams.get("project_key"));
  const { data: counts, error: countsError } = await db.rpc("longmem_counts");
  if (countsError) dbFailure(countsError);

  const { data: rows, error: rowsError } = await db.rpc("longmem_index_rows", { p_project_key: projectKey });
  if (rowsError) dbFailure(rowsError);

  const rendered = renderIndex((rows ?? []) as IndexRow[], DEFAULT_INDEX_BYTES);
  return json({
    ok: true,
    counts,
    index: { bytes: rendered.bytes, total: rendered.total, truncated: rendered.truncated },
  });
}

async function handleSearch(
  query: string,
  projectKey: string | null,
  k: number,
  kinds: string[] | null,
  tags: string[] | null,
  by: "recall" | "related",
): Promise<Record<string, unknown>[]> {
  const { data, error } = await db.rpc("longmem_search", {
    p_query: query,
    p_project_key: projectKey,
    p_k: k,
    p_kinds: kinds,
    p_tags: tags,
    p_by: by,
  });
  if (error) dbFailure(error);
  return ((data ?? []) as Row[]).map(toEntry);
}

async function handleRelated(url: URL): Promise<Response> {
  const context = stringOrNull(url.searchParams.get("context")) ?? "";
  if (context === "") throw new HttpError(400, { error: "context is required", field: "context" });
  const entries = await handleSearch(
    context,
    stringOrNull(url.searchParams.get("project_key")),
    5,
    null,
    null,
    "related",
  );
  return json({ entries, total: entries.length });
}

async function handleRecall(req: Request): Promise<Response> {
  const body = await readJson(req);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query === "") throw new HttpError(400, { error: "query is required", field: "query" });

  const entries = await handleSearch(
    query,
    stringOrNull(body.project_key),
    clampK(body.k),
    stringList(body.kinds),
    stringList(body.tags),
    "recall",
  );

  if (entries.length > 0) {
    const ids = entries.map((entry) => entry.id as string);
    const { error } = await db.rpc("longmem_mark_recalled", { p_ids: ids });
    if (error) dbFailure(error);
  }
  return json({ entries, total: entries.length });
}

async function handleWrite(req: Request): Promise<Response> {
  const body = await readJson(req);
  const entry = asEntry(body);
  const result = validateEntry(entry);
  if (!result.ok) return json({ error: result.error, field: result.field }, 400);
  const value = result.value;

  // A replacement is a deliberate act: it bypasses dedupe by design.
  if (value.replaces) {
    const created = await supersede(value.replaces, value);
    return json({ action: "superseded", id: created.id, entry: created.entry }, 201);
  }

  // Dedupe and insert happen in one transaction inside the database: two
  // writers racing on the same title cannot both pass the check.
  const { data: written, error: writeError } = await db.rpc("longmem_write", {
    p_new: rowFrom(value),
    p_force: value.force === true,
  });
  if (writeError) dbFailure(writeError);

  const outcome = (written ?? [])[0] as
    | { created_id: string | null; existing_id: string | null; existing_title: string | null; similarity: number | null }
    | undefined;
  if (!outcome) throw new HttpError(500, { error: "write returned no row" });

  if (outcome.existing_id) {
    return json(
      {
        action: "needs_decision",
        existing: {
          id: outcome.existing_id,
          title: outcome.existing_title,
          similarity: outcome.similarity,
        },
        options: ["reinforce", "supersede", "force"],
      },
      409,
    );
  }

  const { data: inserted, error: readError } = await db
    .from("memories")
    .select()
    .eq("id", outcome.created_id)
    .single();
  if (readError) dbFailure(readError);

  let warning: string | undefined;
  if (value.scope === "project") {
    const { data: similar, error: similarError } = await db.rpc("longmem_cross_project_similar", {
      p_title: value.title,
      p_project_key: value.project_key,
    });
    if (similarError) dbFailure(similarError);
    const other = (similar ?? [])[0] as { project_key: string; similarity: number } | undefined;
    if (other && other.similarity > 0.7) {
      warning = `similar entry in ${other.project_key}; consider scope=global`;
    }
  }

  return json({ action: "created", entry: inserted, ...(warning ? { warning } : {}) }, 201);
}

async function supersede(
  oldId: string,
  value: Extract<ReturnType<typeof validateEntry>, { ok: true }>["value"],
): Promise<{ id: string; entry: unknown }> {
  const { data, error } = await db.rpc("longmem_supersede", { p_old: oldId, p_new: rowFrom(value) });
  if (error) dbFailure(error);
  const id = data as string;
  const { data: entry, error: readError } = await db.from("memories").select().eq("id", id).single();
  if (readError) dbFailure(readError);
  return { id, entry };
}

async function handleSupersede(req: Request): Promise<Response> {
  const body = await readJson(req);
  const id = stringOrNull(body.id);
  if (!id) throw new HttpError(400, { error: "id is required", field: "id" });

  const entry = asEntry(body);
  const result = validateEntry(entry);
  if (!result.ok) return json({ error: result.error, field: result.field }, 400);

  const created = await supersede(id, result.value);
  return json({ action: "superseded", id: created.id, entry: created.entry }, 201);
}

async function handleReinforce(req: Request): Promise<Response> {
  const body = await readJson(req);
  const id = stringOrNull(body.id);
  if (!id) throw new HttpError(400, { error: "id is required", field: "id" });

  const { data, error } = await db.rpc("longmem_reinforce", { p_id: id });
  if (error) dbFailure(error);
  return json({ id, reinforced_count: data });
}

async function handleUpdate(req: Request): Promise<Response> {
  const body = await readJson(req);
  const id = stringOrNull(body.id);
  if (!id) throw new HttpError(400, { error: "id is required", field: "id" });

  const patch: Record<string, unknown> = {};
  for (const field of ["title", "trigger", "body"] as const) {
    const value = body[field];
    if (typeof value === "string" && value.trim() !== "") patch[field] = value.trim();
  }
  const tags = stringList(body.tags);
  if (tags) patch.tags = tags;
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, { error: "nothing to update", field: "body" });
  }
  if (typeof patch.title === "string" && patch.title.length > 120) {
    throw new HttpError(400, { error: "title exceeds 120 characters", field: "title" });
  }
  if (typeof patch.trigger === "string" && patch.trigger.length > 200) {
    throw new HttpError(400, { error: "trigger exceeds 200 characters", field: "trigger" });
  }

  const { data: current, error: readError } = await db
    .from("memories")
    .select("id, scope, project_key, status, kind, title, trigger, body")
    .eq("id", id)
    .maybeSingle();
  if (readError) dbFailure(readError);
  if (!current || current.status !== "active") throw new HttpError(404, { error: "entry not found or not active" });

  // An update goes through the same gate as a write: editing a trigger to
  // "be careful" must fail here, not only in the CLI that cannot reach it.
  const merged = validateEntry({
    kind: current.kind,
    scope: current.scope,
    project_key: current.project_key,
    title: (patch.title as string | undefined) ?? current.title,
    trigger: (patch.trigger as string | undefined) ?? current.trigger,
    body: (patch.body as string | undefined) ?? current.body,
  });
  if (!merged.ok) return json({ error: merged.error, field: merged.field }, 400);

  if (typeof patch.title === "string") {
    const { data: dedupe, error: dedupeError } = await db.rpc("longmem_dedupe", {
      p_title: patch.title,
      p_scope: current.scope,
      p_project_key: current.project_key,
    });
    if (dedupeError) dbFailure(dedupeError);
    const match = (dedupe ?? [])[0] as { id: string; title: string; similarity: number } | undefined;
    if (match && match.id !== id && match.similarity > 0.7) {
      return json(
        {
          action: "needs_decision",
          existing: { id: match.id, title: match.title, similarity: match.similarity },
          options: ["supersede", "force"],
        },
        409,
      );
    }
  }

  const { data: updated, error: updateError } = await db
    .from("memories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (updateError) dbFailure(updateError);

  return json({ action: "updated", entry: updated });
}

async function handlePromote(req: Request): Promise<Response> {
  const body = await readJson(req);
  const id = stringOrNull(body.id);
  if (!id) throw new HttpError(400, { error: "id is required", field: "id" });

  const { data: current, error: readError } = await db
    .from("memories")
    .select("id, scope, status")
    .eq("id", id)
    .maybeSingle();
  if (readError) dbFailure(readError);
  if (!current || current.status !== "active") throw new HttpError(404, { error: "entry not found or not active" });
  if (current.scope === "global") throw new HttpError(409, { error: "already global" });

  const { data: updated, error: updateError } = await db
    .from("memories")
    .update({ scope: "global", project_key: null })
    .eq("id", id)
    .select()
    .single();
  if (updateError) dbFailure(updateError);

  return json({ action: "promoted", entry: updated });
}


async function handleHandoff(req: Request): Promise<Response> {
  const body = await readJson(req);
  const summary = stringOrNull(body.summary)?.trim();
  if (!summary || summary.length < 1 || summary.length > 500) {
    throw new HttpError(400, { error: "summary must be 1-500 chars", field: "summary" });
  }
  const next = stringOrNull(body.next)?.trim() || null;
  const blocked = stringOrNull(body.blocked)?.trim() || null;
  const context = stringOrNull(body.context)?.trim() || null;
  if (next && next.length > 500) throw new HttpError(400, { error: "next must be <=500 chars", field: "next" });
  if (blocked && blocked.length > 500) throw new HttpError(400, { error: "blocked must be <=500 chars", field: "blocked" });
  if (context && context.length > 500) throw new HttpError(400, { error: "context must be <=500 chars", field: "context" });

  const scope = body.scope === "project" ? "project" : "global";
  const projectKey = scope === "global" ? null : stringOrNull(body.project_key);
  if (scope === "project" && !projectKey) {
    throw new HttpError(400, { error: "project scope requires project_key", field: "project_key" });
  }

  const rawTtl = Number(Deno.env.get("LONGMEM_HANDOFF_TTL_DAYS") ?? 7);
  const ttlDays = Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : 7;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  // archive previous active
  let archiveQ = db.from("handoffs").update({ status: "completed" })
    .eq("status", "active").eq("scope", scope);
  if (projectKey === null) archiveQ = archiveQ.is("project_key", null);
  else archiveQ = archiveQ.eq("project_key", projectKey);
  await archiveQ;

  const { data: inserted, error: insertError } = await db
    .from("handoffs")
    .insert({
      summary,
      next,
      blocked,
      context,
      task_ref: body.task_ref ?? null,
      scope,
      project_key: projectKey,
      expires_at: expiresAt,
      status: "active",
    })
    .select()
    .single();
  if (insertError) dbFailure(insertError);

  return json({ id: inserted.id, handoff: inserted }, 201);
}

async function handleResume(url: URL): Promise<Response> {
  const projectKey = stringOrNull(url.searchParams.get("project_key"));
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("handoffs")
    .select()
    .eq("status", "active")
    .gt("expires_at", now)
    .or(`scope.eq.global,scope.eq.project`)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) dbFailure(error);

  // filter: project-scoped for this project, or global
  const candidates = (data ?? []).filter((h: any) =>
    h.scope === "global" || (h.scope === "project" && h.project_key === projectKey)
  );
  // prefer project over global
  const projectMatch = candidates.find((h: any) => h.scope === "project" && h.project_key === projectKey);
  const globalMatch = candidates.find((h: any) => h.scope === "global");
  const handoff = projectMatch ?? globalMatch ?? null;

  if (handoff && new Date(handoff.expires_at) <= new Date()) {
    await db.from("handoffs").update({ status: "expired" }).eq("id", handoff.id);
    return json({ handoff: null });
  }

  return json({ handoff });
}

async function handleHandoffs(url: URL): Promise<Response> {
  const requested = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 100;
  const { data, error } = await db
    .from("handoffs")
    .select()
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) dbFailure(error);
  return json({ entries: data ?? [], total: (data ?? []).length });
}

async function handleHandoffComplete(req: Request): Promise<Response> {
  const body = await readJson(req);
  const id = stringOrNull(body.id);
  if (!id) throw new HttpError(400, { error: "id is required", field: "id" });

  const { data: existing, error: readError } = await db.from("handoffs").select("id").eq("id", id).maybeSingle();
  if (readError) dbFailure(readError);
  if (!existing) throw new HttpError(404, { error: "handoff not found", field: "id" });

  const { error } = await db.from("handoffs").update({ status: "completed" }).eq("id", id);
  if (error) dbFailure(error);
  return json({ ok: true });
}


// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const route = resolveRoute(req.method, url.pathname);
  if (!route) return json({ error: "not_found" }, 404);

  if (!authorized(req.headers.get("authorization"), LONGMEM_TOKEN)) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    switch (route.name) {
      case "health":
        return await handleHealth();
      case "status":
        return await handleStatus(url);
      case "index":
        return await handleIndex(url);
      case "list":
        return await handleList(url);
      case "related":
        return await handleRelated(url);
      case "recall":
        return await handleRecall(req);
      case "write":
        return await handleWrite(req);
      case "supersede":
        return await handleSupersede(req);
      case "reinforce":
        return await handleReinforce(req);
      case "update":
        return await handleUpdate(req);
      case "promote":
        return await handlePromote(req);
      case "handoff":
        return await handleHandoff(req);
      case "resume":
        return await handleResume(url);
      case "handoffs":
        return await handleHandoffs(url);
      case "handoff_complete":
        return await handleHandoffComplete(req);
      default:
        return json({ error: "not_found" }, 404);
    }
  } catch (error) {
    if (error instanceof HttpError) return json(error.payload, error.status);
    console.error("longmem handler failed", error);
    return json({ error: "internal_error" }, 500);
  }
});
