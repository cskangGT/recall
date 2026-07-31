import { useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { answerQuestion } from '../ask/scriptedAsk';

/**
 * The one place you talk to Recall.
 *
 * Docked at the bottom of the one screen the app has, from the first frame
 * onward. It used to be centred on a separate welcome screen and then move down
 * when you entered the browser; there is no entering any more, so it never
 * moves. Same component, same code path as the Ask bar — whatever you type is
 * answered against the real corpus and lands in the answer folder on the arc.
 *
 * `firstRun` changes two words and nothing else: the empty-state button offers
 * to look around rather than showing a bare return glyph, because on the first
 * frame there is nothing on the arc yet and pressing it is what puts it there.
 */
export function Composer({
  firstRun = false,
  onSubmitted,
}: {
  firstRun?: boolean;
  onSubmitted?: () => void;
}) {
  const setAnswer = useUiStore((s) => s.setAnswer);
  const setHighlight = useUiStore((s) => s.setHighlight);
  const select = useUiStore((s) => s.select);
  const payload = useWorkspaceStore((s) => s.payload);

  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const question = text.trim();
    if (!question || !payload) {
      onSubmitted?.();
      return;
    }
    setThinking(true);

    const source = useWorkspaceStore.getState().source;
    const result = source.ask
      ? await source.ask(question).catch(() => answerQuestion(question, payload))
      : answerQuestion(question, payload);

    setAnswer({ ...result, question });
    setHighlight(result.highlighted_node_ids);
    select(null);
    setText('');
    setThinking(false);
    onSubmitted?.();
  };

  return (
    <div className="composer composer--docked" data-testid="composer">
      <input
        ref={ref}
        data-testid={firstRun ? 'welcome-input' : 'composer-input'}
        placeholder="Ask about anything you've saved…"
        value={text}
        disabled={thinking}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          void submit();
        }}
      />
      <button
        className="composer__send"
        data-testid={firstRun ? 'welcome-send' : 'composer-send'}
        disabled={thinking}
        onClick={() => void submit()}
      >
        {thinking ? 'Thinking…' : text.trim() ? 'Ask' : firstRun ? 'Look around' : '↵'}
      </button>
    </div>
  );
}
