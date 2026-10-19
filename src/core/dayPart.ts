/**
 * The part of the day, and what home leads with in it.
 *
 * A second brain sat down with at eight in the morning and at eleven at
 * night should not say the same first thing. It holds the same three lines —
 * the day, the mind, the pile — so the difference is which one the hour
 * opens, and what the one sentence above them is about: the day ahead in the
 * morning, what there is to sort in the afternoon, what came in at night. Pure over the clock so the
 * boundaries can be pinned in a test.
 */

export type DayPart = 'morning' | 'day' | 'evening';

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

/** The three lines of the today page, named for what the person manages there. */
export type HomeRow = 'schedule' | 'mind' | 'info';

/**
 * The line the hour opens: the day in the morning, the pile in the
 * afternoon, the mind at night. Where there is no calendar door there is no
 * schedule line, and the morning opens on the mind instead.
 */
export function leadRow(part: DayPart, hasSchedule: boolean): HomeRow {
  if (part === 'day') return 'info';
  if (part === 'evening') return 'mind';
  return hasSchedule ? 'schedule' : 'mind';
}
