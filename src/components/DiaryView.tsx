import { useMemo, useState } from 'react';
import { t, currentLocale } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { runBatchPipeline } from '../capture/batch';
import { firstFlight } from '../capture/firstFlight';
import type { GraphPayload, Source } from '../core/types';

/**
 * The diary — a room for days, not fragments (the user's frame: remember the
 * day itself, so that later Mado can say how your thinking was back then).
 *
 * A month calendar marks which days hold an entry (●) and which received
 * memories (·); a day opens into its page: the entries written for it, a
 * place to write another, and everything that arrived that day. Entries ride
 * the normal capture pipeline — extracted, categorized, searchable, part of
 * the sky — while the entry itself stays here, pinned to its day by
 * `diary_date` (yesterday's entry written today still lands on yesterday).
 */

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function DiaryView() {
  const payload = useWorkspaceStore((s) => s.payload);
  const select = useUiStore((s) => s.select);

  const today = dayKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [day, setDay] = useState(today);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  /** The ceremony: a star born at the save button, rising to join the sky. */
  const [rising, setRising] = useState(0);
  /** The look back for the viewed month — the memory's voice, longer form. */
  const [retro, setRetro] = useState<{ month: string; text: string } | null>(null);
  const [looking, setLooking] = useState(false);
  const canRetro = Boolean(useWorkspaceStore.getState().source.diaryRetro);

  const { entriesByDay, memoriesByDay } = useMemo(() => {
    const entries = new Map<string, Source[]>();
    const memories = new Map<string, number>();
    if (payload) {
      for (const s of payload.sources) {
        if (!s.diary_date) continue;
        entries.set(s.diary_date, [...(entries.get(s.diary_date) ?? []), s]);
      }
      for (const m of payload.memories) {
        const k = m.created_at.slice(0, 10);
        memories.set(k, (memories.get(k) ?? 0) + 1);
      }
    }
    return { entriesByDay: entries, memoriesByDay: memories };
  }, [payload]);

  if (!payload) return <div className="diary" data-testid="diary-view" />;

  const locale = currentLocale() === 'ko' ? 'ko-KR' : 'en-GB';
  const monthLabel = month.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 7, 2 + i).toLocaleDateString(locale, { weekday: 'narrow' }),
  );

  // The grid: leading blanks to Sunday, then the month's days.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(dayKey(new Date(month.getFullYear(), month.getMonth(), d)));
  }

  const dayEntries = entriesByDay.get(day) ?? [];
  const dayMemories = payload.memories
    .filter((m) => m.created_at.slice(0, 10) === day)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const lookBack = async () => {
    if (looking) return;
    const from = dayKey(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    setLooking(true);
    try {
      const result = await useWorkspaceStore.getState().source.diaryRetro!(from, to);
      if (result.days === 0 || !result.reflection) {
        useUiStore.getState().toast(t('diary.retro.none'));
      } else {
        setRetro({ month: monthLabel, text: result.reflection });
      }
    } catch {
      useUiStore.getState().toast(t('toast.batchFailed'));
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const store = useWorkspaceStore.getState();
      const title = t('diary.entryTitle', { date: formatDay(day, locale) });
      let addedIds: string[] = [];
      if (store.source.capture) {
        const result = await store.source.capture({
          type: 'text',
          title,
          content,
          diaryDate: day,
        });
        store.applyPayload(result.graph);
        addedIds = result.addedMemoryIds ?? [];
      } else {
        /*
         * Seed mode: the same entry through the local pipeline, quietly — a
         * single diary line does not deserve the bulk reveal. The source is
         * stamped with its day by hand, the way the server column would.
         */
        const result = runBatchPipeline(store.payload!, [{ title, content }]);
        const stamped: GraphPayload = {
          ...result.payload,
          sources: result.payload.sources.map((s) =>
            result.sourceIds.includes(s.id) ? { ...s, diary_date: day } : s,
          ),
        };
        store.applyPayload(stamped);
        addedIds = result.addedMemoryIds;
      }
      setDraft('');
      /*
       * The ceremony. Saving a day is not a database write to the person
       * doing it — it is the same feeling as the recent sky: something of
       * mine is up there now. A star is born at the button and rises; the
       * calendar's mark twinkles in; the toast speaks the sky's language.
       * And the claim is true — the newest memory IS the brightest star in
       * the browse sky the moment this resolves.
       */
      setRising((n) => n + 1);
      useUiStore.getState().toast(t('diary.saved'));
      // First-ever kept thought: after the star has risen, the map shows
      // where it joined the big picture. Later saves stay on this page.
      firstFlight(addedIds, 2600);
    } catch {
      useUiStore.getState().toast(t('toast.batchFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="diary" data-testid="diary-view">
      <div className="diary__calendar">
        <div className="diary__monthbar">
          <button className="diary__nav" data-testid="diary-prev" aria-label="prev month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ◀
          </button>
          <span className="diary__month">{monthLabel}</span>
          <button className="diary__nav" data-testid="diary-next" aria-label="next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            ▶
          </button>
        </div>
        <div className="diary__grid">
          {weekdays.map((w, i) => (
            <span key={`w${i}`} className="diary__weekday">{w}</span>
          ))}
          {cells.map((k, i) =>
            k === null ? (
              <span key={`b${i}`} />
            ) : (
              <button
                key={k}
                className={[
                  'diary__day',
                  k === day ? 'diary__day--on' : '',
                  k === today ? 'diary__day--today' : '',
                ].filter(Boolean).join(' ')}
                data-testid={`diary-day-${k}`}
                onClick={() => setDay(k)}
              >
                <span>{Number(k.slice(8))}</span>
                <span className="diary__marks">
                  {entriesByDay.has(k) && (
                    <span className={`diary__mark-entry${k === day && rising > 0 ? ' diary__mark-entry--born' : ''}`}>
                      ●
                    </span>
                  )}
                  {!entriesByDay.has(k) && (memoriesByDay.get(k) ?? 0) > 0 && (
                    <span className="diary__mark-mem">·</span>
                  )}
                </span>
              </button>
            ),
          )}
        </div>
        {/* The look back — only where a model can do it honestly. */}
        {canRetro && (
          <button
            className="diary__retro-btn"
            data-testid="diary-retro"
            disabled={looking}
            onClick={() => void lookBack()}
          >
            {looking ? t('diary.retro.looking') : t('diary.retro.cta')}
          </button>
        )}
      </div>

      <div className="diary__page">
        {retro && (
          <div className="diary__retro" data-testid="diary-retro-card">
            <div className="diary__retro-head">
              <span className="diary__eyebrow">{t('diary.retro.title', { month: retro.month })}</span>
              <button
                className="diary__retro-close"
                aria-label={t('review.skip')}
                onClick={() => setRetro(null)}
              >
                ×
              </button>
            </div>
            <p className="diary__retro-text">{retro.text}</p>
          </div>
        )}
        <h2 className="diary__date">
          {formatDay(day, locale)}
          {day === today && <span className="diary__today"> · {t('diary.today')}</span>}
        </h2>

        {dayEntries.map((s) => (
          <div key={s.id} className="diary__entry" data-testid={`diary-entry-${s.id}`}>
            {s.raw_content}
          </div>
        ))}

        <textarea
          className="diary__editor"
          data-testid="diary-editor"
          placeholder={dayEntries.length > 0 ? t('diary.continue') : t('diary.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="diary__actions">
          {rising > 0 && (
            <span key={rising} className="diary__risingstar" aria-hidden="true">
              <span className="diary__risingstar-dot" />
            </span>
          )}
          <button
            className="diary__save"
            data-testid="diary-save"
            disabled={saving || draft.trim().length === 0}
            onClick={() => void save()}
          >
            {saving ? t('review.saving') : t('diary.save')}
          </button>
        </div>

        {dayMemories.length > 0 && (
          <>
            <div className="diary__eyebrow">{t('diary.arrived', { n: dayMemories.length })}</div>
            {dayMemories.map((m) => (
              <button
                key={m.id}
                className="diary__memory"
                data-testid={`diary-memory-${m.id}`}
                onClick={() => select(m.id)}
              >
                {m.text}
              </button>
            ))}
          </>
        )}
        {dayEntries.length === 0 && dayMemories.length === 0 && (
          <p className="diary__empty">{t('diary.empty')}</p>
        )}
      </div>
    </div>
  );
}

function formatDay(key: string, locale: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}
