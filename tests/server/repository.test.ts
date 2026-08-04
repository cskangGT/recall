import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importSeed } from '../../server/seed/import';
import { validateSeed } from '../../src/data/validateSeed';
import { evaluateReorg } from '../../src/core/gates';
import { meanPairwiseCosine } from '../../src/core/vectorMath';
import { SPLIT } from '../../src/core/thresholds';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import type { GraphPayload, Memory } from '../../src/core/types';

const WS = 'ws_demo';
let repo: SqliteRepository;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
});

afterEach(() => repo.close());

describe('SqliteRepository — seed round-trip', () => {
  it('reproduces the seed payload the frontend validates', () => {
    importSeed(repo, WS);
    const payload = repo.getGraphPayload(WS);

    // The read must satisfy exactly the same validator the frontend uses —
    // that is the whole point of sharing src/core.
    const validated = validateSeed(payload);
    expect(validated.memories).toHaveLength(47);
    expect(validated.sources).toHaveLength(22);
    expect(validated.categories.filter((c) => c.parent_id === null)).toHaveLength(6);
    expect(validated.categories.filter((c) => c.parent_id !== null)).toHaveLength(14);
    expect(validated.entities).toHaveLength(31);
    expect(validated.edges).toHaveLength((workspaceJson as GraphPayload).edges.length);
  });

  it('preserves the authored category order, not alphabetical or insertion-batched', () => {
    importSeed(repo, WS);
    const fromFile = (workspaceJson as unknown as GraphPayload).categories.map((c) => c.name);
    const fromDb = repo.getGraphPayload(WS).categories.map((c) => c.name);

    // The claim the architecture rests on is that swapping the data source
    // changes nothing above it. Order is part of "nothing": buildTree and the
    // map both read payload order, so a differently-sorted payload renders a
    // differently-shaped app.
    expect(fromDb).toEqual(fromFile);
    expect(fromDb[0]).toBe('Fundraising');
  });

  it('round-trips vectors without precision loss', () => {
    importSeed(repo, WS);
    const original = (workspaceJson as unknown as GraphPayload).memories;
    const loaded = repo.listMemories(WS);
    for (const o of original) {
      const l = loaded.find((m) => m.id === o.id)!;
      expect(l.vector).toEqual(o.vector);
    }
  });

  it("carries every memory's category assignment through", () => {
    importSeed(repo, WS);
    const original = (workspaceJson as unknown as GraphPayload).memories;
    const loaded = repo.getGraphPayload(WS).memories;
    for (const o of original) {
      expect(loaded.find((m) => m.id === o.id)!.category_id).toBe(o.category_id);
    }
  });

  it('preserves the demo split condition through the database (AC-27)', () => {
    importSeed(repo, WS);
    const payload = repo.getGraphPayload(WS);
    const ai = payload.categories.find((c) => c.name === 'AI Tooling')!;
    const members = payload.memories.filter((m) => m.category_id === ai.id);

    expect(members).toHaveLength(9);
    expect(meanPairwiseCosine(members.map((m) => m.vector)))
      .toBeGreaterThan(SPLIT.MAX_MEAN_COHESION);
    expect(evaluateReorg(payload, [ai.id])).toBeNull();

    const withDemo: GraphPayload = {
      ...payload,
      memories: [...payload.memories, ...(demoItem.memories as unknown as Memory[])],
    };
    const candidate = evaluateReorg(withDemo, [ai.id]);
    expect(candidate?.operation).toBe('split');
    expect([candidate!.clusters!.a.length, candidate!.clusters!.b.length].sort((x, y) => x - y))
      .toEqual([4, 7]);
  });
});

describe('SqliteRepository — invariants the schema enforces', () => {
  beforeEach(() => importSeed(repo, WS));

  it('refuses a third level of category nesting', () => {
    const child = repo.listCategories(WS).find((c) => c.parent_id !== null)!;
    expect(() =>
      repo.insertCategory(WS, {
        id: 'cat_too_deep', parent_id: child.id, name: 'Too Deep', rationale: null,
        name_locked: false, user_created: false, x: 0, y: 0, pinned: false, created_by: 'ai',
      }),
    ).toThrow(/two levels deep/);
  });

  it('refuses to re-parent a category under a child', () => {
    const cats = repo.listCategories(WS);
    const child = cats.find((c) => c.parent_id !== null)!;
    const other = cats.find((c) => c.parent_id !== null && c.id !== child.id)!;
    expect(() => repo.updateCategory(other.id, { parent_id: child.id })).toThrow(/two levels deep/);
  });

  it('keeps one category per memory', () => {
    const cats = repo.listCategories(WS);
    const memory = repo.listMemories(WS)[0]!;
    const target = cats.find((c) => c.id !== memory.category_id)!;
    repo.assign({ memoryId: memory.id, categoryId: target.id, confidence: 0.9, assignedBy: 'user' });

    const after = repo.listMemories(WS).filter((m) => m.id === memory.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.category_id).toBe(target.id);
  });

  it('locks a user assignment so a reorganization cannot reclaim it (AC-24)', () => {
    const memory = repo.listMemories(WS)[0]!;
    const target = repo.listCategories(WS).find((c) => c.id !== memory.category_id)!;
    repo.assign({ memoryId: memory.id, categoryId: target.id, confidence: 0.9, assignedBy: 'user' });
    expect(repo.isAssignmentLocked(memory.id)).toBe(true);
    expect(repo.getGraphPayload(WS).memories.find((m) => m.id === memory.id)!.category_locked)
      .toBe(true);
  });

  it('deleting a category re-parents its memories and deletes none (AC-30)', () => {
    const before = repo.listMemories(WS).length;
    const child = repo.listCategories(WS).find((c) => c.parent_id !== null)!;
    const moved = repo.listMemories(WS).filter((m) => m.category_id === child.id).map((m) => m.id);
    expect(moved.length).toBeGreaterThan(0);

    repo.deleteCategory(child.id);

    expect(repo.listMemories(WS)).toHaveLength(before);
    const after = repo.listMemories(WS);
    for (const id of moved) {
      expect(after.find((m) => m.id === id)!.category_id).toBe(child.parent_id);
    }
  });

  it('refuses a duplicate relates_to edge in either direction', () => {
    expect(() =>
      repo.replaceRelatesToEdges(WS, [
        { id: 'e1', source_memory_id: 'mem_01', target_memory_id: 'mem_02', similarity: 0.9 },
        { id: 'e2', source_memory_id: 'mem_02', target_memory_id: 'mem_01', similarity: 0.9 },
      ]),
    ).toThrow();
  });

  it('deduplicates entities by normalized name', () => {
    const id1 = repo.upsertEntity(WS, {
      id: 'ent_new_a', name: 'Anthropic', kind: 'organization', normalized_name: 'anthropic',
    });
    const id2 = repo.upsertEntity(WS, {
      id: 'ent_new_b', name: 'anthropic', kind: 'organization', normalized_name: 'anthropic',
    });
    expect(id2).toBe(id1);
  });

  it('rejects a batch whose embedding dimension differs from the corpus', () => {
    expect(() =>
      repo.insertMemories(WS, [{
        id: 'mem_wrong_dim', source_id: 'src_eval_notes', text: 'x'.repeat(20),
        kind: 'fact', confidence: 0.5, category_id: '', category_locked: false,
        entity_ids: [], vector: new Array(1536).fill(0.1),
        x: null, y: null, pinned: false, created_at: '2026-07-26T00:00:00Z',
      }]),
    ).toThrow(/dimension changed/);
  });

  it('rolls back a failed transaction whole', () => {
    const before = repo.listCategories(WS).length;
    expect(() =>
      repo.transaction(() => {
        repo.insertCategory(WS, {
          id: 'cat_ok', parent_id: null, name: 'Fine', rationale: null,
          name_locked: false, user_created: false, x: 0, y: 0, pinned: false, created_by: 'ai',
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(repo.listCategories(WS)).toHaveLength(before);
  });

  it('records tombstones so a deleted name is not recreated (AC-25)', () => {
    repo.addTombstone(WS, 'Agent Frameworks');
    repo.addTombstone(WS, 'Agent Frameworks');
    expect(repo.listTombstones(WS)).toEqual(['agent frameworks']);
  });
});

describe('migrating a database that already exists', () => {
  // The reason this mechanism exists: `schema.sql` is entirely
  // `CREATE ... IF NOT EXISTS`, so it creates and can never alter. That was
  // fine while the database was `:memory:` or a demo file you deleted between
  // runs, and stopped being fine when a launchd agent started owning
  // ~/.recall/recall.db all day.

  const columns = (r: SqliteRepository, table: string) =>
    (r as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } })
      .db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

  const addColumn = (r: SqliteRepository, table: string, column: string, decl: string) =>
    (r as unknown as { ensureColumn: (t: string, c: string, d: string) => void })
      .ensureColumn(table, column, decl);

  it('adds a column an older database does not have', () => {
    expect(columns(repo, 'sources')).not.toContain('archived_at');
    addColumn(repo, 'sources', 'archived_at', 'TEXT');
    expect(columns(repo, 'sources')).toContain('archived_at');
  });

  it('is idempotent, because migrate() runs on every start', () => {
    addColumn(repo, 'sources', 'archived_at', 'TEXT');
    expect(() => addColumn(repo, 'sources', 'archived_at', 'TEXT')).not.toThrow();
    expect(columns(repo, 'sources').filter((c) => c === 'archived_at')).toHaveLength(1);
  });

  it('leaves the rows that were already there', () => {
    // The whole point is not losing what has accumulated.
    importSeed(repo, WS);
    const before = repo.listSources(WS).length;
    expect(before).toBeGreaterThan(0);
    addColumn(repo, 'sources', 'archived_at', 'TEXT');
    expect(repo.listSources(WS)).toHaveLength(before);
  });

  it('says nothing about a table this schema does not have', () => {
    expect(() => addColumn(repo, 'not_a_table', 'x', 'TEXT')).not.toThrow();
  });

  it('re-running migrate() on a populated database changes nothing', () => {
    importSeed(repo, WS);
    const before = { sources: repo.listSources(WS).length, memories: repo.listMemories(WS).length };
    repo.migrate();
    repo.migrate();
    expect(repo.listSources(WS)).toHaveLength(before.sources);
    expect(repo.listMemories(WS)).toHaveLength(before.memories);
  });
});

describe('snapshots of a live database', () => {
  it('produces a file another connection can read every row from', () => {
    importSeed(repo, WS);
    const dir = mkdtempSync(path.join(tmpdir(), 'recall-vac-'));
    const destination = path.join(dir, 'snap.db');
    try {
      repo.vacuumInto(destination);

      // Opened independently: this is what recovering from a backup means.
      const restored = new SqliteRepository(destination);
      expect(restored.listMemories(WS)).toHaveLength(repo.listMemories(WS).length);
      expect(restored.listSources(WS)).toHaveLength(repo.listSources(WS).length);
      expect(restored.getGraphPayload(WS).categories).toHaveLength(
        repo.getGraphPayload(WS).categories.length,
      );
      restored.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to write over one that exists, rather than replacing it', () => {
    importSeed(repo, WS);
    // A backup the next backup can silently overwrite is one bug from being no
    // backup at all — which is why the filename carries a timestamp.
    const dir = mkdtempSync(path.join(tmpdir(), 'recall-vac-'));
    const destination = path.join(dir, 'snap.db');
    try {
      repo.vacuumInto(destination);
      expect(() => repo.vacuumInto(destination)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
