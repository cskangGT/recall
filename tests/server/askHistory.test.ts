import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { AskPipeline, REFUSAL } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import type { AiProvider, AskTurn, AnswerResult } from '../../server/ai/provider';
import { buildAnswerPrompt } from '../../server/ai/prompts';

/**
 * Follow-ups: the conversation rides along so "which tool won?" has a
 * referent. Two guarantees under test — history reaches retrieval (the query
 * text) and generation (the provider input) — and one non-guarantee: history
 * never lowers the bar. A follow-up with no evidence still refuses.
 */

const WS = 'ws_demo';
const EVAL_QUESTION = 'What did we decide about our eval stack?';
let repo: SqliteRepository;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
});

afterEach(() => repo.close());

describe('AskPipeline with history', () => {
  it('a fresh question still answers and a nonsense one still refuses', async () => {
    const pipeline = new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings());

    const fresh = await pipeline.ask(WS, EVAL_QUESTION);
    expect(fresh.refused).toBe(false);

    const nonsense = await pipeline.ask(WS, 'What is the capital of France?', [
      { question: EVAL_QUESTION, answer: 'x' },
    ]);
    expect(nonsense.refused).toBe(true);
    expect(nonsense.answer).toBe(REFUSAL);
  });

  it('a follow-up that names nothing retrieves through the previous question', async () => {
    const pipeline = new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings());

    // Alone, this has no keywords and a hash-vector embedding: refusal.
    const alone = await pipeline.ask(WS, 'And which tool won?');
    expect(alone.refused).toBe(true);

    // With the conversation, retrieval embeds the previous question alongside
    // it and the fixture resolves the referent the way a real model would.
    const followUp = await pipeline.ask(WS, 'And which tool won?', [
      { question: EVAL_QUESTION, answer: 'Braintrust is the current front-runner.' },
    ]);
    expect(followUp.refused).toBe(false);
    expect(followUp.citations.length).toBeGreaterThan(0);
  });

  it('hands the provider the conversation, capped upstream by the route', async () => {
    let seen: AskTurn[] | undefined;
    const fixture = new FixtureProvider();
    const spy: AiProvider = {
      name: 'spy',
      normalize: (i) => fixture.normalize(i),
      extract: () => fixture.extract(),
      nameClusters: (i) => fixture.nameClusters(i),
      answer: (input: { question: string; retrieved: never[]; history?: AskTurn[] }): Promise<AnswerResult> => {
        seen = input.history;
        return fixture.answer(input);
      },
    };
    const pipeline = new AskPipeline(repo, spy, new FixtureEmbeddings());

    const history = [{ question: EVAL_QUESTION, answer: 'Braintrust.' }];
    await pipeline.ask(WS, 'And which tool won?', history);
    expect(seen).toEqual(history);
  });
});

describe('buildAnswerPrompt with history', () => {
  const retrieved = [
    {
      memory_id: 'mem_1',
      source_id: 'src_1',
      text: 'Decided to drop LangChain.',
      category_name: 'AI Tooling',
      source_title: 'Note',
      source_type: 'text' as const,
    },
  ];

  it('includes the conversation as context, marked as never citable', () => {
    const prompt = buildAnswerPrompt({
      question: 'Which tool won?',
      retrieved,
      history: [{ question: EVAL_QUESTION, answer: 'Braintrust is the front-runner.' }],
    });
    expect(prompt).toContain('Earlier in this conversation');
    expect(prompt).toContain(`Q: ${EVAL_QUESTION}`);
    expect(prompt).toContain('never a source to cite');
    // The question and the memories still bracket it in the right order.
    expect(prompt.indexOf('Earlier in this conversation')).toBeLessThan(
      prompt.indexOf('Question: Which tool won?'),
    );
  });

  it('adds nothing when there is no history — the fresh prompt is unchanged', () => {
    const prompt = buildAnswerPrompt({ question: 'Which tool won?', retrieved });
    expect(prompt).not.toContain('Earlier in this conversation');
  });
});
