import type { Meeting } from './meetingTypes';
import type { Locale } from '../i18n';

/**
 * The calendar, laid out by day.
 *
 * The server hands over a flat window — a week back, two ahead — and this is
 * the only place that turns UTC instants into the person's own days. Groups
 * are what a glance wants: today first, then tomorrow, the rest of this week,
 * next week, whatever is further out, and — last, because it is the least
 * urgent — what already happened. Pure over its inputs so the boundaries
 * (midnight, Monday) can be pinned in a test.
 */

export type MeetingGroupKey = 'past' | 'today' | 'tomorrow' | 'week' | 'next' | 'later';

export interface MeetingGroup<M extends Meeting = Meeting> {
  key: MeetingGroupKey;
  meetings: M[];
}

/** A Date as the local calendar day it belongs to (YYYY-MM-DD). */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ORDER: MeetingGroupKey[] = ['today', 'tomorrow', 'week', 'next', 'later', 'past'];
const DAY_MS = 24 * 3600_000;

/** Midnight (local) of the day `d` falls on. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The local day a meeting belongs to. */
export function meetingDay(meeting: Meeting): string {
  // An all-day event is stored as midnight UTC of its date, which in most of
  // the world's timezones is some other instant of the evening before. Its
  // date is the date it says, not the day that instant lands on locally.
  return meeting.allDay ? meeting.startsAt.slice(0, 10) : localDay(new Date(meeting.startsAt));
}

/** The instant a meeting is over, in the local sense used to file it as past. */
function endInstant(meeting: Meeting): number {
  if (!meeting.allDay) return Date.parse(meeting.endsAt);
  // The exclusive end date, as a local midnight.
  const [y, m, d] = meeting.endsAt.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getTime();
}

export function isOver(meeting: Meeting, now: Date): boolean {
  return endInstant(meeting) < now.getTime();
}

export function groupMeetings<M extends Meeting>(meetings: M[], now: Date): MeetingGroup<M>[] {
  const today = startOfDay(now);
  const todayKey = localDay(today);
  const tomorrowKey = localDay(new Date(today.getTime() + DAY_MS));
  // Weeks run Monday to Sunday; getDay() counts from Sunday.
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY_MS);
  const weekEnd = localDay(new Date(monday.getTime() + 6 * DAY_MS));
  const nextWeekEnd = localDay(new Date(monday.getTime() + 13 * DAY_MS));

  const buckets = new Map<MeetingGroupKey, M[]>();
  for (const meeting of meetings) {
    const day = meetingDay(meeting);
    // Today keeps its finished meetings — dimmed by the view, not filed away:
    // at eleven at night the day is still the day.
    const key: MeetingGroupKey = day < todayKey || (day !== todayKey && isOver(meeting, now))
      ? 'past'
      : day === todayKey
        ? 'today'
        : day === tomorrowKey
          ? 'tomorrow'
          : day <= weekEnd
            ? 'week'
            : day <= nextWeekEnd
              ? 'next'
              : 'later';
    buckets.set(key, [...(buckets.get(key) ?? []), meeting]);
  }

  return ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    meetings: [...buckets.get(key)!].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  }));
}

/** How many names the row spells out before it starts counting. */
const NAMES_SHOWN = 3;

/**
 * Who else is in the room: the organizer first, the self never, three names
 * and a count for the rest. The caller wraps it in the sentence ("you + …").
 */
export function attendeeLine(meeting: Meeting): string {
  const others = meeting.attendees
    .filter((a) => !a.self)
    .sort((a, b) => Number(b.organizer) - Number(a.organizer));
  if (others.length === 0) return '';
  const names = others.slice(0, NAMES_SHOWN).map((a) => a.name);
  const rest = others.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest}` : names.join(', ');
}

/** An instant as the local wall clock, 24h, zero-padded. */
export function formatClock(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** The time column: the local start, or nothing for an all-day event. */
export function formatTime(meeting: Meeting, locale: Locale): string {
  return meeting.allDay ? '' : formatClock(meeting.startsAt, locale);
}
