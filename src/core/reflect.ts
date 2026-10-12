import type { GraphPayload, Memory } from './types';

/**
 * Looking around instead of looking up.
 *
 * "What have I been into lately?" resembles no memory, so retrieval finds
 * nothing and the pipeline refuses — correctly, by its own contract, and
 * wrongly by any person's. A memory should be able to answer that by
 * surveying the last two weeks: which interests took the most, a few of the
 * things kept in each. This module is the pure half, shared by the server
 * (which hands the sample to a model) and the seed demo (which phrases it
 * from the counts alone).
 *
 * The window is anchored to the newest memory, not to the clock: a corpus
 * whose last capture was three weeks ago still has a "lately", and the
 * dates ride along so the answer can say when that was.
 */

export const REFLECTIVE_DAYS = 14;

/*
 * Two ingredients, both required: a word for "lately" and a question about
 * oneself — "what / which / 뭐 / 어떤". "요즘 트렌드인 러닝화 이름이 뭐야?" has
 * the first but asks about the world; "what have I been into" has both.
 */
const LATELY =
  /(요즘|요새|최근|근래|이번\s*주|이번\s*달|지난\s*(주|달|2주|두\s*주)|lately|recently|these days|this (week|month|fortnight)|past (week|two weeks|month))/i;
const ABOUT_ME =
  /(내가|나\s|나는|나\b|나한테|나의|내\s|제가|저는|\bI\b|\bI'm\b|\bI've\b|\bmy\b|\bme\b)/i;
const ASKS_WHAT =
  /(뭐|무엇|무슨|어떤|어디에|what|which|anything)/i;
const ABOUT_WORLD = /(트렌드|유행|뉴스|시세|날씨|가격|trend|news|weather|price)/i;

export function isReflectiveQuestion(question: string): boolean {
  const q = question.trim();
  if (!LATELY.test(q) || !ASKS_WHAT.test(q)) return false;
  if (ABOUT_WORLD.test(q)) return false;
  return (
    ABOUT_ME.test(q) ||
    /(기억|저장|남긴|생각|관심|빠져|saved|kept|remember|into|mind|interested)/i.test(q)
  );
}

export interface Interest {
  categoryId: string;
  name: string;
  /** Memories kept in the window. */
  count: number;
}

export interface RecentSample {
  /** ISO dates, inclusive; null when the corpus is empty. */
  from: string | null;
  to: string | null;
  /** Interests in the window, biggest first. */
  interests: Interest[];
  /** A spread of memories across those interests, newest first within each. */
  picks: Memory[];
}

/** The last fortnight behind the newest memory, grouped by interest. */
export function recentSample(
  payload: GraphPayload,
  options: { days?: number; cap?: number; perInterest?: number } = {},
): RecentSample {
  const days = options.days ?? REFLECTIVE_DAYS;
  const cap = options.cap ?? 12;
  const perInterest = options.perInterest ?? 3;

  const newest = payload.memories.reduce(
    (max, m) => Math.max(max, Date.parse(m.created_at) || 0),
    0,
  );
  if (newest === 0) return { from: null, to: null, interests: [], picks: [] };
  const cutoff = newest - days * 864e5;
  const recent = payload.memories
    .filter((m) => (Date.parse(m.created_at) || 0) >= cutoff)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const nameOf = new Map(payload.categories.map((c) => [c.id, c.name] as const));
  const byCategory = new Map<string, Memory[]>();
  for (const m of recent) {
    const list = byCategory.get(m.category_id) ?? [];
    list.push(m);
    byCategory.set(m.category_id, list);
  }
  const interests: Interest[] = [...byCategory.entries()]
    .map(([categoryId, list]) => ({
      categoryId,
      name: nameOf.get(categoryId) ?? '',
      count: list.length,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Round-robin across interests, biggest first, so the sample says "these
  // weeks" rather than "the one thing you kept most of".
  const picks: Memory[] = [];
  for (let round = 0; round < perInterest && picks.length < cap; round++) {
    for (const i of interests) {
      if (picks.length >= cap) break;
      const m = byCategory.get(i.categoryId)![round];
      if (m) picks.push(m);
    }
  }

  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: day(cutoff), to: day(newest), interests, picks };
}
