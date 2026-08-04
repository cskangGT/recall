import type { Memory } from '../core/types';
import { nameTokens } from '../core/naming';

/**
 * Embeddings without a model, anchored to the corpus.
 *
 * The seed's vectors are real (1024-dim, measured — see thresholds.ts), so a
 * synthetic vector has to live in *their* space or every gate goes silent. Pure
 * hashing gives a direction unrelated to anything saved: nothing assigns,
 * nothing splits, every drop opens a parade of new parents. So a new claim is
 * embedded as a blend:
 *
 *   - an **anchor** — the weighted mean of the corpus memories it lexically
 *     overlaps with, which is where a real embedding model would put it, and
 *   - a **jitter** — a deterministic hash direction, weighted by how weak the
 *     lexical match is.
 *
 * Strong overlap → mostly anchor → files into the category it echoes. No
 * overlap → mostly hash → genuinely far from everything, and the assignment
 * bands in ASSIGN do the rest. Identical text produces an identical vector, so
 * re-dropping a file dedupes at cosine 1.0 without any special casing.
 */

const ANCHOR_COUNT = 4;

/** xorshift32 over an FNV-1a seed — enough randomness to be a direction. */
function hashVector(text: string, dim: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h || 1;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = (state >>> 0) / 4294967295 - 0.5;
  }
  return normalize(out);
}

function normalize(v: number[]): number[] {
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Cosine over token *sets* — cheap, symmetric, and 0 for disjoint texts. */
export function lexicalSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.sqrt(ta.size * tb.size);
}

export function localVector(text: string, corpus: readonly Memory[]): number[] {
  const dim = corpus[0]?.vector.length ?? 8;
  const jitter = hashVector(text, dim);
  if (corpus.length === 0) return jitter;

  const anchors = corpus
    .map((m) => ({ m, score: lexicalSimilarity(text, m.text) }))
    .sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id))
    .slice(0, ANCHOR_COUNT)
    .filter((x) => x.score > 0);

  if (anchors.length === 0) return jitter;

  const anchor = new Array<number>(dim).fill(0);
  for (const { m, score } of anchors) {
    for (let i = 0; i < dim; i++) anchor[i]! += score * m.vector[i]!;
  }
  const anchorUnit = normalize(anchor);

  /*
   * The jitter weight is the whole calibration. Targets, in nearest-member
   * cosine after blending (thresholds.ts: duplicate 0.68, existing ≥0.28,
   * new-child ≥0.24):
   *
   *   strong lexical match (≥0.3)  → ~0.5   files into the category, not a dupe
   *   middling (≈0.15)             → ~0.25  opens a child beside it
   *   token-level noise (<0.06)    → ~0.09  opens its own parent
   */
  const top = anchors[0]!.score;
  const jitterWeight = Math.min(0.95, Math.max(0.5, 1 - 1.7 * top));

  const blended = anchorUnit.map((x, i) => (1 - jitterWeight) * x + jitterWeight * jitter[i]!);
  return normalize(blended);
}
