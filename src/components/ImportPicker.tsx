import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { keepImportPicks } from '../capture/batchRun';
import { useDismissable } from './useDismissable';
import type { ImportNote } from '../data/dataSource';

/**
 * Choosing what to bring in.
 *
 * A reader used to read and keep in one breath: the whole window, up to a
 * hundred notes, in the map before the person saw a title. This is the look
 * before keeping, for an import — the same star list a page's parts get.
 * Every note is a row that is on or off; what came since the last sync
 * stands first; what is already in (known by its way back, or by its words)
 * is dimmed and off, so the same note cannot arrive twice; a search narrows
 * the list without changing what is on. All on by default: the result of
 * pressing straight through is exactly what the old button did, and turning
 * off is the easier gesture.
 */
export function ImportPicker() {
  const pick = useUiStore((s) => s.importPick);
  const payload = useWorkspaceStore((s) => s.payload);
  const dismiss = useDismissable(() => useUiStore.getState().setImportPick(null));
  const [query, setQuery] = useState('');
  const [off, setOff] = useState<Set<number>>(() => new Set());
  const [seeded, setSeeded] = useState(false);

  // Already in: by the way back where there is one, else by title and opening words.
  const already = useMemo(() => {
    const out = new Set<number>();
    if (!pick || !payload) return out;
    const urls = new Set(payload.sources.map((s) => s.url).filter((u): u is string => Boolean(u)));
    const heads = new Set(payload.sources.map((s) => `${s.title}\u0000${s.raw_content.slice(0, 80)}`));
    pick.notes.forEach((n, i) => {
      if ((n.url && urls.has(n.url)) || heads.has(`${n.title}\u0000${n.content.slice(0, 80)}`)) out.add(i);
    });
    return out;
  }, [pick, payload]);

  // What is already in starts off — once, when the list arrives.
  if (pick && !pick.loading && !seeded) {
    setOff(new Set(already));
    setSeeded(true);
  }

  if (!pick) return null;

  const notes = pick.notes;
  const since = pick.since ? Date.parse(pick.since) : null;
  const q = query.trim().toLowerCase();
  const matches = (n: ImportNote) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
  const isNew = (n: ImportNote) => since !== null && Date.parse(n.modified) > since;
  const groups: { key: 'new' | 'rest'; label: string; rows: number[] }[] = [];
  const fresh = notes.map((_, i) => i).filter((i) => isNew(notes[i]!) && matches(notes[i]!));
  const rest = notes.map((_, i) => i).filter((i) => !isNew(notes[i]!) && matches(notes[i]!));
  if (since !== null && fresh.length > 0) groups.push({ key: 'new', label: t('import.new', { n: fresh.length }), rows: fresh });
  if (rest.length > 0) groups.push({ key: 'rest', label: since !== null && fresh.length > 0 ? t('import.rest', { n: rest.length }) : '', rows: rest });
  const on = notes.length - off.size;

  const toggle = (i: number) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const setAll = (value: boolean) => setOff(value ? new Set() : new Set(notes.map((_, i) => i)));

  const keep = () => {
    const items = notes.filter((_, i) => !off.has(i)).map((n) => ({ title: n.title, content: n.content, url: n.url ?? undefined }));
    if (items.length === 0) return;
    void keepImportPicks(items);
  };

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="overlay" {...dismiss}>
      <div className="bar bar--capture" data-testid="import-picker" role="dialog" aria-modal="true" aria-labelledby="import-picker-title">
        <div className="bar__head">
          <span id="import-picker-title">{t('import.title')}</span>
          <span>esc</span>
        </div>
        {pick.loading ? (
          <span className="bar__preview-reading" data-testid="import-reading">{t('import.reading')}</span>
        ) : notes.length === 0 ? (
          <span className="bar__preview-note" data-testid="import-none">{t('import.none')}</span>
        ) : (
          <>
            <input
              className="importpick__search"
              data-testid="import-search"
              placeholder={t('import.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="importpick__tools">
              <span data-testid="import-count">{t('import.count', { n: on, total: notes.length, already: already.size })}</span>
              <span className="spacer" />
              <button className="bar__section-more" data-testid="import-all-on" onClick={() => setAll(true)}>{t('import.allOn')}</button>
              <button className="bar__section-more" data-testid="import-all-off" onClick={() => setAll(false)}>{t('import.allOff')}</button>
            </div>
            {groups.map((g) => (
              <div key={g.key} data-testid={`import-group-${g.key}`}>
                {g.label && <div className="importpick__group">{g.label}</div>}
                <ul className="bar__sections">
                  {g.rows.map((i) => {
                    const n = notes[i]!;
                    const isOn = !off.has(i);
                    return (
                      <li key={i} className={`bar__section importpick__row${isOn ? '' : ' bar__section--off'}`} data-testid={`import-row-${i}`}>
                        <button
                          className="bar__section-star"
                          data-testid={`import-toggle-${i}`}
                          aria-pressed={isOn}
                          aria-label={n.title}
                          onClick={() => toggle(i)}
                        >
                          {isOn ? '★' : '☆'}
                        </button>
                        <span className="bar__section-body">
                          <span className="bar__section-heading">
                            {n.title}
                            {already.has(i) && <span className="importpick__already">{t('import.already')}</span>}
                          </span>
                          {n.firstLine && n.firstLine !== n.title && <span className="bar__section-sum">{n.firstLine}</span>}
                          <span className="importpick__meta">{[when(n.modified), t('import.chars', { n: n.chars.toLocaleString() })].filter(Boolean).join(' · ')}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
        <div className="importpick__foot">
          <button className="welcome__quiet" data-testid="import-cancel" onClick={() => useUiStore.getState().setImportPick(null)}>
            {t('import.cancel')}
          </button>
          <span className="spacer" />
          {!pick.loading && notes.length > 0 && (
            <button className="bar__preview-keep" data-testid="import-keep" disabled={on === 0} onClick={keep}>
              {t('import.keep', { n: on })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
