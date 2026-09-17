import { useMemo } from 'react';
import { t, currentLocale } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { briefingOf } from '../core/briefing';
import { groupMeetings, formatTime, attendeeLine } from '../core/meetings';
import type { Memory } from '../core/types';

/**
 * The first page of home.
 *
 * A second brain, sat down with, should say what it holds — not hand over
 * a list of folders. So home opens on a briefing: the day and what is on
 * it, what has been on the mind lately in the memory's own voice, the
 * questions and decisions of the fortnight, where the thinking has been
 * growing, what is still waiting to be checked. Every line is a door: a
 * concern opens as a page, a growing category opens its reading list, the
 * day opens the meetings, the waiting count opens the originals.
 *
 * Sentences and rows, not tiles. If it looks like a dashboard it has
 * failed; the design rule is spacing, not boxes.
 */

const KIND_KEY = {
  question: 'briefing.kind.question',
  decision: 'briefing.kind.decision',
  task: 'briefing.kind.task',
} as const;

export function Briefing() {
  const payload = useWorkspaceStore((s) => s.payload);
  const meetings = useWorkspaceStore((s) => s.meetings);
  const lately = useWorkspaceStore((s) => s.lately);
  const hasCalendarDoor = Boolean(useWorkspaceStore((s) => s.source.listMeetings));
  const brief = useMemo(() => (payload ? briefingOf(payload) : null), [payload]);
  const today = useMemo(() => {
    if (!meetings?.connected) return [];
    const group = groupMeetings(meetings.meetings, new Date()).find((g) => g.key === 'today');
    return group ? group.meetings.slice(0, 3) : [];
  }, [meetings]);

  if (!payload || !brief) return null;
  const ui = useUiStore.getState();
  const locale = currentLocale() === 'ko' ? 'ko-KR' : 'en-GB';
  const dateLine = new Date().toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const open = (m: Memory) => ui.openMemoryPage(m.id);
  const openCategory = (id: string) => {
    ui.openCategory(id);
    ui.select(id);
  };
  const empty = brief.concerns.length === 0 && brief.learning.length === 0 && !lately;

  return (
    <section className="brief" data-testid="briefing">
      <p className="brief__date">{dateLine}</p>

      {hasCalendarDoor && (
        <div className="brief__block" data-testid="brief-today">
          <span className="brief__eyebrow">{t('briefing.today')}</span>
          {!meetings?.connected ? (
            <button className="brief__line brief__line--quiet" onClick={() => ui.setView('meetings')}>
              {t('briefing.todayConnect')}
            </button>
          ) : today.length === 0 ? (
            <p className="brief__line brief__line--quiet">{t('briefing.todayNone')}</p>
          ) : (
            today.map((m) => (
              <button
                key={m.id}
                className="brief__row"
                data-testid={`brief-meeting-${m.id}`}
                onClick={() => ui.setView('meetings')}
              >
                <span className="brief__time">{m.allDay ? t('meetings.allDay') : formatTime(m, currentLocale())}</span>
                <span className="brief__text">{m.title}</span>
                <span className="brief__meta">{attendeeLine(m)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {lately && (
        <div className="brief__block" data-testid="brief-lately">
          <span className="brief__eyebrow">{t('briefing.lately')}</span>
          <p className="brief__lately">
            {lately.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1')}
          </p>
          {lately.citations.length > 0 && (
            <span className="brief__cites">
              {lately.citations.map((c, i) => (
                <button
                  key={c.memory_id}
                  className="brief__cite"
                  data-testid={`brief-cite-${i + 1}`}
                  onClick={() => ui.openMemoryPage(c.memory_id)}
                  aria-label={t('briefing.citeAria', { n: i + 1 })}
                >
                  {i + 1}
                </button>
              ))}
            </span>
          )}
        </div>
      )}

      {brief.concerns.length > 0 && (
        <div className="brief__block" data-testid="brief-concerns">
          <span className="brief__eyebrow">{t('briefing.concerns')}</span>
          {brief.concerns.map((m) => (
            <button
              key={m.id}
              className="brief__row"
              data-testid={`brief-concern-${m.id}`}
              onClick={() => open(m)}
            >
              <span className="brief__kind">{t(KIND_KEY[m.kind as keyof typeof KIND_KEY] ?? 'briefing.kind.task')}</span>
              <span className="brief__text">{m.text}</span>
            </button>
          ))}
        </div>
      )}

      {(brief.learning.length > 0 || brief.organizing.awaitingReview > 0) && (
        <div className="brief__block" data-testid="brief-growing">
          <span className="brief__eyebrow">{t('briefing.growing')}</span>
          <span className="brief__chips">
            {brief.learning.map((l) => (
              <button
                key={l.categoryId}
                className="brief__chip"
                data-testid={`brief-growing-${l.categoryId}`}
                onClick={() => openCategory(l.categoryId)}
              >
                {l.name}
                <span className="brief__chip-count">+{l.added}</span>
              </button>
            ))}
            {brief.organizing.awaitingReview > 0 && (
              <button
                className="brief__chip brief__chip--quiet"
                data-testid="brief-awaiting"
                onClick={() => ui.setView('sources')}
              >
                {t('briefing.awaiting', { count: brief.organizing.awaitingReview })}
              </button>
            )}
          </span>
        </div>
      )}

      {empty && <p className="brief__line brief__line--quiet">{t('briefing.nothingYet')}</p>}
    </section>
  );
}
