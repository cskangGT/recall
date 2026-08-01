import { cosine } from '../core/vectorMath';
import { DUPLICATE_SIMILARITY } from '../core/thresholds';

/**
 * Whether something being captured is a thing already saved.
 *
 * The one job is not creating a second copy. It never removes anything, which
 * is a deliberate limit rather than a first version: the server's undo does not
 * restore memory rows — it re-assigns the memories in `before_state` into
 * categories, and that assignment has a foreign key to a row a deletion would
 * have taken away. Refusing to write is undoable; having written and deleted is
 * not.
 *
 * The threshold is measured (see `DUPLICATE_SIMILARITY`), and the failure it is
 * measured against is the asymmetric one. Missing a duplicate costs a redundant
 * row. Calling something a duplicate that is not costs the user the thing they
 * just tried to save, silently — so the cutoff sits far above the closest pair
 * of genuinely distinct memories in the corpus, not at the midpoint.
 *
 * Kept out of the ingest paths because there are two of them — the client's
 * seed mode and the server pipeline — and a rule about what counts as the same
 * memory should not be able to differ between them.
 */

export interface DuplicateVerdict<T> {
  /** Candidates that were not already held, in the order given. */
  kept: T[];
  /** Candidates that were, each with what it duplicates and how closely. */
  skipped: { candidate: T; of: T; similarity: number }[];
}

/**
 * Partitions candidates against a corpus.
 *
 * Candidates are checked against the corpus **and against the candidates
 * already kept from this same batch**, because a source that says the same
 * thing twice would otherwise sail through: both copies are new to the corpus,
 * and only one of them should survive. The first occurrence wins, so the result
 * does not depend on which end of the batch you start from.
 */
export function partitionDuplicates<T extends { vector: number[] }>(
  candidates: readonly T[],
  corpus: readonly T[],
  threshold: number = DUPLICATE_SIMILARITY,
): DuplicateVerdict<T> {
  const kept: T[] = [];
  const skipped: { candidate: T; of: T; similarity: number }[] = [];

  for (const candidate of candidates) {
    let best: { of: T; similarity: number } | null = null;
    for (const prior of [...corpus, ...kept]) {
      const similarity = cosine(candidate.vector, prior.vector);
      if (!best || similarity > best.similarity) best = { of: prior, similarity };
    }

    if (best && best.similarity >= threshold) {
      skipped.push({ candidate, of: best.of, similarity: best.similarity });
    } else {
      kept.push(candidate);
    }
  }

  return { kept, skipped };
}
