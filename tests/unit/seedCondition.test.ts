import { describe, it, expect } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import { meanPairwiseCosine, twoMeans } from '../../src/reorg/vectorMath';
import { SPLIT } from '../../src/reorg/thresholds';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import type { Memory } from '../../src/types/graph';

const payload = validateSeed(workspaceJson);
const aiTooling = payload.categories.find((c) => c.name === 'AI Tooling')!;
const aiMemories = payload.memories.filter((m) => m.category_id === aiTooling.id);
const demoMemories = demoItem.memories as unknown as Memory[];

describe('seed workspace', () => {
  it('has the volumes specified in spec 12.2', () => {
    expect(payload.memories).toHaveLength(47);
    expect(payload.sources).toHaveLength(22);
    expect(payload.categories.filter((c) => c.parent_id === null)).toHaveLength(6);
    expect(payload.categories.filter((c) => c.parent_id !== null)).toHaveLength(14);
    expect(payload.entities).toHaveLength(31);
  });

  it('ships the source type distribution from spec 12.3', () => {
    const counts = { text: 0, link: 0, screenshot: 0 };
    for (const s of payload.sources) counts[s.type]++;
    expect(counts).toEqual({ text: 9, link: 8, screenshot: 5 });
  });

  it('gives every node a hand-tuned position', () => {
    for (const m of payload.memories) expect(m.x).not.toBeNull();
    for (const c of payload.categories) expect(c.x).not.toBeNull();
  });

  it('writes every memory in the voice spec 10.2 requires', () => {
    for (const m of payload.memories) {
      const words = m.text.split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(8);
      expect(words).toBeLessThanOrEqual(30);
      expect(m.text).not.toMatch(/^(I|We)\s/);
    }
  });

  it('holds AI Tooling just above the split cohesion threshold', () => {
    expect(aiMemories).toHaveLength(9);
    const cohesion = meanPairwiseCosine(aiMemories.map((m) => m.vector));
    // Must NOT fire before the demo capture.
    expect(cohesion).toBeGreaterThan(SPLIT.MAX_MEAN_COHESION);
    expect(cohesion).toBeCloseTo(0.633, 2);
  });

  it('drops below the threshold once the demo item lands', () => {
    const after = [...aiMemories, ...demoMemories];
    expect(after).toHaveLength(11);
    const cohesion = meanPairwiseCosine(after.map((m) => m.vector));
    expect(cohesion).toBeLessThan(SPLIT.MAX_MEAN_COHESION);
    expect(cohesion).toBeCloseTo(0.591, 2);
  });

  it('splits into a 7/4 structure with usable separation', () => {
    const after = [...aiMemories, ...demoMemories];
    const { a, b, separation } = twoMeans(after.map((m) => ({ id: m.id, vector: m.vector })));
    expect([a.length, b.length].sort((x, y) => x - y)).toEqual([4, 7]);
    expect(separation).toBeGreaterThan(SPLIT.MIN_SEPARATION);
  });

  it('leaves no other category able to reach the split gate', () => {
    for (const c of payload.categories) {
      if (c.id === aiTooling.id) continue;
      const members = payload.memories.filter((m) => m.category_id === c.id);
      expect(members.length).toBeLessThan(SPLIT.MIN_MEMORIES);
    }
  });
});
