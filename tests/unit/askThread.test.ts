import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../../src/store/uiStore';

/**
 * The conversation thread: answered questions extend it, refusals and
 * dismissals do not, and it dies with the answer surface.
 */

const answered = (question: string, answer: string) => ({
  question,
  answer,
  citations: [],
  highlighted_node_ids: [],
  refused: false,
});

const refused = (question: string) => ({
  question,
  answer: "I don't have anything saved about that yet.",
  citations: [],
  highlighted_node_ids: [],
  refused: true,
});

beforeEach(() => {
  useUiStore.setState({ answer: null, askThread: [], highlightedIds: [] });
});

describe('askThread', () => {
  it('grows with each answered question, oldest first', () => {
    const s = useUiStore.getState();
    s.setAnswer(answered('first?', 'one'));
    useUiStore.getState().setAnswer(answered('second?', 'two'));

    expect(useUiStore.getState().askThread).toEqual([
      { question: 'first?', answer: 'one' },
      { question: 'second?', answer: 'two' },
    ]);
  });

  it('keeps only the last three turns', () => {
    for (const n of [1, 2, 3, 4]) {
      useUiStore.getState().setAnswer(answered(`q${n}?`, `a${n}`));
    }
    expect(useUiStore.getState().askThread.map((t) => t.question)).toEqual(['q2?', 'q3?', 'q4?']);
  });

  it('a refusal is not a turn — following up on nothing is nothing', () => {
    useUiStore.getState().setAnswer(answered('first?', 'one'));
    useUiStore.getState().setAnswer(refused('gibberish?'));
    expect(useUiStore.getState().askThread).toEqual([{ question: 'first?', answer: 'one' }]);
  });

  it('dies with the answer: setAnswer(null), escape, and clearAskThread all end it', () => {
    useUiStore.getState().setAnswer(answered('first?', 'one'));
    useUiStore.getState().setAnswer(null);
    expect(useUiStore.getState().askThread).toEqual([]);

    useUiStore.getState().setAnswer(answered('second?', 'two'));
    useUiStore.getState().escape(); // clears highlight + answer + thread
    expect(useUiStore.getState().askThread).toEqual([]);
    expect(useUiStore.getState().answer).toBeNull();

    useUiStore.getState().setAnswer(answered('third?', 'three'));
    useUiStore.getState().clearAskThread();
    expect(useUiStore.getState().askThread).toEqual([]);
    // Starting fresh keeps the answer on screen — only the thread ends.
    expect(useUiStore.getState().answer).not.toBeNull();
  });
});
