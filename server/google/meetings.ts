import type { Repository } from '../db/repository.ts';
import type { GoogleAuth } from './oauth.ts';
import { listEvents } from './calendar.ts';
import { MEETINGS_AHEAD_DAYS, MEETINGS_PAST_DAYS } from '../../src/core/meetingTypes.ts';

/**
 * The sync: Google's window → the `meetings` table.
 *
 * Pulled, not pushed. A read of `/meetings` asks for a sync first, and the
 * sync asks Google only when the stored copy is older than ten minutes —
 * the client can poll or reopen freely without turning every glance into a
 * calendar request, and `refresh=1` is there for the person who just
 * accepted an invite and wants to see it now.
 *
 * A failed read is reported, never applied: the last good list stays, with
 * the reason beside it, because an empty calendar and an unreadable one are
 * different facts and the client should be able to tell them apart.
 */

export const SYNC_STALE_MS = 10 * 60_000;

const DAY_MS = 86400_000;

export interface SyncDeps {
  repo: Repository;
  auth: GoogleAuth;
  /** Defaults to the auth's own transport, so one injected fetch serves both. */
  fetchFn?: typeof fetch;
  now?: () => Date;
}

export interface SyncResult {
  /** The last successful sync — this one, or the previous one if this failed. */
  syncedAt: string | null;
  /** Why this sync could not read the calendar, or null when it did. */
  reason: string | null;
}

/** The window every sync and every list covers, so the two always agree. */
export function syncWindow(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - MEETINGS_PAST_DAYS * DAY_MS).toISOString(),
    to: new Date(now.getTime() + MEETINGS_AHEAD_DAYS * DAY_MS).toISOString(),
  };
}

export async function syncMeetings(
  deps: SyncDeps,
  workspaceId: string,
  { refresh = false }: { refresh?: boolean },
): Promise<SyncResult> {
  const now = deps.now?.() ?? new Date();
  const previous = deps.repo.meetingsSyncedAt(workspaceId);
  if (!refresh && previous !== null && now.getTime() - Date.parse(previous) < SYNC_STALE_MS) {
    return { syncedAt: previous, reason: null };
  }

  const { from, to } = syncWindow(now);
  try {
    const token = await deps.auth.accessToken(workspaceId);
    const meetings = await listEvents(token, from, to, deps.fetchFn ?? deps.auth.fetchFn);
    const syncedAt = now.toISOString();
    deps.repo.replaceMeetings(workspaceId, from, to, meetings, syncedAt);
    return { syncedAt, reason: null };
  } catch (err) {
    return { syncedAt: previous, reason: err instanceof Error ? err.message : 'calendar sync failed' };
  }
}
