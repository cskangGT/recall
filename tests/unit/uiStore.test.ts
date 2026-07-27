import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, ANSWER_FOLDER_ID } from '../../src/store/uiStore';
import { REFUSAL } from '../../src/ask/scriptedAsk';

const reset = () =>
  useUiStore.setState({
    captureOpen: false,
    askOpen: false,
    highlightedIds: [],
    answer: null,
    selectedId: null,
  });

const answered = {
  question: 'What did we decide about our eval stack?',
  answer: 'You decided to drop LangChain [1].',
  citations: [{ n: 1, memory_id: 'mem_11', source_id: 'src_langchain_thread' }],
  highlighted_node_ids: ['mem_11', 'cat_ai_tooling'],
  refused: false,
};

const refused = {
  question: 'What is the capital of France?',
  answer: REFUSAL,
  citations: [],
  highlighted_node_ids: [],
  refused: true,
};

describe('uiStore.escape — spec 6.1 order', () => {
  beforeEach(reset);

  it('closes an open modal first, leaving everything else alone', () => {
    useUiStore.setState({ captureOpen: true, selectedId: 'cat_1', answer: answered });
    useUiStore.getState().escape();
    const s = useUiStore.getState();
    expect(s.captureOpen).toBe(false);
    expect(s.answer).not.toBeNull();
    expect(s.selectedId).toBe('cat_1');
  });

  it('clears the highlight and the answer together', () => {
    useUiStore.setState({
      answer: answered,
      highlightedIds: answered.highlighted_node_ids,
      selectedId: 'cat_1',
    });
    useUiStore.getState().escape();
    const s = useUiStore.getState();
    expect(s.highlightedIds).toEqual([]);
    expect(s.answer).toBeNull();
    // Selection survives — it is the next Escape's job.
    expect(s.selectedId).toBe('cat_1');
  });

  it('dismisses a refused answer, which highlights nothing', () => {
    useUiStore.setState({ answer: refused, highlightedIds: [] });
    useUiStore.getState().escape();
    expect(useUiStore.getState().answer).toBeNull();
  });

  it('clears the selection once nothing else is open', () => {
    useUiStore.setState({ selectedId: 'mem_11' });
    useUiStore.getState().escape();
    expect(useUiStore.getState().selectedId).toBeNull();
  });

  it('takes three presses to go from answered-and-selected to clean', () => {
    useUiStore.setState({
      askOpen: true,
      answer: answered,
      highlightedIds: answered.highlighted_node_ids,
      selectedId: 'cat_1',
    });
    const { escape } = useUiStore.getState();
    escape();
    expect(useUiStore.getState().askOpen).toBe(false);
    escape();
    expect(useUiStore.getState().answer).toBeNull();
    escape();
    expect(useUiStore.getState().selectedId).toBeNull();
  });
});

describe('uiStore — the answer folder', () => {
  beforeEach(() =>
    useUiStore.setState({ view: 'browse', answer: null, openCategoryId: 'cat_fundraising' }),
  );

  it('opens its own folder when an answer lands while browsing', () => {
    useUiStore.getState().setAnswer(answered);
    expect(useUiStore.getState().openCategoryId).toBe(ANSWER_FOLDER_ID);
  });

  it('leaves the open folder alone on the map — there is no folder pane there', () => {
    useUiStore.setState({ view: 'map' });
    useUiStore.getState().setAnswer(answered);
    expect(useUiStore.getState().openCategoryId).toBe('cat_fundraising');
  });

  it('cannot outlive its answer — clearing the answer closes the folder', () => {
    useUiStore.getState().setAnswer(answered);
    useUiStore.getState().setAnswer(null);
    expect(useUiStore.getState().openCategoryId).toBeNull();
  });

  it('closes on Escape along with the answer and the highlight', () => {
    useUiStore.getState().setAnswer(answered);
    useUiStore.setState({ highlightedIds: answered.highlighted_node_ids });
    useUiStore.getState().escape();
    const s = useUiStore.getState();
    expect(s.answer).toBeNull();
    expect(s.openCategoryId).toBeNull();
  });

  it('a refusal still opens the folder, so the refusal is readable there too', () => {
    useUiStore.getState().setAnswer(refused);
    expect(useUiStore.getState().openCategoryId).toBe(ANSWER_FOLDER_ID);
  });
});

describe('uiStore.reorgHistory', () => {
  beforeEach(() => useUiStore.setState({ reorgHistory: [] }));

  it('keeps at most 10 events, newest first', () => {
    const { pushReorg } = useUiStore.getState();
    for (let i = 0; i < 12; i++) {
      pushReorg({
        id: `reorg_${i}`,
        operation: 'split',
        affected_category_ids: [],
        created_category_ids: [],
        banner_text: `event ${i}`,
        before_state: null as never,
        created_at: '2026-07-25T00:00:00Z',
      });
    }
    const history = useUiStore.getState().reorgHistory;
    expect(history).toHaveLength(10);
    expect(history[0]!.id).toBe('reorg_11');
  });

  it('pops the newest event and returns null when empty', () => {
    const { pushReorg, popReorg } = useUiStore.getState();
    pushReorg({
      id: 'reorg_a',
      operation: 'split',
      affected_category_ids: [],
      created_category_ids: [],
      banner_text: 'a',
      before_state: null as never,
      created_at: '2026-07-25T00:00:00Z',
    });
    expect(popReorg()!.id).toBe('reorg_a');
    expect(popReorg()).toBeNull();
  });
});
