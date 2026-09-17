import type { Attendee, Meeting } from '../../src/core/meetingTypes.ts';

/**
 * The Calendar API, read-only, raw fetch.
 *
 * One endpoint — the primary calendar's events in a window, recurring series
 * already expanded (`singleEvents=true`) so each occurrence is its own row
 * with its own id. The parser is exported on its own because the event shape
 * is the part that can actually break, and pinning it against fixtures needs
 * no network.
 */

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
/** Google's own ceiling per page; three weeks of one calendar fits in one. */
const PAGE_SIZE = 250;

type FetchLike = typeof fetch;

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * A moment in UTC, from either shape Google uses: `dateTime` for a timed
 * event (any offset — normalized here), `date` for an all-day one, which
 * becomes midnight UTC of that day so the client can put it on a calendar
 * day without asking which zone the calendar meant.
 */
function whenOf(value: unknown): { iso: string; allDay: boolean } | null {
  const when = asRecord(value);
  if (typeof when.date === 'string') {
    const ms = Date.parse(`${when.date}T00:00:00.000Z`);
    return Number.isFinite(ms) ? { iso: new Date(ms).toISOString(), allDay: true } : null;
  }
  if (typeof when.dateTime === 'string') {
    const ms = Date.parse(when.dateTime);
    return Number.isFinite(ms) ? { iso: new Date(ms).toISOString(), allDay: false } : null;
  }
  return null;
}

function attendeeOf(value: unknown): Attendee | null {
  const a = asRecord(value);
  const email = text(a.email);
  if (!email) return null;
  return {
    name: text(a.displayName) ?? email.split('@')[0] ?? email,
    email,
    self: a.self === true,
    organizer: a.organizer === true,
  };
}

/**
 * One API event → one Meeting, or null for what is not a meeting to show: a
 * cancelled instance (Google returns those inside an expanded series), or a
 * row missing the two things a meeting cannot do without, an id and a start.
 */
export function parseEvent(raw: unknown): Meeting | null {
  const e = asRecord(raw);
  const id = text(e.id);
  if (!id || e.status === 'cancelled') return null;
  const start = whenOf(e.start);
  if (!start) return null;
  // An end is optional in the API (a bare "moment"); the start stands in.
  const end = whenOf(e.end) ?? start;

  return {
    id,
    title: text(e.summary) ?? '(untitled)',
    startsAt: start.iso,
    endsAt: end.iso,
    allDay: start.allDay,
    location: text(e.location),
    description: text(e.description),
    meetLink: text(e.hangoutLink),
    htmlLink: text(e.htmlLink),
    attendees: (Array.isArray(e.attendees) ? e.attendees : [])
      .map(attendeeOf)
      .filter((a): a is Attendee => a !== null),
  };
}

/**
 * Every event starting in [timeMin, timeMax], across however many pages
 * Google splits them into. A 401 is named for what it is — the token was
 * refused — because the caller's answer to that is different from its
 * answer to Google being down.
 */
export async function listEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  fetchFn: FetchLike = fetch,
): Promise<Meeting[]> {
  const meetings: Meeting[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin,
      timeMax,
      maxResults: String(PAGE_SIZE),
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetchFn(`${EVENTS_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Google rejected the token');
      const detail = await response.text().catch(() => '');
      throw new Error(`Google answered ${response.status}: ${detail.slice(0, 160)}`);
    }
    const page = (await response.json()) as { items?: unknown[]; nextPageToken?: string };
    for (const item of page.items ?? []) {
      const meeting = parseEvent(item);
      if (meeting) meetings.push(meeting);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return meetings;
}
