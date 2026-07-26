import type { GraphPayload, Category, ReorgOperation } from './types';
import type { ReorgCandidate } from './gates';

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

  if (candidate.operation !== 'split') {
    throw new Error(`Phase 1 applies split only; got ${candidate.operation}`);
  }

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
