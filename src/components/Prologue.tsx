import { useEffect, useRef, useState } from 'react';
import { t, PRODUCT } from '../i18n';

/**
 * The first words, typed.
 *
 * Before the greeting asks who they are, four lines arrive the way a message
 * does — letter by letter, one line settling before the next — saying why
 * this exists: too much to take in, saved and never seen again, so, Mado.
 * A scene to watch, once. Any press finishes the typing; a second one, or a
 * moment's wait, moves on. With reduced motion the lines stand at once and
 * the way on is a button — the same words, none of the waiting.
 */
const LINES = ['welcome.prologue.1', 'welcome.prologue.2', 'welcome.prologue.3', 'welcome.prologue.4'] as const;
const CHAR_MS = 34;
const LINE_PAUSE_MS = 520;
const DONE_PAUSE_MS = 1400;

export function Prologue({ onDone }: { onDone: () => void }) {
  const lines = LINES.map((k) => t(k, { product: PRODUCT }));
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [at, setAt] = useState<{ line: number; chars: number }>(() => (reduced ? { line: lines.length, chars: 0 } : { line: 0, chars: 0 }));
  const finished = at.line >= lines.length;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (finished) return;
    const current = lines[at.line]!;
    const next = () => {
      if (at.chars < current.length) setAt({ line: at.line, chars: at.chars + 1 });
      else setAt({ line: at.line + 1, chars: 0 });
    };
    timer.current = window.setTimeout(next, at.chars < current.length ? CHAR_MS : LINE_PAUSE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [at, finished, lines]);

  // Finished: a beat, then on — unless the person prefers to press.
  useEffect(() => {
    if (!finished || reduced) return;
    const id = window.setTimeout(onDone, DONE_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [finished, reduced, onDone]);

  const press = () => {
    if (finished) onDone();
    else setAt({ line: lines.length, chars: 0 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        press();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="prologue" data-testid="prologue" data-done={finished ? '1' : '0'} onClick={press}>
      {lines.map((line, i) => {
        if (i > at.line) return null;
        const typing = i === at.line;
        const text = typing ? line.slice(0, at.chars) : line;
        return (
          <p key={i} className={`prologue__line${i === lines.length - 1 ? ' prologue__line--last' : ''}`} data-testid={`prologue-line-${i + 1}`}>
            {text}
            {typing && <span className="prologue__caret" aria-hidden="true" />}
          </p>
        );
      })}
      {finished ? (
        <button
          className="obguide__next prologue__next"
          data-testid="prologue-next"
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
        >
          {t('welcome.prologue.next')}
        </button>
      ) : (
        <button
          className="welcome__quiet prologue__skip"
          data-testid="prologue-skip"
          onClick={(e) => {
            e.stopPropagation();
            setAt({ line: lines.length, chars: 0 });
          }}
        >
          {t('welcome.prologue.skip')}
        </button>
      )}
    </div>
  );
}
