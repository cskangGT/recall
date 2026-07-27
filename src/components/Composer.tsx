import { useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { answerQuestion } from '../ask/scriptedAsk';

/**
 * The one place you talk to Recall.
 *
 * It opens the app on the welcome screen and then stays, pinned to the bottom of
 * the browsing screen. That persistence is the point: the product is a
 * conversation with your own memory, and a chat box that disappears the moment
 * you start looking around says the opposite. Same component, same code path as
 * the Ask bar — whatever you type is answered against the real corpus and lands
 * in the answer folder on the arc.
 */
export function Composer({
  variant,
  onSubmitted,
}: {
  variant: 'welcome' | 'docked';
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
    <div className={`composer composer--${variant}`} data-testid={`composer-${variant}`}>
      <input
        ref={ref}
        data-testid={variant === 'welcome' ? 'welcome-input' : 'composer-input'}
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
        data-testid={variant === 'welcome' ? 'welcome-send' : 'composer-send'}
        disabled={thinking}
        onClick={() => void submit()}
      >
        {thinking ? 'Thinking…' : text.trim() ? 'Ask' : variant === 'welcome' ? 'Look around' : '↵'}
      </button>
    </div>
  );
}
