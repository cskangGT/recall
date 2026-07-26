import { describe, it, expect } from 'vitest';
import { evaluateReorg } from '../../src/reorg/gates';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import type { GraphPayload, Memory, Source } from '../../src/types/graph';

const base = validateSeed(workspaceJson);
const aiTooling = base.categories.find((c) => c.name === 'AI Tooling')!;

const withDemoItem = (): GraphPayload => ({
  ...base,
  sources: [...base.sources, demoItem.source as Source],
  memories: [...base.memories, ...(demoItem.memories as unknown as Memory[])],
});

describe('evaluateReorg', () => {
  it('does not fire on the untouched seed workspace', () => {
    expect(evaluateReorg(base, [aiTooling.id])).toBeNull();
  });

  it('fires exactly one SPLIT on AI Tooling after the demo item (AC-18, AC-27)', () => {
    const candidate = evaluateReorg(withDemoItem(), [aiTooling.id]);
    expect(candidate).not.toBeNull();
    expect(candidate!.operation).toBe('split');
    expect(candidate!.categoryIds).toEqual([aiTooling.id]);
    const sizes = [candidate!.clusters!.a.length, candidate!.clusters!.b.length];
    expect(sizes.sort((a, b) => a - b)).toEqual([4, 7]);
  });

  it('returns a single candidate, never a list', () => {
    const candidate = evaluateReorg(
      withDemoItem(),
      base.categories.map((c) => c.id),
    );
    expect(Array.isArray(candidate)).toBe(false);
    expect(candidate!.operation).toBe('split');
  });

  it('skips a name-locked category (AC-23)', () => {
    const payload = withDemoItem();
    const locked: GraphPayload = {
      ...payload,
      categories: payload.categories.map((c) =>
        c.id === aiTooling.id ? { ...c, name_locked: true } : c,
      ),
    };
    expect(evaluateReorg(locked, [aiTooling.id])).toBeNull();
  });

  it('skips a user-created category (AC-23)', () => {
    const payload = withDemoItem();
    const locked: GraphPayload = {
      ...payload,
      categories: payload.categories.map((c) =>
        c.id === aiTooling.id ? { ...c, user_created: true } : c,
      ),
    };
    expect(evaluateReorg(locked, [aiTooling.id])).toBeNull();
  });

  it('evaluates only the affected neighbourhood', () => {
    const unrelated = base.categories.find((c) => c.name === 'Hiring')!;
    expect(evaluateReorg(withDemoItem(), [unrelated.id])).toBeNull();
  });

  it('never fires MERGE on the seed taxonomy', () => {
    const candidate = evaluateReorg(base, base.categories.map((c) => c.id));
    expect(candidate).toBeNull();
  });
});
