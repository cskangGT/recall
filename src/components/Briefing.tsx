import { Fragment, useMemo, useState } from 'react';
import { t, currentLocale } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { briefingOf } from '../core/briefing';
import { groupMeetings, formatTime, attendeeLine, isOver, localDay } from '../core/meetings';
import { dayPartOf, briefingOrder, type BriefingBlock } from '../core/dayPart';
import type { MeetingWithContext } from '../core/meetingTypes';
import type { Memory } from '../core/types';
import { MemoryRow } from './Inspector';

/**
 * The first page of home.
 *
 * A second brain, sat down with, should say what it holds — not hand over
 * a list of folders. So home opens on a briefing: the day and what is on
 * it, what has been on the mind lately in the memory's own voice, the
 * questions and decisions of the fortnight, where the thinking has been
 * growing, what is still waiting to be sorted. Every line is a door: a
 * concern opens as a page, a growing category opens its reading list, the
 * day opens the meetings, the waiting count opens the originals.
 *
 * Sentences and rows, not tiles. If it looks like a dashboard it has
 * failed; the design rule is spacing, not boxes.
 *
 * The blocks are the same all day; their order is not. Morning opens on the
 * day ahead, the afternoon on what there is to sort, the evening on what
 * came in today and the page that closes it (see core/dayPart). One line of
 * greeting under the date is the only other thing the hour changes.
 */

/** How many of today's memories the evening block shows before it is a list. */
const TODAY_MEMORIES_LIMIT = 5;
/** "Just three today" — small enough to start, and the offer only above it. */
const REVIEW_BITE = 3;

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

export function Briefing() {
  const payload = useWorkspaceStore((s) => s.payload);
  const meetings = useWorkspaceStore((s) => s.meetings);
  const lately = useWorkspaceStore((s) => s.lately);
  const hasCalendarDoor = Boolean(useWorkspaceStore((s) => s.source.listMeetings));
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const brief = useMemo(() => (payload ? briefingOf(payload) : null), [payload]);

  /*
   * Today's meetings that are still ahead, up to three — and when there are
   * none, the next one anywhere in the window, named by its day. At eleven at
   * night "nothing today" is true and useless; "tomorrow 11:00, coffee with
   * Haneul" is what the person actually checks the page for.
   */
  const today = useMemo(() => {
    if (!meetings?.connected) {
      return { ahead: [] as MeetingWithContext[], next: null as null | { meeting: MeetingWithContext; when: string } };
    }
    const now = new Date();
    const groups = groupMeetings(meetings.meetings, now);
    const todayGroup = groups.find((g) => g.key === 'today');
    const ahead = (todayGroup?.meetings ?? []).filter((m) => !isOver(m, now)).slice(0, 3);
    if (ahead.length > 0) return { ahead, next: null };
    for (const g of groups) {
      if (g.key === 'today' || g.key === 'past') continue;
      const first = g.meetings[0];
      if (first) return { ahead: [], next: { meeting: first, when: t(GROUP_KEY[g.key]) } };
    }
    return { ahead: [], next: null };
  }, [meetings]);

  if (!payload || !brief) return null;
  const ui = useUiStore.getState();
  const locale = currentLocale();
  const now = new Date();
  const part = dayPartOf(now);
  const greeting =
    part === 'morning' ? t('briefing.greeting.morning') : part === 'evening' ? t('briefing.greeting.evening') : null;

  /* What came in today, newest first — the evening's material. */
  const todayKey = localDay(now);
  const todayMemories =
    part === 'evening'
      ? payload.memories
          .filter((m) => localDay(new Date(m.created_at)) === todayKey)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
      : [];

  /*
   * "Twenty-two originals not yet checked" reads as homework. Above a small
   * pile the offer is three — the oldest three, so the pile shrinks from the
   * end that has waited longest.
   */
  const held = new Set(payload.memories.map((m) => m.source_id));
  const unchecked = payload.sources
    .filter((s) => !s.reviewed_at && held.has(s.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const reviewBite = unchecked.length > REVIEW_BITE ? unchecked.slice(0, REVIEW_BITE).map((s) => s.id) : null;

  const dateLine = now.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-GB', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const open = (m: Memory) => ui.openMemoryPage(m.id);
  const openCategory = (id: string) => {
    ui.openCategory(id);
    ui.select(id);
  };
  const evidence = lately
    ? lately.citations
        .map((c) => payload.memories.find((m) => m.id === c.memory_id))
        .filter((m): m is Memory => m !== undefined)
    : [];
  const empty = brief.concerns.length === 0 && brief.learning.length === 0 && !lately;

  const meetingRow = (m: MeetingWithContext, when?: string) => (
    <button
      key={m.id}
      className="brief__row"
      data-testid={`brief-meeting-${m.id}`}
      onClick={() => ui.setView('meetings')}
    >
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

  const blocks: Record<BriefingBlock, React.ReactNode> = {
    today: hasCalendarDoor && (
        <div className="brief__block" data-testid="brief-today">
          <span className="brief__eyebrow">
            {today.next ? t('briefing.next') : t('briefing.today')}
          </span>
          {!meetings?.connected ? (
            <button className="brief__line brief__line--quiet" onClick={() => ui.setView('meetings')}>
              {t('briefing.todayConnect')}
            </button>
          ) : today.ahead.length > 0 ? (
            today.ahead.map((m) => meetingRow(m))
          ) : today.next ? (
            meetingRow(today.next.meeting, today.next.when)
          ) : (
            <p className="brief__line brief__line--quiet">{t('briefing.todayNone')}</p>
          )}
        </div>
      ),
    /* The evening's own block: what came in today, and the page that closes it. */
    todayMemories: part === 'evening' && (
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
    ),
    lately: lately && (
        <div className="brief__block" data-testid="brief-lately">
          <span className="brief__eyebrow">{t('briefing.lately')}</span>
          <p className="brief__lately">
            {lately.answer.replace(/\[\d+\]/g, '').replace(/\s+([.,])/g, '$1')}
          </p>
          {evidence.length > 0 && (
            <>
              <button
                className="brief__evidence"
                data-testid="brief-evidence"
                aria-expanded={evidenceOpen}
                onClick={() => setEvidenceOpen((v) => !v)}
              >
                {t('briefing.evidence', { count: evidence.length })} {evidenceOpen ? '↑' : '→'}
              </button>
              {evidenceOpen && (
                <div className="brief__evidence-rows" data-testid="brief-evidence-rows">
                  {evidence.map((m) => (
                    <MemoryRow key={m.id} memory={m} payload={payload} onSelect={(id) => ui.openMemoryPage(id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ),
    concerns: brief.concerns.length > 0 && (
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
      ),
    growing: brief.learning.length > 0 && (
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
          </span>
        </div>
      ),
    organizing: (brief.organizing.awaitingReview > 0 || brief.organizing.arrived > 0) && (
        <div className="brief__block" data-testid="brief-organizing">
          <span className="brief__eyebrow">{t('briefing.organizing')}</span>
          {reviewBite && (
            <button
              className="brief__row"
              data-testid="brief-review-three"
              onClick={() => ui.openReview(reviewBite)}
            >
              <span className="brief__text">{t('briefing.reviewThree')}</span>
            </button>
          )}
          {brief.organizing.awaitingReview > 0 && (
            <button
              className={`brief__row${reviewBite ? ' brief__row--quiet' : ''}`}
              data-testid="brief-awaiting"
              onClick={() => ui.setView('sources')}
            >
              <span className="brief__text">{t('briefing.awaiting', { count: brief.organizing.awaitingReview })}</span>
              <span className="brief__meta">→</span>
            </button>
          )}
          {brief.organizing.arrived > 0 && (
            <p className="brief__line brief__line--quiet">
              {t('briefing.arrived', { count: brief.organizing.arrived })}
            </p>
          )}
        </div>
      ),
  };

  return (
    <section className="brief" data-testid="briefing" data-daypart={part}>
      <p className="brief__date">
        {dateLine}
        {greeting && (
          <span className="brief__greeting" data-testid="brief-greeting">
            {greeting}
          </span>
        )}
      </p>

      {briefingOrder(part).map((key) => (
        <Fragment key={key}>{blocks[key]}</Fragment>
      ))}

      {empty && <p className="brief__line brief__line--quiet">{t('briefing.nothingYet')}</p>}
    </section>
  );
}
