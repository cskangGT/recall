import type { Category, Memory } from './types';
import { cosine, centroid } from './vectorMath';
import { ASSIGN } from './thresholds';

/**
 * Category assignment — spec 8.3.
 *
 * Phase 1 never needed this: the demo item arrived with `category_id` already
 * set, because there was no model to decide. The backend has to decide.
 *
 * ## Why this scores by nearest member rather than by centroid
 *
 * The spec compares a new memory against each category's centroid. That fails
 * exactly where it matters most. A centroid stops representing its category the
 * moment the category has become two things — and detecting that moment is the
 * entire purpose of the SPLIT gate in 8.4. Measured on the seed corpus:
 *
 *   AI Tooling holds 7 memories about agent frameworks and 2 about evals.
 *   Its centroid sits near the frameworks cluster (0.88) and away from the
 *   evals one (0.77). A new evals memory scores 0.41 against that centroid —
 *   inside 8.3's "make a new category" band — while scoring 0.72 against an
 *   evals memory already filed there.
 *
 * Centroid-scored assignment therefore siphons off precisely the memories that
 * would have made a category incoherent enough to split. The two rules fight,
 * and assignment wins, so SPLIT can essentially never fire in production. On
 * the demo corpus it breaks the demo outright.
 *
 * Nearest-member scoring is robust to bimodal categories by construction, and
 * asks the question the product actually asks: *is this like something I have
 * already saved?* — not *is this like the average of everything I have saved?*
 *
 * Centroids are still the right tool for comparing two whole categories, which
 * is what MERGE and PROMOTE do; those keep using them.
 */

export type AssignmentKind =
  /** >= 0.55 to some existing memory: file it alongside that memory. */
  | 'existing'
  /** 0.40-0.55: related to a family but not to any member — new child under the best parent. */
  | 'new_child'
  /** < 0.40: unlike anything saved — a new parent category. */
  | 'new_parent';

export interface Assignment {
  kind: AssignmentKind;
  /** Set when kind === 'existing'. */
  categoryId?: string;
  /** Set when kind === 'new_child' — the parent the new child goes under. */
  parentId?: string;
  /** Best similarity seen, for logging and as context for the naming prompt. */
  score: number;
}

export interface CategoryProfile {
  id: string;
  parentId: string | null;
  /** Member embeddings. Empty for a category holding no memories. */
  vectors: number[][];
}

/** Mean of the member embeddings; null for an empty category (spec 8.2). */
export function centroidOf(memories: Memory[]): number[] | null {
  if (memories.length === 0) return null;
  return centroid(memories.map((m) => m.vector));
}

export function categoryProfiles(
  categories: Category[],
  memories: Memory[],
): CategoryProfile[] {
  return categories.map((c) => ({
    id: c.id,
    parentId: c.parent_id,
    vectors: memories.filter((m) => m.category_id === c.id).map((m) => m.vector),
  }));
}

/** Highest similarity to any single member. Null for an empty category. */
export function bestMemberSimilarity(vector: number[], profile: CategoryProfile): number | null {
  if (profile.vectors.length === 0) return null;
  let best = -Infinity;
  for (const v of profile.vectors) {
    const s = cosine(vector, v);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Picks where a memory belongs.
 *
 * Ties break by category id so the same corpus always produces the same
 * assignment — the same reason `twoMeans` is seeded deterministically. An
 * ingest that assigned differently on a retry would make the map unreproducible.
 */
export function assignMemory(
  vector: number[],
  profiles: CategoryProfile[],
): Assignment {
  const scored = profiles
    .map((p) => ({ p, score: bestMemberSimilarity(vector, p) }))
    .filter((x): x is { p: CategoryProfile; score: number } => x.score !== null)
    .sort((a, b) => (b.score - a.score) || a.p.id.localeCompare(b.p.id));

  const best = scored[0];
  if (!best) return { kind: 'new_parent', score: 0 };

  if (best.score >= ASSIGN.EXISTING_CATEGORY) {
    return { kind: 'existing', categoryId: best.p.id, score: best.score };
  }

  if (best.score >= ASSIGN.NEW_CHILD) {
    // Attach under the best-matching *parent*: a new sibling belongs beside the
    // category it resembles, not beneath it.
    return { kind: 'new_child', parentId: best.p.parentId ?? best.p.id, score: best.score };
  }

  return { kind: 'new_parent', score: best.score };
}
