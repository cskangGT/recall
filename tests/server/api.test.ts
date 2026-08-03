import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed, namespaceSeed } from '../../server/seed/import';
import workspaceJson from '../../seed/workspace.json';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
const del = (path: string) => handle({ method: 'DELETE', path, body: null }, deps);
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
      type: 'screenshot', content: 'evals',
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
      type: 'screenshot', content: 'evals',
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
      type: 'screenshot', content: 'evals',
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
      type: 'screenshot', content: 'evals',
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
      type: 'screenshot', content: 'evals',
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

describe('PATCH /settings', () => {
  it('turns auto-reorganize off and reports it in the payload', async () => {
    const res = await patch(`${base}/settings`, { autoReorganize: false });
    expect(res.status).toBe(200);
    expect(validateSeed((res.body as { graph: unknown }).graph).workspace.auto_reorganize)
      .toBe(false);
  });

  it('rejects a non-boolean rather than coercing it', async () => {
    expect((await patch(`${base}/settings`, { autoReorganize: 'off' })).status).toBe(400);
  });

  /** The switch has to change what the pipeline does, not just what it says. */
  it('stops the ingest restructuring anything', async () => {
    await patch(`${base}/settings`, { autoReorganize: false });
    const res = await post(`${base}/capture`, {
      type: 'screenshot',
      content: 'Braintrust vs Langfuse for agent evals',
    });

    expect(res.status).toBe(200);
    const body = res.body as { reorg: unknown; graph: GraphPayload };
    expect(body.reorg).toBeNull();
    // The memories still landed; only the taxonomy stayed put.
    expect(body.graph.memories.length).toBeGreaterThan(47);
    expect(body.graph.categories).toHaveLength(20);
  });
});


/**
 * The first DELETE this API has had. Nothing at any layer could remove a
 * memory: no repository method, no route, no DataSource method, no store
 * action.
 */
describe('DELETE memory', () => {
  it('removes it and returns the graph without it', async () => {
    const before = repo.getGraphPayload(WS);
    const victim = before.memories[0]!;

    const res = await del(`${base}/memories/${victim.id}`);
    expect(res.status).toBe(200);

    const graph = (res.body as { graph: GraphPayload }).graph;
    expect(graph.memories).toHaveLength(before.memories.length - 1);
    expect(graph.memories.some((m) => m.id === victim.id)).toBe(false);
    expect(repo.listMemories(WS)).toHaveLength(before.memories.length - 1);
  });

  /**
   * The schema is what makes this one statement: memory_category, memory_entity
   * and both edge endpoints are ON DELETE CASCADE. A dangling edge would draw a
   * line to a node that is gone.
   */
  it('takes its edges with it', async () => {
    const before = repo.getGraphPayload(WS);
    const connected = before.memories.find((m) =>
      before.edges.some((e) => e.source_memory_id === m.id || e.target_memory_id === m.id),
    )!;
    expect(connected).toBeDefined();

    await del(`${base}/memories/${connected.id}`);
    const graph = repo.getGraphPayload(WS);
    expect(
      graph.edges.some(
        (e) => e.source_memory_id === connected.id || e.target_memory_id === connected.id,
      ),
    ).toBe(false);
  });

  it('404s an id it does not have, and changes nothing', async () => {
    const before = repo.listMemories(WS).length;
    const res = await del(`${base}/memories/mem_nope`);
    expect(res.status).toBe(404);
    expect(repo.listMemories(WS)).toHaveLength(before);
  });

  /** Deleting a memory must not take its source, or its siblings, with it. */
  it('leaves the source and the sibling memories alone', async () => {
    const before = repo.getGraphPayload(WS);
    const victim = before.memories[0]!;
    const siblings = before.memories.filter(
      (m) => m.source_id === victim.source_id && m.id !== victim.id,
    ).length;

    await del(`${base}/memories/${victim.id}`);
    const graph = repo.getGraphPayload(WS);
    expect(graph.sources.some((s) => s.id === victim.source_id)).toBe(true);
    expect(
      graph.memories.filter((m) => m.source_id === victim.source_id).length,
    ).toBe(siblings);
  });
});

/**
 * More than one workspace.
 *
 * The schema was always multi-tenant — every table carries a workspace_id with
 * a foreign key and an index — but nothing had ever created a second one, and
 * two things were only unique *within* one while sitting in a column that is a
 * global primary key. Both failed on the first write of the second visitor's
 * session, which is the worst possible moment to find out.
 */
describe('a second workspace', () => {
  const mint = () => {
    const id = `ws_${Math.random().toString(36).slice(2, 10)}`;
    importSeed(repo, id, namespaceSeed(workspaceJson as unknown as GraphPayload, id));
    return id;
  };

  it('can be created at all — the seed has fixed primary keys', () => {
    // Importing the seed twice unnamespaced fails on `UNIQUE constraint failed:
    // sources.id`, which is why namespaceSeed exists.
    const a = mint();
    const b = mint();
    expect(repo.getGraphPayload(a).memories).toHaveLength(47);
    expect(repo.getGraphPayload(b).memories).toHaveLength(47);
  });

  it('rewrites every reference, not just the ids', () => {
    const graph = repo.getGraphPayload(mint());
    // A missed reference inserts cleanly and then fails validateSeed in the
    // browser, a long way from the mistake.
    expect(() => validateSeed(graph)).not.toThrow();
  });

  it('keeps one visitor out of another visitor\'s corpus', async () => {
    const a = mint();
    const b = mint();
    await post(`/api/workspaces/${a}/capture`, { type: 'text', content: 'anything' });

    expect(repo.getGraphPayload(a).memories.length).toBeGreaterThan(47);
    expect(repo.getGraphPayload(b).memories).toHaveLength(47);
  });

  /** `edges.id` is a global primary key and rebuildEdges counts per workspace. */
  it('lets both of them capture — edge ids must not collide', async () => {
    const a = mint();
    const b = mint();
    const first = await post(`/api/workspaces/${a}/capture`, { type: 'text', content: 'anything' });
    const second = await post(`/api/workspaces/${b}/capture`, { type: 'text', content: 'anything' });

    expect((first.body as { status: string }).status).toBe('complete');
    expect((second.body as { status: string }).status).toBe('complete');
  });
});

/**
 * The invite gate.
 *
 * A public deployment runs extraction and embedding on somebody's paid account,
 * so an open POST /capture is an open invitation to spend it. Reading stays
 * free — the demo is meant to be shown to anyone — and everything that writes
 * needs the token.
 */
describe('invite token', () => {
  // Built per call: `deps` is assigned in beforeEach, so spreading it at module
  // scope captures undefined.
  const call = (method: string, path: string, invite?: string) =>
    handle(
      { method, path, body: { type: 'text', content: 'x' }, invite },
      { ...deps, inviteToken: 'let-me-in' },
    );

  it('lets anyone read', async () => {
    expect((await call('GET', `${base}/graph`)).status).toBe(200);
  });

  it('refuses a write with no token', async () => {
    const res = await call('POST', `${base}/capture`);
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toContain('read-only');
  });

  it('refuses a write with the wrong token', async () => {
    expect((await call('POST', `${base}/capture`, 'guess')).status).toBe(403);
  });

  it('refuses a delete too — every method that writes, not just capture', async () => {
    const victim = repo.getGraphPayload(WS).memories[0]!.id;
    expect((await call('DELETE', `${base}/memories/${victim}`)).status).toBe(403);
    expect(repo.getGraphPayload(WS).memories.some((m) => m.id === victim)).toBe(true);
  });

  it('allows the write when the token matches', async () => {
    expect((await call('POST', `${base}/capture`, 'let-me-in')).status).toBe(200);
  });

  /** Absent a token the gate is off — what local development and this suite want. */
  it('is off entirely when no token is configured', async () => {
    const res = await handle(
      { method: 'POST', path: `${base}/capture`, body: { type: 'text', content: 'x' } },
      deps,
    );
    expect(res.status).toBe(200);
  });
});

describe('what the capture response carries', () => {
  it('names the categories it touched, so a caller need not search the graph', async () => {
    const res = await post(`${base}/capture`, {
      type: 'screenshot', content: 'Braintrust vs Langfuse',
    });
    const body = res.body as { touchedCategories: { id: string; name: string }[] };
    expect(body.touchedCategories.length).toBeGreaterThan(0);
    for (const c of body.touchedCategories) {
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('omits the graph when the caller says it does not want it', async () => {
    // The payload carries every memory's 1024-float vector and grows forever.
    // The extension shows a notification and closes; it never reads this.
    const res = await post(`${base}/capture`, {
      type: 'text', content: 'a note', includeGraph: false,
    });
    const body = res.body as Record<string, unknown>;
    expect(body.graph).toBeUndefined();
    expect(body.touchedCategories).toBeDefined();
    expect(body.addedMemoryIds).toBeDefined();
  });

  it('still sends the graph by default — the web client needs it', async () => {
    const res = await post(`${base}/capture`, { type: 'text', content: 'a note' });
    expect((res.body as Record<string, unknown>).graph).toBeDefined();
  });

  it('accepts a title and puts it on the source', async () => {
    const res = await post(`${base}/capture`, {
      type: 'link', url: 'https://example.com/a', title: 'A Page Title', content: 'body',
    });
    const { sourceId } = res.body as { sourceId: string };
    expect(repo.listSources(WS).find((s) => s.id === sourceId)!.title).toBe('A Page Title');
  });
});

describe('screenshots', () => {
  // A 1x1 PNG.
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let imageRoot: string;

  beforeEach(() => {
    imageRoot = mkdtempSync(path.join(tmpdir(), 'recall-api-img-'));
    deps.imageRoot = imageRoot;
    deps.ingest = new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings(), imageRoot);
  });
  afterEach(() => rmSync(imageRoot, { recursive: true, force: true }));

  it('stores the bytes and points the source at them', async () => {
    const res = await post(`${base}/capture`, {
      type: 'screenshot', content: 'a pricing table',
      image: { data: PNG, mediaType: 'image/png' },
    });
    expect(res.status).toBe(200);

    const { sourceId } = res.body as { sourceId: string };
    const source = repo.listSources(WS).find((s) => s.id === sourceId)!;
    expect(source.image_path).toBe(path.join(imageRoot, `${sourceId}.png`));
    expect(readFileSync(source.image_path!)).toEqual(Buffer.from(PNG, 'base64'));
  });

  it('refuses a filesystem path from the request body', async () => {
    // This used to be accepted and handed to `fs.readFile`, which made every
    // capture a read primitive for any image on the machine.
    const res = await post(`${base}/capture`, {
      type: 'screenshot', imagePath: '/Users/someone/.ssh/backup.png',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/imagePath is not accepted/);
  });

  it('refuses an image type no vision API reads', async () => {
    const res = await post(`${base}/capture`, {
      type: 'screenshot', image: { data: PNG, mediaType: 'image/svg+xml' },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/unsupported image type/);
  });

  it('serves the image back, so a saved screenshot can be looked at', async () => {
    const { body } = await post(`${base}/capture`, {
      type: 'screenshot', image: { data: PNG, mediaType: 'image/png' },
    });
    const { sourceId } = body as { sourceId: string };

    const res = await get(`${base}/sources/${sourceId}/image`);
    expect(res.status).toBe(200);
    // The route describes the file; `server.ts` streams it.
    expect(res.file).toEqual({
      path: path.join(imageRoot, `${sourceId}.png`),
      contentType: 'image/png',
    });
  });

  it('will not serve an image_path that is not ours', async () => {
    // The seeded demo points at a committed asset outside the root. Refusing is
    // right — the file is not this route's to hand out, and "should never be
    // anything else" is how a file server for the home directory gets built.
    const outside = repo.listSources(WS).find((s) => s.image_path)!;
    const res = await get(`${base}/sources/${outside.id}/image`);
    expect(res.status).toBe(404);
    expect(res.file).toBeUndefined();
  });

  it('404s a source that has no image at all', async () => {
    const { body } = await post(`${base}/capture`, { type: 'text', content: 'just words' });
    const { sourceId } = body as { sourceId: string };
    expect((await get(`${base}/sources/${sourceId}/image`)).status).toBe(404);
  });
});
