import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runAsk } from '../ask/runAsk';
import { observationOf } from '../capture/batch';
import { t } from '../i18n';

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
    <div className={`reveal reveal--${phase}`} data-testid="batch-reveal" role="dialog" aria-label={t('reveal.aria')}>
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
                {Math.min(read, total)} <span className="reveal__of">{t('reveal.of')} {total}</span>
              </span>
              <span className="reveal__stage">{t('reveal.reading')}</span>
            </>
          ) : (
            <span className="reveal__stage">{t('reveal.organizing')}</span>
          )}
        </div>
      )}

      {phase === 'declare' && summary && (
        <div className="reveal__declare" data-testid="batch-reveal-declare">
          {/* The retroactive wow: the pattern this pile was hiding, said once,
              and only when it is actually there (observationOf's thresholds). */}
          {summary.memories === 0 ? (
            <h2>{t('reveal.nothingNew')}</h2>
          ) : (
          <h2
            // The sentence's word order differs per language, so the whole line
            // comes from the dictionary with <b> markers for the numbers.
            dangerouslySetInnerHTML={{
              __html: t('reveal.declare', {
                memories: summary.memories,
                sources: summary.sources,
                interests: summary.categories.length,
                interestWord: t(summary.categories.length === 1 ? 'reveal.interest.one' : 'reveal.interest.many'),
              }).replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>'),
            }}
          />
          )}
          {summary.period && (
            <p className="reveal__period" data-testid="batch-reveal-period">
              {t('reveal.period', { from: summary.period.from, to: summary.period.to })}
            </p>
          )}
          {summary.skipped > 0 && (
            <p className="reveal__skipped">
              {summary.skipped === 1 ? t('reveal.skipped.one') : t('reveal.skipped.many', { count: summary.skipped })}
            </p>
          )}
          {(() => {
            const top = observationOf(summary);
            if (!top) return null;
            return (
              <p
                className="reveal__observe"
                data-testid="batch-reveal-observe"
                dangerouslySetInnerHTML={{
                  __html: t('reveal.observe', {
                    memories: summary.memories,
                    added: top.added,
                    name: top.name,
                  }).replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>'),
                }}
              />
            );
          })()}
          {/* Biggest interests first and biggest on screen — "this is what
              your mind has been on" should be readable before it is read. */}
          <ul className="reveal__chips">
            {summary.categories.map((c, i) => (
              <li
                key={c.id}
                className={[
                  'reveal__chip',
                  c.isNew ? 'reveal__chip--new' : '',
                  i < 3 ? 'reveal__chip--top' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span className="reveal__chip-name">{c.name}</span>
                <span className="reveal__chip-count">{c.added}</span>
                {c.isNew && <span className="reveal__chip-badge">{t('reveal.new')}</span>}
              </li>
            ))}
          </ul>
          {/*
            The bridge from the visual aha to the functional one: three
            questions built from what this batch actually filed, so the first
            "ask your memory" happens within reach of the reveal. In seed mode
            there is no model to answer a novel question honestly, so the same
            click opens the category instead — showing, not pretending.
          */}
          {summary.categories.length > 0 && (
            <div className="reveal__ask" data-testid="batch-reveal-ask">
              <span className="reveal__ask-prompt">{t('reveal.askPrompt')}</span>
              {summary.categories.slice(0, 3).map((c) => (
                <button
                  key={c.id}
                  className="reveal__ask-q"
                  data-testid={`batch-reveal-ask-${c.id}`}
                  onClick={() => {
                    const ui = useUiStore.getState();
                    ui.setBatchReveal(null);
                    if (useWorkspaceStore.getState().source.ask) {
                      void runAsk(t('reveal.suggested', { name: c.name }));
                    } else {
                      ui.setView('browse');
                      ui.openCategory(c.id);
                      ui.select(c.id);
                    }
                  }}
                >
                  {t('reveal.suggested', { name: c.name })}
                </button>
              ))}
            </div>
          )}
          {/* The second door out of the reveal: walk the batch's sources with
              the original beside what Mado kept. Offered, never owed — the
              map is already complete (spec §21). */}
          {(summary.sourceIds?.length ?? 0) > 0 && (
            <button
              className="reveal__review"
              data-testid="batch-reveal-review"
              onClick={() => useUiStore.getState().openReview(summary.sourceIds!)}
            >
              {t('reveal.review')}
            </button>
          )}
          <button
            className="reveal__dismiss"
            data-testid="batch-reveal-dismiss"
            autoFocus
            onClick={() => useUiStore.getState().setBatchReveal(null)}
          >
            {t('reveal.dismiss')}
          </button>
        </div>
      )}
    </div>
  );
}
