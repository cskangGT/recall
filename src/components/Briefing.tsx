import { useMemo, useState } from 'react';
import { t, currentLocale } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { briefingOf } from '../core/briefing';
import { groupMeetings, formatTime, attendeeLine, isOver, localDay } from '../core/meetings';
import { dayPartOf, leadRow, type HomeRow } from '../core/dayPart';
import type { MeetingWithContext } from '../core/meetingTypes';
import type { Memory } from '../core/types';
import { MemoryRow } from './Inspector';
import { SourceChips } from './SourceChips';

/**
 * Home: one sentence, and three lines.
 *
 * The first briefing said everything it held at once — seven blocks of the
 * same weight, a six-line paragraph in the middle, the categories twice —
 * and a page that says everything at a glance says nothing at a glance. So
 * home now leads with the single thing this hour is about, in type large
 * enough to be the page, and keeps the rest behind three lines named for
 * what the person manages here: the day (schedule), the mind (what is held,
 * what came in), and the pile (what to sort, what it has been about lately).
 * Each line is a count until it is pressed; the hour opens one of them.
 *
 * Nothing was removed from the product: the categories live in Browse and
 * on the arc above, the import door sits inside the pile, the diary inside
 * the mind, and everything is still one press away.
 */

const KIND_KEY = {
  question: 'briefing.kind.question',
  decision: 'briefing.kind.decision',
  task: 'briefing.kind.task',
} as const;

const GROUP_KEY = {
  today: 'meetings.group.today',
  tomorrow: 'meetings.group.tomorrow',
  week: 'meetings.group.week',
  next: 'meetings.group.next',
  later: 'meetings.group.later',
  past: 'meetings.group.past',
} as const;

const TODAY_MEMORIES_LIMIT = 5;
/** "Just three today" — small enough to start, and the offer only above it. */
const REVIEW_BITE = 3;

/** The first sentence of a paragraph, and whatever follows it. */
function firstSentence(text: string): { lead: string; rest: string } {
  const match = /^(.+?[.!?。])\s+(.+)$/s.exec(text.trim());
  return match ? { lead: match[1]!, rest: match[2]! } : { lead: text.trim(), rest: '' };
}

export function Briefing() {
  const payload = useWorkspaceStore((s) => s.payload);
  const meetings = useWorkspaceStore((s) => s.meetings);
  const lately = useWorkspaceStore((s) => s.lately);
  const hasCalendarDoor = Boolean(useWorkspaceStore((s) => s.source.listMeetings));
  const brief = useMemo(() => (payload ? briefingOf(payload) : null), [payload]);

  const now = new Date();
  const part = dayPartOf(now);
  const [open, setOpen] = useState<Set<HomeRow>>(() => new Set([leadRow(part, hasCalendarDoor)]));
  const [latelyOpen, setLatelyOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  /* Today's meetings still ahead, or — when there are none — the next one anywhere. */
  const day = useMemo(() => {
    const none = { ahead: [] as MeetingWithContext[], next: null as null | { meeting: MeetingWithContext; when: string } };
    if (!meetings?.connected) return none;
    const at = new Date();
    const groups = groupMeetings(meetings.meetings, at);
    const ahead = (groups.find((g) => g.key === 'today')?.meetings ?? []).filter((m) => !isOver(m, at));
    if (ahead.length > 0) return { ahead, next: null };
    for (const g of groups) {
      if (g.key === 'today' || g.key === 'past') continue;
      const first = g.meetings[0];
      if (first) return { ahead: [], next: { meeting: first, when: t(GROUP_KEY[g.key]) } };
    }
    return none;
  }, [meetings]);

  if (!payload || !brief) return null;
  const ui = useUiStore.getState();
  const locale = currentLocale();
  const dateLine = now.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-GB', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const todayKey = localDay(now);
  const todayMemories = payload.memories
    .filter((m) => localDay(new Date(m.created_at)) === todayKey)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const held = new Set(payload.memories.map((m) => m.source_id));
  const unchecked = payload.sources
    .filter((s) => !s.reviewed_at && held.has(s.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const reviewBite = unchecked.length > REVIEW_BITE ? unchecked.slice(0, REVIEW_BITE).map((s) => s.id) : null;
  const startReview = () => ui.openReview(reviewBite ?? unchecked.map((s) => s.id));

  const heldForToday = day.ahead.reduce((n, m) => n + m.context.length, 0);
  const evidence = lately
    ? lately.citations
        .map((c) => payload.memories.find((m) => m.id === c.memory_id))
        .filter((m): m is Memory => m !== undefined)
    : [];
  const latelyText = lately ? lately.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1') : '';
  const { lead: latelyLead, rest: latelyRest } = firstSentence(latelyText);

  // One line open at a time: two open lines are the long page again.
  const toggle = (row: HomeRow) => setOpen((prev) => (prev.has(row) ? new Set() : new Set([row])));
  const reveal = (row: HomeRow) => setOpen(new Set([row]));

  /*
   * The one sentence. What it says follows the hour — the day ahead in the
   * morning, the pile in the afternoon, what came in at night — and falls
   * through to the next true thing when the hour's own subject is empty. It
   * is a door like everything else: pressing it goes where it points.
   */
  const head = ((): { text: string; go: () => void } => {
    const meetingsHead = (): { text: string; go: () => void } | null => {
      const first = day.ahead[0];
      if (first) {
        return {
          text: t(day.ahead.length === 1 ? 'briefing.head.meeting' : 'briefing.head.meetings', {
            count: day.ahead.length,
            time: first.allDay ? t('meetings.allDay') : formatTime(first, locale),
            who: attendeeLine(first) || first.title,
          }),
          go: () => ui.setView('meetings'),
        };
      }
      if (day.next) {
        return {
          text: t('briefing.head.next', {
            when: day.next.when,
            time: day.next.meeting.allDay ? t('meetings.allDay') : formatTime(day.next.meeting, locale),
            title: day.next.meeting.title,
          }),
          go: () => ui.setView('meetings'),
        };
      }
      return null;
    };
    const sortHead = () =>
      unchecked.length > 0
        ? {
            text: t(reviewBite ? 'briefing.head.sort' : 'briefing.head.sortFew', { count: unchecked.length }),
            go: startReview,
          }
        : null;
    const concernsHead = () =>
      brief.concerns.length > 0
        ? { text: t('briefing.head.concerns', { count: brief.concerns.length }), go: () => reveal('mind') }
        : null;
    const quiet = { text: t('briefing.head.quiet'), go: () => ui.setCaptureOpen(true) };

    if (part === 'evening') {
      return todayMemories.length > 0
        ? { text: t('briefing.head.todayIn', { count: todayMemories.length }), go: () => ui.setView('diary') }
        : { text: t('briefing.todayMemoriesNone'), go: () => ui.setView('diary') };
    }
    if (part === 'day') return sortHead() ?? meetingsHead() ?? concernsHead() ?? quiet;
    return meetingsHead() ?? concernsHead() ?? sortHead() ?? quiet;
  })();

  const meetingRow = (m: MeetingWithContext, when?: string) => (
    <button key={m.id} className="brief__row" data-testid={`brief-meeting-${m.id}`} onClick={() => ui.setView('meetings')}>
      <span className="brief__time">
        {when ? `${when} ` : ''}
        {m.allDay ? t('meetings.allDay') : formatTime(m, locale)}
      </span>
      <span className="brief__text">{m.title}</span>
      <span className="brief__meta">
        {attendeeLine(m)}
        {m.context.length > 0 && (
          <span className="brief__held" data-testid={`brief-meeting-held-${m.id}`}>
            {attendeeLine(m) ? ' · ' : ''}
            {t('briefing.memoriesFor', { count: m.context.length })}
          </span>
        )}
      </span>
    </button>
  );

  const settle = (m: Memory) => {
    useWorkspaceStore.getState().settleMemory(m.id, true);
    ui.toast(
      t(
        m.kind === 'question'
          ? 'toast.settled.question'
          : m.kind === 'decision'
            ? 'toast.settled.decision'
            : 'toast.settled.task',
      ),
    );
  };

  /* What each line says while it is closed — counts, not contents. */
  const scheduleSummary = !meetings?.connected
    ? t('briefing.sum.connect')
    : day.ahead.length > 0
      ? [
          t('briefing.sum.meetings', { count: day.ahead.length }),
          heldForToday > 0 ? t('briefing.memoriesFor', { count: heldForToday }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : day.next
        ? t('briefing.sum.next', {
            when: day.next.when,
            time: day.next.meeting.allDay ? t('meetings.allDay') : formatTime(day.next.meeting, locale),
          })
        : t('briefing.sum.noMeetings');
  const mindSummary = [
    brief.concerns.length > 0
      ? t('briefing.sum.concerns', { count: brief.concerns.length })
      : t('briefing.sum.noConcerns'),
    todayMemories.length > 0 ? t('briefing.sum.todayIn', { count: todayMemories.length }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const infoSummary = [
    unchecked.length > 0 ? t('briefing.sum.review', { count: unchecked.length }) : t('briefing.sum.clear'),
    lately ? t('briefing.lately') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const rowHead = (row: HomeRow, label: string, summary: string) => (
    <button
      className="home__rowhead"
      data-testid={`brief-row-${row}`}
      aria-expanded={open.has(row)}
      onClick={() => toggle(row)}
    >
      <span className="home__rowlabel">{label}</span>
      <span className="home__rowsum">{summary}</span>
      <span className="home__chev" aria-hidden="true">
        {open.has(row) ? '−' : '+'}
      </span>
    </button>
  );

  return (
    <section className="brief home" data-testid="briefing" data-daypart={part}>
      <p className="home__date">{dateLine}</p>
      <button className="home__head" data-testid="brief-head" onClick={head.go}>
        {head.text}
      </button>

      <div className="home__rows">
        {hasCalendarDoor && (
          <div className="home__row">
            {rowHead('schedule', t('briefing.row.schedule'), scheduleSummary)}
            {open.has('schedule') && (
              <div className="home__body" data-testid="brief-today">
                {!meetings?.connected ? (
                  <button className="brief__line brief__line--quiet" onClick={() => ui.setView('meetings')}>
                    {t('briefing.todayConnect')}
                  </button>
                ) : day.ahead.length > 0 ? (
                  day.ahead.slice(0, 3).map((m) => meetingRow(m))
                ) : day.next ? (
                  meetingRow(day.next.meeting, day.next.when)
                ) : (
                  <p className="brief__line brief__line--quiet">{t('briefing.todayNone')}</p>
                )}
                {meetings?.connected && (
                  <button className="brief__evidence" data-testid="brief-all-meetings" onClick={() => ui.setView('meetings')}>
                    {t('briefing.allMeetings')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="home__row">
          {rowHead('mind', t('briefing.row.mind'), mindSummary)}
          {open.has('mind') && (
            <div className="home__body">
              {brief.concerns.length > 0 && (
                <div className="brief__block" data-testid="brief-concerns">
                  <span className="brief__eyebrow">{t('briefing.concerns')}</span>
                  {brief.concerns.map((m) => (
                    <div key={m.id} className="brief__split">
                      <button className="brief__row" data-testid={`brief-concern-${m.id}`} onClick={() => ui.openMemoryPage(m.id)}>
                        <span className="brief__kind">{t(KIND_KEY[m.kind as keyof typeof KIND_KEY] ?? 'briefing.kind.task')}</span>
                        <span className="brief__text">{m.text}</span>
                      </button>
                      <button
                        className="brief__settle"
                        data-testid={`brief-settle-${m.id}`}
                        aria-label={t('briefing.settleAria')}
                        onClick={() => settle(m)}
                      >
                        {t('briefing.settle')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="brief__block" data-testid="brief-today-memories">
                <span className="brief__eyebrow">{t('briefing.todayMemories')}</span>
                {todayMemories.length > 0 ? (
                  <div className="brief__evidence-rows">
                    {todayMemories.slice(0, TODAY_MEMORIES_LIMIT).map((m) => (
                      <MemoryRow key={m.id} memory={m} payload={payload} onSelect={(id) => ui.openMemoryPage(id)} />
                    ))}
                  </div>
                ) : (
                  <p className="brief__line brief__line--quiet">{t('briefing.todayMemoriesNone')}</p>
                )}
                <button className="brief__evidence" data-testid="brief-write-today" onClick={() => ui.setView('diary')}>
                  {t('briefing.writeToday')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="home__row">
          {rowHead('info', t('briefing.row.info'), infoSummary)}
          {open.has('info') && (
            <div className="home__body">
              {unchecked.length > 0 && (
                <div className="brief__block" data-testid="brief-organizing">
                  <span className="brief__eyebrow">{t('briefing.organizing')}</span>
                  {reviewBite && (
                    <button className="brief__row" data-testid="brief-review-three" onClick={startReview}>
                      <span className="brief__text">{t('briefing.reviewThree')}</span>
                    </button>
                  )}
                  <button
                    className={`brief__row${reviewBite ? ' brief__row--quiet' : ''}`}
                    data-testid="brief-awaiting"
                    onClick={() => ui.setView('sources')}
                  >
                    <span className="brief__text">{t('briefing.awaiting', { count: unchecked.length })}</span>
                    <span className="brief__meta">→</span>
                  </button>
                </div>
              )}
              {lately && (
                <div className="brief__block" data-testid="brief-lately">
                  <span className="brief__eyebrow">{t('briefing.lately')}</span>
                  <p className="brief__lately">
                    {latelyLead}
                    {latelyOpen && latelyRest ? ` ${latelyRest}` : ''}
                  </p>
                  <span className="home__inline">
                    {latelyRest && (
                      <button
                        className="brief__evidence"
                        data-testid="brief-lately-more"
                        aria-expanded={latelyOpen}
                        onClick={() => setLatelyOpen((v) => !v)}
                      >
                        {latelyOpen ? t('briefing.less') : t('briefing.more')}
                      </button>
                    )}
                    {evidence.length > 0 && (
                      <button
                        className="brief__evidence"
                        data-testid="brief-evidence"
                        aria-expanded={evidenceOpen}
                        onClick={() => setEvidenceOpen((v) => !v)}
                      >
                        {t('briefing.evidence', { count: evidence.length })} {evidenceOpen ? '↑' : '→'}
                      </button>
                    )}
                  </span>
                  {evidenceOpen && (
                    <div className="brief__evidence-rows" data-testid="brief-evidence-rows">
                      {evidence.map((m) => (
                        <MemoryRow key={m.id} memory={m} payload={payload} onSelect={(id) => ui.openMemoryPage(id)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* The import door outlives the welcome — it lives with the pile it feeds. */}
              <button
                className="brief__evidence"
                data-testid="home-import-link"
                aria-expanded={importOpen}
                onClick={() => setImportOpen((v) => !v)}
              >
                ⤓ {t('arc.importLink')}
              </button>
              {importOpen && <SourceChips />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
