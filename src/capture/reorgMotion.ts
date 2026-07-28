import { radiusFor } from '../graph/nodeStyles';
import type { ReorgEvent } from '../core/applyReorg';
import type { GraphPayload } from '../core/types';

/**
 * What moved, derived by diffing the change against its own snapshot.
 *
 * The map could only ever choreograph a split: children emerging from a parent
 * that is still there. A merge and a promotion were applied correctly and then
 * simply appeared, because by the time the animation runs the payload is already
 * the new one — the absorbed category is gone and the promoted one is somewhere
 * else. `before_state` is a complete snapshot kept for undo, so the previous
 * geometry is available; this reads it rather than threading extra state through
 * the pipeline.
 */

export interface ReorgMotion {
  dissolving: { x: number; y: number; radius: number; intoX: number; intoY: number }[];
  travelling: { id: string; fromX: number; fromY: number }[];
}

/** Positions can be null before layout has run; those cannot be animated. */
const placed = (c: { x: number | null; y: number | null }): c is { x: number; y: number } =>
  c.x !== null && c.y !== null;

export function reorgMotion(event: ReorgEvent | null, after: GraphPayload): ReorgMotion {
  const empty: ReorgMotion = { dissolving: [], travelling: [] };
  if (!event) return empty;

  const before = event.before_state;
  const nowById = new Map(after.categories.map((c) => [c.id, c]));

  // Whatever survived out of the categories this change touched is what the
  // vanished ones were absorbed into.
  const survivor = event.affected_category_ids
    .map((id) => nowById.get(id))
    .find((c) => c !== undefined);

  const dissolving: ReorgMotion['dissolving'] = [];
  for (const id of event.affected_category_ids) {
    if (nowById.has(id)) continue;
    const gone = before.categories.find((c) => c.id === id);
    if (!gone || !placed(gone) || !survivor || !placed(survivor)) continue;
    dissolving.push({
      x: gone.x,
      y: gone.y,
      radius: radiusFor(
        gone.parent_id === null ? 'parent_category' : 'child_category',
        before.memories.filter((m) => m.category_id === id).length,
      ),
      intoX: survivor.x,
      intoY: survivor.y,
    });
  }

  const travelling: ReorgMotion['travelling'] = [];
  for (const now of after.categories) {
    const was = before.categories.find((c) => c.id === now.id);
    if (!was || !placed(was) || !placed(now)) continue;
    // A few pixels of settling is not a journey worth animating.
    if (Math.hypot(now.x - was.x, now.y - was.y) < 40) continue;
    travelling.push({ id: now.id, fromX: was.x, fromY: was.y });
  }

  return { dissolving, travelling };
}
