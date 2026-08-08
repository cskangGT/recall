export type SourceType = 'text' | 'link' | 'screenshot';

export type MemoryKind = 'fact' | 'decision' | 'opinion' | 'question' | 'task' | 'reference';

export type EntityKind =
  | 'person'
  | 'project'
  | 'organization'
  | 'tool'
  | 'concept'
  | 'decision'
  | 'question';

export type ReorgOperation = 'split' | 'merge' | 'promote' | 'new_category' | 'attach_only';

export interface Source {
  id: string;
  type: SourceType;
  title: string;
  raw_content: string;
  scene_description: string | null;
  url: string | null;
  image_path: string | null;
  created_at: string;
  /**
   * Optional because seed payloads predate it and everything in them succeeded.
   * Absent means "fine" — only a failure needs saying.
   */
  status?: 'pending' | 'processing' | 'complete' | 'failed' | 'no_memories';
  error_message?: string | null;
}

/**
 * The database has a `memory_category` join table. The graph payload denormalizes it
 * onto the memory, because the frontend never needs the many-to-one shape.
 * `category_locked` mirrors `memory_category.locked`.
 */
export interface Memory {
  id: string;
  source_id: string;
  text: string;
  kind: MemoryKind;
  confidence: number;
  category_id: string;
  category_locked: boolean;
  entity_ids: string[];
  /**
   * Phase 1 ships 8-dimensional hand-generated unit vectors so the restructuring
   * gates run real geometry. Phase 4 swaps these for real embeddings
   * and the gate code does not change.
   */
  vector: number[];
  x: number | null;
  y: number | null;
  pinned: boolean;
  created_at: string;
  /**
   * How many times this thought has arrived. A duplicate capture is never
   * written twice — it *reinforces* what is already held, and the count is
   * the honest importance signal: saving the same idea three times says more
   * than any ranking heuristic. Optional because seed payloads predate it;
   * absent means 1.
   */
  times_seen?: number;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  rationale: string | null;
  name_locked: boolean;
  user_created: boolean;
  x: number | null;
  y: number | null;
  pinned: boolean;
  created_by: 'ai' | 'user';
}

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  x: number | null;
  y: number | null;
  pinned: boolean;
}

export interface RelatesToEdge {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  similarity: number;
}

export interface GraphPayload {
  /** `plan` is optional because seed payloads predate it; absent means 'pro'. */
  workspace: { id: string; name: string; auto_reorganize: boolean; plan?: 'free' | 'pro' };
  sources: Source[];
  memories: Memory[];
  categories: Category[];
  entities: Entity[];
  edges: RelatesToEdge[];
}

export type NodeKind = 'parent_category' | 'child_category' | 'memory' | 'entity';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  radius: number;
  pinned: boolean;
  /** Parent category id for memories and child categories; null for roots and entities. */
  parentId: string | null;
}

export type EdgeKind = 'contains' | 'mentions' | 'relates_to';

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
}
