export type MemoryRow = {
  id: string;
  scope: "global" | "project";
  project_key: string | null;
  kind: string;
  title: string;
  trigger: string;
  body: string;
  tags: string[];
  status: "active" | "superseded" | "archived";
  superseded_by: string | null;
  pinned: boolean;
  sensitive: boolean;
  source: string | null;
  agent_session: string | null;
  reinforced_count: number;
  last_reinforced_at: string | null;
  recall_count: number;
  last_recalled_at: string | null;
  created_at: string;
  updated_at: string;
  score?: number;
  replaces_id?: string | null;
  replaces_title?: string | null;
  replaces_created_at?: string | null;
  replaces?: { id: string; title: string; created_at: string } | null;
};

export type NewMemoryRow = {
  scope: "global" | "project";
  project_key: string | null;
  kind: string;
  title: string;
  trigger: string;
  body: string;
  tags: string[];
  pinned: boolean;
  sensitive: boolean;
  source: string | null;
  agent_session: string | null;
};

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

export type ListFilter = {
  scope?: "global" | "project";
  project_key?: string | null;
  kind?: string;
  tag?: string;
  status?: "active" | "superseded" | "archived" | "all";
  limit?: number;
};
