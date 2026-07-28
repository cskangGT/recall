import { describe, it, expect, beforeEach } from 'vitest';
import { reorgMotion } from '../../src/capture/reorgMotion';
import { applyReorg, resetReorgIds } from '../../src/core/applyReorg';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import type { GraphPayload } from '../../src/core/types';

/**
 * A merge and a promotion were applied correctly and then simply appeared on the
 * map, because the animation runs against the payload that already contains the
 * result. These cover the diff that recovers what moved.
 */

const load = async (): Promise<GraphPayload> => {
  await useWorkspaceStore.getState().load();
  return useWorkspaceStore.getState().payload!;
};

const cat = (p: GraphPayload, name: string) => p.categories.find((c) => c.name === name)!;

describe('reorgMotion', () => {
  beforeEach(async () => {
    resetReorgIds();
    await load();
  });

  it('has nothing to animate when nothing was restructured', async () => {
    const payload = useWorkspaceStore.getState().payload!;
    expect(reorgMotion(null, payload)).toEqual({ dissolving: [], travelling: [] });
  });

  it('collapses a merged category into the one that absorbed it', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const a = cat(before, 'Investor Notes');
    const b = cat(before, 'Pitch Feedback');

    const { payload: after, event } = applyReorg(
      before,
      { operation: 'merge', categoryIds: [a.id, b.id], score: 1 },
      ['Investor Relations'],
    );

    const motion = reorgMotion(event, after);
    expect(motion.dissolving).toHaveLength(1);

    // It starts where the absorbed category actually was, and ends on the
    // survivor — otherwise it reads as a node fading out at random.
    const gone = [a, b].find((c) => !after.categories.some((x) => x.id === c.id))!;
    const survivor = after.categories.find((c) => c.id === a.id || c.id === b.id)!;
    expect(motion.dissolving[0]!.x).toBe(gone.x);
    expect(motion.dissolving[0]!.intoX).toBe(survivor.x);
    expect(motion.dissolving[0]!.radius).toBeGreaterThan(0);
  });

  it('moves a promoted category from where it used to sit', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const child = cat(before, 'Investor Notes');

    const { payload: after, event } = applyReorg(
      before,
      { operation: 'promote', categoryIds: [child.id], score: 1 },
      [],
    );

    const motion = reorgMotion(event, after);
    const moved = motion.travelling.find((t) => t.id === child.id);
    expect(moved).toBeDefined();
    expect(moved!.fromX).toBe(child.x);
    // applyPromote pushes it 320px clear of the parent it is leaving.
    const now = after.categories.find((c) => c.id === child.id)!;
    expect(Math.hypot(now.x! - moved!.fromX, now.y! - moved!.fromY)).toBeGreaterThan(100);
    expect(motion.dissolving).toEqual([]);
  });

  it('ignores a category that barely settled', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const target = cat(before, 'Hiring');
    const after: GraphPayload = {
      ...before,
      categories: before.categories.map((c) =>
        c.id === target.id ? { ...c, x: (c.x ?? 0) + 5, y: c.y } : c,
      ),
    };
    const event = {
      id: 'reorg_x', operation: 'promote' as const, affected_category_ids: [target.id],
      created_category_ids: [], banner_text: '', before_state: before,
      created_at: '2026-07-27T00:00:00Z',
    };
    expect(reorgMotion(event, after).travelling).toEqual([]);
  });

  it('skips categories that were never laid out', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const target = cat(before, 'Product');
    const unplaced: GraphPayload = {
      ...before,
      categories: before.categories.map((c) => (c.id === target.id ? { ...c, x: null, y: null } : c)),
    };
    const event = {
      id: 'reorg_y', operation: 'merge' as const, affected_category_ids: [target.id],
      created_category_ids: [], banner_text: '', before_state: unplaced,
      created_at: '2026-07-27T00:00:00Z',
    };
    // Absent from `after` entirely, but with no prior position there is nothing
    // to animate from — it must not produce a ghost at the origin.
    const after: GraphPayload = {
      ...before,
      categories: before.categories.filter((c) => c.id !== target.id),
    };
    expect(reorgMotion(event, after).dissolving).toEqual([]);
  });
});
