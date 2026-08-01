/**
 * Every restructuring constant lives here and nowhere else.
 *
 * These are what make the demo safe: geometry decides whether to restructure,
 * the model only names the result.
 *
 * **Measured against openai/text-embedding-3-small at 1024 dimensions**, which
 * is what the seed now carries. The previous values were spec 8.3 and 8.4.2
 * verbatim, chosen for 8-dimensional authored vectors where a theme anchor put
 * same-topic memories near 0.9 and pushed everything else out of the plane. A
 * real model has no such geometry: the entire corpus lands in a band around
 * 0.23, with p90 at 0.34 and the single closest pair of 1,176 at 0.56. Carried
 * across unchanged, every gate here would have gone silent at once — no edge,
 * no merge, no promotion, nothing assigned to an existing category.
 *
 * Each number below is read off the thing it has to separate, not off a
 * percentile picked to look principled. Reproduce with:
 *
 *     npm run thresholds -- --provider openai --dimensions 1024 --propose
 */

const num = (key: string, fallback: number): number => {
  const raw = (import.meta.env ?? {})[key] as string | undefined;
  return raw === undefined ? fallback : Number(raw);
};

export const SPLIT = {
  MIN_MEMORIES: num('VITE_SPLIT_MIN_MEMORIES', 8),
  /* Must sit between the demo category's cohesion before the capture (0.2739)
     and after it (0.2605). Margin 0.0133 — the whole demo turns on it. */
  MAX_MEAN_COHESION: num('VITE_SPLIT_MAX_COHESION', 0.267),
  MIN_CLUSTER_SIZE: num('VITE_SPLIT_MIN_CLUSTER', 3),
  MIN_SEPARATION: num('VITE_SPLIT_MIN_SEPARATION', 0.15),
} as const;

export const MERGE = {
  /* Above the closest pair of siblings that must NOT merge — Investor Notes
     against Seed Benchmarks, at 0.6189 — with 0.05 of room. */
  MIN_CENTROID_SIMILARITY: num('VITE_MERGE_MIN_SIM', 0.67),
  MAX_COMBINED_MEMORIES: num('VITE_MERGE_MAX_COMBINED', 12),
} as const;

export const PROMOTE = {
  MIN_MEMORIES: num('VITE_PROMOTE_MIN_MEMORIES', 12),
  /* Below every child that must stay where it is. The least parent-like is
     Design Systems at 0.6919; this sits under it by the same margin. */
  MAX_PARENT_SIMILARITY: num('VITE_PROMOTE_MAX_PARENT_SIM', 0.64),
} as const;

/*
 * Compared against the *nearest member*, not a centroid — see `assignMemory`
 * in src/core/assign.ts, which ranks by `bestMemberSimilarity`.
 *
 * That distinction is the whole calibration here, and getting it wrong was
 * silent. Derived from centroids first, these came out at 0.47/0.39; the demo's
 * two captured memories score 0.42 and 0.36 against AI Tooling's centroid, so
 * neither attached, and the category the entire demo splits never grew. A broad
 * category's centroid is nothing like its closest member.
 *
 * By nearest member the demo scores 0.3567 and 0.3304, both against AI Tooling,
 * which is also the right answer — so the ranking is sound and only the cutoff
 * was wrong. 0.28 sits under the weaker of the two and at the bottom decile of
 * memories matched against their own category (p10 = 0.2837).
 *
 * It is a low bar, and honestly so. In this space a memory's nearest member in
 * the *right* category has a median of 0.3918, while the 90th percentile in a
 * *wrong* one is 0.3809 — those overlap heavily. What saves the assignment is
 * that `assignMemory` takes the argmax first and only then asks whether it is
 * good enough; the threshold decides existing-versus-new, not which category.
 */
export const ASSIGN = {
  EXISTING_CATEGORY: num('VITE_ASSIGN_EXISTING', 0.28),
  NEW_CHILD: num('VITE_ASSIGN_NEW_CHILD', 0.24),
} as const;

/**
 * relates_to edges are materialized above this similarity (spec 8.1).
 *
 * Chosen by edge count rather than by percentile: at 0.40, 45 of the 1,081
 * pairs clear it, against the 46 the map was drawn with. The map's density is
 * the thing a reader actually perceives, so it is the thing to hold constant.
 */
export const RELATES_TO_MIN_SIMILARITY = num('VITE_RELATES_MIN_SIM', 0.4);
