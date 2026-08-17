import type { Memory } from './types';

/**
 * The free window: Recall Free remembers your last two weeks; Pro remembers
 * everything.
 *
 * The gate is a *time* window, deliberately not a storage quota. Memories are
 * kilobytes on the user's own disk — a "space" limit would be pricing something
 * that costs nothing, and users know it. What Pro actually buys is the
 * organized, askable state of the older corpus, and time is the honest unit of
 * that.
 *
 * Nothing is ever deleted by the plan. An archived memory keeps its row, its
 * source, and its vector; the free tier just stops *presenting* it. That keeps
 * "a capture is never lost" (spec §7.4) true on every tier.
 *
 * `?plan=free` is the whole billing system for now: the seed demo defaults to
 * Pro so the existing demo path and test suite see the full corpus, and the
 * flag exists so the funnel can be seen, designed against, and tested before a
 * payment provider is wired to set it instead.
 */

export type Plan = 'free' | 'pro';

export const FREE_WINDOW_DAYS = 14;

/**
 * The URL flag wins — it exists so the free tier can be previewed against any
 * corpus — then the workspace's own plan (the server's billing writes it),
 * then 'pro': a seed payload predates plans and archiving it would demo an
 * empty product.
 */
export function currentPlan(
  search = typeof window === 'undefined' ? '' : window.location.search,
  workspacePlan?: Plan,
): Plan {
  const forced = new URLSearchParams(search).get('plan');
  if (forced === 'free' || forced === 'pro') return forced;
  return workspacePlan ?? 'pro';
}

/**
 * The instant the free window opens, as an ISO string — memories created
 * before it are archived. Anchored to the *newest memory* rather than the
 * clock: the seed corpus is fictional and committed, so wall-clock "now" would
 * archive all 47 of them and the free tier would demo as an empty product.
 * Against a live corpus the newest memory tracks real time anyway — the last
 * capture is rarely older than the window it anchors.
 */
export function freeCutoff(memories: readonly Memory[], plan: Plan): string | null {
  if (plan !== 'free' || memories.length === 0) return null;
  const newest = memories.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  const anchor = new Date(newest.created_at).getTime();
  return new Date(anchor - FREE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** True when the plan archives this memory. `cutoff` comes from `freeCutoff`. */
export function isArchivedByPlan(createdAt: string, cutoff: string | null): boolean {
  return cutoff !== null && createdAt < cutoff;
}
