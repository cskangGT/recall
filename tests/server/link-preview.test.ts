import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { previewLink } from '../../server/link/preview';

/**
 * The link look: a pasted URL is read before it is kept. The route hands back
 * title and excerpt; private address space is off the table (a hosted box
 * fetching visitor URLs is an SSRF hole otherwise); a server without the
 * capability says 501, not a hang.
 */

const WS = 'ws_demo';
let repo: SqliteRepository;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
});

afterEach(() => repo.close());

const depsWith = (extra: Partial<Deps>): Deps => ({
  repo,
  ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  ask: new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  reset: () => {},
  ...extra,
});

const post = (deps: Deps, body: unknown) =>
  handle({ method: 'POST', path: `/api/workspaces/${WS}/link/preview`, body }, deps);

const PAGE = `<html><head><title>Plain Title</title>
<meta property="og:title" content="OG Title" />
<meta name="description" content="A page about sourdough." />
</head><body><p>Cold retard overnight gives the crust its blisters.</p></body></html>`;

const fakeFetch = (async () => ({ ok: true, text: async () => PAGE })) as unknown as typeof fetch;

describe('POST link/preview', () => {
  it('answers 501 where the server cannot read links', async () => {
    expect((await post(depsWith({}), { url: 'https://example.com' })).status).toBe(501);
  });

  it('requires a url', async () => {
    const deps = depsWith({ previewLink: (u) => previewLink(u, fakeFetch) });
    expect((await post(deps, {})).status).toBe(400);
  });

  it('reads title, description, and excerpt from the page', async () => {
    const deps = depsWith({ previewLink: (u) => previewLink(u, fakeFetch) });
    const res = await post(deps, { url: 'https://example.com/bread' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'OG Title',
      description: 'A page about sourdough.',
    });
    expect((res.body as { excerpt: string }).excerpt).toContain('Cold retard overnight');
  });

  it('refuses the private address space', async () => {
    const deps = depsWith({ previewLink: (u) => previewLink(u, fakeFetch) });
    for (const url of [
      'http://localhost/admin',
      'http://127.0.0.1:8080/',
      'http://10.0.0.5/',
      'http://192.168.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'ftp://example.com/x',
    ]) {
      const res = await post(deps, { url });
      expect(res.status, url).toBe(502);
    }
  });

  it('passes a page error along as 502', async () => {
    const notFound = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    const deps = depsWith({ previewLink: (u) => previewLink(u, notFound) });
    const res = await post(deps, { url: 'https://example.com/gone' });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toContain('404');
  });
});
