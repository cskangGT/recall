import type { GraphPayload, Category, ReorgOperation } from './types.ts';
import type { ReorgCandidate } from './gates.ts';

export interface ReorgEvent {
  id: string;
  operation: ReorgOperation;
  affected_category_ids: string[];
  created_category_ids: string[];
  banner_text: string;
  /** Complete snapshot, so undo is a pure restore and can never drift. */
  before_state: GraphPayload;
  created_at: string;
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_${(++counter).toString(36)}`;

/** Test hook — keeps generated ids stable across test files. */
export function resetReorgIds(): void {
  counter = 0;
}

export function applyReorg(
  payload: GraphPayload,
  candidate: ReorgCandidate,
  names: string[],
): { payload: GraphPayload; event: ReorgEvent } {
  const before: GraphPayload = structuredClone(payload);

  switch (candidate.operation) {
    case 'split':
      return applySplit(payload, before, candidate, names);
    case 'merge':
      return applyMerge(payload, before, candidate, names);
    case 'promote':
      return applyPromote(payload, before, candidate);
  }
}

/**
 * Two siblings said the same thing. Their memories consolidate into one
 * category and the other is removed.
 *
 * The larger category survives — it keeps its id, so its position, its history,
 * and any pins on it survive too. Only its name changes, and the caller is
 * expected to have preferred the larger category's existing name if it still
 * fits (spec 8.4.2), in which case nothing visibly moves except the smaller
 * category disappearing.
 */
function applyMerge(
  payload: GraphPayload,
  before: GraphPayload,
  candidate: ReorgCandidate,
  names: string[],
): { payload: GraphPayload; event: ReorgEvent } {
  const [firstId, secondId] = candidate.categoryIds;
  const first = payload.categories.find((c) => c.id === firstId);
  const second = payload.categories.find((c) => c.id === secondId);
  if (!first || !second) throw new Error('merge needs two known categories');

  const count = (id: string) => payload.memories.filter((m) => m.category_id === id).length;
  const [survivor, absorbed] =
    count(first.id) >= count(second.id) ? [first, second] : [second, first];

  const resultName = names[0] ?? survivor.name;

  const memories = payload.memories.map((m) => {
    if (m.category_id !== absorbed.id) return m;
    if (m.category_locked) return m; // a user assignment is a fact
    return { ...m, category_id: survivor.id, x: m.pinned ? m.x : null, y: m.pinned ? m.y : null };
  });

  // A locked memory left behind would dangle off a deleted category. Keep the
  // absorbed category alive in that case rather than orphaning the row.
  const strandedLocked = memories.some((m) => m.category_id === absorbed.id);

  const categories = payload.categories
    .filter((c) => strandedLocked || c.id !== absorbed.id)
    .map((c) => (c.id === survivor.id ? { ...c, name: resultName } : c));

  return {
    payload: { ...payload, categories, memories },
    event: {
      id: nextId('reorg'),
      operation: 'merge',
      affected_category_ids: [first.id, second.id],
      created_category_ids: [],
      banner_text: `Merged **${first.name}** and **${second.name}** into **${resultName}**`,
      before_state: before,
      created_at: new Date().toISOString(),
    },
  };
}

/**
 * A child outgrew its parent and becomes a root category.
 *
 * No naming call: the category keeps the name it already has, which is what the
 * spec's banner template says out loud ("X grew into its own category"). It
 * moves outward on the map so it reads as having left the cluster.
 */
function applyPromote(
  payload: GraphPayload,
  before: GraphPayload,
  candidate: ReorgCandidate,
): { payload: GraphPayload; event: ReorgEvent } {
  const targetId = candidate.categoryIds[0]!;
  const target = payload.categories.find((c) => c.id === targetId);
  if (!target) throw new Error(`unknown category ${targetId}`);
  if (target.parent_id === null) throw new Error(`${target.name} is already a root category`);

  const parent = payload.categories.find((c) => c.id === target.parent_id);

  // Push it away from the parent it is leaving, along the line between them, so
  // the promotion reads as separation rather than as a node twitching.
  const dx = (target.x ?? 0) - (parent?.x ?? 0);
  const dy = (target.y ?? 0) - (parent?.y ?? 0);
  const length = Math.hypot(dx, dy) || 1;
  const PROMOTE_DISTANCE = 320;

  const categories = payload.categories.map((c) =>
    c.id === targetId
      ? {
          ...c,
          parent_id: null,
          x: c.pinned ? c.x : (parent?.x ?? 0) + (dx / length) * PROMOTE_DISTANCE,
          y: c.pinned ? c.y : (parent?.y ?? 0) + (dy / length) * PROMOTE_DISTANCE,
        }
      : c,
  );

  return {
    payload: { ...payload, categories },
    event: {
      id: nextId('reorg'),
      operation: 'promote',
      affected_category_ids: [targetId],
      created_category_ids: [],
      banner_text: `**${target.name}** grew into its own category`,
      before_state: before,
      created_at: new Date().toISOString(),
    },
  };
}

function applySplit(
  payload: GraphPayload,
  before: GraphPayload,
  candidate: ReorgCandidate,
  names: string[],
): { payload: GraphPayload; event: ReorgEvent } {
  const targetId = candidate.categoryIds[0]!;
  const target = payload.categories.find((c) => c.id === targetId);
  if (!target) throw new Error(`unknown category ${targetId}`);

  const nameA = names[0]!;
  const nameB = names[1]!;

  // Splitting a PARENT keeps it and grows two children beneath it.
  // Splitting a CHILD replaces it with two siblings. (spec 8.4.2)
  const splittingChild = target.parent_id !== null;

  // The two children need real separation on screen. This is the one moment the
  // whole demo is built around; children tucked under the parent read as a blob
  // rather than as a legible change.
  const mkChild = (name: string, offset: number): Category => ({
    id: nextId('cat'),
    parent_id: splittingChild ? target.parent_id : target.id,
    name,
    rationale: null,
    name_locked: false,
    user_created: false,
    x: (target.x ?? 0) + offset,
    y: (target.y ?? 0) + 125,
    pinned: false,
    created_by: 'ai',
  });

  const childA = mkChild(nameA, -165);
  const childB = mkChild(nameB, 165);
  const inA = new Set(candidate.clusters?.a ?? []);

  const memories = payload.memories.map((m) => {
    if (m.category_id !== targetId) return m;
    // A user assignment is a fact — never reassigned by a reorganization pass.
    if (m.category_locked) return m;
    // A memory that changed category loses its hand-placed position and is
    // re-placed beside its new parent, so the regrouping is actually visible.
    return {
      ...m,
      category_id: inA.has(m.id) ? childA.id : childB.id,
      x: m.pinned ? m.x : null,
      y: m.pinned ? m.y : null,
    };
  });

  const categories = splittingChild
    ? [...payload.categories.filter((c) => c.id !== targetId), childA, childB]
    : [...payload.categories, childA, childB];

  const event: ReorgEvent = {
    id: nextId('reorg'),
    operation: 'split',
    affected_category_ids: [targetId],
    created_category_ids: [childA.id, childB.id],
    banner_text: `Split **${target.name}** into **${nameA}** and **${nameB}**`,
    before_state: before,
    created_at: new Date().toISOString(),
  };

  return { payload: { ...payload, categories, memories }, event };
}

/** Pure restore from the snapshot — no recomputation, so undo cannot drift. */
export function undoReorg(event: ReorgEvent): GraphPayload {
  return structuredClone(event.before_state);
}
