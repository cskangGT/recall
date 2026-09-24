import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import { SqliteRepository } from '../../server/db/sqlite';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { createApiServer } from '../../server/http/server';
import {
  CALENDAR_SCOPE, GoogleAuth, selectGoogle, type GoogleConfig,
} from '../../server/google/oauth';
import type { MeetingsResponse } from '../../src/core/meetingTypes';

/**
 * Google OAuth without Google: an injected fetch keyed by URL, a made-up
 * client secret, and an injected clock. What is pinned here is the wire
 * format (the consent URL, the token exchange, the refresh, the revoke), the
 * state signature, and the routes that hang off them — none of which needs a
 * network to be wrong.
 */

const WS = 'ws_demo';
const CONFIG: GoogleConfig = {
  clientId: 'client-id.apps.googleusercontent.com',
  clientSecret: 'shh-client-secret',
  redirectUri: 'http://127.0.0.1:5170/api/google/callback',
};

/** A JWT-shaped id_token whose payload carries the email — no signature needed. */
const idToken = (email: string) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ email, sub: '1' })).toString('base64url')}.sig`;

interface Call { url: string; method: string; body: string; headers: Record<string, string> }

/**
 * A fetch keyed by URL prefix. Each route answers with its body (or a
 * function of the call for the ones that need to look at what was sent),
 * and every call is recorded so a test can assert on the wire.
 */
function fakeFetch(routes: Record<string, unknown | ((call: Call) => unknown)>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const call: Call = {
      url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? ''),
      headers: init?.headers ?? {},
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => call.url.startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => 'no route' };
    const route = routes[key];
    const answer = (typeof route === 'function' ? (route as (c: Call) => unknown)(call) : route) as
      { status?: number } & Record<string, unknown>;
    const status = answer.status ?? 200;
    return { ok: status < 400, status, json: async () => answer, text: async () => JSON.stringify(answer) };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

let repo: SqliteRepository;

beforeEach(() => {
  repo = new SqliteRepository(':memory:');
  repo.migrate();
  repo.createWorkspace({ id: WS, name: 'demo' });
});

afterEach(() => repo.close());

describe('selectGoogle', () => {
  it('is null without both a client id and a secret', () => {
    expect(selectGoogle({} as NodeJS.ProcessEnv, 5170)).toBeNull();
    expect(selectGoogle({ GOOGLE_CLIENT_ID: 'x' } as NodeJS.ProcessEnv, 5170)).toBeNull();
    expect(selectGoogle({ GOOGLE_CLIENT_SECRET: 'y' } as NodeJS.ProcessEnv, 5170)).toBeNull();
  });

  it('derives the redirect from the port and honours an explicit one', () => {
    const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' } as NodeJS.ProcessEnv;
    expect(selectGoogle(env, 5170)).toEqual({
      clientId: 'x', clientSecret: 'y', redirectUri: 'http://127.0.0.1:5170/api/google/callback',
    });
    expect(
      selectGoogle({ ...env, GOOGLE_REDIRECT_URI: 'https://mado.example/api/google/callback' }, 5170)!
        .redirectUri,
    ).toBe('https://mado.example/api/google/callback');
  });
});

describe('the consent URL', () => {
  it('asks for offline read-only calendar access and carries a signed state', () => {
    const auth = new GoogleAuth(CONFIG, repo);
    const url = new URL(auth.authUrl(WS));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(`${CALENDAR_SCOPE} openid email`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(auth.verifyState(url.searchParams.get('state')!)).toBe(WS);
  });
});

describe('state', () => {
  it('round-trips the workspace id and refuses a tampered or foreign one', () => {
    const auth = new GoogleAuth(CONFIG, repo);
    const state = auth.signState(WS);
    expect(auth.verifyState(state)).toBe(WS);

    // Flip a character of the payload: the signature no longer matches.
    const [payload, sig] = state.split('.');
    const flipped = (payload![0] === 'A' ? 'B' : 'A') + payload!.slice(1);
    expect(auth.verifyState(`${flipped}.${sig}`)).toBeNull();
    // Signed with another server's secret.
    const other = new GoogleAuth({ ...CONFIG, clientSecret: 'someone-else' }, repo);
    expect(auth.verifyState(other.signState(WS))).toBeNull();
    expect(auth.verifyState('')).toBeNull();
    expect(auth.verifyState('garbage')).toBeNull();
  });

  it('expires after ten minutes', () => {
    let now = 1_700_000_000_000;
    const auth = new GoogleAuth(CONFIG, repo, fetch, () => now);
    const state = auth.signState(WS);
    now += 9 * 60_000;
    expect(auth.verifyState(state)).toBe(WS);
    now += 2 * 60_000;
    expect(auth.verifyState(state)).toBeNull();
  });
});

describe('the callback', () => {
  it('exchanges the code, keeps the refresh token, and reads the email off the id token', async () => {
    const { fn, calls } = fakeFetch({
      'https://oauth2.googleapis.com/token': {
        access_token: 'ya29.first', expires_in: 3600, refresh_token: '1//refresh',
        id_token: idToken('sung@example.com'), scope: `${CALENDAR_SCOPE} openid email`,
      },
    });
    const auth = new GoogleAuth(CONFIG, repo, fn, () => 1_700_000_000_000);
    const result = await auth.handleCallback('4/code', auth.signState(WS));
    expect(result).toEqual({ workspaceId: WS, email: 'sung@example.com' });

    const exchange = new URLSearchParams(calls[0]!.body);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(exchange.get('code')).toBe('4/code');
    expect(exchange.get('client_id')).toBe(CONFIG.clientId);
    expect(exchange.get('client_secret')).toBe(CONFIG.clientSecret);
    expect(exchange.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(exchange.get('grant_type')).toBe('authorization_code');

    const row = repo.getGoogleToken(WS)!;
    expect(row.refresh_token).toBe('1//refresh');
    expect(row.access_token).toBe('ya29.first');
    expect(row.email).toBe('sung@example.com');
    expect(row.expires_at).toBe(new Date(1_700_000_000_000 + 3600_000).toISOString());
    expect(auth.status(WS)).toEqual({ configured: true, connected: true, email: 'sung@example.com' });
  });

  it('refuses a bad state before touching Google', async () => {
    const { fn, calls } = fakeFetch({});
    const auth = new GoogleAuth(CONFIG, repo, fn);
    await expect(auth.handleCallback('4/code', 'nope.nope')).rejects.toThrow(/state/);
    expect(calls).toHaveLength(0);
  });

  it('says what to do when Google withholds the refresh token', async () => {
    const { fn } = fakeFetch({
      'https://oauth2.googleapis.com/token': { access_token: 'ya29.only', expires_in: 3600 },
    });
    const auth = new GoogleAuth(CONFIG, repo, fn);
    await expect(auth.handleCallback('4/code', auth.signState(WS)))
      .rejects.toThrow('myaccount.google.com/permissions');
    expect(repo.getGoogleToken(WS)).toBeNull();
  });
});

describe('access tokens', () => {
  const T0 = 1_700_000_000_000;
  const stored = (expiresInMs: number) =>
    repo.saveGoogleToken(WS, {
      email: 'sung@example.com', refresh_token: '1//refresh', access_token: 'ya29.cached',
      expires_at: new Date(T0 + expiresInMs).toISOString(), scopes: CALENDAR_SCOPE,
      connected_at: new Date(T0).toISOString(),
    });

  it('uses the cached token while more than a minute remains', async () => {
    stored(61_000);
    const { fn, calls } = fakeFetch({});
    const auth = new GoogleAuth(CONFIG, repo, fn, () => T0);
    expect(await auth.accessToken(WS)).toBe('ya29.cached');
    expect(calls).toHaveLength(0);
  });

  it('refreshes at the sixty-second edge and stores what came back', async () => {
    stored(59_000);
    const { fn, calls } = fakeFetch({
      'https://oauth2.googleapis.com/token': { access_token: 'ya29.fresh', expires_in: 3599 },
    });
    const auth = new GoogleAuth(CONFIG, repo, fn, () => T0);
    expect(await auth.accessToken(WS)).toBe('ya29.fresh');
    const refresh = new URLSearchParams(calls[0]!.body);
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('refresh_token')).toBe('1//refresh');
    expect(refresh.get('client_id')).toBe(CONFIG.clientId);
    expect(refresh.get('client_secret')).toBe(CONFIG.clientSecret);

    const row = repo.getGoogleToken(WS)!;
    expect(row.access_token).toBe('ya29.fresh');
    expect(row.expires_at).toBe(new Date(T0 + 3599_000).toISOString());
    expect(row.refresh_token).toBe('1//refresh'); // untouched — Google did not send a new one
  });

  it("surfaces Google's own error when the refresh is refused", async () => {
    stored(0);
    const { fn } = fakeFetch({
      'https://oauth2.googleapis.com/token': {
        status: 400, error: 'invalid_grant', error_description: 'Token has been expired or revoked.',
      },
    });
    const auth = new GoogleAuth(CONFIG, repo, fn, () => T0);
    await expect(auth.accessToken(WS)).rejects.toThrow('invalid_grant');
    // The row stays: the caller decides whether a revoked grant means disconnect.
    expect(repo.getGoogleToken(WS)!.access_token).toBe('ya29.cached');
  });

  it('says not connected when there is no row', async () => {
    const auth = new GoogleAuth(CONFIG, repo, fakeFetch({}).fn);
    await expect(auth.accessToken(WS)).rejects.toThrow('not connected');
  });
});

describe('disconnect', () => {
  it('revokes the refresh token at Google, then forgets it', async () => {
    repo.saveGoogleToken(WS, {
      email: null, refresh_token: '1//bye', access_token: null, expires_at: null,
      scopes: CALENDAR_SCOPE, connected_at: new Date().toISOString(),
    });
    const { fn, calls } = fakeFetch({ 'https://oauth2.googleapis.com/revoke': {} });
    const auth = new GoogleAuth(CONFIG, repo, fn);
    await auth.disconnect(WS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(new URL(calls[0]!.url).searchParams.get('token')).toBe('1//bye');
    expect(repo.getGoogleToken(WS)).toBeNull();
    expect(auth.status(WS)).toEqual({ configured: true, connected: false, email: null });
  });

  it('forgets the token even when the revoke fails', async () => {
    repo.saveGoogleToken(WS, {
      email: null, refresh_token: '1//bye', access_token: null, expires_at: null,
      scopes: CALENDAR_SCOPE, connected_at: new Date().toISOString(),
    });
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await new GoogleAuth(CONFIG, repo, failing).disconnect(WS);
    expect(repo.getGoogleToken(WS)).toBeNull();
  });

  it('is a no-op without a row', async () => {
    const { fn, calls } = fakeFetch({});
    await new GoogleAuth(CONFIG, repo, fn).disconnect(WS);
    expect(calls).toHaveLength(0);
  });
});

describe('google_tokens rows', () => {
  it('upsert, read back, delete — and never ride the graph payload', () => {
    expect(repo.getGoogleToken(WS)).toBeNull();
    repo.saveGoogleToken(WS, {
      email: 'a@b.c', refresh_token: 'r1', access_token: 'a1', expires_at: '2026-01-01T00:00:00.000Z',
      scopes: CALENDAR_SCOPE, connected_at: '2025-12-31T00:00:00.000Z',
    });
    repo.saveGoogleToken(WS, {
      email: 'a@b.c', refresh_token: 'r2', access_token: 'a2', expires_at: '2026-01-02T00:00:00.000Z',
      scopes: CALENDAR_SCOPE, connected_at: '2025-12-31T00:00:00.000Z',
    });
    expect(repo.getGoogleToken(WS)).toEqual({
      email: 'a@b.c', refresh_token: 'r2', access_token: 'a2', expires_at: '2026-01-02T00:00:00.000Z',
      scopes: CALENDAR_SCOPE, connected_at: '2025-12-31T00:00:00.000Z',
    });
    expect(JSON.stringify(repo.getGraphPayload(WS))).not.toContain('r2');
    repo.deleteGoogleToken(WS);
    expect(repo.getGoogleToken(WS)).toBeNull();
  });

  it('goes with the workspace', () => {
    repo.saveGoogleToken(WS, {
      email: null, refresh_token: 'r', access_token: null, expires_at: null,
      scopes: CALENDAR_SCOPE, connected_at: '2025-12-31T00:00:00.000Z',
    });
    repo.deleteWorkspace(WS);
    repo.createWorkspace({ id: WS, name: 'again' });
    expect(repo.getGoogleToken(WS)).toBeNull();
  });
});

// ---------------------------------------------------------------- routes

const depsWith = (extra: Partial<Deps>): Deps => ({
  repo,
  ingest: new IngestPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  ask: new AskPipeline(repo, new FixtureProvider(), new FixtureEmbeddings()),
  reset: () => {},
  ...extra,
});

/** One timed event as the Calendar API returns it. */
const event = (id: string, summary: string, startIso: string) => ({
  id, summary, status: 'confirmed', htmlLink: `https://calendar.google.com/event?eid=${id}`,
  start: { dateTime: startIso }, end: { dateTime: new Date(Date.parse(startIso) + 3600_000).toISOString() },
  attendees: [{ email: 'sung@example.com', self: true, organizer: true }, { email: 'jane@example.com', displayName: 'Jane' }],
});

describe('the google routes', () => {
  it('reports not configured, and the meetings door answers plainly, without a client id', async () => {
    const deps = depsWith({});
    expect((await handle({ method: 'GET', path: `/api/workspaces/${WS}/google`, body: null }, deps)).body)
      .toEqual({ configured: false, connected: false, email: null });
    const connect = await handle({ method: 'POST', path: `/api/workspaces/${WS}/google/connect`, body: null }, deps);
    expect(connect.status).toBe(503);
    const callback = await handle({ method: 'GET', path: '/api/google/callback', body: null, query: { code: 'x', state: 'y' } }, deps);
    expect(callback.status).toBe(503);

    const meetings = await handle({ method: 'GET', path: `/api/workspaces/${WS}/meetings`, body: null }, deps);
    expect(meetings.status).toBe(200);
    expect(meetings.body).toMatchObject({ connected: false, email: null, syncedAt: null, reason: null, meetings: [] });
    expect(typeof (meetings.body as MeetingsResponse).from).toBe('string');
    expect(typeof (meetings.body as MeetingsResponse).to).toBe('string');

    const caps = await handle({ method: 'GET', path: '/api/capabilities', body: null }, deps);
    expect((caps.body as { google: boolean }).google).toBe(false);
  });

  it('connect hands back the consent URL with a state for this workspace', async () => {
    const auth = new GoogleAuth(CONFIG, repo, fakeFetch({}).fn);
    const deps = depsWith({ google: auth });
    const res = await handle({ method: 'POST', path: `/api/workspaces/${WS}/google/connect`, body: null }, deps);
    expect(res.status).toBe(200);
    const url = new URL((res.body as { url: string }).url);
    expect(url.hostname).toBe('accounts.google.com');
    expect(auth.verifyState(url.searchParams.get('state')!)).toBe(WS);

    const caps = await handle({ method: 'GET', path: '/api/capabilities', body: null }, deps);
    expect((caps.body as { google: boolean }).google).toBe(true);
    expect((await handle({ method: 'GET', path: `/api/workspaces/${WS}/google`, body: null }, deps)).body)
      .toEqual({ configured: true, connected: false, email: null });
  });

  it('the callback stores the token and sends the browser home, or home with a failure', async () => {
    const { fn } = fakeFetch({
      'https://oauth2.googleapis.com/token': {
        access_token: 'ya29.a', expires_in: 3600, refresh_token: '1//r', id_token: idToken('sung@example.com'),
      },
    });
    const auth = new GoogleAuth(CONFIG, repo, fn);
    const deps = depsWith({ google: auth });

    const bad = await handle({ method: 'GET', path: '/api/google/callback', body: null, query: { code: '4/c', state: 'forged.x' } }, deps);
    expect(bad.status).toBe(302);
    expect(bad.redirect).toBe('/?api=1&google=failed');
    expect(repo.getGoogleToken(WS)).toBeNull();

    const missing = await handle({ method: 'GET', path: '/api/google/callback', body: null, query: {} }, deps);
    expect(missing.redirect).toBe('/?api=1&google=failed');

    const good = await handle({ method: 'GET', path: '/api/google/callback', body: null, query: { code: '4/c', state: auth.signState(WS) } }, deps);
    expect(good.status).toBe(302);
    expect(good.redirect).toBe('/?api=1&google=connected');
    expect(repo.getGoogleToken(WS)!.refresh_token).toBe('1//r');
    expect((await handle({ method: 'GET', path: `/api/workspaces/${WS}/google`, body: null }, deps)).body)
      .toEqual({ configured: true, connected: true, email: 'sung@example.com' });
  });

  it('the callback gets in even when writes need an invite — Google carries none', async () => {
    const auth = new GoogleAuth(CONFIG, repo, fakeFetch({}).fn);
    const deps = depsWith({ google: auth, inviteToken: 'secret' });
    const res = await handle({ method: 'GET', path: '/api/google/callback', body: null, query: { code: 'x', state: 'bad' } }, deps);
    expect(res.status).toBe(302);
  });

  it('disconnect revokes and forgets', async () => {
    repo.saveGoogleToken(WS, {
      email: 'a@b.c', refresh_token: '1//r', access_token: null, expires_at: null,
      scopes: CALENDAR_SCOPE, connected_at: new Date().toISOString(),
    });
    const { fn, calls } = fakeFetch({ 'https://oauth2.googleapis.com/revoke': {} });
    const deps = depsWith({ google: new GoogleAuth(CONFIG, repo, fn) });
    const res = await handle({ method: 'POST', path: `/api/workspaces/${WS}/google/disconnect`, body: null }, deps);
    expect(res.body).toEqual({ disconnected: true });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/revoke']);
    expect(repo.getGoogleToken(WS)).toBeNull();
  });

  describe('GET /meetings when connected', () => {
    // Relative to the clock, not a date: the window is measured from now, and a
    // fixed 'tomorrow' became 'last week' the week after it was written.
    const T0 = Date.now();
    const soon = new Date(T0 + 86400_000).toISOString();
    let calendarCalls: number;
    let deps: Deps;

    beforeEach(() => {
      calendarCalls = 0;
      repo.saveGoogleToken(WS, {
        email: 'sung@example.com', refresh_token: '1//r', access_token: 'ya29.ok',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        scopes: CALENDAR_SCOPE, connected_at: new Date().toISOString(),
      });
      const { fn } = fakeFetch({
        'https://www.googleapis.com/calendar/v3/calendars/primary/events': () => {
          calendarCalls += 1;
          return { items: [event('ev1', 'Roadmap review', soon), event('ev2', 'Cancelled thing', soon)].map((e, i) =>
            i === 1 ? { ...e, status: 'cancelled' } : e) };
        },
      });
      deps = depsWith({
        google: new GoogleAuth(CONFIG, repo, fn),
        meetingContext: async (_ws, meetings) => ({
          [meetings[0]!.id]: [{
            memory_id: 'm1', source_id: 's1', text: 'Jane wants the roadmap by Friday',
            category_name: 'Work', source_title: 'note', source_type: 'text',
          }],
        }),
      });
    });

    it('syncs, lists the window, and attaches what Mado remembers', async () => {
      const res = await handle({ method: 'GET', path: `/api/workspaces/${WS}/meetings`, body: null }, deps);
      expect(res.status).toBe(200);
      const body = res.body as MeetingsResponse;
      expect(body.connected).toBe(true);
      expect(body.email).toBe('sung@example.com');
      expect(body.reason).toBeNull();
      expect(typeof body.syncedAt).toBe('string');
      expect(body.meetings).toHaveLength(1);
      expect(body.meetings[0]).toMatchObject({
        id: 'ev1', title: 'Roadmap review', startsAt: soon, allDay: false,
        htmlLink: 'https://calendar.google.com/event?eid=ev1',
      });
      expect(body.meetings[0]!.attendees).toEqual([
        { name: 'sung', email: 'sung@example.com', self: true, organizer: true },
        { name: 'Jane', email: 'jane@example.com', self: false, organizer: false },
      ]);
      expect(body.meetings[0]!.context[0]!.text).toBe('Jane wants the roadmap by Friday');
      expect(calendarCalls).toBe(1);
      // The window bounds the request Google saw.
      expect(Date.parse(body.to) - Date.parse(body.from)).toBe(21 * 86400_000);
    });

    it('does not ask Google again within ten minutes, unless told to refresh', async () => {
      await handle({ method: 'GET', path: `/api/workspaces/${WS}/meetings`, body: null }, deps);
      await handle({ method: 'GET', path: `/api/workspaces/${WS}/meetings`, body: null }, deps);
      expect(calendarCalls).toBe(1);
      await handle({ method: 'GET', path: `/api/workspaces/${WS}/meetings`, body: null, query: { refresh: '1' } }, deps);
      expect(calendarCalls).toBe(2);
    });

    it('reports a failed read as a reason and keeps what it had', async () => {
      await handle({ method: 'GET', path: `/api/workspaces/${WS}/meetings`, body: null }, deps);
      const broken = (async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' })) as unknown as typeof fetch;
      const res = await handle(
        { method: 'GET', path: `/api/workspaces/${WS}/meetings`, body: null, query: { refresh: '1' } },
        { ...deps, google: new GoogleAuth(CONFIG, repo, broken) },
      );
      const body = res.body as MeetingsResponse;
      expect(body.connected).toBe(true);
      expect(body.reason).toBe('Google rejected the token');
      expect(body.meetings).toHaveLength(1);
      expect(typeof body.syncedAt).toBe('string');
    });
  });
});

// ---------------------------------------------------------------- adapter

describe('over the wire: the query string and the redirect', () => {
  let server: Server;
  let port: number;
  let auth: GoogleAuth;

  beforeEach(async () => {
    auth = new GoogleAuth(CONFIG, repo, fakeFetch({
      'https://oauth2.googleapis.com/token': {
        access_token: 'ya29.a', expires_in: 3600, refresh_token: '1//wire', id_token: idToken('w@example.com'),
      },
    }).fn);
    server = createApiServer(depsWith({ google: auth }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const get = (path: string) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      });
      req.on('error', reject);
      req.end();
    });

  it('parses ?code&state and answers 302 with a Location and no body', async () => {
    const state = auth.signState(WS);
    const res = await get(`/api/google/callback?code=${encodeURIComponent('4/abc')}&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?api=1&google=connected');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toBe('');
    expect(repo.getGoogleToken(WS)!.refresh_token).toBe('1//wire');
  });

  it('a route without a query still sees an empty one', async () => {
    const res = await get(`/api/workspaces/${WS}/google`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ configured: true, connected: false, email: null });
  });
});
