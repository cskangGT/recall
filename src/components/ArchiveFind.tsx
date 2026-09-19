import { useEffect } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { isQuestion } from '../ask/scriptedAsk';
import { runAsk } from '../ask/runAsk';

/**
 * The find-or-ask bar, in the archive.
 *
 * Same bar, same place, same rule as the other two lenses: a word narrows
 * what this lens shows — here, the originals whose title or text carries it
 * — and a question is asked, with the answer reading in the panel beside.
 */
export function ArchiveFind() {
  const query = useUiStore((s) => s.archiveQuery);
  const setQuery = useUiStore((s) => s.setArchiveQuery);

  // A narrowing nobody can see must not outlive the bar that made it.
  useEffect(() => () => useUiStore.getState().setArchiveQuery(''), []);

  return (
    <div className="mapsearch" data-testid="archive-find">
      <div className="mapsearch__row">
        <span className="mapsearch__glyph" aria-hidden="true">
          ⌕
        </span>
        <input
          data-testid="archive-find-input"
          aria-label={t('find.placeholder')}
          placeholder={t('find.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isQuestion(query)) {
              const question = query;
              setQuery('');
              void runAsk(question);
              return;
            }
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (query) setQuery('');
            else e.currentTarget.blur();
          }}
        />
        {query.trim() && (
          <span className="composer__mode" data-testid="find-mode">
            {isQuestion(query) ? t('find.mode.ask') : t('find.mode.find')}
          </span>
        )}
      </div>
    </div>
  );
}
