import { useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * One line on its way to being a memory — wherever that happens: the first
 * talk, a page's parts, a line of the brainstorm, the review.
 *
 * A star that is on or off, the words themselves to edit, and Mado's help
 * a press away: "tidy it" rewrites the line as a memory the person will
 * understand a year from now — self-contained, their words, nothing added —
 * and "put it back" undoes it. The help is drawn only where a model can
 * give it. What the line becomes is always the person's to decide.
 */
export interface KeepLineProps {
  prefix: string;
  index: number;
  text: string;
  on: boolean;
  /** Lines said around this one, for what a pronoun refers to. */
  context?: string[];
  onText: (text: string) => void;
  onToggle: () => void;
  /** Enter in the box: keep everything, where the surface has that. */
  onEnter?: () => void;
  /** Take this line out entirely (not just off). */
  onRemove?: () => void;
}

export function KeepLine(p: KeepLineProps) {
  const canPolish = Boolean(useWorkspaceStore((s) => s.source.polish));
  const [busy, setBusy] = useState(false);
  const [before, setBefore] = useState<string | null>(null);

  const polish = async () => {
    const source = useWorkspaceStore.getState().source.polish;
    if (!source || busy || !p.text.trim()) return;
    setBusy(true);
    try {
      const { text } = await source(p.text.trim(), p.context);
      if (text && text !== p.text) {
        setBefore(p.text);
        p.onText(text);
      }
    } catch {
      useUiStore.getState().toast(t('line.polishFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`bar__section keepline${p.on ? '' : ' bar__section--off'}`} data-testid={`${p.prefix}-line-${p.index}`}>
      <button
        className="bar__section-star"
        data-testid={`${p.prefix}-line-toggle-${p.index}`}
        aria-pressed={p.on}
        onClick={p.onToggle}
      >
        {p.on ? '★' : '☆'}
      </button>
      <span className="bar__section-body">
        <textarea
          className="welcome__line-input keepline__text"
          data-testid={`${p.prefix}-line-input-${p.index}`}
          rows={1}
          value={p.text}
          onChange={(e) => {
            p.onText(e.target.value);
            if (before !== null && e.target.value !== before) setBefore(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              p.onEnter?.();
            }
          }}
        />
      </span>
      <span className="keepline__tools">
        {canPolish && before === null && (
          <button className="bar__section-more" data-testid={`${p.prefix}-line-polish-${p.index}`} disabled={busy} onClick={() => void polish()}>
            {busy ? t('line.polishing') : t('line.polish')}
          </button>
        )}
        {before !== null && (
          <button
            className="bar__section-more"
            data-testid={`${p.prefix}-line-undo-${p.index}`}
            onClick={() => {
              p.onText(before);
              setBefore(null);
            }}
          >
            {t('line.undo')}
          </button>
        )}
      </span>
    </li>
  );
}
