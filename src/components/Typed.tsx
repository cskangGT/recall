import { useEffect, useState } from 'react';

/**
 * A line arriving the way a message does — letter by letter. Used where
 * Mado speaks in the first conversation, so its words read as said, not
 * pasted. A press finishes it; reduced motion shows it whole.
 */
const CHAR_MS = 42;

export function Typed({ text, onDone, className, testId }: { text: string; onDone?: () => void; className?: string; testId?: string }) {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [n, setN] = useState(() => (reduced ? text.length : 0));
  const done = n >= text.length;
  useEffect(() => {
    setN(reduced ? text.length : 0);
  }, [text, reduced]);
  useEffect(() => {
    if (done) {
      onDone?.();
      return;
    }
    const id = window.setTimeout(() => setN((v) => v + 1), CHAR_MS);
    return () => window.clearTimeout(id);
    // onDone identity is not a reason to retype.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, done, text]);
  return (
    <p className={className} data-testid={testId} data-done={done ? '1' : '0'} onClick={() => setN(text.length)}>
      {text.slice(0, n)}
      {!done && <span className="prologue__caret" aria-hidden="true" />}
    </p>
  );
}
