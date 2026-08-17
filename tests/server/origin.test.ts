import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';

/**
 * A webpage you are merely visiting must not be able to write here.
 *
 * The reasoning these tests pin down is written out in `originAllowed`. The
 * short version: the belief that `content-type: application/json` forces a
 * preflight and therefore protects this server is true in every clause and
 * false in its conclusion, because the attacker picks the content-type. A
 * `mode: 'no-cors'` POST is a *simple* request, arrives, and executes.
 *
 * That was survivable while the server only existed for the ten minutes
 * `npm start` was in a terminal. A launchd agent makes it true from login to
 * shutdown, which is why this landed before the agent did.
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

const base = `/api/workspaces/${WS}`;
const post = (path: string, origin?: string, body: unknown = null) =>
  handle({ method: 'POST', path, body, origin }, deps);

describe('writes from a browser origin', () => {
  it('refuses a page that is merely open in another tab', async () => {
    const res = await post(`${base}/reset`, 'https://evil.com');
    expect(res.status).toBe(403);
    // The corpus is the assertion that matters — a 403 with the reset already
    // done would pass a status check and still have destroyed everything.
    expect(repo.listMemories(WS)).toHaveLength(47);
  });

  it('refuses it on capture too, which spends real API credit', async () => {
    const res = await post(`${base}/capture`, 'https://evil.com', {
      type: 'text',
      content: 'anything',
    });
    expect(res.status).toBe(403);
    expect(repo.listSources(WS)).toHaveLength(22);
  });

  it('names the origin it turned away, so the log says who', async () => {
    const res = await post(`${base}/reset`, 'https://evil.com');
    expect((res.body as { error: string }).error).toContain('https://evil.com');
  });

  it('lets the served client through', async () => {
    expect((await post(`${base}/reset`, 'http://127.0.0.1:5170')).status).toBe(200);
    expect((await post(`${base}/reset`, 'http://localhost:5170')).status).toBe(200);
  });

  it('lets the Vite dev proxy through, which forwards the browser origin', async () => {
    expect((await post(`${base}/reset`, 'http://localhost:5173')).status).toBe(200);
  });

  it('lets an extension through, whatever its id', async () => {
    expect((await post(`${base}/reset`, 'chrome-extension://abcdefghijklmnop')).status).toBe(200);
    expect((await post(`${base}/reset`, 'safari-web-extension://ABC-123')).status).toBe(200);
  });

  it('lets a caller with no Origin through — curl is not a browser', async () => {
    // Anything running as you on this machine can read the database file
    // directly. There is nothing here to defend against, and refusing would
    // break the installer's own health probe.
    expect((await post(`${base}/reset`, undefined)).status).toBe(200);
  });

  it('is not fooled by an origin that merely starts with localhost', async () => {
    expect((await post(`${base}/reset`, 'http://localhost.evil.com')).status).toBe(403);
    expect((await post(`${base}/reset`, 'http://127.0.0.1.evil.com')).status).toBe(403);
  });
});

describe('reads stay free', () => {
  it('serves the graph to any origin — the threat to a read is rebinding', async () => {
    // Guarded in `server.ts` by the Host check instead, because a rebound name
    // is same-origin and sends no Origin header at all.
    const res = await handle(
      { method: 'GET', path: `${base}/graph`, body: null, origin: 'https://evil.com' },
      deps,
    );
    expect(res.status).toBe(200);
  });
});

describe('same-origin on a hosted deployment', () => {
  const hosted = (origin: string | undefined, host: string | undefined) =>
    handle({ method: 'POST', path: `${base}/reset`, body: null, origin, host }, deps);

  it("lets the deployment's own client through — Origin names the same host", async () => {
    expect((await hosted('http://43.202.24.252', '43.202.24.252')).status).toBe(200);
    expect((await hosted('https://mado.io', 'mado.io')).status).toBe(200);
  });

  it('still refuses a stranger site, whose Origin names their host', async () => {
    expect((await hosted('https://evil.com', '43.202.24.252')).status).toBe(403);
  });

  it('an unparseable Origin falls through to refusal, never a crash', async () => {
    expect((await hosted('null', '43.202.24.252')).status).toBe(403);
  });
});
