import type { HandoffRow, ListFilter, MemoryRow, NewHandoffRow, NewMemoryRow } from "../core/types.ts";

export interface MemoryStore {
  readonly name: string;
  transaction<T>(fn: (tx: MemoryStore) => Promise<T>): Promise<T>;
  insert(input: NewMemoryRow): Promise<MemoryRow>;
  get(id: string): Promise<MemoryRow | null>;
  list(filter: ListFilter): Promise<MemoryRow[]>;
  update(id: string, patch: Partial<NewMemoryRow>): Promise<MemoryRow>;
  reinforce(id: string): Promise<MemoryRow>;
  supersede(oldId: string, input: NewMemoryRow): Promise<MemoryRow>;
  predecessorOf(id: string): Promise<MemoryRow | null>;
  counts(): Promise<Record<string, any>>;
  close(): Promise<void>;
  insertHandoff(input: NewHandoffRow): Promise<HandoffRow>;
  getLatestHandoff(projectKey: string | null): Promise<HandoffRow | null>;
  completeHandoff(id: string): Promise<void>;
  listHandoffs(filter?: { scope?: "global" | "project"; project_key?: string | null; status?: "active" | "completed" | "expired" | "all"; limit?: number }): Promise<HandoffRow[]>;
}
