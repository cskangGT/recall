import { describe, it, expect } from 'vitest';
import { morningCardOf, localDay } from '../../src/core/morning';
import type { GraphPayload } from '../../src/core/types';

/**
 * The morning card speaks at most once a day and only when it is true:
 * yesterday's diary page first, otherwise the best overnight link between a
 * fresh memory (≤48h) and a settled one (≥7d). No candidate, no card.
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
});
