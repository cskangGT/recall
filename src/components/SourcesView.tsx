import { useMemo, useState } from 'react';
import { t, currentLocale } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { GraphPayload, Source, SourceType } from '../core/types';

/**
 * Sources — spec §5.7. The provenance ledger, and the "did my capture work"
 * surface.
 *
 * Built because the app already promised it. When extraction finds nothing the
 * toast says *"Saved, but Recall couldn't find anything to remember in this.
 * It's in your Sources."* — and there was no Sources. A product whose whole
 * claim is that every answer traces back to something you saved cannot have a
 * capture that vanishes into a screen that does not exist.
 */

const SOURCE_LABEL: Record<SourceType, string> = {
  text: t('type.text'),
  link: t('type.link'),
  screenshot: t('type.screenshot'),
};

const SOURCE_ICON: Record<SourceType, string> = {
  text: '✎',
  link: '↗',
  screenshot: '▣',
};

export type SourceFilter = 'all' | SourceType;

export interface SourceRow {
  source: Source;
  memoryCount: number;
  /** Processing genuinely failed — distinct from "produced nothing". */
  failed: boolean;
  error: string | null;
  /** A capture that produced nothing is the case the toast points here for. */
  empty: boolean;
}

/**
 * Reverse-chronological, newest first, with the memory count each source
 * produced.
 *
 * "Produced nothing" stays derived from the payload rather than read from a
 * status column: from the user's side an empty extraction and a source with no
 * memories are the same thing, and deriving it needs no schema change to be true
 * in both seed and API mode.
 *
 * A *failure* is different and cannot be derived — an empty result and a crashed
 * one look identical from the payload, and only one of them is worth retrying.
 * That one reads `status`, which the server now surfaces.
 */
export function buildSourceRows(payload: GraphPayload, filter: SourceFilter = 'all'): SourceRow[] {
  const counts = new Map<string, number>();
  for (const m of payload.memories) {
    counts.set(m.source_id, (counts.get(m.source_id) ?? 0) + 1);
  }

  return payload.sources
    .filter((s) => filter === 'all' || s.type === filter)
    .map((s) => {
      const memoryCount = counts.get(s.id) ?? 0;
      const failed = s.status === 'failed';
      return {
        source: s,
        memoryCount,
        // A failed source produced nothing, but calling it empty would hide the
        // fact that it can be retried.
        empty: !failed && memoryCount === 0,
        failed,
        error: s.error_message ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.source.created_at.localeCompare(a.source.created_at) ||
        a.source.id.localeCompare(b.source.id),
    );
}

const relativeDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(currentLocale() === 'ko' ? 'ko-KR' : 'en-GB', { day: 'numeric', month: 'short' });

export function SourcesView() {
  const payload = useWorkspaceStore((s) => s.payload);
  const selectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const filter = useUiStore((s) => s.sourceFilter);
  const setFilter = useUiStore((s) => s.setSourceFilter);

  const [retrying, setRetrying] = useState<string | null>(null);

  /**
   * Only the API can genuinely retry — seed mode has no processing to re-run,
   * and pretending otherwise would show a spinner that resolves to nothing.
   */
  const retrySource = async (sourceId: string) => {
    const { source: dataSource, applyPayload } = useWorkspaceStore.getState();
    if (!dataSource.retrySource) {
      useUiStore.getState().toast(t('toast.retrySeed'));
      return;
    }
    setRetrying(sourceId);
    try {
      applyPayload(await dataSource.retrySource(sourceId));
    } catch (err) {
      useUiStore.getState().toast(
        err instanceof Error ? t('toast.retryFailedWith', { message: err.message }) : t('toast.retryFailed'),
      );
    } finally {
      setRetrying(null);
    }
  };

  const rows = useMemo(
    () => (payload ? buildSourceRows(payload, filter) : []),
    [payload, filter],
  );

  if (!payload) return <div className="sources" data-testid="sources-view" />;

  return (
    <div className="sources" data-testid="sources-view">
      <div className="sources__head">
        <span>{t('sources.title')}</span>
        <div className="sources__filters">
          {(['all', 'text', 'link', 'screenshot'] as const).map((f) => (
            <button
              key={f}
              className={`sources__filter${filter === f ? ' sources__filter--on' : ''}`}
              data-testid={`sources-filter-${f}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? t('sources.filter.all') : SOURCE_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && <p className="sources__empty">{t('sources.empty')}</p>}

      {rows.map(({ source, memoryCount, empty, failed, error }) => (
        <div
          key={source.id}
          data-testid={`source-row-${source.id}`}
          className={[
            'source-row',
            selectedId === source.id ? 'source-row--selected' : '',
            empty ? 'source-row--empty' : '',
            failed ? 'source-row--failed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          /*
           * Reachable by keyboard. It was a div with an onClick, so the whole
           * of this view — every row of it — could only be operated with a
           * mouse. Not a <button>, deliberately: the arc's nodes learned the
           * same lesson, that a button which is also an HTML5 drag source
           * leaves Chromium stuck in a drag the pointer release never clears.
           * The role and the key handler put back by hand what the element
           * would have given for free.
           */
          role="button"
          tabIndex={0}
          aria-pressed={selectedId === source.id}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            select(source.id);
          }}
          onClick={() => select(source.id)}
        >
          <span className="source-row__icon" title={SOURCE_LABEL[source.type]}>
            {SOURCE_ICON[source.type]}
          </span>
          <span className="source-row__body">
            <span className="source-row__title">{source.title}</span>
            <span className="source-row__meta">
              {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)}
              {empty ? t('sources.meta.empty') : ''}
              {failed ? `${t('sources.meta.failed')}${error ? ` — ${error}` : ''}` : ''}
            </span>
          </span>
          {failed ? (
            <button
              className="source-row__retry"
              data-testid={`retry-${source.id}`}
              onClick={(e) => {
                e.stopPropagation();
                void retrySource(source.id);
              }}
              disabled={retrying === source.id}
            >
              {retrying === source.id ? t('sources.retrying') : t('sources.retry')}
            </button>
          ) : (
            <span className="source-row__count">{memoryCount}</span>
          )}
        </div>
      ))}
    </div>
  );
}
