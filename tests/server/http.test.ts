import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { createApiServer } from '../../server/http/server';

/**
 * The only tests that open a socket.
 *
 * Everything else calls `handle` directly, which is right — routing is a pure
 * function and testing it that way is faster and clearer. But it cannot see
 * `server.ts`, and `server.ts` is where two of the three defences live: it is
 * what reads `Origin` off the wire and hands it to the router, and it is where
 * the Host check runs. A router that would honour a header it is never given is
 * not a defence, and only a real request can tell the difference.
 *
 * The OPTIONS assertion is here for the same reason: "a preflight cannot
 * succeed" is a claim about response headers, and a response header is not
 * something the pure layer has.
 */

const WS = 'ws_demo';
let repo: SqliteRepository;
let server: Server;
let port: number;

beforeAll(async () => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  importSeed(repo, WS);
  const provider = new FixtureProvider();
  const embeddings = new FixtureEmbeddings();

  // Port 0 first, then re-created on the port the OS gave us: `hostAllowed`
  // compares against the port it was told about, so the two have to agree and
  // the number is not knowable until something has bound.
  const probe = createApiServer({} as never);
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  server = createApiServer(
    {
      repo,
      ingest: new IngestPipeline(repo, provider, embeddings),
      ask: new AskPipeline(repo, provider, embeddings),
      reset: (workspaceId) => {
        repo.deleteWorkspace(workspaceId);
        importSeed(repo, workspaceId);
      },
    },
    undefined,
    port,
  );
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  repo.close();
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * `fetch` cannot set `Host` — it is a forbidden header name — and forging Host
 * is precisely what the rebinding test has to do. So: node:http.
 */
function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const base = `/api/workspaces/${WS}`;
const json = { 'content-type': 'application/json' };

describe('the Origin header actually reaches the router', () => {
  it('turns away a write from a page, over the wire', async () => {
    const res = await send('POST', `${base}/reset`, { origin: 'https://evil.com' });
    expect(res.status).toBe(403);
    expect(repo.listMemories(WS)).toHaveLength(47);
  });

  it('lets the extension through with the exact headers it will send', async () => {
    const res = await send(
      'POST',
      `${base}/capture`,
      { ...json, origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
      JSON.stringify({ type: 'text', content: 'from the extension' }),
    );
    expect(res.status).toBe(200);
  });
});

describe('the Host header check — the defence against DNS rebinding', () => {
  it('refuses a request addressed to a name that is not this machine', async () => {
    // A page on evil.com rebound to 127.0.0.1 is same-origin, so it sends no
    // Origin at all and `originAllowed` never sees it. What it cannot change is
    // the name it asked for.
    const res = await send('GET', `${base}/graph`, { host: 'evil.com' });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('memories');
  });

  it('refuses a read, not only a write — the corpus is the thing at risk', async () => {
    const res = await send('GET', `${base}/graph`, { host: 'attacker.test:1234' });
    expect(res.status).toBe(403);
  });

  it('answers to 127.0.0.1 and to localhost', async () => {
    expect((await send('GET', `${base}/graph`, { host: `127.0.0.1:${port}` })).status).toBe(200);
    expect((await send('GET', `${base}/graph`, { host: `localhost:${port}` })).status).toBe(200);
  });
});

describe('a preflight cannot succeed', () => {
  it('answers a preflight from a page with 403 and no CORS headers', async () => {
    // Not the primary defence — `originAllowed` is, because the attack that
    // matters is a *simple* request, which never triggers a preflight at all.
    // OPTIONS used to fall through every route to a 404; it is a 403 now
    // because OPTIONS is not GET, so the Origin check reaches it first. Either
    // answer blocks the preflight. What must never appear is the header below,
    // and a permissive one added later would quietly undo everything above.
    const res = await send('OPTIONS', `${base}/capture`, { origin: 'https://evil.com' });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('sends no CORS headers even on a request it allows', async () => {
    const res = await send('GET', `${base}/graph`);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
