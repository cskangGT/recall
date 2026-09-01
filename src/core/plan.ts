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

/**
 * How the trial presents: as long as the free window, so the sentence "the day
 * the trial ends is the day your first drop starts to sleep" is literally
 * true. The server writes trial_until at workspace creation; this module only
 * reads it.
 */
export type Workspace = { plan?: Plan; trial_until?: string | null };

/** Whole trial days left, or null when there is no live trial. */
export function trialDaysLeft(
  workspace: Workspace | undefined,
  now: Date = new Date(),
): number | null {
  if (workspace?.plan !== 'free' || !workspace.trial_until) return null;
  const ms = Date.parse(workspace.trial_until) - now.getTime();
  if (ms <= 0) return null;
  return Math.ceil(ms / 86400_000);
}

/**
 * The plan the UI should present: a live trial presents as Pro — everything
 * awake, a countdown instead of a paywall. `?plan=` still wins outright, so
 * the free tier stays previewable against any corpus.
 */
export function effectivePlan(
  search = typeof window === 'undefined' ? '' : window.location.search,
  workspace?: Workspace,
  now: Date = new Date(),
): Plan {
  const forced = new URLSearchParams(search).get('plan');
  if (forced === 'free' || forced === 'pro') return forced;
  if (trialDaysLeft(workspace, now) !== null) return 'pro';
  return workspace?.plan ?? 'pro';
}

/** How many memories the free plan has put to sleep, given `freeCutoff`'s answer. */
export function sleepingCountOf(memories: readonly Memory[], cutoff: string | null): number {
  if (cutoff === null) return 0;
  let n = 0;
  for (const m of memories) if (isArchivedByPlan(m.created_at, cutoff)) n++;
  return n;
}
