import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { askThroughSource } from '../ask/askThroughSource';
import { askedCategories } from '../arc/interest';
import { useInterestStore } from '../store/interestStore';

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
 *
 * The add button is here rather than floating in a corner because a corner
 * circle is a thing you have to be taught and a clip in a chat box is not. The
 * placeholder does the other half: dropping a screenshot on the window has
 * always worked and nothing on screen said so, which is a discovery problem, not
 * a missing feature.
 */
export function Composer({
  firstRun = false,
  onSubmitted,
}: {
  firstRun?: boolean;
  onSubmitted?: () => void;
}) {
  const setAnswer = useUiStore((s) => s.setAnswer);
  const recordInterest = useInterestStore((s) => s.record);
  const setHighlight = useUiStore((s) => s.setHighlight);
  const select = useUiStore((s) => s.select);
  const toast = useUiStore((s) => s.toast);
  const payload = useWorkspaceStore((s) => s.payload);

  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const regainFocus = useRef(false);

  /*
   * Put the keyboard back once the input is enabled again.
   *
   * It has to be an effect rather than a call at the end of `submit`: React has
   * not committed `thinking = false` by then, so the element is still disabled
   * and `focus()` on a disabled input silently does nothing.
   */
  useEffect(() => {
    if (thinking || !regainFocus.current) return;
    regainFocus.current = false;
    input.current?.focus();
  }, [thinking]);

  const submit = async () => {
    const question = text.trim();
    if (!question || !payload) {
      onSubmitted?.();
      return;
    }
    /*
     * `disabled` blurs, so remember whether the keyboard was here.
     *
     * The input is disabled while an answer is in flight, and disabling a
     * focused element moves focus to the body. Asking a question therefore cost
     * you the keyboard: you had to click the box again before you could ask a
     * second one, and Escape — which is meant to hand the keyboard *back* —
     * reached App's window handler instead and threw away the answer you had
     * just asked for.
     *
     * Latent until `askThroughSource` made this path await in seed mode too.
     * Before that the whole submit ran in one synchronous batch and React never
     * committed the disabled state at all, so nothing ever blurred.
     */
    regainFocus.current = document.activeElement === input.current;
    setThinking(true);

    const source = useWorkspaceStore.getState().source;
    const outcome = await askThroughSource(source, question, payload);
    if (outcome.kind === 'unreachable') {
      // The question stays in the box. It was not answered, and retyping it
      // after a server hiccup is a small insult on top of a failure.
      toast(outcome.message);
      setThinking(false);
      return;
    }
    const result = outcome.answer;

    setAnswer({ ...result, question });
    /*
     * Asking is the strongest of the three signals the arc ranks by, and until
     * now it left no trace anywhere: the server writes `ask_history` and reads
     * it back nowhere, and the client never saw it at all. Recorded against the
     * top-level categories the answer actually drew on, so the arc reflects what
     * you were thinking about rather than what you happened to click.
     */
    for (const categoryId of askedCategories(payload, result.citations.map((c) => c.memory_id))) {
      recordInterest(categoryId, 'asked');
    }
    setHighlight(result.highlighted_node_ids);
    select(null);
    setText('');
    setThinking(false);
    onSubmitted?.();
  };

  return (
    <div className="composer composer--docked" data-testid="composer">
      <button
        className="composer__add"
        data-testid="composer-add"
        title="Add a note, link, or screenshot (⌘K)"
        aria-label="Add a note, link, or screenshot"
        onClick={() => useUiStore.getState().setCaptureOpen(true)}
      >
        +
      </button>
      {/*
        Deliberately not autofocused. The greeting's "press Enter to look
        around" is answered by a window-level handler in ArcBrowser instead,
        because G, T, S and `,` are single-key shortcuts and App's keyboard
        handler steps aside for INPUT targets — a focused composer would swallow
        every one of them and type the letter.
      */}
      <input
        ref={input}
        data-testid={firstRun ? 'welcome-input' : 'composer-input'}
        /* A placeholder is not a name. It disappears the moment you type, and
           several readers do not announce it at all — this input had no
           accessible name whatsoever. */
        aria-label="Ask a question, or paste something to save"
        placeholder="Ask anything, or drop a screenshot to save it…"
        value={text}
        disabled={thinking}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          /*
           * Escape hands the keyboard back to the app.
           *
           * G, T, S and `,` are single-key shortcuts, and App's handler steps
           * aside for INPUT targets — so the moment you click this box every one
           * of them stops navigating and starts typing letters into it, with
           * nothing on screen to say so. Before this there was no way out
           * without reaching for the mouse: the composer is docked and always
           * mounted, so unlike the command bars there was no dialog to close.
           */
          if (e.key === 'Escape') {
            // Only blur. App's Escape also clears the answer and the selection,
            // and losing the answer you were reading because you wanted your
            // arrow keys back is not the same gesture. Pressing it again does
            // that, now that the window can hear it.
            e.stopPropagation();
            e.currentTarget.blur();
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          void submit();
        }}
      />
      <button
        className="composer__send"
        data-testid={firstRun ? 'welcome-send' : 'composer-send'}
        /* The label is a glyph two thirds of the time, so the name is spelled
           out and kept in step with what the button will actually do. */
        aria-label={
          thinking
            ? 'Thinking'
            : text.trim()
              ? 'Ask'
              : firstRun && (payload?.memories.length ?? 0) > 0
                ? 'Look around'
                : 'Send'
        }
        disabled={thinking}
        onClick={() => void submit()}
      >
        {/* "Look around" offers to fan the categories out, so it can only be
            offered when there are categories. On an empty workspace it invited
            the one gesture in the app guaranteed to do nothing. */}
        {thinking
          ? 'Thinking…'
          : text.trim()
            ? 'Ask'
            : firstRun && (payload?.memories.length ?? 0) > 0
              ? 'Look around'
              : '↵'}
      </button>
    </div>
  );
}
