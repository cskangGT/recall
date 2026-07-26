import { describe, it, expect } from 'vitest';
import { applyReorg, undoReorg } from '../../src/core/applyReorg';
import type { ReorgCandidate } from '../../src/core/gates';
import type { Category, GraphPayload, Memory } from '../../src/core/types';

/**
 * MERGE and PROMOTE, which the gates could already fire but applyReorg used to
 * throw on. That gap was worse than not having the gates: `evaluateReorg`
 * returns the single highest-scoring candidate, so a merge outscoring a split
 * meant the split was discarded and *nothing* happened.
 */

const category = (id: string, name: string, parent: string | null = null): Category => ({
  id, parent_id: parent, name, rationale: null,
  name_locked: false, user_created: false,
  x: 100, y: 100, pinned: false, created_by: 'ai',
});

const memory = (id: string, categoryId: string, locked = false): Memory => ({
  id, source_id: 'src_1', text: `memory ${id}`, kind: 'fact', confidence: 0.9,
  category_id: categoryId, category_locked: locked, entity_ids: [],
  vector: [1, 0, 0, 0, 0, 0, 0, 0],
  x: 50, y: 50, pinned: false, created_at: '2026-07-26T00:00:00Z',
});

const payloadWith = (categories: Category[], memories: Memory[]): GraphPayload => ({
  workspace: { id: 'ws', name: 'W', auto_reorganize: true },
  sources: [], memories, categories, entities: [], edges: [],
});

// ---------------------------------------------------------------- merge

describe('applyReorg — merge', () => {
  const parent = category('cat_p', 'Product');
  const big = { ...category('cat_a', 'Pricing', 'cat_p'), x: 10, y: 20 };
  const small = category('cat_b', 'Plans', 'cat_p');
  const memories = [
    memory('m1', 'cat_a'), memory('m2', 'cat_a'), memory('m3', 'cat_a'),
    memory('m4', 'cat_b'), memory('m5', 'cat_b'),
  ];
  const candidate: ReorgCandidate = {
    operation: 'merge', categoryIds: ['cat_a', 'cat_b'], score: 0.4,
  };

  it('consolidates into the larger category, which keeps its id and position', () => {
    const { payload } = applyReorg(payloadWith([parent, big, small], memories), candidate, ['Pricing']);

    const survivor = payload.categories.find((c) => c.id === 'cat_a')!;
    expect(survivor).toBeDefined();
    expect(survivor.x).toBe(10);
    expect(survivor.y).toBe(20);
    expect(payload.categories.find((c) => c.id === 'cat_b')).toBeUndefined();
    expect(payload.memories.filter((m) => m.category_id === 'cat_a')).toHaveLength(5);
  });

  it('applies the name the caller chose', () => {
    const { payload } = applyReorg(
      payloadWith([parent, big, small], memories), candidate, ['Pricing & Plans'],
    );
    expect(payload.categories.find((c) => c.id === 'cat_a')!.name).toBe('Pricing & Plans');
  });

  it('writes the verbatim banner template', () => {
    const { event } = applyReorg(payloadWith([parent, big, small], memories), candidate, ['Pricing']);
    expect(event.banner_text).toBe('Merged **Pricing** and **Plans** into **Pricing**');
    expect(event.operation).toBe('merge');
    expect(event.created_category_ids).toEqual([]);
  });

  it('survives regardless of which order the gate reported the pair in', () => {
    const reversed: ReorgCandidate = { ...candidate, categoryIds: ['cat_b', 'cat_a'] };
    const { payload } = applyReorg(payloadWith([parent, big, small], memories), reversed, ['Pricing']);
    // cat_a is still the larger, so it still survives.
    expect(payload.categories.find((c) => c.id === 'cat_a')).toBeDefined();
    expect(payload.categories.find((c) => c.id === 'cat_b')).toBeUndefined();
  });

  it('never moves a locked memory, and keeps its category alive rather than orphaning it', () => {
    const withLock = [...memories.slice(0, 4), memory('m5', 'cat_b', true)];
    const { payload } = applyReorg(payloadWith([parent, big, small], withLock), candidate, ['Pricing']);

    expect(payload.memories.find((m) => m.id === 'm5')!.category_id).toBe('cat_b');
    // Deleting cat_b would leave m5 pointing at nothing.
    expect(payload.categories.find((c) => c.id === 'cat_b')).toBeDefined();
  });

  it('restores exactly on undo', () => {
    const before = payloadWith([parent, big, small], memories);
    const { event } = applyReorg(before, candidate, ['Pricing']);
    expect(undoReorg(event)).toEqual(before);
  });
});

// ---------------------------------------------------------------- promote

describe('applyReorg — promote', () => {
  const parent = { ...category('cat_p', 'Product'), x: 0, y: 0 };
  const child = { ...category('cat_c', 'Pricing', 'cat_p'), x: 30, y: 40 };
  const memories = [memory('m1', 'cat_c'), memory('m2', 'cat_c')];
  const candidate: ReorgCandidate = { operation: 'promote', categoryIds: ['cat_c'], score: 0.3 };

  it('makes the child a root category', () => {
    const { payload } = applyReorg(payloadWith([parent, child], memories), candidate, []);
    expect(payload.categories.find((c) => c.id === 'cat_c')!.parent_id).toBeNull();
  });

  it('keeps its memories', () => {
    const { payload } = applyReorg(payloadWith([parent, child], memories), candidate, []);
    expect(payload.memories.filter((m) => m.category_id === 'cat_c')).toHaveLength(2);
  });

  it('moves it away from the parent along the line between them', () => {
    const { payload } = applyReorg(payloadWith([parent, child], memories), candidate, []);
    const moved = payload.categories.find((c) => c.id === 'cat_c')!;
    // Was 50 away at a 3-4-5 angle; should now be 320 away on the same bearing.
    expect(Math.hypot(moved.x! - parent.x!, moved.y! - parent.y!)).toBeCloseTo(320, 5);
    expect(moved.x! / moved.y!).toBeCloseTo(30 / 40, 5);
  });

  it('leaves a pinned category where the user put it', () => {
    const pinned = { ...child, pinned: true };
    const { payload } = applyReorg(payloadWith([parent, pinned], memories), candidate, []);
    const moved = payload.categories.find((c) => c.id === 'cat_c')!;
    expect(moved.x).toBe(30);
    expect(moved.y).toBe(40);
    expect(moved.parent_id).toBeNull();
  });

  it('writes the verbatim banner template and creates nothing', () => {
    const { event } = applyReorg(payloadWith([parent, child], memories), candidate, []);
    expect(event.banner_text).toBe('**Pricing** grew into its own category');
    expect(event.operation).toBe('promote');
    expect(event.created_category_ids).toEqual([]);
  });

  it('refuses to promote a category that is already a root', () => {
    expect(() =>
      applyReorg(
        payloadWith([parent], []),
        { operation: 'promote', categoryIds: ['cat_p'], score: 0.3 },
        [],
      ),
    ).toThrow(/already a root/);
  });

  it('restores exactly on undo', () => {
    const before = payloadWith([parent, child], memories);
    const { event } = applyReorg(before, candidate, []);
    expect(undoReorg(event)).toEqual(before);
  });
});

// ---------------------------------------------------------------- coverage

describe('applyReorg — every operation the gates can produce is applicable', () => {
  it('handles all three without throwing', () => {
    const parent = category('cat_p', 'Product');
    const a = category('cat_a', 'A', 'cat_p');
    const b = category('cat_b', 'B', 'cat_p');
    const mems = [
      memory('m1', 'cat_a'), memory('m2', 'cat_a'), memory('m3', 'cat_a'),
      memory('m4', 'cat_b'),
    ];
    const base = payloadWith([parent, a, b], mems);

    const cases: ReorgCandidate[] = [
      { operation: 'split', categoryIds: ['cat_a'], clusters: { a: ['m1', 'm2'], b: ['m3'] }, score: 1 },
      { operation: 'merge', categoryIds: ['cat_a', 'cat_b'], score: 1 },
      { operation: 'promote', categoryIds: ['cat_a'], score: 1 },
    ];
    for (const candidate of cases) {
      expect(() => applyReorg(base, candidate, ['One', 'Two'])).not.toThrow();
    }
  });
});
