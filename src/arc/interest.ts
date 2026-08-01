import type { GraphPayload } from '../core/types';

/**
 * What the user has been into lately, as a number per top-level category.
 *
 * The arc used to show every category in the order they happened to be created,
 * which is a fact about the database rather than about the person using it. Its
 * job now is to answer "what have I been on recently?" without being asked — so
 * what is on the arc has to be a consequence of what the user has been doing,
 * and everything else belongs on the map, which is the view that shows the whole
 * corpus at once.
 *
 * That division also settles a tension worth naming. Ranking makes the arc
 * rearrange itself, and a thing that moves cannot be remembered by where it is.
 * But the map already persists an x and y per category, so the map is the stable
 * place and the arc is the live one. Neither has to be both.
 *
 * Three kinds of attention count, and they are not worth the same:
 *
 * - **asked** is the strongest. Framing a question is deliberate and effortful;
 *   nobody asks about something by accident.
 * - **saved** is next. Keeping something is a real signal, but a reflexive one —
 *   people save things they never think about again.
 * - **opened** is weakest and still worth counting. Browsing is cheap, so a
 *   single visit means little, but repeatedly returning to the same category
 *   means something.
 *
 * Kept pure and out of the store for the same reason `layout.ts` and `star.ts`
 * are: "does a burst of saves three weeks ago outrank one question yesterday" is
 * a question a unit test should answer.
 */

/** An interaction that is not already recorded in the corpus itself. */
export interface InterestEvent {
  /** Always a top-level category — attributed at record time, not at read time. */
  categoryId: string;
  kind: 'asked' | 'opened';
  /** ISO 8601. */
  at: string;
}

/** A memory arriving in a category. Derived from the corpus, never logged. */
export interface SaveEvent {
  categoryId: string;
  at: string;
}

/**
 * How much each kind of attention is worth before decay.
 *
 * Exported and named rather than buried as literals, and unit-tested, because
 * these are judgement calls someone will want to argue with — the same treatment
 * `core/thresholds.ts` gets, for the same reason.
 */
export const WEIGHT = {
  asked: 3,
  saved: 1,
  opened: 0.5,
} as const;

/**
 * Ten days.
 *
 * "Lately" has to mean weeks rather than months, or a category you were buried
 * in last spring outranks the one you were reading this morning purely on
 * volume. At ten days a burst of six saves a fortnight ago is worth about the
 * same as two saves today, which is roughly the trade a person would make.
 */
export const HALF_LIFE_DAYS = 10;

/**
 * Anything older than this contributes nothing.
 *
 * Not an optimisation — a statement. Without a floor, a category with two
 * hundred memories from a year ago accumulates enough residue to sit on the arc
 * forever, and the arc stops being about lately at all.
 */
export const HORIZON_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Half its value every HALF_LIFE_DAYS, nothing at all past the horizon. */
export function decay(ageDays: number): number {
  if (ageDays >= HORIZON_DAYS) return 0;
  // Something recorded slightly in the future — a clock skew, or seed data
  // authored ahead of today — counts as now rather than as extra credit.
  const age = Math.max(0, ageDays);
  return Math.pow(0.5, age / HALF_LIFE_DAYS);
}

function ageInDays(at: string, now: Date): number {
  const t = Date.parse(at);
  // An unparseable date scores zero rather than NaN, which would poison the
  // whole sum and silently empty the arc.
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / DAY_MS;
}

/**
 * Every memory in the corpus as a save against its **top-level** category.
 *
 * The rollup matters: a memory usually lives in a subcategory, and the arc's top
 * level shows parents. Without it, every save would score against a category
 * that is not on screen.
 */
export function savesFrom(payload: GraphPayload): SaveEvent[] {
  const parentOf = new Map(payload.categories.map((c) => [c.id, c.parent_id]));
  return payload.memories.map((m) => ({
    categoryId: parentOf.get(m.category_id) ?? m.category_id,
    at: m.created_at,
  }));
}

/**
 * The clock the decay is measured against: the corpus's own present.
 *
 * Not the wall clock, and the difference matters twice.
 *
 * A workspace nobody has saved to for a month would otherwise have every score
 * decayed to noise and an arc that ranks nothing — which is strictly worse than
 * showing what that person was last into. "Lately" is a claim about a workspace,
 * so it should be measured from that workspace's most recent activity. In a live
 * one the newest memory is minutes old and this is the wall clock.
 *
 * It also keeps the seeded demo from expiring. Its dates are fixed in a file; a
 * wall clock walks away from them until everything sits past the horizon and the
 * arc silently stops ranking — the kind of failure that looks like a design
 * decision rather than a bug.
 *
 * Only saves set it, never interactions. If opening a category could advance the
 * clock, a single click would age the whole corpus a month and flatten exactly
 * the signal the arc is built on.
 */
export function corpusNow(saves: readonly SaveEvent[], wallClock: Date): Date {
  let newest = 0;
  for (const s of saves) {
    const t = Date.parse(s.at);
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  return newest === 0 ? wallClock : new Date(newest);
}

/**
 * A score per top-level category. Absent means zero — callers should treat a
 * missing key as untouched rather than as an error.
 */
export function interestScores(
  saves: readonly SaveEvent[],
  events: readonly InterestEvent[],
  now: Date,
): Map<string, number> {
  const scores = new Map<string, number>();
  const add = (id: string, weight: number, at: string) => {
    const value = weight * decay(ageInDays(at, now));
    if (value === 0) return;
    scores.set(id, (scores.get(id) ?? 0) + value);
  };

  for (const s of saves) add(s.categoryId, WEIGHT.saved, s.at);
  for (const e of events) add(e.categoryId, WEIGHT[e.kind], e.at);
  return scores;
}

/**
 * Category ids, most interesting first.
 *
 * Ties break on the caller's original order rather than on id, so a corpus with
 * no interaction history at all still comes out in the order the workspace
 * authored — a stable arc rather than an alphabetical one.
 */
export function rankByInterest(
  ids: readonly string[],
  scores: ReadonlyMap<string, number>,
): string[] {
  return ids
    .map((id, index) => ({ id, index, score: scores.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.id);
}

/**
 * The top-level categories an answer drew on.
 *
 * An answer cites memories, and a memory lives in a subcategory, and the arc
 * ranks parents — so a question about evals has to score against `AI Tooling`
 * rather than against a child nobody can see from the top level. Deduplicated,
 * because one question is one act of attention however many memories it touched.
 */
export function askedCategories(payload: GraphPayload, memoryIds: readonly string[]): string[] {
  const parentOf = new Map(payload.categories.map((c) => [c.id, c.parent_id]));
  const categoryOf = new Map(payload.memories.map((m) => [m.id, m.category_id]));
  const out = new Set<string>();
  for (const memoryId of memoryIds) {
    const category = categoryOf.get(memoryId);
    if (category === undefined) continue;
    out.add(parentOf.get(category) ?? category);
  }
  return [...out];
}
