import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { search } from '../search/search';
import type { SourceType } from '../core/types';

/**
 * Search, docked on the map.
 *
 * The two views now each carry the input that fits their job: browsing is a
 * conversation, so it has a composer; the map is everything at once, so it has
 * a way to find one thing in it. Until now the map had neither — search existed
 * behind ⌘/ and a glyph in the rail, which is a keyboard shortcut for a feature
 * whose whole point is that you do not know where the thing is.
 *
 * It lights the map rather than opening a list. That is the difference between
 * search *on* a map and search *instead of* one: the answer to "where is the
 * thing about evals" is a position, and the renderer already dims everything
 * unhighlighted to 15%, so typing turns the map into its own result view. A
 * list would have thrown away the one thing the map is for.
 *
 * The filters are by source type because that is the axis the corpus actually
 * has. Filtering by where something came from — the "show me only the things I
 * saved from Instagram" idea — needs an origin the sources do not carry: every
 * seeded link is example.com, and `Source` has no notion of a platform beyond
 * its URL. When it does, this is where the chips go.
 */

const FILTERS: { id: SourceType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Notes' },
  { id: 'link', label: 'Links' },
  { id: 'screenshot', label: 'Screenshots' },
];

export function MapSearch() {
  const payload = useWorkspaceStore((s) => s.payload);
  const setHighlight = useUiStore((s) => s.setHighlight);
  const select = useUiStore((s) => s.select);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SourceType | 'all'>('all');

  const results = useMemo(() => {
    if (!payload) return [];
    // A filter on its own is a legitimate query — "show me every screenshot" is
    // a question about the map, and it should not need a word typed at it.
    const hits =
      query.trim().length > 0
        ? search(payload, query)
        : payload.memories.map((memory) => ({
            memory,
            sourceType: payload.sources.find((s) => s.id === memory.source_id)?.type ?? 'text',
          }));
    return hits.filter((r) => filter === 'all' || r.sourceType === filter);
  }, [payload, query, filter]);

  const searching = query.trim().length > 0 || filter !== 'all';

  /*
   * The highlight is shared with the answer, so this bar only touches it while
   * it is actually saying something.
   *
   * Without the guard, mounting cleared it: asking a question and then pressing
   * G to see where the answer lives would arrive at a map that had just thrown
   * away the highlight it came for. The ref records whether this bar is the one
   * currently making a claim, so it can put the map back afterwards without
   * ever clearing someone else's.
   */
  const owns = useRef(false);
  useEffect(() => {
    if (searching) {
      owns.current = true;
      setHighlight(results.map((r) => r.memory.id));
    } else if (owns.current) {
      owns.current = false;
      setHighlight([]);
    }
  }, [searching, results, setHighlight]);

  useEffect(
    () => () => {
      // Leaving must not strand the map dimmed by a query nobody can see.
      if (owns.current) setHighlight([]);
    },
    [setHighlight],
  );

  if (!payload) return null;

  return (
    <div className="mapsearch" data-testid="map-search">
      <div className="mapsearch__row">
        <span className="mapsearch__glyph" aria-hidden="true">
          ⌕
        </span>
        <input
          data-testid="map-search-input"
          aria-label="Search your memories"
          placeholder="Find something on the map…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            // Same ladder as the composer: the first Escape hands the keyboard
            // back, so the single-key view shortcuts start working again.
            e.stopPropagation();
            if (query) setQuery('');
            else e.currentTarget.blur();
          }}
        />
        {searching && (
          <span className="mapsearch__count" data-testid="map-search-count">
            {results.length} of {payload.memories.length}
          </span>
        )}
      </div>

      <div className="mapsearch__filters" role="group" aria-label="Filter by source type">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            data-testid={`map-filter-${f.id}`}
            className={`mapsearch__filter${filter === f.id ? ' mapsearch__filter--on' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              select(null);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
