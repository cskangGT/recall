import type { GraphPayload, Memory } from './types';

/**
 * The first page of home, read out of the graph alone.
 *
 * Home used to open on an index — a list of folders, which is what a filing
 * cabinet shows and not what a second brain says when you sit down. The
 * briefing is the other thing: what has been on the table lately, where the
 * thinking has been growing, what is still waiting to be looked at. Pure,
 * so the seed demo has one too; the model-written paragraph ("lately, it
 * has mostly been…") arrives separately from the reflective ask.
 *
 * The window is anchored to the newest memory, like the reflective sample:
 * a corpus whose last capture was three weeks ago still has a "lately".
 */

export const BRIEFING_DAYS = 14;
/** Enough to see the shape of the fortnight; more is a list, not a briefing. */
export const CONCERNS_LIMIT = 5;
export const LEARNING_LIMIT = 3;

/** The kinds that are still open — a question asked, a decision made, a task set down. */
const CONCERN_KINDS = new Set<Memory['kind']>(['question', 'decision', 'task']);

export interface Briefing {
  /** Questions, decisions and tasks kept in the window, newest first. */
  concerns: Memory[];
  /** Categories that took the most in the window — where the thinking has been. */
  learning: { categoryId: string; name: string; added: number }[];
  organizing: {
    /** Originals with memories that nobody has checked yet. */
    awaitingReview: number;
    /** Originals that arrived in the window. */
    arrived: number;
    /** Memories kept in the window. */
    arrivedMemories: number;
  };
  /** The window, ISO dates; null when the corpus is empty. */
  period: { from: string; to: string } | null;
}

export function briefingOf(payload: GraphPayload, days: number = BRIEFING_DAYS): Briefing {
  const newest = payload.memories.reduce(
    (max, m) => Math.max(max, Date.parse(m.created_at) || 0),
    0,
  );
  const empty: Briefing = {
    concerns: [],
    learning: [],
    organizing: { awaitingReview: 0, arrived: 0, arrivedMemories: 0 },
    period: null,
  };
  if (newest === 0) return empty;

  const cutoff = newest - days * 864e5;
  const inWindow = (iso: string) => (Date.parse(iso) || 0) >= cutoff;
  const recent = payload.memories.filter((m) => inWindow(m.created_at));

  const concerns = recent
    .filter((m) => CONCERN_KINDS.has(m.kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .slice(0, CONCERNS_LIMIT);

  const nameOf = new Map(payload.categories.map((c) => [c.id, c.name] as const));
  const grew = new Map<string, number>();
  for (const m of recent) grew.set(m.category_id, (grew.get(m.category_id) ?? 0) + 1);
  const learning = [...grew.entries()]
    .filter(([, added]) => added >= 2)
    .map(([categoryId, added]) => ({ categoryId, name: nameOf.get(categoryId) ?? '', added }))
    .sort((a, b) => b.added - a.added || a.name.localeCompare(b.name))
    .slice(0, LEARNING_LIMIT);

  const withMemories = new Set(payload.memories.map((m) => m.source_id));
  const awaitingReview = payload.sources.filter(
    (s) => !s.reviewed_at && withMemories.has(s.id),
  ).length;
  const arrived = payload.sources.filter((s) => inWindow(s.created_at)).length;

  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return {
    concerns,
    learning,
    organizing: { awaitingReview, arrived, arrivedMemories: recent.length },
    period: { from: day(cutoff), to: day(newest) },
  };
}
