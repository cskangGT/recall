import type { GraphPayload, Memory } from './types';
import type { Meeting } from './meetingTypes';
import { relatedMemories } from './related';
import { localDay, meetingDay, isOver } from './meetings';

export { localDay };

/**
 * The morning card — the second wow, the day after.
 *
 * Onboarding does not end when the first session does; the promise that
 * matters is "this gets better as time passes", and the first proof is small:
 * overnight, something new found something old. The card says that once a
 * day, only when it is actually true, and never twice for the same morning.
 *
 * Three shapes. Today's meetings first — the day ahead is the strongest pull
 * of all, and the card is the door to what Mado remembers about the people in
 * it. Then the diary: a page written yesterday outranks a vector link, because
 * rereading your own evening is the stronger pull. The last two are computed
 * from the payload alone — no model, no request; the first needs the calendar
 * the store already holds.
 *
 * Before all of them, once: the first day. The hour the welcome ends, home is
 * new ground, and the card says what the day made and where tomorrow starts.
 * It reads the stamp the welcome left (`FIRST_DAY_KEY`) and speaks only on
 * that calendar day.
 *
 * And once a week, where the server can look back: the first visit of a week
 * whose predecessor has diary pages offers "the you of last week". It ranks
 * under yesterday's page (the nearer pull) and over a vector link.
 */

export interface MorningOptions {
  /** The day the welcome ended (FIRST_DAY_KEY), if it did. */
  firstDayStamp?: string | null;
  /** The Monday of the week whose look-back was already offered or put away. */
  weekStamp?: string | null;
  /** The server has the look-back door (source.diaryRetro). */
  canRetro?: boolean;
}

/** Monday (local) of the week `d` falls in, as a local day. */
export function mondayOf(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(m);
}

export type MorningCard =
  | { kind: 'firstDay'; count: number }
  | { kind: 'meetings'; count: number; first: Meeting }
  | { kind: 'diary'; sourceId: string; date: string }
  | { kind: 'week'; from: string; to: string; days: number }
  | { kind: 'link'; recent: Memory; older: Memory; similarity: number };

const HOURS = 3600_000;
/** How fresh the new end of the link must be. */
const RECENT_WINDOW_MS = 48 * HOURS;
/** How settled the old end must be — a link between two fresh memories is not "time passing". */
const OLDER_THAN_MS = 7 * 24 * HOURS;
/** Recent memories examined, newest first — enough for one good pair. */
const RECENT_CAP = 30;

export function morningCardOf(
  payload: GraphPayload,
  now: Date,
  meetings: Meeting[] = [],
  opts: MorningOptions = {},
): MorningCard | null {
  const today = localDay(now);
  if (opts.firstDayStamp === today) {
    const count = payload.memories.filter((m) => localDay(new Date(m.created_at)) === today).length;
    return { kind: 'firstDay', count };
  }
  const ahead = meetings
    .filter((m) => meetingDay(m) === today && !isOver(m, now))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const first = ahead[0];
  if (first) return { kind: 'meetings', count: ahead.length, first };

  const yesterday = localDay(new Date(now.getTime() - 24 * HOURS));
  const diary = payload.sources.find((s) => s.diary_date === yesterday);
  if (diary) return { kind: 'diary', sourceId: diary.id, date: yesterday };

  // Last week, Monday to Sunday — offered once, and only if it has pages:
  // the look-back reads diary days, and a week without any has nothing to say.
  const monday = mondayOf(now);
  if (opts.canRetro && opts.weekStamp !== monday) {
    const [y, mo, d] = monday.split('-').map(Number) as [number, number, number];
    const from = localDay(new Date(y, mo - 1, d - 7));
    const to = localDay(new Date(y, mo - 1, d - 1));
    const days = new Set(
      payload.sources
        .map((s) => s.diary_date)
        .filter((day): day is string => Boolean(day) && day! >= from && day! <= to),
    ).size;
    if (days > 0) return { kind: 'week', from, to, days };
  }

  const t = now.getTime();
  const recents = payload.memories
    .filter((m) => {
      const age = t - Date.parse(m.created_at);
      return age >= 0 && age <= RECENT_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, RECENT_CAP);

  let best: Extract<MorningCard, { kind: 'link' }> | null = null;
  for (const recent of recents) {
    for (const { memory, similarity } of relatedMemories(payload, recent.id)) {
      if (t - Date.parse(memory.created_at) < OLDER_THAN_MS) continue;
      if (!best || similarity > best.similarity) best = { kind: 'link', recent, older: memory, similarity };
      break; // relatedMemories is best-first — the first old-enough one is this recent's best.
    }
  }
  return best;
}
