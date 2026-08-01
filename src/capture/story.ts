import { cosine } from '../core/vectorMath';
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

/**
 * Above this cosine, a new memory is saying something you have already saved.
 *
 * Deliberately not a de-duplication threshold — nothing is discarded. It only
 * decides whether the UI says "new" or shows you the thing it echoes, and being
 * wrong costs a slightly odd label rather than lost data.
 *
 * **Currently unreachable, on purpose.** Under the authored 8-dimensional
 * vectors this fired on the demo capture and produced the line the capture story
 * exists for — "You already saved something close to this". Measured against
 * real embeddings, that pair scores 0.3567 while the 99th percentile of every
 * ordinary pair in the corpus is 0.4550: the demo's echo is *less* alike than
 * one pair in a hundred picked at random. Reading the two sentences back
 * explains it — one is about which tool replaced a spreadsheet, the other about
 * how far apart two reviewers score. They were never saying the same thing;
 * they shared a theme, and a theme is what those vectors encoded.
 *
 * A threshold low enough to catch it labels 104 of 1,081 pairs an echo. Telling
 * a user "you already saved this" about one in ten unrelated things is worse
 * than saying nothing, so it says nothing: `echoOf` stays null and the story
 * reports what was read and where it landed, both of which are still true.
 *
 * This is the feature real de-duplication should restore, once similarity is
 * measured on something that encodes meaning.
 */
export const ECHO_SIMILARITY = 1.01;

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
): CaptureStory | null {
  const added = addedMemoryIds
    .map((id) => after.memories.find((m) => m.id === id))
    .filter((m): m is Memory => m !== undefined);
  if (added.length === 0) return null;

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
    destination: parentNameOf(after, added[0]!.category_id),
    restructured,
  };
}
