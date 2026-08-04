import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { validateSeed } from '../../src/data/validateSeed';
import type { GraphPayload } from '../../src/core/types';

/**
 * The batch ingest: many sources, one structural operation.
 *
 * The fixture provider extracts the demo item's two memories for *any* input,
 * so every item after the first dedupes to nothing — degenerate, but exactly
 * what makes the invariants sharp: N source rows always exist, memories are
 * written once, and however many items arrive, at most one reorg row does.
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
    reset: (workspaceId) => {
      repo.deleteWorkspace(workspaceId);
      importSeed(repo, workspaceId);
    },
  };
});

afterEach(() => repo.close());

const post = (path: string, body: unknown = null) => handle({ method: 'POST', path, body }, deps);
const base = `/api/workspaces/${WS}`;

const ITEMS = [
  { type: 'text', content: 'Braintrust vs Langfuse for agent evals', title: 'note one' },
  { type: 'text', content: 'A second note about something else entirely', title: 'note two' },
  { type: 'text', content: 'A third note, saved in the same drop', title: 'note three' },
];

describe('IngestPipeline.ingestBatch', () => {
  it('persists every source, suppresses per-item reorgs, and fires the gates once', async () => {
    const { results, reorg } = await deps.ingest.ingestBatch(
      ITEMS.map((i) => ({ workspaceId: WS, type: 'text' as const, content: i.content, title: i.title })),
    );

    expect(results).toHaveLength(3);
    for (const r of results) expect(r.reorg).toBeNull();

    // The fixture extracts the same two memories every time; the batch writes
    // them once and reports the rest as already held.
    expect(results[0]!.addedMemoryIds).toHaveLength(2);
    expect(results[1]!.skipped).toHaveLength(2);
    expect(results[2]!.skipped).toHaveLength(2);

    // The demo condition still tips — one split, after everything attached.
    expect(reorg).not.toBeNull();
    expect(reorg!.operation).toBe('split');
    expect(repo.listReorgEvents(WS, 10)).toHaveLength(1);

    // Every item is a source row — a capture is never lost, in bulk either.
    const sources = repo.listSources(WS);
    for (const title of ['note one', 'note two', 'note three']) {
      expect(sources.some((s) => s.title === title)).toBe(true);
    }
  });

  it('honors auto_reorganize off for the batch pass too', async () => {
    repo.setAutoReorganize(WS, false);
    const { reorg } = await deps.ingest.ingestBatch(
      ITEMS.map((i) => ({ workspaceId: WS, type: 'text' as const, content: i.content, title: i.title })),
    );
    expect(reorg).toBeNull();
    expect(repo.listReorgEvents(WS, 10)).toHaveLength(0);
  });
});

describe('POST capture/batch', () => {
  it('returns per-item results, the single reorg, and the final graph', async () => {
    const res = await post(`${base}/capture/batch`, { items: ITEMS });
    expect(res.status).toBe(200);

    const body = res.body as {
      results: { sourceId: string; status: string; addedMemoryIds: string[] }[];
      reorg: { operation: string } | null;
      graph: GraphPayload;
    };
    expect(body.results).toHaveLength(3);
    expect(body.reorg!.operation).toBe('split');

    const graph = validateSeed(body.graph);
    expect(graph.memories).toHaveLength(49);
    expect(graph.sources).toHaveLength(25);
  });

  it('leaves the graph out when includeGraph is false', async () => {
    const res = await post(`${base}/capture/batch`, { items: ITEMS, includeGraph: false });
    expect(res.status).toBe(200);
    expect((res.body as { graph?: unknown }).graph).toBeUndefined();
  });

  it('rejects an empty batch, an oversized batch, and a screenshot item', async () => {
    expect((await post(`${base}/capture/batch`, { items: [] })).status).toBe(400);
    expect(
      (
        await post(`${base}/capture/batch`, {
          items: Array.from({ length: 101 }, () => ({ type: 'text', content: 'x' })),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`${base}/capture/batch`, {
          items: [{ type: 'screenshot', imagePath: '/tmp/x.png' }],
        })
      ).status,
    ).toBe(400);
  });

  it('does not disturb the single-capture route', async () => {
    const res = await post(`${base}/capture`, {
      type: 'screenshot', content: 'evals', imagePath: '/seed/demo-screenshot.png',
    });
    expect(res.status).toBe(200);
    expect((res.body as { reorg: unknown }).reorg).not.toBeNull();
  });
});
