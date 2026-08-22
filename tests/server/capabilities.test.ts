import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';

/**
 * GET /api/capabilities — the server says which import doors it can open, so
 * the client never draws a door that answers 501 (the hosted Ubuntu box and
 * "이 Mac의 메모").
 */

let repo: SqliteRepository;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
});

afterEach(() => repo.close());

const depsWith = (extra: Partial<Deps>): Deps => ({
  repo,
  ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  ask: new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  reset: () => {},
  ...extra,
});

const get = (deps: Deps) => handle({ method: 'GET', path: '/api/capabilities', body: null }, deps);

describe('GET /api/capabilities', () => {
  it('reports closed doors on a server with no readers', async () => {
    const res = await get(depsWith({}));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ appleNotes: false, notion: false });
  });

  it('reports exactly the doors the deps can open', async () => {
    const res = await get(depsWith({
      readNotes: async () => ({ notes: [], total: 0, droppedSecretLines: 0 }) as never,
    }));
    expect(res.body).toEqual({ appleNotes: true, notion: false });
  });
});
