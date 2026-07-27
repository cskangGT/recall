import { useMemo } from 'react';
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
  text: 'Note',
  link: 'Link',
  screenshot: 'Screenshot',
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
  /** A capture that produced nothing is the case the toast points here for. */
  empty: boolean;
}

/**
 * Reverse-chronological, newest first, with the memory count each source
 * produced.
 *
 * "Produced nothing" is derived from the payload rather than read from a status
 * column: from the user's side those are the same thing, and it needs no schema
 * change to be true in both seed and API mode. An explicit `failed` status —
 * which would carry a Retry action — needs the status field surfaced on the
 * payload, and is not here yet.
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
      return { source: s, memoryCount, empty: memoryCount === 0 };
    })
    .sort(
      (a, b) =>
        b.source.created_at.localeCompare(a.source.created_at) ||
        a.source.id.localeCompare(b.source.id),
    );
}

const relativeDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function SourcesView() {
  const payload = useWorkspaceStore((s) => s.payload);
  const selectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const filter = useUiStore((s) => s.sourceFilter);
  const setFilter = useUiStore((s) => s.setSourceFilter);

  const rows = useMemo(
    () => (payload ? buildSourceRows(payload, filter) : []),
    [payload, filter],
  );

  if (!payload) return <div className="sources" data-testid="sources-view" />;

  return (
    <div className="sources" data-testid="sources-view">
      <div className="sources__head">
        <span>Sources</span>
        <div className="sources__filters">
          {(['all', 'text', 'link', 'screenshot'] as const).map((f) => (
            <button
              key={f}
              className={`sources__filter${filter === f ? ' sources__filter--on' : ''}`}
              data-testid={`sources-filter-${f}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : SOURCE_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && <p className="sources__empty">No sources yet.</p>}

      {rows.map(({ source, memoryCount, empty }) => (
        <button
          key={source.id}
          data-testid={`source-row-${source.id}`}
          className={[
            'source-row',
            selectedId === source.id ? 'source-row--selected' : '',
            empty ? 'source-row--empty' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => select(source.id)}
        >
          <span className="source-row__icon" title={SOURCE_LABEL[source.type]}>
            {SOURCE_ICON[source.type]}
          </span>
          <span className="source-row__body">
            <span className="source-row__title">{source.title}</span>
            <span className="source-row__meta">
              {SOURCE_LABEL[source.type]} · {relativeDate(source.created_at)}
              {empty ? ' · nothing to remember in this' : ''}
            </span>
          </span>
          <span className="source-row__count">{memoryCount}</span>
        </button>
      ))}
    </div>
  );
}
