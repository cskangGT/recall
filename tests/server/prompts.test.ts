import { describe, it, expect } from 'vitest';
import {
  MAX_MEMORIES, buildAnswerPrompt, buildNamePrompt, coerceExtract, coerceNormalize,
  nameByFallback, resolveAnswer, resolveNames,
} from '../../server/ai/prompts.ts';
import { parseVoyageResponse } from '../../server/ai/voyage.ts';
import {
  parseOpenAiResponse, parseChatJson, OpenAiEmbeddings, DEFAULT_DIMENSIONS,
} from '../../server/ai/openai.ts';
import { selectAi } from '../../server/ai/select.ts';
import type { NameCluster, RetrievedMemory } from '../../server/ai/provider.ts';

/**
 * The model calls, minus the model.
 *
 * These cover the half of the real provider that can fail without a network:
 * malformed output, hallucinated citations, illegal names. Every case here is
 * something a live model will eventually do, and the point of the split is that
 * none of them need an API key to be caught.
 */

const retrieved: RetrievedMemory[] = [
  {
    memory_id: 'mem_1', source_id: 'src_1', text: 'Dropped LangChain',
    category_name: 'AI Tooling', source_title: 'Thread', source_type: 'link',
  },
  {
    memory_id: 'mem_2', source_id: 'src_2', text: 'Tracing misses correctness',
    category_name: 'AI Tooling', source_title: 'Eval notes', source_type: 'text',
  },
];

describe('coerceExtract', () => {
  it('fills in what a model left out rather than throwing', () => {
    const result = coerceExtract({ memories: [{ text: 'A decision was made' }] });
    expect(result.memories[0]).toMatchObject({ kind: 'fact', confidence: 0.5, entities: [] });
    expect(result.suggested_title).toBe('Untitled capture');
  });

  it('treats an empty extraction as valid — plenty of things are not worth keeping', () => {
    expect(coerceExtract({ memories: [], summary: 'nothing here' }).memories).toEqual([]);
    expect(coerceExtract(null).memories).toEqual([]);
  });

  it('drops blank memories and caps the count at the spec limit', () => {
    const raw = {
      memories: [
        { text: '   ' },
        ...Array.from({ length: 14 }, (_, i) => ({ text: `memory ${i}` })),
      ],
    };
    expect(coerceExtract(raw).memories).toHaveLength(MAX_MEMORIES);
  });

  it('replaces enum values it does not recognise instead of persisting them', () => {
    const result = coerceExtract({
      memories: [{ text: 'x', kind: 'vibe', confidence: 42, entities: [{ name: 'Braintrust', kind: 'startup' }] }],
    });
    expect(result.memories[0]!.kind).toBe('fact');
    expect(result.memories[0]!.confidence).toBe(0.5);
    expect(result.memories[0]!.entities[0]!.kind).toBe('concept');
  });
});

describe('coerceNormalize', () => {
  it('cannot report meaningful text when nothing was read', () => {
    const result = coerceNormalize({
      ocr_text: '', scene_description: '', detected_context: 'slack', has_meaningful_text: true,
    });
    expect(result.has_meaningful_text).toBe(false);
  });

  it('falls back to "other" for an unknown context', () => {
    expect(coerceNormalize({ detected_context: 'tiktok' }).detected_context).toBe('other');
  });
});

describe('resolveNames — spec 10.4', () => {
  const clusters: NameCluster[] = [
    { cluster_id: 'a', sample_texts: ['agent frameworks are heavy'] },
    { cluster_id: 'b', sample_texts: ['eval suites catch regressions'] },
  ];

  it('accepts good names and reports why the others failed', () => {
    const { accepted, rejected } = resolveNames(
      { clusters: [
        { cluster_id: 'a', name: 'Agent Frameworks', rationale: 'r' },
        { cluster_id: 'b', name: 'Miscellaneous', rationale: 'r' },
      ] },
      clusters,
      [],
    );
    expect(accepted.map((a) => a.name)).toEqual(['Agent Frameworks']);
    expect(rejected['b']).toContain('generic');
  });

  it('will not let two clusters from one split take the same name', () => {
    const { accepted, rejected } = resolveNames(
      { clusters: [
        { cluster_id: 'a', name: 'Evals', rationale: 'r' },
        { cluster_id: 'b', name: 'Evals', rationale: 'r' },
      ] },
      clusters,
      [],
    );
    expect(accepted).toHaveLength(1);
    expect(rejected['b']).toBeDefined();
  });

  it('rejects a name that collides with an existing sibling', () => {
    const { rejected } = resolveNames(
      { clusters: [{ cluster_id: 'a', name: 'Hiring', rationale: 'r' }] },
      [clusters[0]!],
      ['Hiring'],
    );
    expect(rejected['a']).toContain('duplicates');
  });

  it('reports a cluster the model simply ignored', () => {
    const { rejected } = resolveNames({ clusters: [] }, clusters, []);
    expect(Object.keys(rejected)).toEqual(['a', 'b']);
  });

  it('survives junk where the clusters array should be', () => {
    expect(resolveNames('not json', clusters, []).accepted).toEqual([]);
    expect(resolveNames(null, clusters, []).accepted).toEqual([]);
  });

  it('always produces a name eventually — naming cannot veto a decided change', () => {
    const named = nameByFallback(clusters[1]!, clusters);
    expect(named.cluster_id).toBe('b');
    expect(named.name.length).toBeGreaterThan(0);
  });

  it('tells the model why it was rejected when retrying', () => {
    const prompt = buildNamePrompt({
      operation: 'split',
      clusters: [clusters[0]!],
      forbiddenNames: [],
      retryReasons: { a: 'generic container name' },
    });
    expect(prompt).toContain('previous name was rejected: generic container name');
  });
});

describe('resolveAnswer', () => {
  it('maps [n] back to the memory that was actually retrieved', () => {
    const result = resolveAnswer({ answer: 'You dropped it [1].', citations: [1], refused: false }, retrieved);
    expect(result.refused).toBe(false);
    expect(result.citations).toEqual([{ n: 1, memory_id: 'mem_1', source_id: 'src_1' }]);
  });

  it('drops a citation number that was never on offer', () => {
    const result = resolveAnswer({ answer: 'x [9]', citations: [9], refused: false }, retrieved);
    // Nothing resolved, so there is nothing behind the sentence.
    expect(result.refused).toBe(true);
  });

  it('treats an answer with no citations as a refusal that forgot to say so', () => {
    expect(resolveAnswer({ answer: 'Probably yes.', citations: [], refused: false }, retrieved).refused)
      .toBe(true);
  });

  it('honours an explicit refusal', () => {
    expect(resolveAnswer({ answer: '', citations: [], refused: true }, retrieved).refused).toBe(true);
  });

  it('de-duplicates a repeated citation', () => {
    const result = resolveAnswer({ answer: 'a [1] b [1]', citations: [1, 1], refused: false }, retrieved);
    expect(result.citations).toHaveLength(1);
  });

  it('numbers the memories it shows the model, so citing is by position', () => {
    const prompt = buildAnswerPrompt({ question: 'q', retrieved });
    expect(prompt).toContain('[1] Dropped LangChain');
    expect(prompt).toContain('[2] Tracing misses correctness');
  });
});

describe('parseVoyageResponse', () => {
  const ok = (n: number, dim = 2) => ({
    data: Array.from({ length: n }, (_, i) => ({
      index: i,
      embedding: Array.from({ length: dim }, () => 0.5),
    })),
  });

  it('returns one vector per input', () => {
    expect(parseVoyageResponse(ok(3), 3, 2)).toHaveLength(3);
  });

  it('restores the input order rather than trusting arrival order', () => {
    const body = {
      data: [
        { index: 1, embedding: [1, 1] },
        { index: 0, embedding: [0, 0] },
      ],
    };
    expect(parseVoyageResponse(body, 2, 2)[0]).toEqual([0, 0]);
  });

  it('refuses a dimensionality that would put queries in a different space', () => {
    expect(() => parseVoyageResponse(ok(1, 8), 1, 1024)).toThrow(/different spaces/);
  });

  it('refuses a short response rather than silently misaligning memories', () => {
    expect(() => parseVoyageResponse(ok(2), 3, 2)).toThrow(/2 embeddings for 3/);
  });

  it('rejects a malformed body', () => {
    expect(() => parseVoyageResponse({}, 1, 2)).toThrow(/no data array/);
  });
});

describe('selectAi', () => {
  it('uses the fixture when no keys are present', () => {
    const s = selectAi({} as NodeJS.ProcessEnv);
    expect(s.live).toBe(false);
    expect(s.ai.name).toBe('fixture');
  });

  it('will not run half-live — one key is not enough', () => {
    const s = selectAi({ ANTHROPIC_API_KEY: 'sk-x' } as NodeJS.ProcessEnv);
    expect(s.live).toBe(false);
    expect(s.reason).toContain('VOYAGE_API_KEY or OPENAI_API_KEY');
  });

  it('says so when RECALL_AI=live was asked for but cannot be honoured', () => {
    const s = selectAi({ RECALL_AI: 'live', VOYAGE_API_KEY: 'v' } as NodeJS.ProcessEnv);
    expect(s.reason).toContain('falling back to fixture');
  });

  it('lets the demo force the fixture even with keys present', () => {
    const s = selectAi({
      RECALL_AI: 'fixture', ANTHROPIC_API_KEY: 'sk-x', VOYAGE_API_KEY: 'v',
    } as NodeJS.ProcessEnv);
    expect(s.live).toBe(false);
  });

  it('goes live when both keys are present', () => {
    const s = selectAi({ ANTHROPIC_API_KEY: 'sk-x', VOYAGE_API_KEY: 'v' } as NodeJS.ProcessEnv);
    expect(s.live).toBe(true);
    expect(s.ai.name).toBe('anthropic');
    expect(s.embeddings.dimensions).toBe(1024);
  });

  /**
   * The bug this fixes. Voyage was the only embedder for long enough that its
   * key became load-bearing for the whole stack: an Anthropic key and an OpenAI
   * key present, Voyage's missing, and everything ran on fixtures while
   * reporting "VOYAGE_API_KEY not set" — true, and useless.
   */
  it('accepts OpenAI as the embedder when Voyage has no key', () => {
    const s = selectAi({ ANTHROPIC_API_KEY: 'sk-x', OPENAI_API_KEY: 'sk-o' } as NodeJS.ProcessEnv);
    expect(s.live).toBe(true);
    expect(s.reason).toContain('OPENAI_API_KEY');
    // Same width either way, so a workspace survives a change of supplier.
    expect(s.embeddings.dimensions).toBe(1024);
  });

  it('prefers Voyage for the embedding half when both can do it', () => {
    const s = selectAi({
      ANTHROPIC_API_KEY: 'sk-x', VOYAGE_API_KEY: 'v', OPENAI_API_KEY: 'sk-o',
    } as NodeJS.ProcessEnv);
    // Voyage is the one whose document/query asymmetry retrieval was written for.
    expect(s.reason).toContain('VOYAGE_API_KEY to embed');
  });

  /**
   * The change this pair of tests exists to record. Extraction moved to OpenAI
   * because a live Anthropic key with no credit answers every request with
   * "Your credit balance is too low" — indistinguishable, from the outside,
   * from being broken. One OpenAI key now does both jobs.
   */
  it('runs on an OpenAI key alone — it can both read and embed', () => {
    const s = selectAi({ OPENAI_API_KEY: 'sk-o' } as NodeJS.ProcessEnv);
    expect(s.live).toBe(true);
    expect(s.ai.name).toBe('openai');
    expect(s.reason).toBe('OPENAI_API_KEY to read, OPENAI_API_KEY to embed');
  });

  it('prefers OpenAI to read when both readers are available', () => {
    const s = selectAi({ ANTHROPIC_API_KEY: 'sk-x', OPENAI_API_KEY: 'sk-o' } as NodeJS.ProcessEnv);
    expect(s.ai.name).toBe('openai');
  });

  it('puts Anthropic back when asked for by name', () => {
    const s = selectAi({
      ANTHROPIC_API_KEY: 'sk-x', OPENAI_API_KEY: 'sk-o', RECALL_EXTRACTOR: 'anthropic',
    } as NodeJS.ProcessEnv);
    expect(s.ai.name).toBe('anthropic');
    expect(s.reason).toContain('ANTHROPIC_API_KEY to read');
  });

  it('still refuses to run with no reader at all', () => {
    const s = selectAi({ VOYAGE_API_KEY: 'v' } as NodeJS.ProcessEnv);
    expect(s.live).toBe(false);
    expect(s.reason).toContain('ANTHROPIC_API_KEY or OPENAI_API_KEY');
  });
});

describe('parseOpenAiResponse', () => {
  const ok = (n: number, dim = 2) => ({
    data: Array.from({ length: n }, (_, i) => ({
      index: i,
      embedding: Array.from({ length: dim }, () => i),
    })),
  });

  it('returns one vector per input', () => {
    expect(parseOpenAiResponse(ok(3), 3, 2)).toHaveLength(3);
  });

  /**
   * The guard that matters. OpenAI sends an explicit `index` and does not
   * promise arrival order; trusting the array as it comes embeds every memory
   * as its neighbour — a corruption nothing downstream can detect, because
   * every vector is still a perfectly valid vector.
   */
  it('sorts by index rather than trusting arrival order', () => {
    const body = {
      data: [
        { index: 1, embedding: [1, 1] },
        { index: 0, embedding: [0, 0] },
      ],
    };
    expect(parseOpenAiResponse(body, 2, 2)[0]).toEqual([0, 0]);
  });

  it('refuses a width it did not ask for', () => {
    expect(() => parseOpenAiResponse(ok(1, 8), 1, 1024)).toThrow(/different spaces/);
  });

  it('refuses a short response', () => {
    expect(() => parseOpenAiResponse(ok(2), 3, 2)).toThrow(/2 embeddings for 3/);
  });

  it('refuses a body with no data', () => {
    expect(() => parseOpenAiResponse({}, 1, 2)).toThrow(/no data array/);
  });
});

describe('OpenAiEmbeddings', () => {
  it('asks for the narrowed width, measured to be the one that keeps the split', () => {
    // 512 fails the harness (margin 0.0083 against a 0.01 floor); 1024 passes
    // at 0.0133. text-embedding-3-* are Matryoshka, so this is a request
    // parameter rather than a different model.
    expect(DEFAULT_DIMENSIONS).toBe(1024);

    let sent: unknown = null;
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: Array(1024).fill(0.1) }] }),
      };
    }) as unknown as typeof fetch;

    const provider = new OpenAiEmbeddings({ apiKey: 'sk-o', fetchImpl });
    return provider.embed(['hello'], 'document').then((out) => {
      expect(out[0]).toHaveLength(1024);
      expect(sent).toMatchObject({ model: 'text-embedding-3-small', dimensions: 1024 });
    });
  });

  it('says which key is missing rather than failing at the first request', () => {
    expect(() => new OpenAiEmbeddings({ apiKey: '' })).toThrow(/OPENAI_API_KEY/);
  });
});

/**
 * Two of these failures are specific to this API and both are silent.
 *
 * A refusal arrives as a `refusal` field with `content` null, which would parse
 * as "no memories" rather than as an error. And a reply truncated by the token
 * limit still comes back with a half-written JSON body — strict mode guarantees
 * the *shape* of a complete reply, not that the reply completed.
 */
describe('parseChatJson', () => {
  const reply = (content: string, extra: object = {}) => ({
    choices: [{ message: { content }, finish_reason: 'stop', ...extra }],
  });

  it('returns the parsed body', () => {
    expect(parseChatJson(reply('{"memories":[]}'))).toEqual({ memories: [] });
  });

  it('turns a refusal into an error rather than an empty result', () => {
    const body = { choices: [{ message: { content: null, refusal: 'I cannot help with that' } }] };
    expect(() => parseChatJson(body)).toThrow(/refused/);
  });

  it('catches a reply the token limit cut in half', () => {
    const body = { choices: [{ message: { content: '{"memories":[' }, finish_reason: 'length' }] };
    expect(() => parseChatJson(body)).toThrow(/truncated/);
  });

  it('refuses a body with no choices', () => {
    expect(() => parseChatJson({})).toThrow(/no choices/);
  });

  it('refuses unparseable content rather than returning it', () => {
    expect(() => parseChatJson(reply('not json'))).toThrow(/unparseable/);
  });
});
