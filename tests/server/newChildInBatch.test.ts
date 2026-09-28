import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { FixtureProvider } from '../../server/ai/fixture';
import { ASSIGN } from '../../src/core/thresholds';

/**
 * A long note can open a category and, two sentences later, open a child
 * beside it. The plan hands the child a *provisional* parent — the synthetic
 * id of the cluster opened earlier in the same batch — and persist() used to
 * write that id straight into categories.parent_id, which the schema
 * rejected: FOREIGN KEY constraint failed, on a perfectly good note.
 */
const WS = 'ws_t';
let repo: SqliteRepository;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  repo.createWorkspace({ id: WS, name: 't' });
});
afterEach(() => repo.close());

/** Two memories: the second sits in the new-child band of the first, nowhere near anything else. */
const provider = Object.assign(new FixtureProvider(), {
  extract: async () => ({
    memories: [
      { text: 'alpha opens a category', kind: 'fact' as const, confidence: 0.9, entities: [] },
      { text: 'beta belongs beside alpha', kind: 'fact' as const, confidence: 0.9, entities: [] },
    ],
    summary: 'two',
    suggested_title: 'two',
  }),
});
const c = (ASSIGN.NEW_CHILD + ASSIGN.EXISTING_CATEGORY) / 2;
const embeddings = {
  dimensions: 4,
  embed: async (texts: string[]) =>
    texts.map((t) => (t.startsWith('alpha') ? [1, 0, 0, 0] : [c, Math.sqrt(1 - c * c), 0, 0])),
};

describe('a child opened under a category from the same batch', () => {
  it('lands under the real category, not the provisional cluster id', async () => {
    const ingest = new IngestPipeline(repo, provider, embeddings);
    const result = await ingest.ingest(
      { workspaceId: WS, type: 'text', content: 'alpha. beta.' },
      { reorganize: false },
    );
    expect(result.status).toBe('complete');
    expect(result.addedMemoryIds).toHaveLength(2);

    const categories = repo.listCategories(WS);
    expect(categories).toHaveLength(2);
    const parent = categories.find((x) => x.parent_id === null)!;
    const child = categories.find((x) => x.parent_id !== null)!;
    expect(child.parent_id).toBe(parent.id);
  });
});
