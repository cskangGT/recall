import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { answerQuestion } from './scriptedAsk';
import { askedCategories } from '../arc/interest';
import { useInterestStore } from '../store/interestStore';

/**
 * Asking, wherever the question came from.
 *
 * The composer, the ask bar, and the reveal's suggested questions all do the
 * same five things — answer against the corpus (server or script), publish the
 * answer, record interest, light the citations, clear the selection. Three
 * copies of that had already drifted once (only one of them sent the
 * conversation), which is exactly the bug this file exists to make impossible.
 */
export async function runAsk(question: string): Promise<boolean> {
  const q = question.trim();
  const payload = useWorkspaceStore.getState().payload;
  if (!q || !payload) return false;
  // One question at a time. A second click while the first is out is almost
  // always "is anything happening?" — the shared `asking` flag answers that on
  // every surface instead, and re-entry here would race two answers for one
  // answer slot.
  if (useUiStore.getState().asking) return false;

  useUiStore.getState().setAsking(true);
  try {
    // Snapshotted before the answer lands — the model must see the conversation
    // as it was when the question was asked.
    const history = useUiStore.getState().askThread;
    const source = useWorkspaceStore.getState().source;
    const result = source.ask
      ? await source.ask(q, history).catch(() => answerQuestion(q, payload, history))
      : answerQuestion(q, payload, history);

    useUiStore.getState().setAnswer({ ...result, question: q });
    for (const categoryId of askedCategories(payload, result.citations.map((c) => c.memory_id))) {
      useInterestStore.getState().record(categoryId, 'asked');
    }
    useUiStore.getState().setHighlight(result.highlighted_node_ids);
    useUiStore.getState().select(null);
    return true;
  } finally {
    useUiStore.getState().setAsking(false);
  }
}
