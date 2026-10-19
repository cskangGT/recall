import type { GraphPayload, Memory } from '../../src/core/types.ts';
import { cosine } from '../../src/core/vectorMath.ts';
import type { EmbeddingProvider, RetrievedMemory } from '../ai/provider.ts';

/**
 * Hybrid retrieval — spec §9.1.
 *
 * Keyword search and vector search answer different questions and fail in
 * different places. BM25 finds the memory that literally says "Braintrust" and
 * is blind to "the eval tool we picked"; cosine finds the paraphrase and drifts
 * toward whatever is topically adjacent. Reciprocal rank fusion combines the
 * two rankings without needing their scores to be comparable — which they are
 * not, one being a log-scaled term statistic and the other a bounded cosine.
 */

/** Spec §9.1. Damps the influence of any single ranker's top slot. */
export const RRF_K = 60;

/** Spec §9.2. Below this a memory is not evidence, whatever its rank. */
export const RELEVANCE_FLOOR = 0.35;

/**
 * The floor for a meeting's context, lower than the question floor.
 *
 * A question is a sentence the user wrote to be answered, and an answer
 * that cites a weak match is a fabrication with a footnote — so Ask fails
 * closed at 0.35. A meeting is a title, a fragment of a description and a
 * list of names: not a question, and embedded nowhere in particular. The
 * stakes differ too. Nothing is asserted from meeting context; it is shown
 * beside the event as "you noted this once", and the user decides whether it
 * helps. A near miss costs a glance; a missed memory costs the thing the
 * feature exists for. Hence more slack — but still a floor, because a
 * memory that merely shares a rank with the title is noise, not context.
 */
export const MEETING_RELEVANCE_FLOOR = 0.28;

/** Spec §9.2: retrieve 20, answer from at most 8. */
export const RETRIEVE_LIMIT = 20;
export const CONTEXT_LIMIT = 8;

export interface Ranked {
  memory: Memory;
  /** Fused RRF score — for ordering only; not comparable across queries. */
  score: number;
  /** Cosine to the question. Compared against RELEVANCE_FLOOR. */
  similarity: number;
  matchedKeyword: boolean;
}

export interface KeywordHit {
  memoryId: string;
  /** Lower is better, as bm25 returns. Used for rank only. */
  rank: number;
}

/**
 * Fuses a keyword ranking with a vector ranking.
 *
 * `keywordHits` is expected pre-ranked (best first) — the repository owns how
 * they are produced, so a Postgres implementation can use tsvector without this
 * function changing.
 */
export function fuse(
  payload: GraphPayload,
  questionVector: number[],
  keywordHits: KeywordHit[],
  limit = RETRIEVE_LIMIT,
): Ranked[] {
  const byId = new Map(payload.memories.map((m) => [m.id, m]));

  const similarity = new Map<string, number>();
  for (const m of payload.memories) similarity.set(m.id, cosine(questionVector, m.vector));

  const vectorRank = new Map<string, number>();
  [...payload.memories]
    .sort((a, b) =>
      (similarity.get(b.id)! - similarity.get(a.id)!) || a.id.localeCompare(b.id))
    .forEach((m, i) => vectorRank.set(m.id, i + 1));

  const keywordRank = new Map<string, number>();
  keywordHits.forEach((h, i) => keywordRank.set(h.memoryId, i + 1));

  const scored: Ranked[] = [];
  for (const memoryId of new Set([...vectorRank.keys(), ...keywordRank.keys()])) {
    const memory = byId.get(memoryId);
    if (!memory) continue;
    // A ranker that did not return the document contributes nothing, rather
    // than a penalty — that is what makes RRF robust to one ranker being blind
    // to a phrasing the other catches.
    const fromVector = vectorRank.has(memoryId) ? 1 / (RRF_K + vectorRank.get(memoryId)!) : 0;
    const fromKeyword = keywordRank.has(memoryId) ? 1 / (RRF_K + keywordRank.get(memoryId)!) : 0;
    scored.push({
      memory,
      score: fromVector + fromKeyword,
      similarity: similarity.get(memoryId) ?? 0,
      matchedKeyword: keywordRank.has(memoryId),
    });
  }

  return scored
    .sort((a, b) => (b.score - a.score) || a.memory.id.localeCompare(b.memory.id))
    .slice(0, limit);
}

/**
 * Drops everything the floor rejects.
 *
 * Applied after fusion rather than before: a memory can rank highly on keywords
 * while being semantically unrelated, and the floor is what stops that from
 * becoming a citation. Recall's credibility rests on every claim being
 * traceable, so an unsupported retrieval has to fail closed.
 */
export function applyFloor(ranked: Ranked[], floor = RELEVANCE_FLOOR): Ranked[] {
  return ranked.filter((r) => r.similarity >= floor);
}

/**
 * Everything retrieval does before a floor is applied to a piece of text:
 * embed it as a query, run the keyword half, fuse, floor, cap.
 *
 * Extracted from Ask so a meeting title can be run through exactly the same
 * pipeline as a question — one implementation of "what is relevant to this
 * text", not two that drift. The keyword search is passed as a function
 * rather than a repository so the caller binds the workspace and this file
 * keeps knowing nothing about storage.
 *
 * The floor is applied over the full `RETRIEVE_LIMIT` fused list and only
 * then sliced to `limit`: callers that want to know how many memories
 * survived (Ask's refusal rule) pass no limit and count; callers that want a
 * handful pass one.
 */
export async function relevantTo(
  payload: GraphPayload,
  keywordSearch: (query: string, limit: number) => KeywordHit[],
  embeddings: EmbeddingProvider,
  text: string,
  options: { limit?: number; floor?: number } = {},
): Promise<Ranked[]> {
  const [vector] = await embeddings.embed([text], 'query');
  const keywordHits = keywordSearch(text, RETRIEVE_LIMIT);
  const fused = fuse(payload, vector!, keywordHits, RETRIEVE_LIMIT);
  return applyFloor(fused, options.floor ?? RELEVANCE_FLOOR).slice(0, options.limit ?? RETRIEVE_LIMIT);
}

/**
 * Context expansion (spec §9.2 step 5): each memory with its category and
 * source, so whoever reads it — a model answering, or a person glancing at a
 * meeting — can attribute rather than guess. Lives here rather than in Ask
 * because the shape is what every consumer of retrieval cites.
 */
export function expandMemories(
  payload: GraphPayload,
  memories: { id: string; source_id: string; text: string; category_id: string }[],
): RetrievedMemory[] {
  const categoryName = new Map(payload.categories.map((c) => [c.id, c.name]));
  const sourceById = new Map(payload.sources.map((s) => [s.id, s]));
  return memories.map((m) => {
    const source = sourceById.get(m.source_id);
    return {
      memory_id: m.id,
      source_id: m.source_id,
      text: m.text,
      category_name: categoryName.get(m.category_id) ?? 'Uncategorised',
      source_title: source?.title ?? 'Unknown source',
      source_type: source?.type ?? 'text',
    };
  });
}
