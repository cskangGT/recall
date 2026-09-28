import type { SourceType } from './types';

/**
 * The wire shapes for meetings — shared by the server (which syncs them from
 * Google Calendar and attaches what Mado remembers) and the client (which
 * lays them out by day). Kept in src/core like naming.ts and reflect.ts so
 * one definition serves both sides; times are ISO strings in UTC, and the
 * client is the only place that turns them into a wall clock.
 */

export interface Attendee {
  /** Display name when Google has one, else the email's local part. */
  name: string;
  email: string;
  /** The connected account itself. */
  self: boolean;
  organizer: boolean;
}

export interface Meeting {
  /** Google's event id — stable across syncs, so it is the primary key. */
  id: string;
  title: string;
  /** ISO 8601, UTC. For an all-day event, midnight UTC of that date. */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  meetLink: string | null;
  htmlLink: string | null;
  attendees: Attendee[];
}

/** One memory Mado holds that bears on a meeting — the same shape Ask cites. */
export interface MeetingMemory {
  memory_id: string;
  source_id: string;
  text: string;
  category_name: string;
  source_title: string;
  source_type: SourceType;
}

export interface MeetingWithContext extends Meeting {
  /** What Mado remembers that helps for this one — at most five. */
  context: MeetingMemory[];
}

/** `GET /api/workspaces/:id/google` and the `google` field of capabilities. */
export interface GoogleStatus {
  /** The server has a client id and secret — the door can be drawn. */
  configured: boolean;
  /** A token is stored for this workspace. */
  connected: boolean;
  /** The connected account, when known. */
  email: string | null;
}

/** `GET /api/workspaces/:id/meetings`. */
export interface MeetingsResponse {
  connected: boolean;
  email: string | null;
  /** ISO time of the last successful calendar sync, or null before the first. */
  syncedAt: string | null;
  /** Why the calendar could not be read this time, when it could not. */
  reason: string | null;
  /** The window this list covers, ISO. */
  from: string;
  to: string;
  meetings: MeetingWithContext[];
}

/** The window a sync covers: a week back, two weeks ahead. */
export const MEETINGS_PAST_DAYS = 7;
export const MEETINGS_AHEAD_DAYS = 14;
