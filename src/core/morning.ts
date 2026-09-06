import type { GraphPayload, Memory } from './types';
import { relatedMemories } from './related';

/**
 * The morning card — the second wow, the day after.
 *
 * Onboarding does not end when the first session does; the promise that
 * matters is "this gets better as time passes", and the first proof is small:
 * overnight, something new found something old. The card says that once a
 * day, only when it is actually true, and never twice for the same morning.
 *
 * Two shapes, diary first: a page written yesterday outranks a vector link,
 * because rereading your own evening is the stronger pull. Both are computed
 * from the payload alone — no model, no request.
 */

export type MorningCard =
  | { kind: 'diary'; sourceId: string; date: string }
  | { kind: 'link'; recent: Memory; older: Memory; similarity: number };

/** A Date as the local calendar day it belongs to (YYYY-MM-DD). */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const HOURS = 3600_000;
/** How fresh the new end of the link must be. */
const RECENT_WINDOW_MS = 48 * HOURS;
/** How settled the old end must be — a link between two fresh memories is not "time passing". */
const OLDER_THAN_MS = 7 * 24 * HOURS;
/** Recent memories examined, newest first — enough for one good pair. */
const RECENT_CAP = 30;

export function morningCardOf(payload: GraphPayload, now: Date): MorningCard | null {
  const yesterday = localDay(new Date(now.getTime() - 24 * HOURS));
  const diary = payload.sources.find((s) => s.diary_date === yesterday);
  if (diary) return { kind: 'diary', sourceId: diary.id, date: yesterday };

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
