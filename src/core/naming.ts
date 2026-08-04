/**
 * Category naming, without a model.
 *
 * Moved here from server/ai/provider.ts (which re-exports it) the day the
 * client grew a batch pipeline: the browser's seed mode names the categories a
 * bulk drop opens, and a rule about what counts as a sayable name should not be
 * able to differ between the two ingest paths — the same reason
 * `partitionDuplicates` lives in src.
 */

/** Rejected outright by spec §10.4 — a container name is a failure to decide. */
const GENERIC = new Set(['miscellaneous', 'other', 'general', 'various', 'stuff', 'misc']);

export interface NameValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Applied to model output before it is written. A badly named category is
 * recoverable by the user; a failed reorganization is not — so callers fall
 * back to a TF-IDF name rather than abandoning the operation (spec §10.4).
 */
export function validateName(name: string, forbidden: string[]): NameValidation {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  const words = trimmed.split(/\s+/);
  if (words.length > 3) return { ok: false, reason: `${words.length} words, max 3` };
  if (GENERIC.has(trimmed.toLowerCase())) return { ok: false, reason: 'generic container name' };
  if (forbidden.some((f) => f.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, reason: 'duplicates an existing or tombstoned name' };
  }
  return { ok: true };
}

const STOP = new Set(
  ('the a an and or but of to in for on with at by from as is are was were be been it its this that ' +
    'these those not no you your we our they their he she i me my more most than then so if when ' +
    'what which who how why can could should would will just also very much every all any'
  ).split(' '),
);

/** The tokenizer naming ranks with — shared with the local embedder. */
export function nameTokens(t: string): string[] {
  return t.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Every candidate term for a cluster, best first.
 *
 * `fallbackName` takes the top two; the batch pipeline walks further down the
 * list when two clusters born in the same drop would otherwise collide on the
 * same pair.
 */
export function rankedTerms(sampleTexts: string[], allTexts: string[][]): string[] {
  const tf = new Map<string, number>();
  for (const t of sampleTexts) for (const w of nameTokens(t)) tf.set(w, (tf.get(w) ?? 0) + 1);

  const df = new Map<string, number>();
  for (const doc of allTexts) {
    for (const w of new Set(doc.flatMap(nameTokens))) df.set(w, (df.get(w) ?? 0) + 1);
  }

  /*
   * IDF only means something across several documents, and this is called with
   * one whenever a capture opens a brand-new category.
   *
   * With a single document every term has df 1, so the weight collapses to
   * log(1/2) — negative for everything. Sorted descending that ranks the
   * *rarest* words first and breaks ties alphabetically, which is how a note
   * about lowering a pricing tier came out named "Because Consider".
   *
   * One document has no comparison to make, so rank by frequency, and prefer
   * the longer word on a tie: in a single sentence almost everything appears
   * once, and "pricing" carries more than "try".
   */
  const n = Math.max(1, allTexts.length);
  const scored =
    n <= 1
      ? [...tf.entries()]
          .map(([w, freq]) => ({ w, score: freq }))
          .sort((a, b) => b.score - a.score || b.w.length - a.w.length || a.w.localeCompare(b.w))
      : [...tf.entries()]
          .map(([w, freq]) => ({ w, score: freq * Math.log(n / (1 + (df.get(w) ?? 0))) }))
          .sort((a, b) => b.score - a.score || a.w.localeCompare(b.w));

  return scored.map((s) => s.w);
}

const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Deterministic fallback when naming fails validation twice: the two highest
 * TF-IDF terms in the cluster, title-cased.
 */
export function fallbackName(sampleTexts: string[], allTexts: string[][]): string {
  const picked = rankedTerms(sampleTexts, allTexts).slice(0, 2).map(title);
  return picked.length > 0 ? picked.join(' ') : 'Unsorted';
}

/**
 * A name for a cluster that must not collide with anything in `forbidden`.
 *
 * Walks term pairs — (1st,2nd), then (1st,3rd), and so on — until one clears
 * `validateName`. Two clusters opened by the same batch usually share their
 * most frequent term; they should not end up sharing a name for it.
 */
export function uniqueName(sampleTexts: string[], allTexts: string[][], forbidden: string[]): string {
  const terms = rankedTerms(sampleTexts, allTexts);
  if (terms.length === 0) return validateName('Unsorted', forbidden).ok ? 'Unsorted' : `Unsorted ${forbidden.length}`;

  for (let second = 1; second <= terms.length; second++) {
    const pair = second < terms.length ? [terms[0]!, terms[second]!] : [terms[0]!];
    const candidate = pair.map(title).join(' ');
    if (validateName(candidate, forbidden).ok) return candidate;
  }
  // Every pair collided — a numbered name is worse than none at all being
  // written, and better than throwing away the whole batch.
  return `${title(terms[0]!)} ${forbidden.length + 1}`;
}
