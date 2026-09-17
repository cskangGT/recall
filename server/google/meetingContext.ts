import type { Repository } from '../db/repository.ts';
import type { EmbeddingProvider } from '../ai/provider.ts';
import type { Entity, GraphPayload, Memory } from '../../src/core/types.ts';
import type { Meeting, MeetingMemory } from '../../src/core/meetingTypes.ts';
import { expandMemories, relevantTo, MEETING_RELEVANCE_FLOOR } from '../search/retrieve.ts';
import { emailToNames, normalizeEntityName } from '../entities/normalize.ts';

/**
 * What Mado remembers that bears on a meeting.
 *
 * Two ways a memory can belong on a meeting card, tried in this order:
 *
 *  1. Someone in the room is someone Mado knows. An attendee whose name or
 *     address resolves to a person or organization entity brings every memory
 *     linked to that entity, newest first. This is the strong signal — "you
 *     have three notes about Sujin" is exactly what a person wants ten
 *     minutes before the call — so it always comes first.
 *
 *  2. The meeting is about something Mado has notes on. The title, a slice of
 *     the description and the attendee names go through the same hybrid
 *     retrieval Ask uses, under a lower floor (see MEETING_RELEVANCE_FLOOR).
 *
 * Merged, deduplicated, capped at five: a card, not a search page. The
 * shape is `RetrievedMemory` under another name, so the client renders the
 * same citation it already knows how to render.
 */

/** A card holds this many; the rest is a search away. */
export const MEETING_CONTEXT_LIMIT = 5;

/** How much of a description is worth embedding — the agenda, not the dial-in. */
const DESCRIPTION_CHARS = 300;

/** How many relevance hits to ask for before merging — more than the cap, so dedupe has slack. */
const RELEVANCE_HITS = 10;

/** Only these kinds can be in a meeting. A tool sharing a name with a person is a coincidence. */
const ATTENDEE_KINDS = new Set<Entity['kind']>(['person', 'organization']);

/** Below this a name fragment matches too much to be a match at all. */
const MIN_MATCH_CHARS = 3;

/**
 * Per-process memo of a meeting's context, keyed by event id.
 *
 * A calendar sync runs every few minutes and returns the same three weeks of
 * events nearly every time; embedding each of them again would be the
 * expensive part of a feature whose inputs did not change. The key records
 * everything the answer depends on — the meeting's own text, who is coming,
 * and how many memories exist — so a rename, a new attendee or a new capture
 * each invalidate exactly the entries they should. Memory *edits* do not
 * change the count; that staleness is bounded by the process lifetime and
 * accepted, since the card is a hint, not a record.
 */
const cache = new Map<string, { key: string; context: MeetingMemory[] }>();

/** For tests, and for anything that knows the corpus changed under it. */
export function resetMeetingContextCache(): void {
  cache.clear();
}

function cacheKey(meeting: Meeting, payload: GraphPayload): string {
  const emails = meeting.attendees.map((a) => a.email.toLowerCase()).sort().join(',');
  return [meeting.title, meeting.startsAt, emails, payload.memories.length].join('|');
}

/** Newest first, ties broken by id so the order is stable across runs. */
function newestFirst(a: Memory, b: Memory): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

/**
 * The spellings under which an attendee might be known to the graph.
 *
 * The display name is the obvious one. The address contributes two more:
 * a local part that reads as a name ("sujin.kim" — in both orders, since
 * neither Google nor the extractor promises family-name-first), and the
 * domain's registrable label, which for a company address is the company.
 * The name is matched loosely (containment either way); the address-derived
 * forms are matched exactly, because "kim" would otherwise match everyone.
 */
function attendeeForms(name: string, email: string): { loose: string | null; exact: string[] } {
  const full = normalizeEntityName(name);
  const exact: string[] = [];

  const { local, domainName } = emailToNames(email);
  const words = local.split(/[._-]+/).map(normalizeEntityName).filter(Boolean);
  const looksLikeName = /\p{L}/u.test(local) && local.length >= MIN_MATCH_CHARS;
  if (looksLikeName && words.length > 0) {
    exact.push(words.join(' '));
    if (words.length === 2) exact.push(`${words[1]} ${words[0]}`);
  }
  if (domainName) exact.push(normalizeEntityName(domainName));

  return {
    loose: full.length >= MIN_MATCH_CHARS ? full : null,
    exact: exact.filter((f) => f.length >= MIN_MATCH_CHARS),
  };
}

/** Entities the attendee resolves to, given every candidate already normalized. */
function matchEntities(
  forms: ReturnType<typeof attendeeForms>,
  entities: { id: string; normalized: string }[],
): string[] {
  const exact = new Set(forms.exact);
  return entities
    .filter(({ normalized }) => {
      if (exact.has(normalized)) return true;
      if (!forms.loose) return false;
      return normalized === forms.loose
        || normalized.includes(forms.loose)
        || forms.loose.includes(normalized);
    })
    .map((e) => e.id);
}

/** The retrieval text: what the meeting says it is, and who is in it. */
function retrievalText(meeting: Meeting): string {
  return [
    meeting.title,
    meeting.description?.slice(0, DESCRIPTION_CHARS),
    ...meeting.attendees.filter((a) => !a.self).map((a) => a.name),
  ]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join('\n');
}

export async function contextForAll(
  repo: Repository,
  embeddings: EmbeddingProvider,
  workspaceId: string,
  meetings: Meeting[],
): Promise<Record<string, MeetingMemory[]>> {
  const out: Record<string, MeetingMemory[]> = {};
  if (meetings.length === 0) return out;

  // One read of the graph for the whole batch — the payload carries the
  // entity links and vectors every meeting needs, and a sync hands over a
  // few dozen meetings at once.
  const payload = repo.getGraphPayload(workspaceId);
  const entities = repo
    .listEntities(workspaceId)
    .filter((e) => ATTENDEE_KINDS.has(e.kind))
    .map((e) => ({ id: e.id, normalized: normalizeEntityName(e.name) }))
    .filter((e) => e.normalized.length >= MIN_MATCH_CHARS);
  const keywordSearch = (q: string, n: number) => repo.keywordSearch(workspaceId, q, n);

  for (const meeting of meetings) {
    const key = cacheKey(meeting, payload);
    const hit = cache.get(meeting.id);
    if (hit && hit.key === key) {
      out[meeting.id] = hit.context;
      continue;
    }

    const context = await contextFor(meeting, payload, entities, keywordSearch, embeddings);
    cache.set(meeting.id, { key, context });
    out[meeting.id] = context;
  }

  return out;
}

async function contextFor(
  meeting: Meeting,
  payload: GraphPayload,
  entities: { id: string; normalized: string }[],
  keywordSearch: Parameters<typeof relevantTo>[1],
  embeddings: EmbeddingProvider,
): Promise<MeetingMemory[]> {
  const others = meeting.attendees.filter((a) => !a.self);
  const text = retrievalText(meeting);
  if (!text) return [];

  // 1. People and companies Mado knows.
  const matched = new Set<string>();
  for (const attendee of others) {
    for (const id of matchEntities(attendeeForms(attendee.name, attendee.email), entities)) {
      matched.add(id);
    }
  }
  const picked: Memory[] = matched.size === 0
    ? []
    : payload.memories
        .filter((m) => m.entity_ids.some((id) => matched.has(id)))
        .sort(newestFirst)
        .slice(0, MEETING_CONTEXT_LIMIT);

  // 2. What the meeting is about — only worth the embedding if there is
  // still room on the card.
  if (picked.length < MEETING_CONTEXT_LIMIT) {
    const seen = new Set(picked.map((m) => m.id));
    const hits = await relevantTo(payload, keywordSearch, embeddings, text, {
      floor: MEETING_RELEVANCE_FLOOR,
      limit: RELEVANCE_HITS,
    });
    for (const hit of hits) {
      if (picked.length >= MEETING_CONTEXT_LIMIT) break;
      if (seen.has(hit.memory.id)) continue;
      seen.add(hit.memory.id);
      picked.push(hit.memory);
    }
  }

  return expandMemories(payload, picked);
}
