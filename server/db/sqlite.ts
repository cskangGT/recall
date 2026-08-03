import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * `node:sqlite` is loaded through createRequire rather than imported.
 *
 * Vite resolves bare specifiers against the builtin list it was compiled with,
 * and 5.x predates `node:sqlite` becoming stable — a static import fails with
 * "Failed to load url sqlite" before the test even runs. createRequire is
 * evaluated at runtime by Node itself, which does know the module.
 */
const nodeRequire = createRequire(import.meta.url);

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  new (path: string): SqliteDatabase;
  DatabaseSync: new (path: string) => SqliteDatabase;
};
import type {
  Category, Entity, GraphPayload, Memory, RelatesToEdge,
} from '../../src/core/types.ts';
import type {
  MemoryAssignment, ReorgEventRow, Repository, SourceRow,
} from './repository.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const bool = (v: unknown): boolean => v === 1 || v === true;
const int = (v: boolean): number => (v ? 1 : 0);
const json = <T>(v: unknown, fallback: T): T =>
  typeof v === 'string' ? (JSON.parse(v) as T) : fallback;

export class SqliteRepository implements Repository {
  private readonly db: SqliteDatabase;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
  }

  migrate(): void {
    this.db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  }

  // ---------------------------------------------------------------- workspace

  createWorkspace(input: { id: string; name: string; isDemo?: boolean }): void {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, auto_reorganize, model_tier, is_demo, created_at)
         VALUES (?, ?, 1, 'fast', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(input.id, input.name, int(input.isDemo ?? false), new Date().toISOString());
  }

  deleteWorkspace(id: string): void {
    // Every table cascades from workspaces, but SQLite only honours that with
    // foreign_keys ON — which schema.sql sets per connection, not per database.
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  getWorkspace(id: string) {
    const row = this.db
      .prepare('SELECT id, name, auto_reorganize FROM workspaces WHERE id = ?')
      .get(id) as { id: string; name: string; auto_reorganize: number } | undefined;
    return row ? { ...row, auto_reorganize: bool(row.auto_reorganize) } : null;
  }

  // ---------------------------------------------------------------- graph read

  /**
   * Assembles the frontend's payload. `memory_category` is denormalized onto
   * each memory here rather than exposed as a join table, because the frontend
   * has no use for the many-to-one shape — same reasoning as `src/core/types.ts`.
   */
  getGraphPayload(workspaceId: string): GraphPayload {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`unknown workspace ${workspaceId}`);

    const memories = this.listMemories(workspaceId);
    const entityLinks = this.db
      .prepare(
        `SELECT me.memory_id, me.entity_id FROM memory_entity me
         JOIN memories m ON m.id = me.memory_id WHERE m.workspace_id = ?`,
      )
      .all(workspaceId) as { memory_id: string; entity_id: string }[];

    const byMemory = new Map<string, string[]>();
    for (const link of entityLinks) {
      const list = byMemory.get(link.memory_id) ?? [];
      list.push(link.entity_id);
      byMemory.set(link.memory_id, list);
    }

    return {
      workspace: { id: ws.id, name: ws.name, auto_reorganize: ws.auto_reorganize },
      sources: this.listSources(workspaceId).map(({ workspace_id: _w, ...s }) => ({
        id: s.id, type: s.type, title: s.title, raw_content: s.raw_content,
        scene_description: s.scene_description, url: s.url,
        image_path: s.image_path, created_at: s.created_at,
        // Surfaced so the Sources screen can offer a retry rather than showing
        // a failed capture as merely empty.
        status: s.status, error_message: s.error_message,
      })),
      memories: memories.map((m) => ({
        ...m,
        entity_ids: (byMemory.get(m.id) ?? []).sort(),
      })),
      categories: this.listCategories(workspaceId),
      entities: this.listEntities(workspaceId),
      edges: this.listEdges(workspaceId),
    };
  }

  // ---------------------------------------------------------------- sources

  insertSource(workspaceId: string, s: SourceRow): void {
    this.db
      .prepare(
        `INSERT INTO sources (id, workspace_id, type, title, raw_content, scene_description,
                              url, image_path, referenced_urls, detected_context, summary,
                              status, error_message, created_at, processed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.id, workspaceId, s.type, s.title, s.raw_content, s.scene_description,
        s.url, s.image_path, JSON.stringify(s.referenced_urls ?? []),
        (s as { detected_context?: string | null }).detected_context ?? null,
        (s as { summary?: string | null }).summary ?? null,
        s.status, s.error_message, s.created_at, s.processed_at,
      );
  }

  updateSourceStatus(
    id: string,
    status: SourceRow['status'],
    fields: {
      error_message?: string | null;
      summary?: string | null;
      processed_at?: string | null;
      title?: string | null;
    } = {},
  ): void {
    // COALESCE gives every field "null means leave it alone" semantics, which is
    // right for summary and processed_at and wrong for the error: it made a
    // message unclearable, so a source that failed once carried its error into
    // every later state — including a successful retry. An error belongs to a
    // failure, so anything that is not a failure clears it.
    this.db
      .prepare(
        `UPDATE sources SET status = ?,
           error_message = CASE WHEN ? = 1 THEN COALESCE(?, error_message) ELSE NULL END,
           summary       = COALESCE(?, summary),
           processed_at  = COALESCE(?, processed_at),
           title         = COALESCE(?, title)
         WHERE id = ?`,
      )
      .run(
        status,
        status === 'failed' ? 1 : 0,
        fields.error_message ?? null,
        fields.summary ?? null,
        fields.processed_at ?? null,
        fields.title ?? null,
        id,
      );
  }

  setAutoReorganize(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE workspaces SET auto_reorganize = ? WHERE id = ?').run(int(enabled), id);
  }

  listSources(workspaceId: string): SourceRow[] {
    const rows = this.db
      .prepare('SELECT * FROM sources WHERE workspace_id = ? ORDER BY created_at DESC, id')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      ...(r as unknown as SourceRow),
      referenced_urls: json<string[]>(r.referenced_urls, []),
    }));
  }

  // ---------------------------------------------------------------- memories

  insertMemories(workspaceId: string, memories: Memory[]): void {
    const dims = new Set(memories.map((m) => m.vector.length));
    if (dims.size > 1) {
      throw new Error(`mixed embedding dimensions in one batch: ${[...dims].join(', ')}`);
    }
    const existing = this.db
      .prepare('SELECT vector FROM memories WHERE workspace_id = ? LIMIT 1')
      .get(workspaceId) as { vector: string } | undefined;
    if (existing && memories.length > 0) {
      const stored = json<number[]>(existing.vector, []).length;
      const incoming = memories[0]!.vector.length;
      if (stored !== incoming) {
        throw new Error(
          `embedding dimension changed: workspace holds ${stored}-dim vectors, got ${incoming}. ` +
            'Re-embed the whole corpus — cosine across mixed dimensions is meaningless.',
        );
      }
    }

    const stmt = this.db.prepare(
      `INSERT INTO memories (id, workspace_id, source_id, text, kind, confidence,
                             vector, x, y, pinned, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const m of memories) {
      stmt.run(
        m.id, workspaceId, m.source_id, m.text, m.kind, m.confidence,
        JSON.stringify(m.vector), m.x, m.y, int(m.pinned), m.created_at,
      );
    }
  }

  listMemories(workspaceId: string): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, mc.category_id, mc.locked
         FROM memories m
         LEFT JOIN memory_category mc ON mc.memory_id = m.id
         WHERE m.workspace_id = ?
         ORDER BY m.id`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      source_id: r.source_id as string,
      text: r.text as string,
      kind: r.kind as Memory['kind'],
      confidence: r.confidence as number,
      category_id: (r.category_id as string | null) ?? '',
      category_locked: bool(r.locked),
      entity_ids: [],
      vector: json<number[]>(r.vector, []),
      x: (r.x as number | null) ?? null,
      y: (r.y as number | null) ?? null,
      pinned: bool(r.pinned),
      created_at: r.created_at as string,
    }));
  }

  updateMemoryPosition(id: string, x: number | null, y: number | null, pinned: boolean): void {
    this.db.prepare('UPDATE memories SET x = ?, y = ?, pinned = ? WHERE id = ?')
      .run(x, y, int(pinned), id);
  }

  replaceMemoryVectors(workspaceId: string, vectors: Map<string, number[]>): void {
    const dims = new Set([...vectors.values()].map((v) => v.length));
    if (dims.size > 1) {
      throw new Error(`re-embed produced mixed dimensions: ${[...dims].join(', ')}`);
    }
    const ids = this.db
      .prepare('SELECT id FROM memories WHERE workspace_id = ?')
      .all(workspaceId) as { id: string }[];
    const missing = ids.filter((r) => !vectors.has(r.id));
    if (missing.length > 0) {
      throw new Error(
        `re-embed covered ${vectors.size} of ${ids.length} memories — ` +
          'a partial swap would leave two embedding spaces in one workspace',
      );
    }

    const update = this.db.prepare('UPDATE memories SET vector = ? WHERE id = ? AND workspace_id = ?');
    this.db.exec('BEGIN');
    try {
      for (const [id, vector] of vectors) update.run(JSON.stringify(vector), id, workspaceId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------------------------------------------------------------- categories

  insertCategory(workspaceId: string, c: Category): void {
    this.db
      .prepare(
        `INSERT INTO categories (id, workspace_id, parent_id, name, rationale, name_locked,
                                 user_created, x, y, pinned, created_at, created_by, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE workspace_id = ?))`,
      )
      .run(
        c.id, workspaceId, c.parent_id, c.name, c.rationale, int(c.name_locked),
        int(c.user_created), c.x, c.y, int(c.pinned), new Date().toISOString(), c.created_by,
        workspaceId,
      );
  }

  updateCategory(id: string, fields: Partial<Category>): void {
    const allowed = ['name', 'parent_id', 'name_locked', 'user_created', 'x', 'y', 'pinned'] as const;
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const key of allowed) {
      if (!(key in fields)) continue;
      const raw = fields[key];
      sets.push(`${key} = ?`);
      values.push(typeof raw === 'boolean' ? int(raw) : (raw as string | number | null));
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteMemory(id: string): void {
    // One statement, because the schema already describes the consequences:
    // memory_category, memory_entity and both edge endpoints cascade, and the
    // FTS row goes with the trigger at schema.sql.
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  deleteCategory(id: string): void {
    // Re-parent members to the category's parent first: deleting a category
    // must never delete memories (spec §5.4, AC-30).
    const row = this.db.prepare('SELECT parent_id FROM categories WHERE id = ?')
      .get(id) as { parent_id: string | null } | undefined;
    if (row?.parent_id) {
      this.db.prepare('UPDATE memory_category SET category_id = ? WHERE category_id = ?')
        .run(row.parent_id, id);
    }
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }

  listCategories(workspaceId: string): Category[] {
    const rows = this.db
      .prepare('SELECT * FROM categories WHERE workspace_id = ? ORDER BY sort_order, id')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      parent_id: (r.parent_id as string | null) ?? null,
      name: r.name as string,
      rationale: (r.rationale as string | null) ?? null,
      name_locked: bool(r.name_locked),
      user_created: bool(r.user_created),
      x: (r.x as number | null) ?? null,
      y: (r.y as number | null) ?? null,
      pinned: bool(r.pinned),
      created_by: r.created_by as 'ai' | 'user',
    }));
  }

  // ---------------------------------------------------------------- assignment

  assign(a: MemoryAssignment): void {
    this.db
      .prepare(
        `INSERT INTO memory_category (memory_id, category_id, confidence, locked, assigned_at, assigned_by)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(memory_id) DO UPDATE SET
           category_id = excluded.category_id,
           confidence  = excluded.confidence,
           locked      = excluded.locked,
           assigned_at = excluded.assigned_at,
           assigned_by = excluded.assigned_by`,
      )
      .run(
        a.memoryId, a.categoryId, a.confidence,
        int(a.locked ?? a.assignedBy === 'user'),
        new Date().toISOString(), a.assignedBy,
      );
  }

  isAssignmentLocked(memoryId: string): boolean {
    const row = this.db.prepare('SELECT locked FROM memory_category WHERE memory_id = ?')
      .get(memoryId) as { locked: number } | undefined;
    return bool(row?.locked);
  }

  // ---------------------------------------------------------------- entities

  upsertEntity(
    workspaceId: string,
    e: Omit<Entity, 'x' | 'y' | 'pinned'> & { normalized_name: string },
  ): string {
    // An alias hit resolves to the canonical entity, so "anthropic" and
    // "Anthropic" never become two nodes on the map (spec §10.2).
    const alias = this.db
      .prepare('SELECT entity_id FROM entity_aliases WHERE workspace_id = ? AND alias_normalized = ?')
      .get(workspaceId, e.normalized_name) as { entity_id: string } | undefined;
    if (alias) return alias.entity_id;

    const existing = this.db
      .prepare('SELECT id FROM entities WHERE workspace_id = ? AND normalized_name = ?')
      .get(workspaceId, e.normalized_name) as { id: string } | undefined;
    if (existing) return existing.id;

    this.db
      .prepare(
        `INSERT INTO entities (id, workspace_id, name, normalized_name, kind, x, y, pinned, created_at)
         VALUES (?,?,?,?,?,NULL,NULL,0,?)`,
      )
      .run(e.id, workspaceId, e.name, e.normalized_name, e.kind, new Date().toISOString());
    return e.id;
  }

  linkMemoryEntity(memoryId: string, entityId: string): void {
    this.db
      .prepare('INSERT INTO memory_entity (memory_id, entity_id) VALUES (?,?) ON CONFLICT DO NOTHING')
      .run(memoryId, entityId);
  }

  listEntities(workspaceId: string): Entity[] {
    const rows = this.db
      .prepare('SELECT * FROM entities WHERE workspace_id = ? ORDER BY id')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      kind: r.kind as Entity['kind'],
      x: (r.x as number | null) ?? null,
      y: (r.y as number | null) ?? null,
      pinned: bool(r.pinned),
    }));
  }

  // ---------------------------------------------------------------- search

  keywordSearch(
    workspaceId: string,
    query: string,
    limit: number,
  ): { memoryId: string; rank: number }[] {
    // FTS5 MATCH takes a query language, so raw user input is a syntax hazard,
    // not just a relevance one: an apostrophe or a bare `AND` throws. Reduce
    // the question to bare terms and OR them — recall matters more than
    // precision here because RRF and the relevance floor do the filtering.
    const terms = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t}"`).join(' OR ');

    try {
      const rows = this.db
        .prepare(
          `SELECT m.id AS id, bm25(memories_fts) AS score
           FROM memories_fts
           JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ? AND m.workspace_id = ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(match, workspaceId, limit) as { id: string; score: number }[];
      return rows.map((r) => ({ memoryId: r.id, rank: r.score }));
    } catch {
      // A malformed query must not take the whole Ask down — the vector half
      // still produces a usable ranking on its own.
      return [];
    }
  }

  // ---------------------------------------------------------------- edges

  replaceRelatesToEdges(workspaceId: string, edges: RelatesToEdge[]): void {
    this.db.prepare('DELETE FROM edges WHERE workspace_id = ?').run(workspaceId);
    const stmt = this.db.prepare(
      `INSERT INTO edges (id, workspace_id, source_memory_id, target_memory_id, similarity, created_at)
       VALUES (?,?,?,?,?,?)`,
    );
    const now = new Date().toISOString();
    for (const e of edges) {
      // The CHECK constraint requires the ordered pair; normalize rather than
      // trusting the caller, so a duplicate can never be inserted.
      const [a, b] = [e.source_memory_id, e.target_memory_id].sort();
      stmt.run(e.id, workspaceId, a, b, e.similarity, now);
    }
  }

  listEdges(workspaceId: string): RelatesToEdge[] {
    return this.db
      .prepare(
        `SELECT id, source_memory_id, target_memory_id, similarity
         FROM edges WHERE workspace_id = ? ORDER BY id`,
      )
      .all(workspaceId) as RelatesToEdge[];
  }

  // ---------------------------------------------------------------- reorg log

  insertReorgEvent(workspaceId: string, e: ReorgEventRow): void {
    this.db
      .prepare(
        `INSERT INTO reorg_events (id, workspace_id, trigger_source_id, operation, status,
                                   affected_category_ids, created_category_ids, banner_text,
                                   before_state, after_state, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.id, workspaceId, e.trigger_source_id, e.operation, e.status,
        JSON.stringify(e.affected_category_ids), JSON.stringify(e.created_category_ids),
        e.banner_text, JSON.stringify(e.before_state),
        e.after_state ? JSON.stringify(e.after_state) : null, e.created_at,
      );
  }

  listReorgEvents(workspaceId: string, limit: number): ReorgEventRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM reorg_events WHERE workspace_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(workspaceId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      trigger_source_id: (r.trigger_source_id as string | null) ?? null,
      operation: r.operation as ReorgEventRow['operation'],
      status: r.status as ReorgEventRow['status'],
      affected_category_ids: json<string[]>(r.affected_category_ids, []),
      created_category_ids: json<string[]>(r.created_category_ids, []),
      banner_text: r.banner_text as string,
      before_state: json<ReorgEventRow['before_state']>(r.before_state, {} as never),
      after_state: r.after_state ? json<ReorgEventRow['before_state']>(r.after_state, {} as never) : null,
      created_at: r.created_at as string,
    }));
  }

  markReorgUndone(id: string): void {
    this.db.prepare("UPDATE reorg_events SET status = 'undone' WHERE id = ?").run(id);
  }

  // ---------------------------------------------------------------- tombstones

  addTombstone(workspaceId: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO category_tombstones (id, workspace_id, name, deleted_at)
         VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
      )
      .run(`tomb_${workspaceId}_${name.toLowerCase()}`, workspaceId, name.toLowerCase(), new Date().toISOString());
  }

  listTombstones(workspaceId: string): string[] {
    return (
      this.db.prepare('SELECT name FROM category_tombstones WHERE workspace_id = ?')
        .all(workspaceId) as { name: string }[]
    ).map((r) => r.name);
  }

  // ---------------------------------------------------------------- ask

  recordAsk(workspaceId: string, input: {
    id: string; question: string; answer: string | null; citations: unknown; refused: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ask_history (id, workspace_id, question, answer, citations, refused, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        input.id, workspaceId, input.question, input.answer,
        JSON.stringify(input.citations), int(input.refused), new Date().toISOString(),
      );
  }

  // ---------------------------------------------------------------- lifecycle

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}
