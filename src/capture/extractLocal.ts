/**
 * Claim extraction without a model.
 *
 * The batch pipeline's seed-mode stand-in for spec §10.2: a real provider reads
 * meaning; this reads structure. Lines and sentences that look like claims are
 * kept, chrome is dropped, and the result is deterministic — the same file
 * always yields the same memories, which is what makes the batch demo safe to
 * run live for the same reason the split is.
 *
 * When the API is on, none of this runs: the server extracts with the real
 * model and this file is dead weight in the bundle, not a second opinion.
 */

/** Spec §10.2 volume rule: 1–10 memories per source. */
const MAX_CLAIMS_PER_SOURCE = 6;
const MIN_WORDS = 5;
const MAX_WORDS = 40;

const BULLET_PREFIX = /^[\s>*#•·\-–—]+|^\s*\d+[.)]\s+/;
const URL_ONLY = /^https?:\/\/\S+$/i;

/** One line of a pasted note, split further where sentences end. */
function sentences(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function extractClaims(content: string): string[] {
  const claims: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(BULLET_PREFIX, '').replace(/\s+/g, ' ').trim();
    if (line.length === 0) continue;

    for (const sentence of sentences(line)) {
      if (URL_ONLY.test(sentence)) continue;
      const words = sentence.split(/\s+/).length;
      // Korean packs a claim into fewer space-separated words — particles ride
      // on the words instead of between them — so the floor drops with it.
      const minWords = /[\uac00-\ud7a3]/.test(sentence) ? 3 : MIN_WORDS;
      if (words < minWords || words > MAX_WORDS) continue;

      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      claims.push(sentence);
      if (claims.length >= MAX_CLAIMS_PER_SOURCE) return claims;
    }
  }

  return claims;
}
