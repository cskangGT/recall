import { describe, it, expect } from 'vitest';
import { describeDeletion, planCategoryDeletion, type DeletionPlan } from '../../src/core/deleteCategory';
import type { Category, GraphPayload, Memory } from '../../src/core/types';

/**
 * Deleting a category never deletes a memory (AC-30) and every memory has
 * exactly one category (§8.5). The spec answers where a *child's* memories go
 * and is silent about a root's — which is the case that actually happens, since
 * a young corpus is nothing but roots.
 */

const cat = (id: string, name: string, parent: string | null = null, userCreated = false): Category => ({
  id, parent_id: parent, name, rationale: null,
  name_locked: false, user_created: userCreated,
  x: null, y: null, pinned: false, created_by: userCreated ? 'user' : 'ai',
});

/** A 3-dimensional vector is enough to make "nearest" mean something readable. */
const mem = (id: string, categoryId: string, vector: number[]): Memory => ({
  id, source_id: 'src_1', category_id: categoryId, text: id, kind: 'fact',
  confidence: 0.9, vector, entity_ids: [], created_at: '2026-01-01T00:00:00Z',
  x: null, y: null, pinned: false, category_locked: false,
});

const graph = (categories: Category[], memories: Memory[]): GraphPayload => ({
  categories, memories, entities: [], edges: [], sources: [],
  workspace: { id: 'ws', name: 'Recall', auto_reorganize: true },
} as unknown as GraphPayload);

const plan = (outcome: ReturnType<typeof planCategoryDeletion>): DeletionPlan => {
  if ('refused' in outcome) throw new Error(`refused: ${outcome.refused}`);
  return outcome;
};

describe('a child category', () => {
  const payload = graph(
    [cat('cat_parent', 'AI Tooling'), cat('cat_child', 'Evals', 'cat_parent')],
    [mem('m1', 'cat_child', [1, 0, 0]), mem('m2', 'cat_child', [0, 1, 0])],
  );

  it('sends its memories to the parent, as the spec says, without asking geometry', () => {
    // The destination is already decided and visible in the breadcrumb. A second
    // opinion from cosine would only make the result harder to predict.
    const p = plan(planCategoryDeletion(payload, 'cat_child'));
    expect(p.moves.map((m) => m.toCategoryId)).toEqual(['cat_parent', 'cat_parent']);
    expect(p.promoted).toEqual([]);
  });

  it('deletes zero memories', () => {
    const p = plan(planCategoryDeletion(payload, 'cat_child'));
    expect(p.moves).toHaveLength(2);
  });
});

describe('a root category', () => {
  // Two distinct directions, and a loose memory that clearly belongs with one.
  const payload = graph(
    [cat('cat_a', 'Pricing'), cat('cat_b', 'Onboarding'), cat('cat_doomed', 'Mixed')],
    [
      mem('a1', 'cat_a', [1, 0, 0]),
      mem('b1', 'cat_b', [0, 1, 0]),
      mem('d1', 'cat_doomed', [0.98, 0.2, 0]),
      mem('d2', 'cat_doomed', [0.1, 0.99, 0]),
    ],
  );

  it('refiles each memory into whichever remaining category it is nearest', () => {
    const p = plan(planCategoryDeletion(payload, 'cat_doomed'));
    const to = Object.fromEntries(p.moves.map((m) => [m.memoryId, m.toCategoryId]));
    expect(to).toEqual({ d1: 'cat_a', d2: 'cat_b' });
  });

  it('never creates a category on the way out', () => {
    // `assignMemory` would make one below its threshold. A delete that
    // immediately recreates something like what you just deleted is absurd, so
    // this takes the argmax and ignores the threshold entirely.
    const far = graph(
      [cat('cat_a', 'Pricing'), cat('cat_doomed', 'Mixed')],
      [mem('a1', 'cat_a', [1, 0, 0]), mem('d1', 'cat_doomed', [0, 0, 1])],
    );
    const p = plan(planCategoryDeletion(far, 'cat_doomed'));
    expect(p.moves).toEqual([{ memoryId: 'd1', toCategoryId: 'cat_a', score: expect.any(Number) }]);
    expect(p.moves[0]!.score).toBeLessThan(0.3); // genuinely unrelated, and it still lands
  });

  it('promotes its children to categories of their own', () => {
    // Two levels, always (§8.5). Orphaning them under a parent that no longer
    // exists would be a third state the tree cannot render.
    const nested = graph(
      [cat('cat_root', 'AI Tooling'), cat('cat_k1', 'Agents', 'cat_root'), cat('cat_k2', 'Evals', 'cat_root')],
      [mem('k1', 'cat_k1', [1, 0, 0]), mem('k2', 'cat_k2', [0, 1, 0])],
    );
    const p = plan(planCategoryDeletion(nested, 'cat_root'));
    expect(p.promoted.sort()).toEqual(['cat_k1', 'cat_k2']);
    // Their memories are theirs and do not move.
    expect(p.moves).toEqual([]);
  });

  it('lets a deleted root’s own children take its loose memories', () => {
    // The nicest case: delete "AI Tooling" and the memories that sat directly on
    // it fall into the halves it was split into, which is where they belong.
    const nested = graph(
      [cat('cat_root', 'AI Tooling'), cat('cat_k1', 'Agents', 'cat_root'), cat('cat_k2', 'Evals', 'cat_root')],
      [
        mem('k1', 'cat_k1', [1, 0, 0]),
        mem('k2', 'cat_k2', [0, 1, 0]),
        mem('loose', 'cat_root', [0.05, 0.99, 0]),
      ],
    );
    const p = plan(planCategoryDeletion(nested, 'cat_root'));
    expect(p.moves).toEqual([{ memoryId: 'loose', toCategoryId: 'cat_k2', score: expect.any(Number) }]);
  });

  it('refuses when it is the only category left, rather than dropping memories', () => {
    const alone = graph([cat('cat_only', 'Everything')], [mem('m1', 'cat_only', [1, 0, 0])]);
    const outcome = planCategoryDeletion(alone, 'cat_only');
    expect('refused' in outcome && outcome.refused).toMatch(/nowhere to go/);
  });

  it('allows deleting the only category when it is empty', () => {
    const alone = graph([cat('cat_only', 'Everything')], []);
    expect(plan(planCategoryDeletion(alone, 'cat_only')).moves).toEqual([]);
  });

  it('still lands a memory when every remaining category is empty', () => {
    // No member to be similar to, so nothing scores — and it must still go
    // somewhere, because every memory has exactly one category.
    const empties = graph(
      [cat('cat_empty', 'Empty'), cat('cat_doomed', 'Mixed')],
      [mem('d1', 'cat_doomed', [1, 0, 0])],
    );
    const p = plan(planCategoryDeletion(empties, 'cat_doomed'));
    expect(p.moves).toEqual([{ memoryId: 'd1', toCategoryId: 'cat_empty', score: 0 }]);
  });

  it('is deterministic, so the confirmation cannot show one plan and apply another', () => {
    const a = plan(planCategoryDeletion(payload, 'cat_doomed'));
    const b = plan(planCategoryDeletion(payload, 'cat_doomed'));
    expect(a).toEqual(b);
  });
});

describe('tombstones', () => {
  it('marks an AI-created name so the next pass will not resurrect it', () => {
    const payload = graph([cat('cat_a', 'Pricing'), cat('cat_x', 'Odds and Ends')], []);
    expect(plan(planCategoryDeletion(payload, 'cat_x')).tombstone).toBe('Odds and Ends');
  });

  it('leaves a name you chose yourself alone', () => {
    // Deleting your own category says nothing about the clustering; it is not a
    // correction the reorganizer needs to remember.
    const payload = graph([cat('cat_a', 'Pricing'), cat('cat_mine', 'Mine', null, true)], []);
    expect(plan(planCategoryDeletion(payload, 'cat_mine')).tombstone).toBeNull();
  });
});

describe('missing category', () => {
  it('refuses rather than throwing, because two tabs can race', () => {
    const outcome = planCategoryDeletion(graph([], []), 'cat_gone');
    expect('refused' in outcome && outcome.refused).toMatch(/already gone/);
  });
});

describe('what the confirmation says', () => {
  const payload = graph(
    [cat('cat_a', 'Pricing'), cat('cat_b', 'Onboarding'), cat('cat_doomed', 'Mixed')],
    [
      mem('a1', 'cat_a', [1, 0, 0]),
      mem('b1', 'cat_b', [0, 1, 0]),
      mem('d1', 'cat_doomed', [0.98, 0.2, 0]),
      mem('d2', 'cat_doomed', [0.1, 0.99, 0]),
    ],
  );

  it('names where the memories are going, before you agree to it', () => {
    const text = describeDeletion(plan(planCategoryDeletion(payload, 'cat_doomed')));
    expect(text).toContain('2 memories go');
    expect(text).toContain('Pricing');
    expect(text).toContain('Onboarding');
  });

  it('drops the counts when everything lands in one place', () => {
    const one = graph(
      [cat('cat_a', 'Pricing'), cat('cat_doomed', 'Mixed')],
      [mem('a1', 'cat_a', [1, 0, 0]), mem('d1', 'cat_doomed', [0.9, 0.1, 0])],
    );
    expect(describeDeletion(plan(planCategoryDeletion(one, 'cat_doomed'))))
      .toBe('Its memory goes to Pricing.');
  });

  it('says plainly when there is nothing to move', () => {
    const empty = graph([cat('cat_a', 'Pricing'), cat('cat_e', 'Empty')], [mem('a1', 'cat_a', [1, 0, 0])]);
    expect(describeDeletion(plan(planCategoryDeletion(empty, 'cat_e'))))
      .toContain('nothing moves');
  });

  it('mentions subcategories that are about to stand on their own', () => {
    const nested = graph(
      [cat('cat_root', 'AI Tooling'), cat('cat_k1', 'Agents', 'cat_root')],
      [mem('k1', 'cat_k1', [1, 0, 0])],
    );
    expect(describeDeletion(plan(planCategoryDeletion(nested, 'cat_root'))))
      .toContain('subcategory becomes a category of its own');
  });
});
