import { describe, it, expect } from 'vitest';
import { applyReorg, undoReorg } from '../../src/core/applyReorg';
import { evaluateReorg } from '../../src/core/gates';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import type { GraphPayload, Memory, Source } from '../../src/core/types';

const base = validateSeed(workspaceJson);
const aiTooling = base.categories.find((c) => c.name === 'AI Tooling')!;
const withDemo: GraphPayload = {
  ...base,
  sources: [...base.sources, demoItem.source as Source],
  memories: [...base.memories, ...(demoItem.memories as unknown as Memory[])],
};
const candidate = evaluateReorg(withDemo, [aiTooling.id])!;
const names = ['Agent Frameworks', 'Evals & Observability'];

describe('applyReorg — parent split', () => {
  const { payload, event } = applyReorg(withDemo, candidate, names);

  it('keeps the parent category with its id, name and position', () => {
    const parent = payload.categories.find((c) => c.id === aiTooling.id)!;
    expect(parent).toBeDefined();
    expect(parent.name).toBe('AI Tooling');
    expect(parent.parent_id).toBeNull();
    expect(parent.x).toBe(aiTooling.x);
  });

  it('creates exactly two children under it', () => {
    const children = payload.categories.filter((c) => c.parent_id === aiTooling.id);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.name).sort()).toEqual([...names].sort());
  });

  it('leaves the parent with zero directly-attached memories (AC-27)', () => {
    expect(payload.memories.filter((m) => m.category_id === aiTooling.id)).toHaveLength(0);
  });

  it('distributes 11 memories into the two children as 7 and 4', () => {
    const children = payload.categories.filter((c) => c.parent_id === aiTooling.id);
    const counts = children
      .map((c) => payload.memories.filter((m) => m.category_id === c.id).length)
      .sort((a, b) => a - b);
    expect(counts).toEqual([4, 7]);
  });

  it('never nests three levels deep', () => {
    for (const c of payload.categories) {
      if (!c.parent_id) continue;
      const parent = payload.categories.find((p) => p.id === c.parent_id)!;
      expect(parent.parent_id).toBeNull();
    }
  });

  it('writes the verbatim banner template (AC-21)', () => {
    expect(event.banner_text).toBe(
      'Split **AI Tooling** into **Agent Frameworks** and **Evals & Observability**',
    );
  });

  it('records the affected and created categories', () => {
    expect(event.affected_category_ids).toEqual([aiTooling.id]);
    expect(event.created_category_ids).toHaveLength(2);
    expect(event.operation).toBe('split');
  });

  it('restores the exact prior structure on undo (AC-22)', () => {
    expect(undoReorg(event)).toEqual(withDemo);
  });

  it('never reassigns a locked memory (AC-24)', () => {
    const lockedId = candidate.clusters!.a[0]!;
    const locked: GraphPayload = {
      ...withDemo,
      memories: withDemo.memories.map((m) =>
        m.id === lockedId ? { ...m, category_locked: true } : m,
      ),
    };
    const out = applyReorg(locked, candidate, names).payload;
    expect(out.memories.find((m) => m.id === lockedId)!.category_id).toBe(aiTooling.id);
  });

  it('applies every operation the gates can produce, not just split', () => {
    // This used to throw "Phase 1 applies split only". That was worse than it
    // looked: evaluateReorg returns the single highest-scoring candidate, so a
    // merge outscoring a split meant the split was discarded and nothing at all
    // happened. See tests/unit/mergePromote.test.ts for the merge and promote
    // behaviour itself.
    const merge = { ...candidate, operation: 'merge' as const, categoryIds: [aiTooling.id] };
    expect(() => applyReorg(withDemo, merge, names)).toThrow(/two known categories/);
    expect(() => applyReorg(withDemo, merge, names)).not.toThrow(/split only/);
  });
});
