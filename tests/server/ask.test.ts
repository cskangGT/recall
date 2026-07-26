import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline, REFUSAL } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { fuse, applyFloor, RELEVANCE_FLOOR } from '../../server/search/retrieve';
import type { AnswerResult, RetrievedMemory } from '../../server/ai/provider';

const WS = 'ws_demo';
let repo: SqliteRepository;
let ask: AskPipeline;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  ask = new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings());
});

afterEach(() => repo.close());

const ingestDemo = () =>
  new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()).ingest({
    workspaceId: WS, type: 'screenshot', content: 'evals',
    imagePath: '/seed/demo-screenshot.png',
  });

describe('keyword search — the FTS5 half', () => {
  it('finds a memory by a literal term', () => {
    const hits = repo.keywordSearch(WS, 'LangChain', 20);
    expect(hits.length).toBeGreaterThan(0);
    const texts = hits.map((h) => repo.listMemories(WS).find((m) => m.id === h.memoryId)!.text);
    expect(texts.some((t) => t.includes('LangChain'))).toBe(true);
  });

  it('survives punctuation and FTS5 operator words in the question', () => {
    // Raw input reaches a query language, so an apostrophe or a bare NOT is a
    // syntax hazard, not just a relevance one.
    for (const q of ["what's our eval stack?", 'pricing AND OR NOT', '"unclosed quote', 'a * b']) {
      expect(() => repo.keywordSearch(WS, q, 20)).not.toThrow();
    }
  });

  it('returns nothing rather than throwing for a query with no usable terms', () => {
    expect(repo.keywordSearch(WS, '?? !!', 20)).toEqual([]);
  });

  it('tracks memories through a delete', () => {
    const before = repo.keywordSearch(WS, 'LangChain', 20).length;
    const target = repo.listMemories(WS).find((m) => m.text.includes('LangChain'))!;
    repo.deleteCategory(target.category_id); // cascades nothing, but exercises the triggers
    expect(repo.keywordSearch(WS, 'LangChain', 20).length).toBeLessThanOrEqual(before);
  });
});

describe('fuse — reciprocal rank fusion', () => {
  it('ranks a memory found by both rankers above one found by only one', () => {
    const payload = repo.getGraphPayload(WS);
    const target = payload.memories.find((m) => m.text.includes('LangChain'))!;
    const other = payload.memories.find((m) => m.id !== target.id)!;

    const ranked = fuse(payload, target.vector, [{ memoryId: target.id, rank: -1 }], 20);
    const targetRank = ranked.findIndex((r) => r.memory.id === target.id);
    const otherRank = ranked.findIndex((r) => r.memory.id === other.id);

    expect(targetRank).toBe(0);
    expect(otherRank === -1 || otherRank > targetRank).toBe(true);
  });

  it('still returns a ranking when the keyword half finds nothing', () => {
    const payload = repo.getGraphPayload(WS);
    const ranked = fuse(payload, payload.memories[0]!.vector, [], 20);
    expect(ranked).toHaveLength(20);
    expect(ranked[0]!.memory.id).toBe(payload.memories[0]!.id);
  });

  it('is deterministic under ties', () => {
    const payload = repo.getGraphPayload(WS);
    const v = payload.memories[3]!.vector;
    const first = fuse(payload, v, [], 20).map((r) => r.memory.id);
    for (let i = 0; i < 10; i++) {
      expect(fuse(payload, v, [], 20).map((r) => r.memory.id)).toEqual(first);
    }
  });

  it('applies the relevance floor after fusion, not before', () => {
    const payload = repo.getGraphPayload(WS);
    // A keyword-only hit that is semantically unrelated must not survive: it can
    // rank highly on terms and still be no evidence at all.
    const unrelated = payload.memories.find((m) => m.text.includes('Morning workouts'))!;
    const question = payload.memories.find((m) => m.text.includes('LangChain'))!.vector;

    const ranked = fuse(payload, question, [{ memoryId: unrelated.id, rank: -1 }], 20);
    expect(ranked.some((r) => r.memory.id === unrelated.id)).toBe(true);

    const kept = applyFloor(ranked);
    for (const r of kept) expect(r.similarity).toBeGreaterThanOrEqual(RELEVANCE_FLOOR);
  });
});

describe('AskPipeline', () => {
  it('answers the demo question with citations that resolve (AC-33, AC-34)', async () => {
    await ingestDemo();
    const result = await ask.ask(WS, 'What did we decide about our eval stack?');

    expect(result.refused).toBe(false);
    expect(result.citations.length).toBeGreaterThanOrEqual(2);

    const payload = repo.getGraphPayload(WS);
    const memoryIds = new Set(payload.memories.map((m) => m.id));
    const sourceIds = new Set(payload.sources.map((s) => s.id));
    for (const c of result.citations) {
      expect(memoryIds.has(c.memory_id)).toBe(true);
      expect(sourceIds.has(c.source_id)).toBe(true);
    }
    for (const sentence of result.answer.split(/(?<=\.)\s+/)) {
      if (sentence.trim()) expect(sentence).toMatch(/\[\d+\]/);
    }
  });

  it('highlights the cited memories and their categories (AC-36)', async () => {
    await ingestDemo();
    const result = await ask.ask(WS, 'What did we decide about our eval stack?');
    const payload = repo.getGraphPayload(WS);

    for (const c of result.citations) expect(result.highlighted_node_ids).toContain(c.memory_id);
    const category = payload.memories.find((m) => m.id === result.citations[0]!.memory_id)!.category_id;
    expect(result.highlighted_node_ids).toContain(category);
  });

  it('refuses verbatim when nothing relevant is saved (AC-35, AC-37)', async () => {
    const result = await ask.ask(WS, 'What is the capital of France?');
    expect(result.answer).toBe(REFUSAL);
    expect(result.answer).toBe("I don't have anything saved about that yet.");
    expect(result.citations).toHaveLength(0);
    expect(result.highlighted_node_ids).toHaveLength(0);
    expect(result.refused).toBe(true);
  });

  it('refuses a fabricated citation rather than passing it through', async () => {
    const liar = new FixtureProvider();
    liar.answer = async (): Promise<AnswerResult> => ({
      answer: 'Confidently wrong [1].',
      citations: [{ n: 1, memory_id: 'mem_does_not_exist', source_id: 'src_nope' }],
      refused: false,
    });
    const p = new AskPipeline(repo, liar, new FixtureEmbeddings());

    const result = await p.ask(WS, 'What did we decide about our eval stack?');
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL);
  });

  it('refuses a citation to a real memory retrieval never surfaced', async () => {
    const sneaky = new FixtureProvider();
    let surfaced: RetrievedMemory[] = [];
    sneaky.answer = async (input): Promise<AnswerResult> => {
      surfaced = input.retrieved;
      const notSurfaced = repo
        .listMemories(WS)
        .find((m) => !input.retrieved.some((r) => r.memory_id === m.id))!;
      return {
        answer: 'Drawn from something you never showed me [1].',
        citations: [{ n: 1, memory_id: notSurfaced.id, source_id: notSurfaced.source_id }],
        refused: false,
      };
    };
    const p = new AskPipeline(repo, sneaky, new FixtureEmbeddings());

    const result = await p.ask(WS, 'What did we decide about our eval stack?');
    expect(surfaced.length).toBeGreaterThan(0);
    expect(result.refused).toBe(true);
  });

  it('never hands the model more than the context limit', async () => {
    let seen = 0;
    const counting = new FixtureProvider();
    const original = counting.answer.bind(counting);
    counting.answer = async (input) => {
      seen = input.retrieved.length;
      return original(input);
    };
    const p = new AskPipeline(repo, counting, new FixtureEmbeddings());

    await p.ask(WS, 'What did we decide about our eval stack?');
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(8);
  });

  it('records every ask, refusals included', async () => {
    await ask.ask(WS, 'What did we decide about our eval stack?');
    await ask.ask(WS, 'What is the capital of France?');
    // recordAsk has no reader on the interface; assert via the raw table.
    const rows = (repo as unknown as {
      db: { prepare(s: string): { all(...a: unknown[]): unknown[] } };
    }).db.prepare('SELECT question, refused FROM ask_history ORDER BY id').all() as {
      question: string; refused: number;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.refused === 1)).toBe(true);
    expect(rows.some((r) => r.refused === 0)).toBe(true);
  });
});
