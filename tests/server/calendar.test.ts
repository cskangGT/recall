import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { parseEvent, listEvents } from '../../server/google/calendar';
import { syncMeetings, syncWindow, SYNC_STALE_MS } from '../../server/google/meetings';
import { CALENDAR_SCOPE, GoogleAuth } from '../../server/google/oauth';
import { MEETINGS_AHEAD_DAYS, MEETINGS_PAST_DAYS, type Meeting } from '../../src/core/meetingTypes';

/**
 * The Calendar API's event shape, pinned; the page walk against a two-page
 * fake; and the sync's rules — a window, a staleness clock, and a failure
 * that leaves the last good list alone.
 */

const CONFIG = {
  clientId: 'id', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:5170/api/google/callback',
};

describe('parseEvent', () => {
  it('reads a timed event with its attendees, links and place', () => {
    const meeting = parseEvent({
      id: 'abc123',
      status: 'confirmed',
      summary: 'Roadmap review',
      description: 'Bring the Q4 list',
      location: 'Room 4',
      htmlLink: 'https://calendar.google.com/event?eid=abc',
      hangoutLink: 'https://meet.google.com/xyz-abcd-efg',
      start: { dateTime: '2026-09-17T10:00:00+09:00' },
      end: { dateTime: '2026-09-17T11:00:00+09:00' },
      attendees: [
        { email: 'sung@example.com', self: true, organizer: true, responseStatus: 'accepted' },
        { email: 'jane.doe@example.com', displayName: 'Jane Doe' },
        { email: 'bob@example.com' },
      ],
    });
    expect(meeting).toEqual<Meeting>({
      id: 'abc123',
      title: 'Roadmap review',
      startsAt: '2026-09-17T01:00:00.000Z',
      endsAt: '2026-09-17T02:00:00.000Z',
      allDay: false,
      location: 'Room 4',
      description: 'Bring the Q4 list',
      meetLink: 'https://meet.google.com/xyz-abcd-efg',
      htmlLink: 'https://calendar.google.com/event?eid=abc',
      attendees: [
        { name: 'sung', email: 'sung@example.com', self: true, organizer: true },
        { name: 'Jane Doe', email: 'jane.doe@example.com', self: false, organizer: false },
        { name: 'bob', email: 'bob@example.com', self: false, organizer: false },
      ],
    });
  });

  it('an all-day event is midnight UTC of its date, with the exclusive end kept', () => {
    const meeting = parseEvent({
      id: 'day1', summary: 'Offsite',
      start: { date: '2026-09-20' }, end: { date: '2026-09-21' },
    })!;
    expect(meeting.allDay).toBe(true);
    expect(meeting.startsAt).toBe('2026-09-20T00:00:00.000Z');
    expect(meeting.endsAt).toBe('2026-09-21T00:00:00.000Z');
    expect(meeting.attendees).toEqual([]);
    expect(meeting.location).toBeNull();
    expect(meeting.meetLink).toBeNull();
  });

  it('skips cancelled events and anything without an id or a start', () => {
    expect(parseEvent({ id: 'x', status: 'cancelled', start: { dateTime: '2026-09-17T10:00:00Z' } })).toBeNull();
    expect(parseEvent({ summary: 'no id', start: { dateTime: '2026-09-17T10:00:00Z' } })).toBeNull();
    expect(parseEvent({ id: 'x', summary: 'no start' })).toBeNull();
    expect(parseEvent(null)).toBeNull();
  });

  it('names an untitled event and drops attendees without an email', () => {
    const meeting = parseEvent({
      id: 'u', start: { dateTime: '2026-09-17T10:00:00Z' }, end: { dateTime: '2026-09-17T10:30:00Z' },
      attendees: [{ displayName: 'ghost' }],
    })!;
    expect(meeting.title).toBe('(untitled)');
    expect(meeting.attendees).toEqual([]);
  });
});

describe('listEvents', () => {
  const page = (ids: string[], nextPageToken?: string) => ({
    items: ids.map((id) => ({
      id, summary: id, start: { dateTime: '2026-09-17T10:00:00Z' }, end: { dateTime: '2026-09-17T11:00:00Z' },
    })),
    ...(nextPageToken ? { nextPageToken } : {}),
  });

  it('walks every page with the bearer token and the window', async () => {
    const calls: URL[] = [];
    const headers: Record<string, string>[] = [];
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      const u = new URL(url);
      calls.push(u);
      headers.push(init?.headers ?? {});
      const body = u.searchParams.get('pageToken') === 'p2' ? page(['c']) : page(['a', 'b'], 'p2');
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    }) as unknown as typeof fetch;

    const meetings = await listEvents('ya29.x', '2026-09-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z', fetchImpl);
    expect(meetings.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.origin + calls[0]!.pathname).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(calls[0]!.searchParams.get('singleEvents')).toBe('true');
    expect(calls[0]!.searchParams.get('orderBy')).toBe('startTime');
    expect(calls[0]!.searchParams.get('timeMin')).toBe('2026-09-10T00:00:00.000Z');
    expect(calls[0]!.searchParams.get('timeMax')).toBe('2026-10-01T00:00:00.000Z');
    expect(calls[0]!.searchParams.get('maxResults')).toBe('250');
    expect(calls[0]!.searchParams.get('pageToken')).toBeNull();
    expect(calls[1]!.searchParams.get('pageToken')).toBe('p2');
    expect(headers[0]!.authorization).toBe('Bearer ya29.x');
  });

  it('says the honest thing on a rejected token, and quotes any other failure', async () => {
    const unauthorized = (async () => ({
      ok: false, status: 401, json: async () => ({}), text: async () => 'unauthorized',
    })) as unknown as typeof fetch;
    await expect(listEvents('bad', 'a', 'b', unauthorized)).rejects.toThrow('Google rejected the token');

    const flaky = (async () => ({
      ok: false, status: 503, json: async () => ({}), text: async () => 'backend error',
    })) as unknown as typeof fetch;
    await expect(listEvents('ok', 'a', 'b', flaky)).rejects.toThrow('Google answered 503: backend error');
  });
});

// ---------------------------------------------------------------- rows

const WS = 'ws_demo';
let repo: SqliteRepository;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  repo.createWorkspace({ id: WS, name: 'demo' });
});

afterEach(() => repo.close());

const meeting = (id: string, startsAt: string, extra: Partial<Meeting> = {}): Meeting => ({
  id, title: id, startsAt, endsAt: new Date(Date.parse(startsAt) + 3600_000).toISOString(),
  allDay: false, location: null, description: null, meetLink: null, htmlLink: null,
  attendees: [{ name: 'Jane', email: 'jane@example.com', self: false, organizer: true }],
  ...extra,
});

describe('meeting rows', () => {
  it('replaces the window in one go and lists it in start order', () => {
    expect(repo.meetingsSyncedAt(WS)).toBeNull();
    repo.replaceMeetings(WS, '2026-09-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z', [
      meeting('late', '2026-09-20T10:00:00.000Z'),
      meeting('early', '2026-09-12T10:00:00.000Z', { allDay: true, location: 'Room 4' }),
    ], '2026-09-16T09:00:00.000Z');
    expect(repo.meetingsSyncedAt(WS)).toBe('2026-09-16T09:00:00.000Z');

    const listed = repo.listMeetings(WS, '2026-09-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    expect(listed.map((m) => m.id)).toEqual(['early', 'late']);
    expect(listed[0]).toEqual(meeting('early', '2026-09-12T10:00:00.000Z', { allDay: true, location: 'Room 4' }));

    // A second sync of the same window drops what Google no longer returns.
    repo.replaceMeetings(WS, '2026-09-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z', [
      meeting('late', '2026-09-20T11:00:00.000Z'),
    ], '2026-09-16T10:00:00.000Z');
    const again = repo.listMeetings(WS, '2026-09-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    expect(again.map((m) => m.id)).toEqual(['late']);
    expect(again[0]!.startsAt).toBe('2026-09-20T11:00:00.000Z');
    expect(repo.meetingsSyncedAt(WS)).toBe('2026-09-16T10:00:00.000Z');
  });

  it('leaves rows outside the window alone and keeps workspaces apart', () => {
    repo.createWorkspace({ id: 'ws_other', name: 'other' });
    repo.replaceMeetings(WS, '2026-09-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z',
      [meeting('old', '2026-09-02T10:00:00.000Z')], '2026-09-07T00:00:00.000Z');
    repo.replaceMeetings('ws_other', '2026-09-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
      [meeting('theirs', '2026-09-12T10:00:00.000Z')], '2026-09-16T00:00:00.000Z');
    repo.replaceMeetings(WS, '2026-09-10T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
      [meeting('mine', '2026-09-12T10:00:00.000Z')], '2026-09-16T00:00:00.000Z');

    expect(repo.listMeetings(WS, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z').map((m) => m.id))
      .toEqual(['old', 'mine']);
    expect(repo.listMeetings('ws_other', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z').map((m) => m.id))
      .toEqual(['theirs']);
  });
});

// ---------------------------------------------------------------- sync

describe('syncMeetings', () => {
  const T0 = new Date('2026-09-16T09:00:00.000Z');
  let calendarCalls: number;
  let fetchImpl: typeof fetch;

  beforeEach(() => {
    calendarCalls = 0;
    repo.saveGoogleToken(WS, {
      email: 'sung@example.com', refresh_token: '1//r', access_token: 'ya29.ok',
      expires_at: new Date(T0.getTime() + 3600_000).toISOString(),
      scopes: CALENDAR_SCOPE, connected_at: T0.toISOString(),
    });
    fetchImpl = (async (url: string) => {
      if (!String(url).includes('/calendar/')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      calendarCalls += 1;
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({ items: [{ id: `ev${calendarCalls}`, summary: 'x', start: { dateTime: '2026-09-17T10:00:00Z' }, end: { dateTime: '2026-09-17T11:00:00Z' } }] }),
      };
    }) as unknown as typeof fetch;
  });

  const auth = () => new GoogleAuth(CONFIG, repo, fetchImpl, () => T0.getTime());

  it('covers a week back and two weeks ahead', () => {
    const { from, to } = syncWindow(T0);
    expect(from).toBe(new Date(T0.getTime() - MEETINGS_PAST_DAYS * 86400_000).toISOString());
    expect(to).toBe(new Date(T0.getTime() + MEETINGS_AHEAD_DAYS * 86400_000).toISOString());
  });

  it('syncs once, then trusts the stored list until it goes stale', async () => {
    let now = T0;
    const deps = { repo, auth: auth(), now: () => now };
    expect(await syncMeetings(deps, WS, {})).toEqual({ syncedAt: T0.toISOString(), reason: null });
    expect(repo.listMeetings(WS, syncWindow(T0).from, syncWindow(T0).to).map((m) => m.id)).toEqual(['ev1']);

    now = new Date(T0.getTime() + SYNC_STALE_MS - 1);
    expect(await syncMeetings(deps, WS, {})).toEqual({ syncedAt: T0.toISOString(), reason: null });
    expect(calendarCalls).toBe(1);

    now = new Date(T0.getTime() + SYNC_STALE_MS + 1);
    expect(await syncMeetings(deps, WS, {})).toEqual({ syncedAt: now.toISOString(), reason: null });
    expect(calendarCalls).toBe(2);
  });

  it('refresh asks again regardless', async () => {
    const deps = { repo, auth: auth(), now: () => T0 };
    await syncMeetings(deps, WS, {});
    await syncMeetings(deps, WS, { refresh: true });
    expect(calendarCalls).toBe(2);
  });

  it('a failed read keeps the last good rows and says why', async () => {
    const deps = { repo, auth: auth(), now: () => T0 };
    await syncMeetings(deps, WS, {});

    const later = new Date(T0.getTime() + SYNC_STALE_MS + 1);
    const broken = (async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' })) as unknown as typeof fetch;
    const result = await syncMeetings({ repo, auth: auth(), fetchFn: broken, now: () => later }, WS, {});
    expect(result).toEqual({ syncedAt: T0.toISOString(), reason: 'Google answered 500: boom' });
    expect(repo.listMeetings(WS, syncWindow(T0).from, syncWindow(T0).to).map((m) => m.id)).toEqual(['ev1']);
    expect(repo.meetingsSyncedAt(WS)).toBe(T0.toISOString());
  });

  it('a workspace that was never connected reports it without touching Google', async () => {
    repo.deleteGoogleToken(WS);
    const result = await syncMeetings({ repo, auth: auth(), now: () => T0 }, WS, {});
    expect(result).toEqual({ syncedAt: null, reason: 'not connected' });
    expect(calendarCalls).toBe(0);
  });
});
