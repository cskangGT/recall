import type { GraphPayload, Memory } from './types';
import { cosine } from './vectorMath';
import { RELATES_TO_MIN_SIMILARITY } from './thresholds';

/**
 * The memories nearest to this one, best first — what the Inspector shows as
 * "related". The floor is the same threshold the map draws relates_to edges
 * with, so the list and the lines never disagree about what counts as close.
 * Same-source siblings are excluded: arriving together is provenance, not
 * relatedness, and the reading list already shows them side by side.
 */
export function relatedMemories(
  payload: GraphPayload,
  memoryId: string,
  limit = 5,
): { memory: Memory; similarity: number }[] {
  const anchor = payload.memories.find((m) => m.id === memoryId);
  if (!anchor) return [];
  return payload.memories
    .filter((m) => m.id !== memoryId && m.source_id !== anchor.source_id)
    .map((memory) => ({ memory, similarity: cosine(anchor.vector, memory.vector) }))
    .filter((r) => r.similarity >= RELATES_TO_MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity || a.memory.id.localeCompare(b.memory.id))
    .slice(0, limit);
}
