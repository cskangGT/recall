import type {
  Category, Entity, GraphPayload, Memory, RelatesToEdge, Source,
} from '../../src/core/types.ts';

/**
 * The storage seam.
 *
 * The pipeline is written against this interface and never against SQL, which
 * is what lets a Postgres implementation replace SQLite later without the
 * pipeline noticing — the same seam `DataSource` provides on the frontend.
 */

export interface SourceRow extends Source {
  workspace_id: string;
  referenced_urls: string[];
  status: 'pending' | 'processing' | 'complete' | 'failed' | 'no_memories';
  error_message: string | null;
  processed_at: string | null;
  /** When the user reviewed this source's extractions — null means not yet. */
  reviewed_at?: string | null;
}

/** One review verdict, recorded verbatim — the curation signal (spec §21). */
export interface CurationRow {
  id: string;
  source_id: string | null;
  /** The memory's text at the moment of the verdict — a discard keeps it. */
  memory_text: string;
  verdict: 'keep' | 'discard' | 'edit';
  edited_text: string | null;
  created_at: string;
}

export interface MemoryAssignment {
  memoryId: string;
  categoryId: string;
  confidence: number;
  assignedBy: 'ai' | 'user';
  locked?: boolean;
}

export interface ReorgEventRow {
  id: string;
  trigger_source_id: string | null;
  operation: 'split' | 'merge' | 'promote' | 'new_category' | 'attach_only';
  status: 'applied' | 'proposed' | 'undone' | 'dismissed';
  affected_category_ids: string[];
  created_category_ids: string[];
  banner_text: string;
  before_state: GraphPayload;
  after_state: GraphPayload | null;
  created_at: string;
}

export interface Repository {
  /** Applies the schema. Idempotent. */
  migrate(): void;

  createWorkspace(input: { id: string; name: string; isDemo?: boolean; plan?: 'free' | 'pro' }): void;
  /** Drops a workspace and everything under it. Used to reset the demo. */
  deleteWorkspace(id: string): void;
  getWorkspace(
    id: string,
  ): { id: string; name: string; auto_reorganize: boolean; plan: 'free' | 'pro' } | null;
  /** Billing writes this; nothing else does. */
  setPlan(id: string, plan: 'free' | 'pro'): void;
  setAutoReorganize(id: string, enabled: boolean): void;

  /**
   * The single read the frontend needs — the same shape `SeedDataSource` returns,
   * so swapping the frontend's data source is a one-line change (spec §12.1).
   */
  getGraphPayload(workspaceId: string): GraphPayload;

  insertSource(workspaceId: string, source: SourceRow): void;
  updateSourceStatus(
    id: string,
    status: SourceRow['status'],
    fields?: {
      error_message?: string | null;
      summary?: string | null;
      processed_at?: string | null;
      title?: string | null;
    },
  ): void;
  listSources(workspaceId: string): SourceRow[];

  insertMemories(workspaceId: string, memories: Memory[]): void;
  /** A duplicate arrival strengthens what is already held — never rewrites it. */
  reinforceMemory(id: string): void;
  listMemories(workspaceId: string): Memory[];
  updateMemoryPosition(id: string, x: number | null, y: number | null, pinned: boolean): void;
  /**
   * Swaps every vector in the workspace at once.
   *
   * All-or-nothing because a workspace holding two embedding spaces is worse
   * than one holding the wrong space consistently: cosine between them is
   * meaningless, so retrieval degrades silently instead of failing.
   */
  replaceMemoryVectors(workspaceId: string, vectors: Map<string, number[]>): void;

  /**
   * Removes a memory outright. The schema does the rest: its assignment, its
   * entity links and both ends of its edges are ON DELETE CASCADE, and an FTS
   * trigger clears the index (server/db/schema.sql).
   *
   * Deliberately not reversible. `IngestPipeline.undo` re-assigns the memories
   * in a reorg's before_state rather than re-inserting them, so a row this took
   * away cannot be put back by it — which is why the UI asks first rather than
   * offering an undo it could not honour.
   */
  deleteMemory(id: string): void;

  insertCategory(workspaceId: string, category: Category): void;
  updateCategory(id: string, fields: Partial<Pick<Category,
    'name' | 'parent_id' | 'name_locked' | 'user_created' | 'x' | 'y' | 'pinned'>>): void;
  deleteCategory(id: string): void;
  listCategories(workspaceId: string): Category[];

  assign(assignment: MemoryAssignment): void;
  /** The join row's lock, checked before any reorganization touches a memory. */
  isAssignmentLocked(memoryId: string): boolean;

  upsertEntity(workspaceId: string, entity: Omit<Entity, 'x' | 'y' | 'pinned'> & {
    normalized_name: string;
  }): string;
  linkMemoryEntity(memoryId: string, entityId: string): void;
  listEntities(workspaceId: string): Entity[];

  /**
   * Keyword half of hybrid retrieval, best first. Implementation-specific by
   * design: SQLite uses FTS5/bm25, Postgres would use tsvector — the fusion in
   * `server/search/retrieve.ts` only needs an ordered list of ids.
   */
  keywordSearch(workspaceId: string, query: string, limit: number): { memoryId: string; rank: number }[];

  replaceRelatesToEdges(workspaceId: string, edges: RelatesToEdge[]): void;
  listEdges(workspaceId: string): RelatesToEdge[];

  insertReorgEvent(workspaceId: string, event: ReorgEventRow): void;
  listReorgEvents(workspaceId: string, limit: number): ReorgEventRow[];
  markReorgUndone(id: string): void;

  addTombstone(workspaceId: string, name: string): void;
  listTombstones(workspaceId: string): string[];

  // ------------------------------------------------------------- curation
  /** Records one review verdict. The signal that teaches the next extraction. */
  insertCuration(workspaceId: string, row: CurationRow): void;
  /** Most recent first. `verdict` filters; absent returns all. */
  listCuration(workspaceId: string, verdict?: CurationRow['verdict'], limit?: number): CurationRow[];
  /** Stamps the source as reviewed. */
  setSourceReviewed(sourceId: string, reviewedAt: string): void;
  /**
   * Rewrites a memory's text and vector together — an edit moves the meaning,
   * so the embedding must move with it or retrieval quietly rots. The FTS
   * trigger keeps the keyword index in step on its own.
   */
  updateMemoryText(id: string, text: string, vector: number[]): void;

  recordAsk(workspaceId: string, input: {
    id: string; question: string; answer: string | null;
    citations: unknown; refused: boolean;
  }): void;

  /** All-or-nothing. An ingest that half-applies is worse than one that fails. */
  transaction<T>(fn: () => T): T;
  close(): void;
}
