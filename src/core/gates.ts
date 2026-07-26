import type { GraphPayload, Category, Memory } from './types.ts';
import { cosine, centroid, meanPairwiseCosine, twoMeans } from './vectorMath.ts';
import { SPLIT, MERGE, PROMOTE } from './thresholds.ts';

export interface ReorgCandidate {
  operation: 'split' | 'merge' | 'promote';
  categoryIds: string[];
  /** Present for split only: the two memory-id groups the category divides into. */
  clusters?: { a: string[]; b: string[] };
  /** Normalized margin over threshold. The single highest scorer executes. */
  score: number;
}

/** A user edit is a fact. Locked categories are removed before any scoring. */
const isLocked = (c: Category): boolean => c.name_locked || c.user_created;

export function evaluateReorg(
  payload: GraphPayload,
  touchedCategoryIds: string[],
): ReorgCandidate | null {
  const byId = new Map(payload.categories.map((c) => [c.id, c]));
  const membersOf = (id: string): Memory[] =>
    payload.memories.filter((m) => m.category_id === id);

  // Affected neighbourhood only: touched categories, their parents, their siblings.
  const scope = new Set<string>();
  for (const id of touchedCategoryIds) {
    const cat = byId.get(id);
    if (!cat) continue;
    scope.add(id);
    if (cat.parent_id) {
      scope.add(cat.parent_id);
      for (const sib of payload.categories.filter((c) => c.parent_id === cat.parent_id)) {
        scope.add(sib.id);
      }
    }
  }

  const candidates: ReorgCandidate[] = [];

  for (const id of scope) {
    const cat = byId.get(id);
    if (!cat || isLocked(cat)) continue;
    const members = membersOf(id);

    // SPLIT — the category has grown incoherent.
    if (members.length >= SPLIT.MIN_MEMORIES) {
      const cohesion = meanPairwiseCosine(members.map((m) => m.vector));
      if (cohesion < SPLIT.MAX_MEAN_COHESION) {
        const { a, b, separation } = twoMeans(
          members.map((m) => ({ id: m.id, vector: m.vector })),
        );
        if (
          a.length >= SPLIT.MIN_CLUSTER_SIZE &&
          b.length >= SPLIT.MIN_CLUSTER_SIZE &&
          separation > SPLIT.MIN_SEPARATION
        ) {
          candidates.push({
            operation: 'split',
            categoryIds: [id],
            clusters: { a: a.map((x) => x.id), b: b.map((x) => x.id) },
            score: (SPLIT.MAX_MEAN_COHESION - cohesion) / SPLIT.MAX_MEAN_COHESION,
          });
        }
      }
    }

    // PROMOTE — a child has outgrown its parent.
    if (cat.parent_id && members.length >= PROMOTE.MIN_MEMORIES) {
      const parentMembers = membersOf(cat.parent_id);
      if (parentMembers.length > 0) {
        const sim = cosine(
          centroid(members.map((m) => m.vector)),
          centroid(parentMembers.map((m) => m.vector)),
        );
        if (sim < PROMOTE.MAX_PARENT_SIMILARITY) {
          candidates.push({
            operation: 'promote',
            categoryIds: [id],
            score: (PROMOTE.MAX_PARENT_SIMILARITY - sim) / PROMOTE.MAX_PARENT_SIMILARITY,
          });
        }
      }
    }
  }

  // MERGE — two siblings within scope say the same thing.
  const scoped = [...scope]
    .map((id) => byId.get(id))
    .filter((c): c is Category => c !== undefined && !isLocked(c));

  for (let i = 0; i < scoped.length; i++) {
    for (let j = i + 1; j < scoped.length; j++) {
      const a = scoped[i]!;
      const b = scoped[j]!;
      if (a.parent_id !== b.parent_id) continue;
      const ma = membersOf(a.id);
      const mb = membersOf(b.id);
      if (ma.length === 0 || mb.length === 0) continue;
      if (ma.length + mb.length > MERGE.MAX_COMBINED_MEMORIES) continue;
      const sim = cosine(
        centroid(ma.map((m) => m.vector)),
        centroid(mb.map((m) => m.vector)),
      );
      if (sim > MERGE.MIN_CENTROID_SIMILARITY) {
        candidates.push({
          operation: 'merge',
          categoryIds: [a.id, b.id],
          score: (sim - MERGE.MIN_CENTROID_SIMILARITY) / (1 - MERGE.MIN_CENTROID_SIMILARITY),
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // At most one structural operation per ingest (spec 8.4.3). An audience can
  // only absorb one structural idea per beat; the rest re-evaluate next capture.
  candidates.sort((x, y) => y.score - x.score);
  return candidates[0]!;
}
