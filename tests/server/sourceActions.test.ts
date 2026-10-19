import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { buildCondensePrompt, coerceCondense } from '../../server/ai/prompts';

/**
 * Two hands the review card grows: condense one source's memories into a
 * single draft (a capability — 501 without a model), and throw a source away
 * whole (pure repository work, cascades by schema, teaches nothing).
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

const base = `/api/workspaces/${WS}`;
const post = (path: string, body: unknown = null) => handle({ method: 'POST', path, body }, deps);
const del = (path: string) => handle({ method: 'DELETE', path, body: null }, deps);

/** A source with at least two memories. */
const richSource = () => {
  const counts = new Map<string, number>();
  for (const m of repo.listMemories(WS)) counts.set(m.source_id, (counts.get(m.source_id) ?? 0) + 1);
  return [...counts.entries()].find(([, n]) => n >= 2)![0];
};

const withCondense = () => {
  const provider = Object.assign(new FixtureProvider(), {
    condenseSource: async (input: { title: string; texts: string[]; locale?: string }) => ({
      text: `${input.title}: ${input.texts.length} things, in one`,
    }),
  });
  deps.ingest = new IngestPipeline(repo, provider, new FixtureEmbeddings());
};

describe('DELETE sources/:id', () => {
  it('removes the source, its memories and their edges — nothing else', async () => {
    const id = richSource();
    const mine = new Set(repo.listMemories(WS).filter((m) => m.source_id === id).map((m) => m.id));
    const sourcesBefore = repo.listSources(WS).length;
    const memoriesBefore = repo.listMemories(WS).length;

    const res = await del(`${base}/sources/${id}`);
    expect(res.status).toBe(200);
    const graph = (res.body as { graph: { sources: { id: string }[]; memories: { id: string }[] } }).graph;
    expect(graph.sources.some((s) => s.id === id)).toBe(false);
    expect(graph.sources).toHaveLength(sourcesBefore - 1);
    expect(graph.memories).toHaveLength(memoriesBefore - mine.size);
    expect(graph.memories.some((m) => mine.has(m.id))).toBe(false);
    expect(repo.listEdges(WS).some((e) => mine.has(e.source_memory_id) || mine.has(e.target_memory_id))).toBe(false);
  });

  it('404s an unknown source', async () => {
    expect((await del(`${base}/sources/src_nope`)).status).toBe(404);
  });
});

describe('POST sources/:id/condense-preview', () => {
  it('answers 501 when the wired model cannot condense — the fixture', async () => {
    const res = await post(`${base}/sources/${richSource()}/condense-preview`, { locale: 'ko' });
    expect(res.status).toBe(501);
  });

  it('drafts one text through the capability, and writes nothing', async () => {
    withCondense();
    const id = richSource();
    const before = repo.listMemories(WS).length;
    const res = await post(`${base}/sources/${id}/condense-preview`, { locale: 'ko' });
    expect(res.status).toBe(200);
    expect((res.body as { text: string }).text).toMatch(/things, in one$/);
    expect(repo.listMemories(WS)).toHaveLength(before);
  });

  it('404s an unknown source and 400s a source with nothing to condense', async () => {
    withCondense();
    expect((await post(`${base}/sources/src_nope/condense-preview`)).status).toBe(404);
    const empty = repo.listSources(WS).find(
      (s) => !repo.listMemories(WS).some((m) => m.source_id === s.id),
    );
    if (empty) expect((await post(`${base}/sources/${empty.id}/condense-preview`)).status).toBe(400);
  });
});

describe('GET /api/capabilities', () => {
  it('says whether condensing is a door this server can open', async () => {
    const get = () => handle({ method: 'GET', path: '/api/capabilities', body: null }, deps);
    expect((await get()).body).toMatchObject({ condense: false });
    withCondense();
    expect((await get()).body).toMatchObject({ condense: true });
  });
});

describe('buildCondensePrompt / coerceCondense', () => {
  it('names the source, numbers the memories, and asks for one memory in the source language', () => {
    const prompt = buildCondensePrompt({
      title: 'Rizz 사례',
      texts: ['주 7달러 구독', '창업자 2명'],
      locale: 'ko',
    });
    expect(prompt).toContain('Rizz 사례');
    expect(prompt).toContain('1. 주 7달러 구독');
    expect(prompt).toContain('2. 창업자 2명');
    expect(prompt).toMatch(/ONE memory/);
    expect(prompt).toMatch(/same language/);
  });

  it('falls back to the originals joined rather than losing content', () => {
    expect(coerceCondense({ text: '  ' }, ['a', 'b']).text).toBe('a · b');
    expect(coerceCondense({ text: 'one' }, ['a', 'b']).text).toBe('one');
    expect(coerceCondense(null, ['a']).text).toBe('a');
  });
});
