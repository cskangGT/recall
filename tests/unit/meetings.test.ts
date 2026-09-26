import { describe, it, expect } from 'vitest';
import { groupMeetings, attendeeLine, formatTime } from '../../src/core/meetings';
import type { Meeting, Attendee } from '../../src/core/meetingTypes';

/**
 * The calendar laid out by day. `now` is frozen at a Wednesday mid-morning so
 * every boundary — midnight, the end of the week, the end of next week — is a
 * fixed number of hours away. Times are built from local wall-clock parts and
 * serialized to UTC, the way the server sends them.
 */

// Wednesday 16 September 2026, 10:00 local.
const NOW = new Date(2026, 8, 16, 10, 0, 0);

const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).toISOString();

const me: Attendee = { name: 'Me', email: 'me@example.com', self: true, organizer: false };
const person = (name: string, organizer = false): Attendee => ({
  name,
  email: `${name.toLowerCase()}@example.com`,
  self: false,
  organizer,
});

const meeting = (id: string, startsAt: string, endsAt: string, extra: Partial<Meeting> = {}): Meeting => ({
  id,
  title: `meeting ${id}`,
  startsAt,
  endsAt,
  allDay: false,
  location: null,
  description: null,
  meetLink: null,
  htmlLink: null,
  attendees: [me],
  ...extra,
});

describe('groupMeetings', () => {
  it('puts today, tomorrow, this week, next week, later in that order and past last', () => {
    const groups = groupMeetings(
      [
        meeting('later', at(2026, 10, 5, 9), at(2026, 10, 5, 10)),
        meeting('past', at(2026, 9, 14, 9), at(2026, 9, 14, 10)),
        meeting('next', at(2026, 9, 22, 9), at(2026, 9, 22, 10)),
        meeting('week', at(2026, 9, 19, 9), at(2026, 9, 19, 10)),
        meeting('tomorrow', at(2026, 9, 17, 9), at(2026, 9, 17, 10)),
        meeting('today', at(2026, 9, 16, 14), at(2026, 9, 16, 15)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'tomorrow', 'week', 'next', 'later', 'past']);
    expect(groups.map((g) => g.meetings.map((m) => m.id))).toEqual([
      ['today'],
      ['tomorrow'],
      ['week'],
      ['next'],
      ['later'],
      ['past'],
    ]);
  });

  it('omits empty groups', () => {
    const groups = groupMeetings([meeting('t', at(2026, 9, 17, 9), at(2026, 9, 17, 10))], NOW);
    expect(groups.map((g) => g.key)).toEqual(['tomorrow']);
    expect(groupMeetings([], NOW)).toEqual([]);
  });

  it('orders within a group by start time', () => {
    const groups = groupMeetings(
      [
        meeting('b', at(2026, 9, 16, 16), at(2026, 9, 16, 17)),
        meeting('a', at(2026, 9, 16, 11), at(2026, 9, 16, 12)),
      ],
      NOW,
    );
    expect(groups[0]?.meetings.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('a meeting that ended earlier today is still today — dimmed, not filed away', () => {
    const groups = groupMeetings(
      [
        meeting('done', at(2026, 9, 16, 8), at(2026, 9, 16, 9)),
        meeting('running', at(2026, 9, 16, 9, 30), at(2026, 9, 16, 10, 30)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['today']);
    expect(groups[0]?.meetings.map((m) => m.id)).toEqual(['done', 'running']);
  });

  it('respects midnight: 23:59 is today, 00:00 is tomorrow', () => {
    const groups = groupMeetings(
      [
        meeting('late', at(2026, 9, 16, 23, 59), at(2026, 9, 17, 0, 30)),
        meeting('early', at(2026, 9, 17, 0, 0), at(2026, 9, 17, 1)),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.meetings.map((m) => m.id)])).toEqual([
      ['today', ['late']],
      ['tomorrow', ['early']],
    ]);
  });

  it('the week runs Monday to Sunday: Sunday is this week, Monday is next', () => {
    const groups = groupMeetings(
      [
        meeting('sun', at(2026, 9, 20, 9), at(2026, 9, 20, 10)),
        meeting('mon', at(2026, 9, 21, 9), at(2026, 9, 21, 10)),
        meeting('nextSun', at(2026, 9, 27, 23), at(2026, 9, 27, 23, 30)),
        meeting('after', at(2026, 9, 28, 0), at(2026, 9, 28, 1)),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.meetings.map((m) => m.id)])).toEqual([
      ['week', ['sun']],
      ['next', ['mon', 'nextSun']],
      ['later', ['after']],
    ]);
  });

  it('files an all-day event by its date, not by the UTC midnight it is stored at', () => {
    // Google stores an all-day event as midnight UTC of its date, exclusive end
    // the next midnight. In any western timezone that instant is the evening
    // before — the event must still land on its own day.
    const groups = groupMeetings(
      [
        meeting('allday', '2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z', { allDay: true }),
        meeting('alldayToday', '2026-09-16T00:00:00.000Z', '2026-09-17T00:00:00.000Z', { allDay: true }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.meetings.map((m) => m.id)])).toEqual([
      ['today', ['alldayToday']],
      ['tomorrow', ['allday']],
    ]);
  });

  it('an all-day event of a previous day is past', () => {
    const groups = groupMeetings(
      [meeting('yday', '2026-09-15T00:00:00.000Z', '2026-09-16T00:00:00.000Z', { allDay: true })],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['past']);
  });
});

describe('attendeeLine', () => {
  it('names the others, organizer first, and never the self', () => {
    const m = meeting('x', at(2026, 9, 16, 14), at(2026, 9, 16, 15), {
      attendees: [person('Jun'), me, person('Sujin', true)],
    });
    expect(attendeeLine(m)).toBe('Sujin, Jun');
  });

  it('is empty when there is nobody else', () => {
    expect(attendeeLine(meeting('x', at(2026, 9, 16, 14), at(2026, 9, 16, 15)))).toBe('');
  });

  it('caps at three names and counts the rest', () => {
    const m = meeting('x', at(2026, 9, 16, 14), at(2026, 9, 16, 15), {
      attendees: [me, person('A'), person('B'), person('C'), person('D'), person('E')],
    });
    expect(attendeeLine(m)).toBe('A, B, C +2');
  });
});

describe('formatTime', () => {
  it('is the local wall clock, 24h, zero-padded', () => {
    expect(formatTime(meeting('x', at(2026, 9, 16, 9, 5), at(2026, 9, 16, 10)), 'en')).toBe('09:05');
    expect(formatTime(meeting('x', at(2026, 9, 16, 0, 0), at(2026, 9, 16, 1)), 'ko')).toBe('00:00');
    expect(formatTime(meeting('x', at(2026, 9, 16, 15, 30), at(2026, 9, 16, 16)), 'en')).toBe('15:30');
  });

  it('is empty for an all-day event', () => {
    expect(
      formatTime(
        meeting('x', '2026-09-16T00:00:00.000Z', '2026-09-17T00:00:00.000Z', { allDay: true }),
        'en',
      ),
    ).toBe('');
  });
});
