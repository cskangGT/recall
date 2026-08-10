import { useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runAsk } from '../ask/runAsk';
import { t } from '../i18n';

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
  placeholder,
}: {
  firstRun?: boolean;
  onSubmitted?: () => void;
  /**
   * A context-aware suggestion — the placeholder is the one place the app can
   * recommend a question without taking up any room. ArcBrowser passes one
   * built from whatever is open; absent, the generic invitation stands.
   */
  placeholder?: string;
}) {
  const payload = useWorkspaceStore((s) => s.payload);

  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);

  const submit = async () => {
    if (!text.trim() || !payload) {
      onSubmitted?.();
      return;
    }
    setThinking(true);
    await runAsk(text);
    setText('');
    setThinking(false);
    onSubmitted?.();
  };

  return (
    <div className="composer composer--docked" data-testid="composer">
      <button
        className="composer__add"
        data-testid="composer-add"
        title={t('composer.addTitle')}
        aria-label={t('composer.add')}
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
        data-testid={firstRun ? 'welcome-input' : 'composer-input'}
        /* A placeholder is not a name. It disappears the moment you type, and
           several readers do not announce it at all — this input had no
           accessible name whatsoever. */
        aria-label={t('composer.ask')}
        placeholder={placeholder ?? t('composer.placeholder')}
        value={text}
        /*
         * Never disabled. Disabling blurs, and losing focus mid-think hands
         * the next Escape to the window — which clears the very answer that is
         * about to arrive. Double-submit is guarded in the handler instead.
         */
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
          if (!thinking) void submit();
        }}
      />
      <button
        className="composer__send"
        data-testid={firstRun ? 'welcome-send' : 'composer-send'}
        /* The label is a glyph two thirds of the time, so the name is spelled
           out and kept in step with what the button will actually do. */
        aria-label={
          thinking
            ? t('composer.thinkingAria')
            : text.trim()
              ? t('composer.askAction')
              : t('composer.send')
        }
        disabled={thinking}
        onClick={() => void submit()}
      >
        {/* "Look around" offers to fan the categories out, so it can only be
            offered when there are categories. On an empty workspace it invited
            the one gesture in the app guaranteed to do nothing. */}
        {/* The doors above own "look around" now — a second button saying the
            same words two rows apart read as a stutter, not an affordance. */}
        {thinking
          ? t('composer.thinking')
          : text.trim()
            ? t('composer.askAction')
            : '↵'}
      </button>
    </div>
  );
}
