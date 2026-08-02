import { describe, it, expect } from 'vitest';
import {
  decay,
  interestScores,
  rankByInterest,
  savesFrom,
  corpusNow,
  WEIGHT,
  HALF_LIFE_DAYS,
  HORIZON_DAYS,
  type InterestEvent,
  type SaveEvent,
} from '../../src/arc/interest';
import type { GraphPayload } from '../../src/core/types';

const NOW = new Date('2026-08-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('decay', () => {
  it('is worth everything today and half a half-life later', () => {
    expect(decay(0)).toBe(1);
    expect(decay(HALF_LIFE_DAYS)).toBeCloseTo(0.5, 10);
    expect(decay(HALF_LIFE_DAYS * 2)).toBeCloseTo(0.25, 10);
  });

  /**
   * Not an optimisation, a statement: without a floor a category with two
   * hundred memories from last year accumulates enough residue to sit on the
   * arc forever, and the arc stops being about lately at all.
   */
  it('is exactly nothing past the horizon', () => {
    expect(decay(HORIZON_DAYS)).toBe(0);
    expect(decay(HORIZON_DAYS + 500)).toBe(0);
    expect(decay(HORIZON_DAYS - 1)).toBeGreaterThan(0);
  });

  it('treats a future timestamp as now rather than as extra credit', () => {
    // Clock skew, or seed data authored ahead of today.
    expect(decay(-30)).toBe(1);
  });
});

describe('interestScores', () => {
  const saves = (ids: [string, number][]): SaveEvent[] =>
    ids.map(([categoryId, n]) => ({ categoryId, at: daysAgo(n) }));

  it('scores nothing for a category nobody has touched', () => {
    expect(interestScores([], [], NOW).get('cat_x')).toBeUndefined();
  });

  it('weights a question above a save above a visit', () => {
    const one = (kind: InterestEvent['kind']) =>
      interestScores([], [{ categoryId: 'c', kind, at: daysAgo(0) }], NOW).get('c')!;
    expect(one('asked')).toBeGreaterThan(WEIGHT.saved);
    expect(WEIGHT.saved).toBeGreaterThan(one('opened'));
  });

  /**
   * The trade the half-life is chosen to make. Asking about something this
   * morning has to beat a flurry of saving three weeks ago, or the arc just
   * ranks by volume and says nothing about attention.
   */
  it('lets one question today outrank a burst of saves three weeks back', () => {
    const scores = interestScores(
      saves([
        ['old', 21],
        ['old', 21],
        ['old', 22],
        ['old', 23],
        ['old', 24],
      ]),
      [{ categoryId: 'fresh', kind: 'asked', at: daysAgo(0) }],
      NOW,
    );
    expect(scores.get('fresh')!).toBeGreaterThan(scores.get('old')!);
  });

  it('accumulates repeated visits — one is noise, many is a habit', () => {
    const once = interestScores(
      [],
      [{ categoryId: 'c', kind: 'opened', at: daysAgo(1) }],
      NOW,
    ).get('c')!;
    const often = interestScores(
      [],
      Array.from({ length: 8 }, (): InterestEvent => ({
        categoryId: 'c',
        kind: 'opened',
        at: daysAgo(1),
      })),
      NOW,
    ).get('c')!;
    expect(often).toBeGreaterThan(once * 7);
    expect(often).toBeGreaterThan(WEIGHT.asked);
  });

  it('drops events past the horizon entirely rather than shrinking them', () => {
    const scores = interestScores(saves([['c', HORIZON_DAYS + 1]]), [], NOW);
    expect(scores.has('c')).toBe(false);
  });

  it('survives an unparseable timestamp instead of poisoning the sum', () => {
    // A NaN here would spread through the addition and silently empty the arc.
    const scores = interestScores(
      [
        { categoryId: 'c', at: 'not a date' },
        { categoryId: 'c', at: daysAgo(0) },
      ],
      [],
      NOW,
    );
    expect(scores.get('c')).toBeCloseTo(WEIGHT.saved, 10);
  });
});

describe('savesFrom', () => {
  const payload = {
    categories: [
      { id: 'parent', parent_id: null },
      { id: 'child', parent_id: 'parent' },
      { id: 'other', parent_id: null },
    ],
    memories: [
      { category_id: 'child', created_at: daysAgo(1) },
      { category_id: 'parent', created_at: daysAgo(2) },
      { category_id: 'other', created_at: daysAgo(3) },
    ],
  } as unknown as GraphPayload;

  /**
   * The rollup is the point. A memory usually lives in a subcategory while the
   * arc's top level shows parents — without this every save would score against
   * a category that is not on screen.
   */
  it('credits a subcategory memory to its parent', () => {
    const byCategory = savesFrom(payload).map((s) => s.categoryId);
    expect(byCategory).toEqual(['parent', 'parent', 'other']);
  });

  it('leaves a top-level memory where it is', () => {
    expect(savesFrom(payload)[1]!.categoryId).toBe('parent');
  });
});

describe('rankByInterest', () => {
  it('puts the most interesting first', () => {
    const scores = new Map([
      ['a', 1],
      ['b', 9],
      ['c', 4],
    ]);
    expect(rankByInterest(['a', 'b', 'c'], scores)).toEqual(['b', 'c', 'a']);
  });

  /**
   * A brand-new workspace has no history at all. Ties falling back to the
   * caller's order keeps that arc in the sequence the workspace authored,
   * rather than sorting it alphabetically by id — which would look like a
   * decision nobody made.
   */
  it('keeps the given order when nothing has been touched', () => {
    const ids = ['zeta', 'alpha', 'mu'];
    expect(rankByInterest(ids, new Map())).toEqual(ids);
  });

  it('treats an unscored category as zero rather than dropping it', () => {
    expect(rankByInterest(['a', 'b'], new Map([['b', 2]]))).toEqual(['b', 'a']);
  });
});

describe('corpusNow', () => {
  it('is the newest thing the corpus holds, not the time of day', () => {
    const saves: SaveEvent[] = [
      { categoryId: 'a', at: '2026-04-01T10:00:00Z' },
      { categoryId: 'b', at: '2026-06-27T10:00:00Z' },
      { categoryId: 'c', at: '2026-05-15T10:00:00Z' },
    ];
    expect(corpusNow(saves, NOW).toISOString()).toBe('2026-06-27T10:00:00.000Z');
  });

  /**
   * The failure this exists to prevent: the seeded demo's dates are fixed in a
   * file, so a wall clock walks away from them until everything sits past the
   * horizon and the arc silently stops ranking.
   */
  it('keeps a corpus that has aged past the horizon rankable', () => {
    const saves: SaveEvent[] = [
      { categoryId: 'busy', at: '2025-06-20T10:00:00Z' },
      { categoryId: 'busy', at: '2025-06-27T10:00:00Z' },
      { categoryId: 'quiet', at: '2025-04-01T10:00:00Z' },
    ];
    // More than a year of wall clock later.
    const stale = interestScores(saves, [], NOW);
    expect(stale.size).toBe(0);

    const anchored = interestScores(saves, [], corpusNow(saves, NOW));
    expect(anchored.get('busy')!).toBeGreaterThan(anchored.get('quiet')!);
  });

  it('falls back to the wall clock for an empty corpus', () => {
    expect(corpusNow([], NOW)).toBe(NOW);
  });

  it('ignores an unparseable date rather than anchoring on it', () => {
    const saves: SaveEvent[] = [
      { categoryId: 'a', at: 'nonsense' },
      { categoryId: 'a', at: '2026-06-27T10:00:00Z' },
    ];
    expect(corpusNow(saves, NOW).toISOString()).toBe('2026-06-27T10:00:00.000Z');
  });
});
