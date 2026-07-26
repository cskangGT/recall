/**
 * Every restructuring constant lives here and nowhere else.
 *
 * These are what make the demo safe: geometry decides whether to restructure,
 * the model only names the result. Phase 4 re-measures them against real
 * 1536-dimensional embeddings, which is why they are overridable by env.
 *
 * Values are spec 8.3 and 8.4.2 verbatim.
 */

const num = (key: string, fallback: number): number => {
  const raw = (import.meta.env ?? {})[key] as string | undefined;
  return raw === undefined ? fallback : Number(raw);
};

export const SPLIT = {
  MIN_MEMORIES: num('VITE_SPLIT_MIN_MEMORIES', 8),
  MAX_MEAN_COHESION: num('VITE_SPLIT_MAX_COHESION', 0.62),
  MIN_CLUSTER_SIZE: num('VITE_SPLIT_MIN_CLUSTER', 3),
  MIN_SEPARATION: num('VITE_SPLIT_MIN_SEPARATION', 0.15),
} as const;

export const MERGE = {
  MIN_CENTROID_SIMILARITY: num('VITE_MERGE_MIN_SIM', 0.86),
  MAX_COMBINED_MEMORIES: num('VITE_MERGE_MAX_COMBINED', 12),
} as const;

export const PROMOTE = {
  MIN_MEMORIES: num('VITE_PROMOTE_MIN_MEMORIES', 12),
  MAX_PARENT_SIMILARITY: num('VITE_PROMOTE_MAX_PARENT_SIM', 0.5),
} as const;

export const ASSIGN = {
  EXISTING_CATEGORY: num('VITE_ASSIGN_EXISTING', 0.55),
  NEW_CHILD: num('VITE_ASSIGN_NEW_CHILD', 0.4),
} as const;

/** relates_to edges are materialized above this similarity (spec 8.1). */
export const RELATES_TO_MIN_SIMILARITY = num('VITE_RELATES_MIN_SIM', 0.82);
