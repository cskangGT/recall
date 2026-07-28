import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { validateSeed } from '../../src/data/validateSeed';
import type { GraphPayload } from '../../src/core/types';

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
    reset: (workspaceId) => {
      repo.deleteWorkspace(workspaceId);
      importSeed(repo, workspaceId);
    },
  };
});

afterEach(() => repo.close());

const get = (path: string) => handle({ method: 'GET', path, body: null }, deps);
const post = (path: string, body: unknown = null) => handle({ method: 'POST', path, body }, deps);
const patch = (path: string, body: unknown) => handle({ method: 'PATCH', path, body }, deps);
const base = `/api/workspaces/${WS}`;

describe('GET graph', () => {
  it('returns a payload the frontend validator accepts', async () => {
    const res = await get(`${base}/graph`);
    expect(res.status).toBe(200);
    const payload = validateSeed(res.body);
    expect(payload.memories).toHaveLength(47);
    expect(payload.categories).toHaveLength(20);
  });

  it('404s an unknown workspace rather than returning an empty graph', async () => {
    const res = await get('/api/workspaces/ws_nope/graph');
    expect(res.status).toBe(404);
  });

  it('404s an unknown route', async () => {
    expect((await get('/api/nonsense')).status).toBe(404);
    expect((await get('/not-api/at/all')).status).toBe(404);
    expect((await get(`${base}/graph/extra`)).status).toBe(404);
  });
});

describe('POST capture', () => {
  it('ingests, splits, and returns the new graph in one round trip', async () => {
    const res = await post(`${base}/capture`, {
      type: 'screenshot', content: 'evals', imagePath: '/seed/demo-screenshot.png',
    });
    expect(res.status).toBe(200);

    const body = res.body as { addedMemoryIds: string[]; reorg: { banner_text: string } | null; graph: GraphPayload };
    expect(body.addedMemoryIds).toHaveLength(2);
    expect(body.reorg!.banner_text).toBe(
      'Split **AI Tooling** into **Agent Frameworks** and **Evals & Observability**',
    );
    // The graph rides along so the UI cannot render a split before the payload
    // that contains it.
    expect(validateSeed(body.graph).memories).toHaveLength(49);
  });

  it('rejects an unknown source type', async () => {
    const res = await post(`${base}/capture`, { type: 'audio', content: 'x' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/text, link, screenshot/);
  });

  it('rejects a missing body', async () => {
    expect((await post(`${base}/capture`)).status).toBe(400);
  });
});

describe('POST reset', () => {
  it('restores the pristine corpus after a capture', async () => {
    await post(`${base}/capture`, {
      type: 'screenshot', content: 'evals', imagePath: '/seed/demo-screenshot.png',
    });
    expect(validateSeed(repo.getGraphPayload(WS)).memories).toHaveLength(49);

    const res = await post(`${base}/reset`);
    expect(res.status).toBe(200);

    // Seed mode gets this from a page reload; once the corpus is in a database
    // the presenter loses that, and the runbook promises it.
    const graph = validateSeed((res.body as { graph: GraphPayload }).graph);
    expect(graph.memories).toHaveLength(47);
    expect(graph.sources).toHaveLength(22);
    expect(graph.categories).toHaveLength(20);
  });

  it('clears user corrections too', async () => {
    const payload = repo.getGraphPayload(WS);
    const memory = payload.memories[0]!;
    const target = payload.categories.find((c) => c.id !== memory.category_id)!;
    await post(`${base}/memories/${memory.id}/category`, { categoryId: target.id });
    expect(repo.getGraphPayload(WS).memories.find((m) => m.id === memory.id)!.category_locked).toBe(true);

    await post(`${base}/reset`);
    const after = repo.getGraphPayload(WS).memories.find((m) => m.id === memory.id)!;
    expect(after.category_id).toBe(memory.category_id);
    expect(after.category_locked).toBe(false);
  });
});

describe('POST ask', () => {
  it('answers with citations after the demo capture', async () => {
    await post(`${base}/capture`, {
      type: 'screenshot', content: 'evals', imagePath: '/seed/demo-screenshot.png',
    });
    const res = await post(`${base}/ask`, { question: 'What did we decide about our eval stack?' });
    expect(res.status).toBe(200);

    const body = res.body as { refused: boolean; citations: unknown[]; highlighted_node_ids: string[] };
    expect(body.refused).toBe(false);
    expect(body.citations.length).toBeGreaterThanOrEqual(2);
    expect(body.highlighted_node_ids.length).toBeGreaterThan(0);
  });

  it('refuses verbatim over HTTP too', async () => {
    const res = await post(`${base}/ask`, { question: 'What is the capital of France?' });
    expect(res.status).toBe(200); // a refusal is an answer, not an error
    expect((res.body as { answer: string }).answer).toBe(
      "I don't have anything saved about that yet.",
    );
  });

  it('rejects an empty question', async () => {
    expect((await post(`${base}/ask`, { question: '   ' })).status).toBe(400);
    expect((await post(`${base}/ask`, {})).status).toBe(400);
  });
});

describe('POST undo', () => {
  it('reverses the reorganization and returns the restored graph', async () => {
    const capture = await post(`${base}/capture`, {
      type: 'screenshot', content: 'evals', imagePath: '/seed/demo-screenshot.png',
    });
    const reorgId = (capture.body as { reorg: { id: string } }).reorg.id;

    const res = await post(`${base}/reorgs/${reorgId}/undo`);
    expect(res.status).toBe(200);

    const graph = validateSeed((res.body as { graph: GraphPayload }).graph);
    expect(graph.categories).toHaveLength(20);
    // Undo reverses the reorganization, not the capture.
    expect(graph.memories).toHaveLength(49);
  });

  it('refuses to undo the same reorganization twice', async () => {
    const capture = await post(`${base}/capture`, {
      type: 'screenshot', content: 'evals', imagePath: '/seed/demo-screenshot.png',
    });
    const reorgId = (capture.body as { reorg: { id: string } }).reorg.id;
    await post(`${base}/reorgs/${reorgId}/undo`);
    expect((await post(`${base}/reorgs/${reorgId}/undo`)).status).toBe(400);
  });

  it('404s an unknown reorganization', async () => {
    expect((await post(`${base}/reorgs/reorg_nope/undo`)).status).toBe(404);
  });
});

describe('POST memory category — a user correction', () => {
  it('moves the memory and locks the assignment', async () => {
    const payload = repo.getGraphPayload(WS);
    const memory = payload.memories[0]!;
    const target = payload.categories.find((c) => c.id !== memory.category_id)!;

    const res = await post(`${base}/memories/${memory.id}/category`, { categoryId: target.id });
    expect(res.status).toBe(200);

    const graph = (res.body as { graph: GraphPayload }).graph;
    const moved = graph.memories.find((m) => m.id === memory.id)!;
    expect(moved.category_id).toBe(target.id);
    expect(moved.category_locked).toBe(true);
  });

  it('404s unknown ids and 400s a missing categoryId', async () => {
    const payload = repo.getGraphPayload(WS);
    expect((await post(`${base}/memories/mem_nope/category`, { categoryId: payload.categories[0]!.id })).status).toBe(404);
    expect((await post(`${base}/memories/${payload.memories[0]!.id}/category`, { categoryId: 'cat_nope' })).status).toBe(404);
    expect((await post(`${base}/memories/${payload.memories[0]!.id}/category`, {})).status).toBe(400);
  });
});

describe('PATCH category', () => {
  it('renaming locks the name against future reorganization', async () => {
    const category = repo.getGraphPayload(WS).categories[0]!;
    const res = await patch(`${base}/categories/${category.id}`, { name: 'My Name' });
    expect(res.status).toBe(200);

    const updated = (res.body as { graph: GraphPayload }).graph.categories
      .find((c) => c.id === category.id)!;
    expect(updated.name).toBe('My Name');
    expect(updated.name_locked).toBe(true);
  });

  it('re-parents a child onto a different root', async () => {
    const payload = repo.getGraphPayload(WS);
    const child = payload.categories.find((c) => c.parent_id !== null)!;
    const root = payload.categories.find((c) => c.parent_id === null && c.id !== child.parent_id)!;

    const res = await patch(`${base}/categories/${child.id}`, { parentId: root.id });
    expect(res.status).toBe(200);
    expect(
      (res.body as { graph: GraphPayload }).graph.categories.find((c) => c.id === child.id)!.parent_id,
    ).toBe(root.id);
  });

  it('refuses a third level in the words the UI already uses', async () => {
    const payload = repo.getGraphPayload(WS);
    const children = payload.categories.filter((c) => c.parent_id !== null);
    const res = await patch(`${base}/categories/${children[0]!.id}`, { parentId: children[1]!.id });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Recall keeps categories two levels deep.');
  });

  it('400s an update with nothing in it', async () => {
    const category = repo.getGraphPayload(WS).categories[0]!;
    expect((await patch(`${base}/categories/${category.id}`, {})).status).toBe(400);
  });
});

describe('POST /sources/:id/retry', () => {
  it('refuses a source that did not fail — retrying would double its memories', async () => {
    const graph = validateSeed((await get(`${base}/graph`)).body);
    const res = await post(`${base}/sources/${graph.sources[0]!.id}/retry`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/only a failed source/);
  });

  it('404s an unknown source', async () => {
    expect((await post(`${base}/sources/src_nope/retry`)).status).toBe(404);
  });

  it('re-runs a failed source and reports the new graph', async () => {
    // Fail one on purpose, through the real pipeline.
    const broken = new FixtureProvider();
    broken.extract = async () => {
      throw new Error('rate limited');
    };
    const failing = new IngestPipeline(repo, broken, new FixtureEmbeddings());
    const failed = await failing.ingest({ workspaceId: WS, type: 'text', content: 'anything' });
    expect(failed.status).toBe('failed');

    const res = await post(`${base}/sources/${failed.sourceId}/retry`);
    expect(res.status).toBe(200);

    const body = res.body as { status: string; graph: GraphPayload };
    expect(body.status).not.toBe('failed');
    // The payload carries status through, so the UI can stop offering Retry.
    const source = body.graph.sources.find((s) => s.id === failed.sourceId)!;
    expect(source.status).not.toBe('failed');
    expect(source.error_message).toBeNull();
  });
});

