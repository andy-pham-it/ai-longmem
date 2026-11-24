import type { ListFilter, MemoryRow, NewEntry, NewMemoryRow } from "./types.ts";
import type { MemoryStore } from "../stores/memory-store.ts";
import type { RenderedIndex } from "./render.ts";
import { validateEntry } from "./validate.ts";
import { renderIndex } from "./render.ts";
import { normalize, tokenOverlap, trigramSimilarity } from "./normalize.ts";

export type Core = {
  index(projectKey: string | null, maxBytes?: number): Promise<RenderedIndex>;
  related(context: string, projectKey?: string | null): Promise<MemoryRow[]>;
  recall(query: string, opts?: { kinds?: string[]; tags?: string[]; limit?: number; projectKey?: string | null; status?: "active" | "superseded" | "archived" | "all" }): Promise<MemoryRow[]>;
  write(input: NewEntry): Promise<{ action: "created" | "reinforced" | "needs_decision" | "superseded"; id?: string; entry?: MemoryRow; existing?: MemoryRow; similarity?: number; warning?: string }>;
  reinforce(id: string): Promise<MemoryRow>;
  update(id: string, patch: Partial<NewEntry>): Promise<MemoryRow>;
  supersede(oldId: string, input: NewEntry): Promise<MemoryRow>;
  promote(id: string): Promise<MemoryRow>;
  list(filter: ListFilter): Promise<{ entries: MemoryRow[]; total: number }>;
  status(): Promise<{ counts: Record<string, number> }>;
  health(): Promise<boolean>;
};
class CoreError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
  }
}

function toRow(input: any): NewMemoryRow {
  const v = input as { scope?: string; project_key?: string | null; kind: string; title: string; trigger: string; body: string; tags?: string[]; pinned?: boolean; sensitive?: boolean; source?: string; agent_session?: string };
  const scope = (v.scope === "project" ? "project" : "global") as "global" | "project";
  return {
    scope,
    project_key: scope === "global" ? null : (v.project_key ?? null),
    kind: v.kind,
    title: v.title.trim(),
    trigger: v.trigger.trim(),
    body: v.body.trim(),
    tags: (v.tags ?? []).map((t) => t.trim()).filter(Boolean),
    pinned: v.pinned === true,
    sensitive: v.sensitive === true,
    source: v.source ?? null,
    agent_session: v.agent_session ?? null,
  };
}

function score(query: string, row: MemoryRow, by: "recall" | "related"): number {
  const q = normalize(query);
  const text = by === "related" ? row.trigger : `${row.title} ${row.trigger} ${row.body}`;
  const fts = tokenOverlap(q, text);
  const tri = trigramSimilarity(q, text);
  const reinforced = Math.min(row.reinforced_count, 5) / 5;
  const pinned = row.pinned ? 0.1 : 0;
  return 0.5 * fts + 0.3 * tri + 0.1 * reinforced + pinned;
}

export function createCore(store: MemoryStore): Core {
  return {
    async index(projectKey, maxBytes = 8192) {
      const rows = await store.list({ status: "active", limit: 500 });
      const filtered = rows.filter((r) => r.sensitive !== true && (projectKey === null || r.scope === "global" || r.project_key === projectKey));
      // index is global+project of this repo; keep global always, project only if matches
      const kept = filtered.filter((r) => r.scope === "global" || r.project_key === projectKey);
      const indexRows = kept.map((r) => ({ id: r.id, kind: r.kind, scope: r.scope, title: r.title, trigger: r.trigger, pinned: r.pinned, reinforced_count: r.reinforced_count, project_key: r.project_key }));
      return renderIndex(indexRows, maxBytes);
    },

    async related(context, projectKey = null) {
      const rows = await store.list({ status: "active", limit: 500 });
      const candidates = rows.filter((r) => !r.sensitive && (r.scope === "global" || r.project_key === projectKey));
      const scored = candidates
        .map((r) => ({ row: r, score: score(context, r, "related") }))
        .sort((a, b) => b.score - a.score || b.row.reinforced_count - a.row.reinforced_count)
        .slice(0, 5)
        .map((x) => x.row);
      return scored;
    },

    async recall(query, opts) {
      const rows = await store.list({ status: opts?.status ?? "active", limit: 500 });
      let candidates = rows;
      if (opts?.projectKey) candidates = candidates.filter((r) => r.scope === "global" || r.project_key === opts.projectKey);
      if (opts?.kinds?.length) candidates = candidates.filter((r) => opts.kinds!.includes(r.kind));
      if (opts?.tags?.length) candidates = candidates.filter((r) => opts.tags!.some((t) => r.tags.includes(t)));
      const scored = candidates
        .map((r) => ({ row: r, score: score(query, r, "recall") }))
        .sort((a, b) => b.score - a.score || b.row.reinforced_count - a.row.reinforced_count || (a.row.updated_at < b.row.updated_at ? 1 : -1))
        .slice(0, opts?.limit ?? 5)
        .map((x) => ({ ...x.row, score: x.score }));
      return scored;
    },

    async write(input) {
      const result = validateEntry(input);
      if (!result.ok) throw new CoreError(result.field, result.error);
      const row = toRow(result.value as any);

      if (row.scope === "project" && !row.project_key) {
        throw new CoreError("project_key", "project scope requires a project_key");
      }

      // replaces: deliberate act, bypasses dedupe
      if (input.replaces) {
        const created = await this.supersede(input.replaces, input);
        return { action: "superseded", id: created.id, entry: created };
      }

      // dedupe inside a transaction
      let outcome: { action: "created" | "reinforced" | "needs_decision"; entry?: MemoryRow; existing?: MemoryRow; similarity?: number; warning?: string } = { action: "created" };

      await store.transaction(async (tx) => {
        const all = await tx.list({ status: "active", limit: 500 });
        const sameScope = all.filter((r) => r.scope === row.scope && (row.scope === "global" || r.project_key === row.project_key));
        let best: { row: MemoryRow; sim: number } | null = null;
        for (const r of sameScope) {
          const sim = trigramSimilarity(row.title, r.title);
          if (sim > 0.7 && (!best || sim > best.sim)) best = { row: r, sim };
        }
        if (best && input.force !== true) {
          outcome = { action: "needs_decision", existing: best.row, similarity: best.sim };
          return;
        }
        if (best && input.force === true) {
          // still create a new row (force bypass)
        }
        // cross-project warning for project scope
        let warning: string | undefined;
        if (row.scope === "project") {
          const other = all.find((r) => r.scope === "project" && r.project_key !== row.project_key && trigramSimilarity(row.title, r.title) > 0.7);
          if (other) warning = `similar title exists in project ${other.project_key}`;
        }
        const created = await tx.insert(row);
        if (best) {
          // reinforce the existing instead? No: force means create new. But dedupe path reinforces. Handle reinforce separately.
        }
        outcome = { action: "created", entry: created, warning };
      });

      // reinforce path: if not force and a duplicate existed we already returned needs_decision.
      // If a near-duplicate existed and we want reinforce, caller uses reinforce(). So nothing here.

      if (outcome.action === "needs_decision") return outcome;

      // Reinforce when force is false and similarity high? Already handled by needs_decision. 
      return outcome;
    },

    async reinforce(id) {
      const row = await store.get(id);
      if (!row) throw new CoreError("id", "entry not found");
      return store.reinforce(id);
    },

    async update(id, patch) {
      const row = await store.get(id);
      if (!row) throw new CoreError("id", "entry not found");
      const merged = { ...row, ...patch } as NewEntry;
      const v = validateEntry(merged);
      if (!v.ok) throw new CoreError(v.field, v.error);
      const newRow = toRow(v.value as any);
      // dedupe on reworded title excluding self
      const all = await store.list({ status: "active", limit: 500 });
      const other = all.find((r) => r.id !== id && r.scope === newRow.scope && (newRow.scope === "global" || r.project_key === newRow.project_key) && trigramSimilarity(newRow.title, r.title) > 0.7);
      if (other) throw new CoreError("title", `similar entry exists: ${other.id}`);
      const updated = await store.update(id, newRow);
      return updated;
    },

    async supersede(oldId, input) {
      const result = validateEntry(input);
      if (!result.ok) throw new CoreError(result.field, result.error);
      const row = toRow(result.value as any);
      const created = await store.supersede(oldId, row);
      const pred = await store.predecessorOf(created.id);
      return { ...created, replaces_id: pred?.id ?? null, replaces_title: pred?.title ?? null, replaces_created_at: pred?.created_at ?? null, replaces: pred ? { id: pred.id, title: pred.title, created_at: pred.created_at } : null };
    },

    async promote(id) {
      const row = await store.get(id);
      if (!row) throw new CoreError("id", "entry not found");
      if (row.scope !== "project") throw new CoreError("scope", "only project entries can be promoted");
      const updated = await store.update(id, { scope: "global", project_key: null } as any);
      return updated;
    },

    async list(filter) {
      const rows = await store.list(filter);
      return { entries: rows, total: rows.length };
    },

    async status() {
      const counts = await store.counts();
      return { counts };
    },

    async health() {
      try {
        await store.counts();
        return true;
      } catch {
        return false;
      }
    },
  };
}

export { CoreError };
