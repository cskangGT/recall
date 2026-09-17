/**
 * The part of the day, and what home leads with in it.
 *
 * A second brain sat down with at eight in the morning and at eleven at
 * night should not say the same first thing. It holds the same things — the
 * day's meetings, what is on the table, what came in — so the difference is
 * not new blocks but their order and one line of greeting: mornings open on
 * the day ahead, afternoons on what there is to sort, evenings on what came
 * in today and the page that closes it. Pure over the clock so the
 * boundaries can be pinned in a test.
 */

export type DayPart = 'morning' | 'day' | 'evening';

/** Every block the briefing can show, named once. */
export type BriefingBlock =
  | 'today'
  | 'todayMemories'
  | 'lately'
  | 'concerns'
  | 'growing'
  | 'organizing';

/** Local hours: 05–11 morning, 11–18 day, the rest evening (night included). */
export const MORNING_FROM = 5;
export const DAY_FROM = 11;
export const EVENING_FROM = 18;

export function dayPartOf(now: Date): DayPart {
  const h = now.getHours();
  if (h >= MORNING_FROM && h < DAY_FROM) return 'morning';
  if (h >= DAY_FROM && h < EVENING_FROM) return 'day';
  return 'evening';
}

const ORDER: Record<DayPart, BriefingBlock[]> = {
  morning: ['today', 'concerns', 'lately', 'growing', 'organizing'],
  day: ['today', 'organizing', 'lately', 'concerns', 'growing'],
  evening: ['todayMemories', 'concerns', 'today', 'lately', 'growing', 'organizing'],
};

/** The blocks in the order this part of the day reads them. */
export function briefingOrder(part: DayPart): BriefingBlock[] {
  return ORDER[part];
}
