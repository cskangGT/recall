import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { FixtureEmbeddings } from '../../server/ai/fixture';
import {
  relevantTo, expandMemories, MEETING_RELEVANCE_FLOOR, RELEVANCE_FLOOR, RETRIEVE_LIMIT,
} from '../../server/search/retrieve';

const WS = 'ws_demo';
let repo: SqliteRepository;
let embeddings: FixtureEmbeddings;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  embeddings = new FixtureEmbeddings();
});

afterEach(() => repo.close());

const keywordSearch = (q: string, n: number) => repo.keywordSearch(WS, q, n);

describe('relevantTo — retrieval as a free function', () => {
  it('returns floored, fused hits for a text a seed memory embeds exactly', async () => {
    const payload = repo.getGraphPayload(WS);
    const target = payload.memories.find((m) => m.text.includes('LangChain'))!;
    const hits = await relevantTo(payload, keywordSearch, embeddings, target.text);
    expect(hits[0]!.memory.id).toBe(target.id);
    expect(hits.every((h) => h.similarity >= RELEVANCE_FLOOR)).toBe(true);
    expect(hits.length).toBeLessThanOrEqual(RETRIEVE_LIMIT);
  });

  it('honours a caller-supplied floor and limit', async () => {
    const payload = repo.getGraphPayload(WS);
    const target = payload.memories.find((m) => m.text.includes('LangChain'))!;
    const loose = await relevantTo(payload, keywordSearch, embeddings, target.text, {
      floor: 0, limit: 3,
    });
    expect(loose).toHaveLength(3);
    const strict = await relevantTo(payload, keywordSearch, embeddings, target.text, {
      floor: 1.01,
    });
    expect(strict).toEqual([]);
  });

  it('returns nothing for a text unrelated to the corpus', async () => {
    const payload = repo.getGraphPayload(WS);
    const hits = await relevantTo(payload, keywordSearch, embeddings, 'zzqx plorbit fnargle');
    expect(hits).toEqual([]);
  });

  it('meeting floor sits below the question floor', () => {
    expect(MEETING_RELEVANCE_FLOOR).toBeLessThan(RELEVANCE_FLOOR);
  });
});

describe('expandMemories', () => {
  it('attaches category and source to each memory', () => {
    const payload = repo.getGraphPayload(WS);
    const m = payload.memories[0]!;
    const [expanded] = expandMemories(payload, [m]);
    expect(expanded).toEqual({
      memory_id: m.id,
      source_id: m.source_id,
      text: m.text,
      category_name: payload.categories.find((c) => c.id === m.category_id)!.name,
      source_title: payload.sources.find((s) => s.id === m.source_id)!.title,
      source_type: payload.sources.find((s) => s.id === m.source_id)!.type,
    });
  });
});

// ---------------------------------------------------------------- contextForAll

import { contextForAll, resetMeetingContextCache } from '../../server/google/meetingContext';
import type { Meeting, Attendee } from '../../src/core/meetingTypes';
import type { EmbeddingProvider } from '../../server/ai/provider';

const attendee = (name: string, email: string, extra: Partial<Attendee> = {}): Attendee => ({
  name, email, self: false, organizer: false, ...extra,
});

const meeting = (id: string, title: string, attendees: Attendee[], extra: Partial<Meeting> = {}): Meeting => ({
  id, title, attendees,
  startsAt: '2026-09-17T01:00:00Z', endsAt: '2026-09-17T02:00:00Z', allDay: false,
  location: null, description: null, meetLink: null, htmlLink: null,
  ...extra,
});

/** An embedding provider that counts its calls, wrapping the fixture. */
function countingEmbeddings(): EmbeddingProvider & { calls: number } {
  const inner = new FixtureEmbeddings();
  const counted = {
    dimensions: inner.dimensions,
    calls: 0,
    embed(texts: string[], purpose: 'document' | 'query') {
      counted.calls += 1;
      void purpose;
      return inner.embed(texts);
    },
  };
  return counted;
}

/** The seed has no people or companies; the graph gets some the way ingest would add them. */
function addPeople() {
  // The two Anthropic SDK memories, deliberately linked out of date order.
  const sujin = repo.upsertEntity(WS, { id: 'ent_sujin', name: 'Kim Sujin', kind: 'person', normalized_name: 'kim sujin' });
  repo.linkMemoryEntity('mem_13', sujin);
  repo.linkMemoryEntity('mem_11', sujin);
  const acme = repo.upsertEntity(WS, { id: 'ent_acme', name: 'Acme', kind: 'organization', normalized_name: 'acme' });
  repo.linkMemoryEntity('mem_33', acme);
  // Someone who shows up in a lot of notes — more than a meeting card holds.
  const busy = repo.upsertEntity(WS, { id: 'ent_busy', name: 'Park Jihoon', kind: 'person', normalized_name: 'park jihoon' });
  for (const id of ['mem_00', 'mem_01', 'mem_02', 'mem_05', 'mem_09', 'mem_10']) repo.linkMemoryEntity(id, busy);
  return { sujin, acme, busy };
}

describe('contextForAll — what Mado remembers about a meeting', () => {
  beforeEach(() => resetMeetingContextCache());

  it('puts memories linked to an attendee entity first, newest first', async () => {
    addPeople();
    const m = meeting('evt_1', 'Weekly sync', [attendee('Kim Sujin', 'sujin@somewhere.io')]);
    const out = await contextForAll(repo, embeddings, WS, [m]);
    const ids = out['evt_1']!.map((c) => c.memory_id);
    expect(ids.slice(0, 2)).toEqual(['mem_11', 'mem_13']);
    expect(out['evt_1']![0]).toMatchObject({
      memory_id: 'mem_11', source_id: expect.any(String), text: expect.stringContaining('LangChain'),
      category_name: expect.any(String), source_title: expect.any(String), source_type: expect.any(String),
    });
  });

  it('matches an entity through the display name loosely and the email strictly', async () => {
    addPeople();
    // Google sometimes has only the honorific form; the entity was stored bare.
    const byName = meeting('evt_2', 'Sync', [attendee('김수진 님', 'x@nowhere.io')]);
    repo.upsertEntity(WS, { id: 'ent_ksj', name: '김수진', kind: 'person', normalized_name: '김수진' });
    repo.linkMemoryEntity('mem_37', 'ent_ksj');
    // No display name at all — Google fell back to the local part — but the
    // domain names the company.
    const byEmail = meeting('evt_3', 'Intro', [attendee('someone', 'someone@acme.co.kr')]);
    // The local part reads as a name in either order.
    const byLocal = meeting('evt_4', 'Coffee', [attendee('sujin.kim', 'sujin.kim@gmail.com')]);
    const out = await contextForAll(repo, embeddings, WS, [byName, byEmail, byLocal]);
    expect(out['evt_2']![0]!.memory_id).toBe('mem_37');
    expect(out['evt_3']![0]!.memory_id).toBe('mem_33');
    expect(out['evt_4']!.slice(0, 2).map((c) => c.memory_id)).toEqual(['mem_11', 'mem_13']);
  });

  it('ignores the connected account itself and entities of other kinds', async () => {
    const { busy } = addPeople();
    // A tool that happens to carry a person's name, linked to the same notes.
    const tool = repo.upsertEntity(WS, { id: 'ent_toolish', name: 'Toolish', kind: 'tool', normalized_name: 'toolish' });
    for (const id of ['mem_00', 'mem_01', 'mem_02']) repo.linkMemoryEntity(id, tool);
    const m = meeting('evt_5', 'Planning', [
      attendee('Park Jihoon', 'me@somewhere.io', { self: true }),
      attendee('Toolish', 'toolish@nowhere.io'),
    ]);
    const out = await contextForAll(repo, embeddings, WS, [m]);
    // Neither the self attendee's entity nor the tool contributes; the title
    // alone retrieves nothing, so the card is empty rather than borrowed.
    expect(out['evt_5']).toEqual([]);
    expect(busy).toBe('ent_busy');
  });

  it('falls back to relevance when nobody is known', async () => {
    const payload = repo.getGraphPayload(WS);
    const target = payload.memories.find((m) => m.id === 'mem_11')!;
    const m = meeting('evt_6', target.text, [attendee('Nobody Known', 'nobody@nowhere.io')]);
    const out = await contextForAll(repo, embeddings, WS, [m]);
    expect(out['evt_6']![0]!.memory_id).toBe('mem_11');
    expect(out['evt_6']!.length).toBeGreaterThan(0);
  });

  it('merges entity matches before relevance hits, without repeats, capped at five', async () => {
    addPeople();
    const payload = repo.getGraphPayload(WS);
    const sdk = payload.memories.find((m) => m.id === 'mem_11')!;
    const busy = meeting('evt_7', 'Catch up', [attendee('Park Jihoon', 'jihoon@nowhere.io')]);
    const both = meeting('evt_8', sdk.text, [attendee('Kim Sujin', 'sujin@somewhere.io')]);
    const out = await contextForAll(repo, embeddings, WS, [busy, both]);
    expect(out['evt_7']).toHaveLength(5);
    expect(out['evt_7']!.map((c) => c.memory_id)).toEqual(['mem_00', 'mem_01', 'mem_02', 'mem_05', 'mem_09']);
    const ids = out['evt_8']!.map((c) => c.memory_id);
    expect(ids.slice(0, 2)).toEqual(['mem_11', 'mem_13']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(5);
  });

  it('returns an empty list, and does not embed, for a meeting with nothing to go on', async () => {
    const counted = countingEmbeddings();
    const m = meeting('evt_9', '', []);
    const out = await contextForAll(repo, counted, WS, [m]);
    expect(out['evt_9']).toEqual([]);
    expect(counted.calls).toBe(0);
  });

  it('embeds once per meeting and reuses the result while nothing changed', async () => {
    addPeople();
    const counted = countingEmbeddings();
    const a = meeting('evt_10', 'Weekly sync', [attendee('Kim Sujin', 'sujin@somewhere.io')]);
    const b = meeting('evt_11', 'Roadmap review', [attendee('Nobody', 'n@nowhere.io')]);
    const first = await contextForAll(repo, counted, WS, [a, b]);
    expect(counted.calls).toBe(2);
    const second = await contextForAll(repo, counted, WS, [{ ...a }, { ...b }]);
    expect(counted.calls).toBe(2);
    expect(second['evt_10']).toBe(first['evt_10']);
    expect(second['evt_11']).toBe(first['evt_11']);

    // A retitled meeting is a different meeting to remember for.
    await contextForAll(repo, counted, WS, [{ ...a, title: 'Offsite' }, b]);
    expect(counted.calls).toBe(3);

    // New memories arriving is a reason to look again for everyone.
    resetMeetingContextCache();
    await contextForAll(repo, counted, WS, [a, b]);
    expect(counted.calls).toBe(5);
  });
});
