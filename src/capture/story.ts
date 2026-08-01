import { cosine } from '../core/vectorMath';
import { ECHO_SIMILARITY } from '../core/thresholds';
import type { GraphPayload, Memory } from '../core/types';

/**
 * What just happened to the thing you dropped in.
 *
 * Filing is where the product either earns trust or quietly loses it. A ticker
 * that says "Reorganizing…" and then a banner tells you *that* something moved;
 * it never tells you what Recall actually read, whether it had seen this before,
 * or where it decided the thing belongs. This assembles that account from the
 * payloads either side of the ingest, so the answer comes from real data rather
 * than a scripted caption.
 */


export interface CapturedMemory {
  id: string;
  text: string;
  /** The closest thing already saved, when it is close enough to be worth showing. */
  echoOf: { text: string; categoryName: string; similarity: number } | null;
}

export interface CaptureStory {
  /** What Recall says it saw — the scene description for an image, else the raw text. */
  saw: string;
  sourceTitle: string;
  memories: CapturedMemory[];
  /**
   * What the source said that was already held, and therefore not written.
   *
   * Reported rather than dropped in silence. A source that produced four
   * memories and added one has to be able to say why, or the count reads as
   * extraction having failed.
   */
  alreadyHeld: { text: string; similarity: number }[];
  /** The top-level category the capture landed in. */
  destination: string | null;
  /** Set when the capture also triggered a restructuring. */
  restructured: boolean;
}

/** The top-level ancestor of a category — what the arc actually shows. */
function parentNameOf(payload: GraphPayload, categoryId: string | null): string | null {
  const category = payload.categories.find((c) => c.id === categoryId);
  if (!category) return null;
  if (!category.parent_id) return category.name;
  return payload.categories.find((c) => c.id === category.parent_id)?.name ?? category.name;
}

export function buildCaptureStory(
  before: GraphPayload,
  after: GraphPayload,
  addedMemoryIds: string[],
  restructured: boolean,
  alreadyHeld: { text: string; similarity: number }[] = [],
): CaptureStory | null {
  const added = addedMemoryIds
    .map((id) => after.memories.find((m) => m.id === id))
    .filter((m): m is Memory => m !== undefined);
  /*
   * Everything the source said was already held.
   *
   * Returning null here would leave the screen blank after a capture that did
   * real work — read the thing, compared it, decided. There is a story to tell;
   * it just has no new memory in it.
   */
  if (added.length === 0) {
    if (alreadyHeld.length === 0) return null;
    return {
      // Separated, because these are distinct sentences and joining them on a
      // space runs the end of one into the start of the next.
      saw: alreadyHeld.map((h) => h.text).join(' · '),
      sourceTitle: 'Nothing new',
      memories: [],
      alreadyHeld,
      destination: null,
      restructured: false,
    };
  }

  const source = after.sources.find((s) => s.id === added[0]!.source_id);

  const memories: CapturedMemory[] = added.map((memory) => {
    // Compared against the corpus *before* this capture, so the two memories
    // that arrived together never count as echoes of each other.
    let best: { memory: Memory; similarity: number } | null = null;
    for (const prior of before.memories) {
      const similarity = cosine(memory.vector, prior.vector);
      if (!best || similarity > best.similarity) best = { memory: prior, similarity };
    }

    return {
      id: memory.id,
      text: memory.text,
      echoOf:
        best && best.similarity >= ECHO_SIMILARITY
          ? {
              text: best.memory.text,
              categoryName:
                after.categories.find((c) => c.id === best!.memory.category_id)?.name ?? 'Unfiled',
              similarity: best.similarity,
            }
          : null,
    };
  });

  return {
    saw:
      source?.type === 'screenshot' && source.scene_description
        ? source.scene_description
        : (source?.raw_content ?? added.map((m) => m.text).join(' ')),
    sourceTitle: source?.title ?? 'Untitled capture',
    memories,
    alreadyHeld,
    destination: parentNameOf(after, added[0]!.category_id),
    restructured,
  };
}
