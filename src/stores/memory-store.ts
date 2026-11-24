import type { ListFilter, MemoryRow, NewMemoryRow } from "../core/types.ts";

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
  counts(): Promise<Record<string, number>>;
  close(): Promise<void>;
}
