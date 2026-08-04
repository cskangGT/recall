import { useUiStore } from '../store/uiStore';

/**
 * The reveal a bulk drop plays over the sky.
 *
 * Three beats: dots pour in as items are read, gather while the pipeline runs,
 * and the declaration lands — how many saves became how many interests. It is
 * the batch equivalent of the single capture's ghost-and-ticker, scaled to the
 * moment where someone hands Recall a folder of their life at once. The beats
 * are paced by the driver (batchRun.ts); this component only renders the
 * phase it is told.
 */

/** More dots than this stops reading as "my stuff" and starts reading as noise. */
const MAX_DOTS = 120;

/** Deterministic scatter — the same batch pours the same sky every run. */
function dotPlacement(i: number): { x: number; y: number; delay: number; size: number } {
  let h = (i + 1) * 2654435761;
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967295;
  };
  return {
    x: 8 + next() * 84,
    y: 10 + next() * 62,
    delay: next() * 0.35,
    size: 2 + next() * 3,
  };
}

export function BatchReveal() {
  const reveal = useUiStore((s) => s.batchReveal);
  if (!reveal) return null;

  const { phase, total, read, summary } = reveal;
  const dots = Math.min(total, MAX_DOTS);
  const litPerDot = total / dots;

  return (
    <div className={`reveal reveal--${phase}`} data-testid="batch-reveal" role="dialog" aria-label="Organizing your saves">
      <div className="reveal__sky" aria-hidden="true">
        {Array.from({ length: dots }, (_, i) => {
          const p = dotPlacement(i);
          const lit = read >= (i + 1) * litPerDot;
          return (
            <span
              key={i}
              className={`reveal__dot${lit ? ' reveal__dot--lit' : ''}`}
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                transitionDelay: `${p.delay}s`,
                // Where the gather pulls it: toward the center of the sky.
                ['--dx' as string]: `${50 - p.x}%`,
                ['--dy' as string]: `${40 - p.y}%`,
              }}
            />
          );
        })}
      </div>

      {phase !== 'declare' && (
        <div className="reveal__status" data-testid="batch-reveal-status" aria-live="polite">
          {phase === 'reading' ? (
            <>
              <span className="reveal__count">
                {Math.min(read, total)} <span className="reveal__of">of {total}</span>
              </span>
              <span className="reveal__stage">Reading…</span>
            </>
          ) : (
            <span className="reveal__stage">Finding what goes together…</span>
          )}
        </div>
      )}

      {phase === 'declare' && summary && (
        <div className="reveal__declare" data-testid="batch-reveal-declare">
          <h2>
            Organized <strong>{summary.memories}</strong> memories from{' '}
            <strong>{summary.sources}</strong> saves into{' '}
            <strong>{summary.categories.length}</strong> interest
            {summary.categories.length === 1 ? '' : 's'}.
          </h2>
          {summary.skipped > 0 && (
            <p className="reveal__skipped">
              {summary.skipped} thing{summary.skipped === 1 ? ' was' : 's were'} already saved — not written twice.
            </p>
          )}
          <ul className="reveal__chips">
            {summary.categories.map((c) => (
              <li key={c.id} className={`reveal__chip${c.isNew ? ' reveal__chip--new' : ''}`}>
                <span className="reveal__chip-name">{c.name}</span>
                <span className="reveal__chip-count">{c.added}</span>
                {c.isNew && <span className="reveal__chip-badge">new</span>}
              </li>
            ))}
          </ul>
          <button
            className="reveal__dismiss"
            data-testid="batch-reveal-dismiss"
            autoFocus
            onClick={() => useUiStore.getState().setBatchReveal(null)}
          >
            Look around
          </button>
        </div>
      )}
    </div>
  );
}
