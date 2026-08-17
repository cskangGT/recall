import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { answerSoFar } from '../../server/ai/prompts';

/**
 * Ask, streamed: delta frames of new answer text, then exactly one done frame
 * carrying the same AskResult the plain ask would return. The generator is a
 * value — these tests iterate it the way any route is asserted.
 */

const WS = 'ws_demo';
const QUESTION = 'What did we decide about our eval stack?';
let repo: SqliteRepository;
let ask: AskPipeline;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  ask = new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings());
});

afterEach(() => repo.close());

const drain = async (
  gen: AsyncIterable<{ event: string; data: unknown }>,
): Promise<{ deltas: string[]; done: unknown[] }> => {
  const deltas: string[] = [];
  const done: unknown[] = [];
  for await (const frame of gen) {
    if (frame.event === 'delta') deltas.push((frame.data as { text: string }).text);
    else if (frame.event === 'done') done.push(frame.data);
  }
  return { deltas, done };
};

describe('askStream', () => {
  it('without a streaming provider, still ends in the same result ask returns', async () => {
    const plain = await ask.ask(WS, QUESTION);
    repo.close();
    repo = new SqliteRepository(':memory:');
    repo.migrate();
    importSeed(repo, WS);
    ask = new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings());

    const { deltas, done } = await drain(ask.askStream(WS, QUESTION));
    expect(deltas).toEqual([]); // the fixture cannot stream — no fake typing
    expect(done).toHaveLength(1);
    expect((done[0] as { answer: string }).answer).toBe(plain.answer);
  });

  it('streams deltas from a provider that can, then the validated result', async () => {
    const provider = new FixtureProvider();
    const streaming = Object.assign(provider, {
      answerStream: async (
        input: Parameters<FixtureProvider['answer']>[0],
        onDelta: (text: string) => void,
      ) => {
        const result = await provider.answer(input);
        // Word by word, the way tokens arrive.
        for (const word of result.answer.split(/(?<= )/)) onDelta(word);
        return result;
      },
    });
    ask = new AskPipeline(repo, streaming, new FixtureEmbeddings());

    const { deltas, done } = await drain(ask.askStream(WS, QUESTION));
    expect(deltas.length).toBeGreaterThan(1);
    const final = done[0] as { answer: string; refused: boolean };
    expect(deltas.join('')).toBe(final.answer);
    expect(final.refused).toBe(false);
  });

  it('a question with nothing behind it refuses without streaming a word', async () => {
    const { deltas, done } = await drain(ask.askStream(WS, 'What is the capital of France?'));
    expect(deltas).toEqual([]);
    expect((done[0] as { refused: boolean }).refused).toBe(true);
  });

  it('the route carries the generator; the adapter is the only one who writes', async () => {
    const deps: Deps = {
      repo,
      ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
      ask,
      reset: () => {},
    };
    const res = await handle(
      { method: 'POST', path: `/api/workspaces/${WS}/ask/stream`, body: { question: QUESTION } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.events).toBeDefined();
    const { done } = await drain(res.events!);
    expect(done).toHaveLength(1);

    const missing = await handle(
      { method: 'POST', path: `/api/workspaces/${WS}/ask/stream`, body: {} },
      deps,
    );
    expect(missing.status).toBe(400);
  });
});

describe('answerSoFar — the answer field of a partially-streamed JSON body', () => {
  it('reads a complete field', () => {
    expect(answerSoFar('{"answer":"It works.","citations":[1]}')).toBe('It works.');
  });

  it('reads as far as the stream got', () => {
    expect(answerSoFar('{"answer":"The decision was')).toBe('The decision was');
  });

  it('resolves escapes and holds back half of one', () => {
    expect(answerSoFar('{"answer":"a\\nb \\"quoted\\"')).toBe('a\nb "quoted"');
    expect(answerSoFar('{"answer":"line\\')).toBe('line');
    expect(answerSoFar('{"answer":"ko \\uae3')).toBe('ko ');
    expect(answerSoFar('{"answer":"\\uae30\\uc5b5"')).toBe('기억');
  });

  it('returns nothing before the field opens', () => {
    expect(answerSoFar('')).toBe('');
    expect(answerSoFar('{"ans')).toBe('');
    expect(answerSoFar('{"answer":')).toBe('');
  });
});
