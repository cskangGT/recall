import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { buildMergePrompt, coerceMerge } from '../../server/ai/prompts';

/**
 * The user-driven merge. The AI explains and drafts; the person decides; the
 * apply loses nothing — times_seen sums, entity links union, the originals'
 * sources stay. Preview is a capability (501 without a drafting model);
 * apply is pure repository work and needs no model at all.
 */

const WS = 'ws_demo';
let repo: SqliteRepository;
let deps: Deps;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  const provider = new FixtureProvider();
  const embeddings = new FixtureEmbeddings();
  deps = {
    repo,
    ingest: new IngestPipeline(repo, provider, embeddings),
    ask: new AskPipeline(repo, provider, embeddings),
    reset: () => {},
  };
});

afterEach(() => repo.close());

const post = (path: string, body: unknown = null) => handle({ method: 'POST', path, body }, deps);
const base = `/api/workspaces/${WS}`;
const twoIds = () => repo.listMemories(WS).slice(0, 2).map((m) => m.id);

describe('POST memories/merge-preview', () => {
  it('answers 501 when the wired model cannot draft merges — the fixture', async () => {
    const res = await post(`${base}/memories/merge-preview`, { memoryIds: twoIds() });
    expect(res.status).toBe(501);
  });

  it('drafts through the capability when a model has it', async () => {
    const provider = Object.assign(new FixtureProvider(), {
      mergeMemories: async (input: { texts: string[]; locale?: string }) => ({
        reason: `these ${input.texts.length} overlap`,
        merged_text: input.texts.join(' / '),
      }),
    });
    deps.ingest = new IngestPipeline(repo, provider, new FixtureEmbeddings());

    const ids = twoIds();
    const res = await post(`${base}/memories/merge-preview`, { memoryIds: ids, locale: 'ko' });
    expect(res.status).toBe(200);
    const body = res.body as { reason: string; merged_text: string };
    expect(body.reason).toContain('2');
    expect(body.merged_text.length).toBeGreaterThan(0);
  });

  it('refuses fewer than two memories, and unknown ids', async () => {
    const one = await post(`${base}/memories/merge-preview`, { memoryIds: [twoIds()[0]] });
    expect(one.status).toBe(400);
    const ghost = await post(`${base}/memories/merge-preview`, {
      memoryIds: [twoIds()[0], 'mem_ghost'],
    });
    expect(ghost.status).toBe(404);
  });
});

describe('POST memories/merge', () => {
  it('merges without losing anything: times_seen sums, entities union, originals go', async () => {
    const [a, b] = repo.listMemories(WS).slice(0, 2);
    // Give one original a second arrival, so the sum is visible.
    repo.reinforceMemory(a!.id);
    const entityUnion = new Set([...a!.entity_ids, ...b!.entity_ids]);

    const res = await post(`${base}/memories/merge`, {
      memoryIds: [a!.id, b!.id],
      mergedText: '두 기억의 모든 사실을 담은 한 문장.',
    });
    expect(res.status).toBe(200);
    const { mergedMemoryId, graph } = res.body as {
      mergedMemoryId: string;
      graph: { memories: { id: string; text: string; times_seen?: number; entity_ids: string[]; category_locked: boolean }[] };
    };

    const merged = graph.memories.find((m) => m.id === mergedMemoryId)!;
    expect(merged.text).toBe('두 기억의 모든 사실을 담은 한 문장.');
    expect(merged.times_seen).toBe(3); // 2 (reinforced a) + 1 (b)
    expect(new Set(merged.entity_ids)).toEqual(entityUnion);
    // The merge is a user edit — no reorganization may quietly undo it.
    expect(merged.category_locked).toBe(true);

    expect(graph.memories.some((m) => m.id === a!.id)).toBe(false);
    expect(graph.memories.some((m) => m.id === b!.id)).toBe(false);
  });

  it('keeps every original source — provenance is never merged away', async () => {
    const before = repo.listSources(WS).length;
    const res = await post(`${base}/memories/merge`, {
      memoryIds: twoIds(),
      mergedText: 'merged',
    });
    expect(res.status).toBe(200);
    expect(repo.listSources(WS).length).toBe(before);
  });

  it('requires the approved text', async () => {
    const res = await post(`${base}/memories/merge`, { memoryIds: twoIds(), mergedText: '  ' });
    expect(res.status).toBe(400);
  });
});

describe('merge prompt and coercion', () => {
  it('states both hard rules and numbers the memories', () => {
    const prompt = buildMergePrompt({ texts: ['첫 번째', 'second'], locale: 'ko' });
    expect(prompt).toContain('Nothing may be lost');
    expect(prompt).toContain('Nothing may be');
    expect(prompt).toContain('1. 첫 번째');
    expect(prompt).toContain('2. second');
    expect(prompt).toContain('한국어');
  });

  it('falls back to the joined originals rather than losing content', () => {
    const draft = coerceMerge({ reason: 'r' }, ['a', 'b']);
    expect(draft.merged_text).toBe('a · b');
  });
});
