import { describe, it, expect } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import { briefingOf, BRIEFING_DAYS } from '../../src/core/briefing';

/**
 * The first page of home, read out of the graph alone: what has been on the
 * table lately (questions, decisions, tasks), where the thinking has been
 * growing, and what is still waiting to be looked at. The window is anchored
 * to the newest memory, like the reflective sample — a corpus whose last
 * capture was a while ago still has a "lately".
 */
const payload = validateSeed(workspaceJson);

describe('briefingOf', () => {
  it('lists the open questions, decisions and tasks of the fortnight, newest first', () => {
    const b = briefingOf(payload);
    expect(b.concerns.map((m) => m.id)).toEqual(['mem_11', 'mem_22']);
    for (const m of b.concerns) expect(['question', 'decision', 'task']).toContain(m.kind);
  });

  it('leaves out what has been put down — settled is off the table, not gone', () => {
    const settled = {
      ...payload,
      memories: payload.memories.map((m) =>
        m.id === 'mem_11' ? { ...m, settled_at: '2026-07-20T00:00:00Z' } : m,
      ),
    };
    expect(briefingOf(settled).concerns.map((m) => m.id)).toEqual(['mem_22']);
    expect(settled.memories.some((m) => m.id === 'mem_11')).toBe(true);
  });

  it('names the categories that grew most in the window, biggest first, at least two memories each', () => {
    const b = briefingOf(payload);
    expect(b.learning.map((l) => l.categoryId)).toEqual(['cat_ai_tooling', 'cat_eng_hiring']);
    expect(b.learning.map((l) => l.added)).toEqual([4, 4]);
    expect(b.learning.every((l) => l.name.length > 0)).toBe(true);
  });

  it('counts what is still waiting: originals not yet checked', () => {
    const b = briefingOf(payload);
    expect(b.organizing.awaitingReview).toBe(22);
    const checked = {
      ...payload,
      sources: payload.sources.map((s) => ({ ...s, reviewed_at: '2026-07-20T00:00:00Z' })),
    };
    expect(briefingOf(checked).organizing.awaitingReview).toBe(0);
  });

  it('caps the concerns at five and keeps the window at a fortnight', () => {
    expect(BRIEFING_DAYS).toBe(14);
    const flood = {
      ...payload,
      memories: [
        ...payload.memories,
        ...Array.from({ length: 8 }, (_, i) => ({
          ...payload.memories[0]!,
          id: `mem_q${i}`,
          kind: 'question' as const,
          created_at: `2026-07-2${i}T00:00:00Z`.replace('2026-07-2', i < 5 ? '2026-07-1' : '2026-07-2'),
        })),
      ],
    };
    expect(briefingOf(flood).concerns.length).toBeLessThanOrEqual(5);
  });

  it('an empty corpus has an empty briefing', () => {
    const b = briefingOf({ ...payload, memories: [], sources: [] });
    expect(b.concerns).toEqual([]);
    expect(b.learning).toEqual([]);
    expect(b.organizing.awaitingReview).toBe(0);
    expect(b.period).toBeNull();
  });
});
