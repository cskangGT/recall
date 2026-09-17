import { describe, it, expect } from 'vitest';
import { morningCardOf, localDay } from '../../src/core/morning';
import type { GraphPayload } from '../../src/core/types';
import type { Meeting } from '../../src/core/meetingTypes';

/**
 * The morning card speaks at most once a day and only when it is true:
 * yesterday's diary page first, otherwise the best overnight link between a
 * fresh memory (≤48h) and a settled one (≥7d). No candidate, no card. A
 * meeting still ahead today outranks both — the day ahead is the strongest pull.
 */

const NOW = new Date('2026-08-21T09:00:00');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const mem = (id: string, src: string, vector: number[], createdHoursAgo: number) => ({
  id,
  source_id: src,
  text: `memory ${id}`,
  kind: 'fact',
  confidence: 1,
  category_id: 'cat_a',
  category_locked: false,
  entity_ids: [],
  vector,
  x: null,
  y: null,
  pinned: false,
  created_at: hoursAgo(createdHoursAgo),
});

const payloadWith = (memories: unknown[], sources: unknown[] = []) =>
  ({ memories, sources, categories: [], entities: [] }) as unknown as GraphPayload;

const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
const meeting = (id: string, startH: number, endH: number): Meeting => ({
  id,
  title: `meeting ${id}`,
  startsAt: hoursFromNow(startH),
  endsAt: hoursFromNow(endH),
  allDay: false,
  location: null,
  description: null,
  meetLink: null,
  htmlLink: null,
  attendees: [],
});

describe('morningCardOf', () => {
  it('links a fresh memory to a settled one it points at', () => {
    const card = morningCardOf(
      payloadWith([
        mem('m_new', 'src_1', [1, 0], 10),
        mem('m_old', 'src_2', [0.95, 0.3], 24 * 30),
      ]),
      NOW,
    );
    expect(card?.kind).toBe('link');
    if (card?.kind === 'link') {
      expect(card.recent.id).toBe('m_new');
      expect(card.older.id).toBe('m_old');
    }
  });

  it('says nothing when the only neighbour is also fresh', () => {
    const card = morningCardOf(
      payloadWith([
        mem('m_new', 'src_1', [1, 0], 10),
        mem('m_also_new', 'src_2', [0.95, 0.3], 30),
      ]),
      NOW,
    );
    expect(card).toBeNull();
  });

  it('says nothing when nothing arrived recently', () => {
    const card = morningCardOf(
      payloadWith([
        mem('m_a', 'src_1', [1, 0], 24 * 10),
        mem('m_b', 'src_2', [0.95, 0.3], 24 * 30),
      ]),
      NOW,
    );
    expect(card).toBeNull();
  });

  it('says nothing when the fresh memory has no real neighbour', () => {
    const card = morningCardOf(
      payloadWith([
        mem('m_new', 'src_1', [1, 0], 10),
        mem('m_far', 'src_2', [0, 1], 24 * 30),
      ]),
      NOW,
    );
    expect(card).toBeNull();
  });

  it("prefers yesterday's diary page over any link", () => {
    const yesterday = localDay(new Date(NOW.getTime() - 24 * 3600_000));
    const card = morningCardOf(
      payloadWith(
        [mem('m_new', 'src_1', [1, 0], 10), mem('m_old', 'src_2', [0.95, 0.3], 24 * 30)],
        [{ id: 'src_d', diary_date: yesterday }],
      ),
      NOW,
    );
    expect(card).toEqual({ kind: 'diary', sourceId: 'src_d', date: yesterday });
  });

  it("today's meetings still ahead outrank the diary and the link", () => {
    const yesterday = localDay(new Date(NOW.getTime() - 24 * 3600_000));
    const card = morningCardOf(
      payloadWith(
        [mem('m_new', 'src_1', [1, 0], 10), mem('m_old', 'src_2', [0.95, 0.3], 24 * 30)],
        [{ id: 'src_d', diary_date: yesterday }],
      ),
      NOW,
      // 09:00 now: one ended at 08:30, one runs 10:00–11:00, one at 14:00.
      [meeting('later', 5, 6), meeting('done', -1, -0.5), meeting('next', 1, 2)],
    );
    expect(card?.kind).toBe('meetings');
    if (card?.kind === 'meetings') {
      expect(card.count).toBe(2);
      expect(card.first.id).toBe('next');
    }
  });

  it('a meeting tomorrow, or one already over, is no reason for a card', () => {
    const card = morningCardOf(payloadWith([]), NOW, [meeting('tmrw', 26, 27), meeting('done', -3, -2)]);
    expect(card).toBeNull();
  });

  it('on the first day, says what the day made — before any other card', () => {
    const card = morningCardOf(
      payloadWith([mem('m_a', 'src_1', [1, 0], 2), mem('m_b', 'src_2', [0, 1], 3)]),
      NOW,
      [meeting('m1', 1, 2)],
      localDay(NOW),
    );
    expect(card).toEqual({ kind: 'firstDay', count: 2 });
  });

  it('a first-day stamp from another day is silent', () => {
    const card = morningCardOf(payloadWith([]), NOW, [], '2026-08-20');
    expect(card).toBeNull();
  });
});
