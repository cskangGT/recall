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

/*
 * The whole page, and the reason when it is not. The text handed on is the
 * article, not the navigation; a long page is cut at the cap and says so; a
 * page with nothing on it says why — script-drawn, login, a file — and a read
 * that fails carries its reason to the client.
 */
import { mainText, MAX_TEXT, LinkError } from '../../server/link/preview';

const html = (body: string, head = '') => `<html><head><title>T</title>${head}</head><body>${body}</body></html>`;
const fetching = (page: string, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }) =>
  (async () => ({ ok: true, status: 200, url: 'https://example.com/x', headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, text: async () => page })) as unknown as typeof fetch;

describe('previewLink — the whole page, honestly', () => {
  it('hands on the article text and leaves the navigation out', async () => {
    const page = html(
      `<nav><a href="/">Home</a><a href="/about">About</a></nav><article><h1>Sourdough</h1><p>${'Cold retard overnight gives the crust its blisters. '.repeat(8)}</p></article><footer>© Bakery</footer>`,
    );
    const p = await previewLink('https://example.com/bread', fetching(page));
    expect(p.text).toContain('Cold retard overnight');
    expect(p.text).not.toContain('About');
    expect(p.text).not.toContain('© Bakery');
    expect(p.note).toBeNull();
    expect(p.chars).toBeGreaterThan(300);
    expect(p.truncated).toBe(false);
  });

  it('cuts a long page at the cap and says so', async () => {
    const page = html(`<main>${'<p>A sentence of the long article that goes on.</p>'.repeat(600)}</main>`);
    const p = await previewLink('https://example.com/long', fetching(page));
    expect(p.truncated).toBe(true);
    expect(p.text!.length).toBe(MAX_TEXT);
    expect(p.chars).toBeGreaterThan(MAX_TEXT);
  });

  it('names a script-drawn shell as such', async () => {
    const page = html(`<noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div>`);
    const p = await previewLink('https://example.com/app', fetching(page));
    expect(p.note).toBe('app');
  });

  it('names a login wall as such', async () => {
    const page = `<html><head><title>Sign in · Service</title></head><body><form><input name="u"/></form></body></html>`;
    const p = await previewLink('https://example.com/login', fetching(page));
    expect(p.note).toBe('login');
  });

  it('names a nearly empty page as thin', async () => {
    const p = await previewLink('https://example.com/empty', fetching(html('<p>Hi.</p>')));
    expect(p.note).toBe('thin');
  });

  it('names a file for what it is instead of reading its bytes', async () => {
    const p = await previewLink('https://example.com/paper.pdf', fetching('%PDF-1.7 …', { 'content-type': 'application/pdf' }));
    expect(p.note).toBe('not-html');
    expect(p.text).toBeNull();
    expect(p.contentType).toBe('application/pdf');
  });

  it('carries the reason of a failed read to the route', async () => {
    const refused = (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch;
    const deps = depsWith({ previewLink: (u) => previewLink(u, refused) });
    const res = await post(deps, { url: 'https://example.com/private' });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ reason: 'status', httpStatus: 403 });
    const bad = await post(deps, { url: 'http://localhost/x' });
    expect(res.status).toBe(502);
    expect((bad.body as { reason: string }).reason).toBe('private');
  });

  it('says timeout when the page never answers', async () => {
    const hanging = ((_: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    // Abort by hand rather than wait eight seconds: the reader reacts to the signal, whoever pulls it.
    const p = previewLink('https://example.com/slow', hanging);
    await expect(p).rejects.toBeInstanceOf(LinkError);
    await expect(p).rejects.toMatchObject({ reason: 'timeout' });
  }, 12_000);

  it('mainText prefers a marked region only when it holds the page', () => {
    const shell = `<body><nav>Menu</nav><main></main><div>${'Real words here. '.repeat(20)}</div></body>`;
    expect(mainText(shell)).toContain('Real words');
  });
});
