import { describe, it, expect } from 'vitest';
import { askThroughSource, askFailureMessage } from '../../src/ask/askThroughSource';
import { SeedDataSource, type DataSource } from '../../src/data/dataSource';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import type { GraphPayload } from '../../src/core/types';

/**
 * The rule: a failed ask never produces an answer.
 *
 * Both surfaces used to do `.catch(() => answerQuestion(question, payload))`,
 * which substituted the demo's fictional corpus whenever the real one could not
 * be reached — silently, and with citations to memories the user has never
 * saved. These are the tests that keep that from coming back.
 */

const payload = validateSeed(workspaceJson) as GraphPayload;

/** A question that `seed/answers.json` has a scripted answer for. */
const SCRIPTED = 'why did we drop langchain?';

const failing = (err: unknown): DataSource => ({
  mode: 'api',
  load: async () => payload,
  ask: async () => {
    throw err;
  },
});

describe('a live source that fails', () => {
  it('reports the failure instead of answering from the fixture', async () => {
    const outcome = await askThroughSource(failing(new TypeError('Failed to fetch')), SCRIPTED, payload);
    expect(outcome.kind).toBe('unreachable');
  });

  it('never returns scripted content, even for a question the fixture can answer', async () => {
    // The heart of it. This question has a hand-written demo answer with
    // citations; before the fix a server outage produced that answer verbatim,
    // presented as the user's own memory.
    const outcome = await askThroughSource(failing(new TypeError('Failed to fetch')), SCRIPTED, payload);
    expect(outcome).not.toHaveProperty('answer');
  });

  it('does not dress a failure up as a refusal either', async () => {
    // The other half: a question the fixture cannot match returned "I don't
    // have anything saved about that yet" — a statement about a corpus that was
    // never consulted, which is just as wrong and harder to notice.
    const outcome = await askThroughSource(
      failing(new TypeError('Failed to fetch')),
      'what did I read about sourdough hydration?',
      payload,
    );
    expect(outcome.kind).toBe('unreachable');
  });

  it('names the likely cause when the server is simply not running', async () => {
    for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch', 'Load failed']) {
      expect(askFailureMessage(new TypeError(message))).toMatch(/Is the server running\?/);
    }
  });

  it('passes a server’s own error through, rather than guessing', async () => {
    // A 500 from a live server is a different problem from an absent one, and
    // "is the server running?" would send you looking in the wrong place.
    expect(askFailureMessage(new Error('rate limited'))).toContain('rate limited');
    expect(askFailureMessage(new Error('rate limited'))).not.toMatch(/Is the server running\?/);
  });

  it('says nothing was answered, so a silent failure cannot read as an empty one', async () => {
    const outcome = await askThroughSource(failing(new TypeError('Failed to fetch')), SCRIPTED, payload);
    expect(outcome.kind === 'unreachable' && outcome.message).toMatch(/nothing was answered/i);
  });
});

describe('a live source that works', () => {
  it('returns exactly what the server said', async () => {
    const answer = {
      answer: 'You dropped it because the abstractions got in the way [1].',
      citations: [{ n: 1, memory_id: 'mem_1', source_id: 'src_1' }],
      highlighted_node_ids: ['mem_1'],
      refused: false,
    };
    const source: DataSource = { mode: 'api', load: async () => payload, ask: async () => answer };
    const outcome = await askThroughSource(source, SCRIPTED, payload);
    expect(outcome).toEqual({ kind: 'answered', answer });
  });
});

describe('seed mode', () => {
  it('still answers from the fixture, because there the fixture is the corpus', async () => {
    // Not a fallback: `SeedDataSource` has no `ask`, there is no server to fail,
    // and the demo corpus is the only corpus. The scripted answer is honest here.
    const outcome = await askThroughSource(SeedDataSource, SCRIPTED, payload);
    expect(outcome.kind).toBe('answered');
    expect(outcome.kind === 'answered' && outcome.answer.refused).toBe(false);
    expect(outcome.kind === 'answered' && outcome.answer.citations.length).toBeGreaterThan(0);
  });

  it('still refuses in seed mode when nothing matches', async () => {
    const outcome = await askThroughSource(SeedDataSource, 'what is the capital of France?', payload);
    expect(outcome.kind === 'answered' && outcome.answer.refused).toBe(true);
  });
});
