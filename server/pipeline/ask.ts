import { randomUUID } from 'node:crypto';
import type { Repository } from '../db/repository.ts';
import type { AiProvider, AskTurn, EmbeddingProvider, RetrievedMemory } from '../ai/provider.ts';
import { applyFloor, fuse, CONTEXT_LIMIT, RETRIEVE_LIMIT } from '../search/retrieve.ts';

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
  // Written out rather than as constructor parameter properties: those emit
  // code, not just types, so Node's strip-only TypeScript loader rejects them —
  // and `node server/http/main.ts` with no build step is worth the four lines.
  private readonly repo: Repository;
  private readonly ai: AiProvider;
  private readonly embeddings: EmbeddingProvider;

  constructor(repo: Repository, ai: AiProvider, embeddings: EmbeddingProvider) {
    this.repo = repo;
    this.ai = ai;
    this.embeddings = embeddings;
  }

  /**
   * `ask`, with the answer text arriving as it is generated.
   *
   * An async generator of SSE-shaped events — `delta` frames carrying new
   * answer text, then exactly one `done` frame carrying the same AskResult
   * `ask` would have returned. Every guarantee is unchanged: retrieval,
   * the floor, citation validation and the refusal all run here too, and a
   * generation that fails validation ends in a refusal even though its text
   * already streamed — the client replaces the draft with the final result,
   * so the contract owns what persists.
   *
   * A generator rather than a callback so `routes.ts` can stay a pure
   * function: the route returns the iterable and only the http adapter knows
   * what a socket is.
   */
  async *askStream(
    workspaceId: string,
    question: string,
    history: AskTurn[] = [],
  ): AsyncGenerator<{ event: 'delta'; data: { text: string } } | { event: 'done'; data: AskResult }> {
    const prepared = await this.prepare(workspaceId, question, history);
    if ('refusal' in prepared) {
      this.record(workspaceId, question, prepared.refusal);
      yield { event: 'done', data: prepared.refusal };
      return;
    }
    const { payload, context, survivingCount } = prepared;

    /*
     * The provider pushes deltas through a callback; a generator pulls. The
     * queue between them is the adapter: pushed text queues up, the loop
     * drains it, and a notify latch wakes the loop when it went to sleep
     * with nothing to yield.
     */
    const pending: string[] = [];
    let notify: (() => void) | null = null;
    const wake = () => {
      notify?.();
      notify = null;
    };
    const streamFn = this.ai.answerStream?.bind(this.ai);
    const flight = (
      streamFn
        ? streamFn({ question, retrieved: context, history }, (text) => {
            pending.push(text);
            wake();
          })
        : this.ai.answer({ question, retrieved: context, history })
    ).finally(wake);

    let settled = false;
    const settle = flight.then(
      (r) => ((settled = true), r),
      (err) => {
        settled = true;
        throw err;
      },
    );
    while (!settled || pending.length > 0) {
      if (pending.length === 0) {
        await Promise.race([settle.catch(() => {}), new Promise<void>((r) => (notify = r))]);
        continue;
      }
      yield { event: 'delta', data: { text: pending.shift()! } };
    }

    const result = this.finish(workspaceId, question, payload, context, survivingCount, await settle);
    yield { event: 'done', data: result };
  }

  /** Whether the wired model can look back at all. */
  canRetrospect(): boolean {
    return typeof this.ai.retrospect === 'function';
  }

  /**
   * The look back (일기 회고): every diary entry whose day falls in [from, to],
   * oldest first, plus a capped sample of what else arrived those days, given
   * to the model to say how the thinking moved. Reads only; records nothing.
   */
  async retrospect(
    workspaceId: string,
    from: string,
    to: string,
    locale?: 'en' | 'ko',
  ): Promise<{ reflection: string; days: number }> {
    if (!this.ai.retrospect) throw new Error('this model cannot look back');
    const payload = this.repo.getGraphPayload(workspaceId);

    const entries = payload.sources
      .filter((s) => s.diary_date && s.diary_date >= from && s.diary_date <= to)
      .sort((a, b) => a.diary_date!.localeCompare(b.diary_date!) || a.created_at.localeCompare(b.created_at))
      .map((s) => ({ date: s.diary_date!, text: s.raw_content }));
    if (entries.length === 0) return { reflection: '', days: 0 };

    const diarySourceIds = new Set(
      payload.sources.filter((s) => s.diary_date).map((s) => s.id),
    );
    const memories = payload.memories
      .filter((m) => {
        const day = m.created_at.slice(0, 10);
        return day >= from && day <= to && !diarySourceIds.has(m.source_id);
      })
      .slice(0, 12)
      .map((m) => m.text);

    const { reflection } = await this.ai.retrospect({ entries, memories, locale });
    return { reflection, days: new Set(entries.map((e) => e.date)).size };
  }

  async ask(workspaceId: string, question: string, history: AskTurn[] = []): Promise<AskResult> {
    const prepared = await this.prepare(workspaceId, question, history);
    if ('refusal' in prepared) {
      this.record(workspaceId, question, prepared.refusal);
      return prepared.refusal;
    }
    const { payload, context, survivingCount } = prepared;
    const generated = await this.ai.answer({ question, retrieved: context, history });
    return this.finish(workspaceId, question, payload, context, survivingCount, generated);
  }

  /** Retrieval through context expansion — everything before a model speaks. */
  private async prepare(
    workspaceId: string,
    question: string,
    history: AskTurn[],
  ): Promise<
    | { refusal: AskResult }
    | {
        payload: ReturnType<Repository['getGraphPayload']>;
        context: RetrievedMemory[];
        survivingCount: number;
      }
  > {
    const payload = this.repo.getGraphPayload(workspaceId);

    /*
     * A follow-up retrieves on the conversation, not on itself. "Which of
     * those take reservations?" embeds nowhere near restaurants — the referent
     * lives in the previous question, so the previous question rides along for
     * the query embedding and the keyword pass. Only the latest turn: two
     * questions back is a different subject more often than the same one, and
     * an over-wide query drags the floor down for everything.
     *
     * Everything downstream is unchanged on purpose — the floor, the citation
     * contract, the refusal. History rewords the question; it never lowers the
     * bar for answering it.
     */
    const previous = history.at(-1);
    const retrievalText = previous ? `${previous.question}\n${question}` : question;

    const [questionVector] = await this.embeddings.embed([retrievalText], 'query');
    const keywordHits = this.repo.keywordSearch(workspaceId, retrievalText, RETRIEVE_LIMIT);

    const fused = fuse(payload, questionVector!, keywordHits, RETRIEVE_LIMIT);
    const surviving = applyFloor(fused);

    if (surviving.length < MIN_SUPPORTING_MEMORIES) {
      return { refusal: refusal(surviving.length) };
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

    return { payload, context, survivingCount: surviving.length };
  }

  /** Validation and recording — everything after a model spoke. */
  private finish(
    workspaceId: string,
    question: string,
    payload: ReturnType<Repository['getGraphPayload']>,
    context: RetrievedMemory[],
    survivingCount: number,
    generated: Awaited<ReturnType<AiProvider['answer']>>,
  ): AskResult {
    if (generated.refused || generated.citations.length === 0) {
      this.record(workspaceId, question, refusal(survivingCount));
      return refusal(survivingCount);
    }

    // The contract, enforced rather than trusted: a citation the retrieval set
    // does not contain is a fabrication, and one hallucinated answer costs more
    // than every refusal combined.
    const available = new Set(context.map((c) => c.memory_id));
    const invalid = generated.citations.filter((c) => !available.has(c.memory_id));
    if (invalid.length > 0) {
      this.record(workspaceId, question, refusal(survivingCount));
      return refusal(survivingCount);
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
      retrievedCount: survivingCount,
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
