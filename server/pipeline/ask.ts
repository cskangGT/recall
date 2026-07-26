import { randomUUID } from 'node:crypto';
import type { Repository } from '../db/repository';
import type { AiProvider, EmbeddingProvider, RetrievedMemory } from '../ai/provider';
import { applyFloor, fuse, CONTEXT_LIMIT, RETRIEVE_LIMIT } from '../search/retrieve';

/**
 * Ask — spec §9.2.
 *
 * The pipeline exists to make one guarantee mechanical rather than hoped for:
 * an answer cites only memories that retrieval actually surfaced. Nothing here
 * lets the model reach past what it was given, and a question with too little
 * evidence is refused before a model is ever called.
 */

export const REFUSAL = "I don't have anything saved about that yet.";

/** Spec §9.2 step 4: fewer than two surviving memories is not an answer. */
export const MIN_SUPPORTING_MEMORIES = 2;

export interface AskResult {
  answer: string;
  citations: { n: number; memory_id: string; source_id: string }[];
  /** Cited memories plus their categories — what the map lights up (spec §5.6). */
  highlighted_node_ids: string[];
  refused: boolean;
  /** How many memories survived the floor, for diagnosing a refusal. */
  retrievedCount: number;
}

const refusal = (retrievedCount: number): AskResult => ({
  answer: REFUSAL,
  citations: [],
  highlighted_node_ids: [],
  refused: true,
  retrievedCount,
});

export class AskPipeline {
  constructor(
    private readonly repo: Repository,
    private readonly ai: AiProvider,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async ask(workspaceId: string, question: string): Promise<AskResult> {
    const payload = this.repo.getGraphPayload(workspaceId);

    const [questionVector] = await this.embeddings.embed([question], 'query');
    const keywordHits = this.repo.keywordSearch(workspaceId, question, RETRIEVE_LIMIT);

    const fused = fuse(payload, questionVector!, keywordHits, RETRIEVE_LIMIT);
    const surviving = applyFloor(fused);

    if (surviving.length < MIN_SUPPORTING_MEMORIES) {
      this.record(workspaceId, question, refusal(surviving.length));
      return refusal(surviving.length);
    }

    // Context expansion (spec §9.2 step 5): the model sees each memory with its
    // category and source, so it can attribute rather than guess.
    const categoryName = new Map(payload.categories.map((c) => [c.id, c.name]));
    const sourceById = new Map(payload.sources.map((s) => [s.id, s]));
    const context: RetrievedMemory[] = surviving.slice(0, CONTEXT_LIMIT).map((r) => {
      const source = sourceById.get(r.memory.source_id);
      return {
        memory_id: r.memory.id,
        source_id: r.memory.source_id,
        text: r.memory.text,
        category_name: categoryName.get(r.memory.category_id) ?? 'Uncategorised',
        source_title: source?.title ?? 'Unknown source',
        source_type: source?.type ?? 'text',
      };
    });

    const generated = await this.ai.answer({ question, retrieved: context });

    if (generated.refused || generated.citations.length === 0) {
      this.record(workspaceId, question, refusal(surviving.length));
      return refusal(surviving.length);
    }

    // The contract, enforced rather than trusted: a citation the retrieval set
    // does not contain is a fabrication, and one hallucinated answer costs more
    // than every refusal combined.
    const available = new Set(context.map((c) => c.memory_id));
    const invalid = generated.citations.filter((c) => !available.has(c.memory_id));
    if (invalid.length > 0) {
      this.record(workspaceId, question, refusal(surviving.length));
      return refusal(surviving.length);
    }

    const highlighted = new Set<string>();
    for (const citation of generated.citations) {
      highlighted.add(citation.memory_id);
      const memory = payload.memories.find((m) => m.id === citation.memory_id);
      if (memory) highlighted.add(memory.category_id);
    }

    const result: AskResult = {
      answer: generated.answer,
      citations: generated.citations,
      highlighted_node_ids: [...highlighted],
      refused: false,
      retrievedCount: surviving.length,
    };
    this.record(workspaceId, question, result);
    return result;
  }

  private record(workspaceId: string, question: string, result: AskResult): void {
    this.repo.recordAsk(workspaceId, {
      id: `ask_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      question,
      answer: result.refused ? null : result.answer,
      citations: result.citations,
      refused: result.refused,
    });
  }
}
