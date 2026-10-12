import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Repository } from '../db/repository.ts';
import type { GoogleStatus } from '../../src/core/meetingTypes.ts';

/**
 * Google OAuth, without the SDK.
 *
 * The same reasoning as Stripe: a consent URL, one code exchange, one refresh
 * and one revoke are four documented wire formats, and writing them directly
 * keeps the module testable with an injected fetch and a made-up secret. The
 * only scope asked for is read-only calendar (plus `openid email`, so the
 * settings screen can say *which* account is connected); Mado never writes
 * to a calendar and never asks to.
 *
 * What is stored: the refresh token, per workspace, in `google_tokens`. It is
 * the durable credential — the access token in front of it is a cache that
 * expires hourly — and it leaves this process exactly once, on disconnect,
 * to be revoked.
 */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Must match the OAuth client's registered redirect exactly. */
  redirectUri: string;
}

/**
 * Present only when both halves of the client are — half a client is not a
 * door that can be drawn. The redirect defaults to this server's own loopback
 * address on the port it will bind; a hosted deployment names its own.
 */
export function selectGoogle(env: NodeJS.ProcessEnv = process.env, port: number): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: env.GOOGLE_REDIRECT_URI ?? `http://127.0.0.1:${port}/api/google/callback`,
  };
}

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** How long a consent round-trip may take before the state is stale. */
const STATE_TTL_MS = 10 * 60_000;
/** Refresh this far before expiry, so a token never dies mid-request. */
const REFRESH_MARGIN_MS = 60_000;

type FetchLike = typeof fetch;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** The middle segment of a JWT, decoded — the claims, without checking the signature. */
function jwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (!segment) return {};
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export class GoogleAuth {
  private readonly config: GoogleConfig;
  private readonly repo: Repository;
  /** Exposed so the calendar read can share the same (possibly injected) transport. */
  readonly fetchFn: FetchLike;
  private readonly now: () => number;

  constructor(
    config: GoogleConfig,
    repo: Repository,
    fetchFn: FetchLike = fetch,
    now: () => number = () => Date.now(),
  ) {
    this.config = config;
    this.repo = repo;
    this.fetchFn = fetchFn;
    this.now = now;
  }

  // ---------------------------------------------------------------- consent

  /**
   * Where the browser goes to say yes. `access_type=offline` with
   * `prompt=consent` is what makes Google hand over a refresh token — without
   * the prompt, a second connect of an already-approved app returns only an
   * access token, and the connection would die within the hour.
   */
  authUrl(workspaceId: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: `${CALENDAR_SCOPE} openid email`,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: this.signState(workspaceId),
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /**
   * The state binds the callback to the workspace that started it. Signed
   * with the client secret so a callback cannot be aimed at somebody else's
   * workspace, and stamped so a captured URL cannot be replayed next week.
   */
  signState(workspaceId: string): string {
    const payload = Buffer.from(`${workspaceId}.${this.now()}`, 'utf8').toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  /** The workspace id the state names, or null for anything forged, foreign or stale. */
  verifyState(state: string): string | null {
    const dot = state.lastIndexOf('.');
    if (dot <= 0) return null;
    const payload = state.slice(0, dot);
    const given = Buffer.from(state.slice(dot + 1), 'utf8');
    const expected = Buffer.from(this.sign(payload), 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const split = decoded.lastIndexOf('.');
    if (split <= 0) return null;
    const workspaceId = decoded.slice(0, split);
    const issued = Number(decoded.slice(split + 1));
    if (!Number.isFinite(issued)) return null;
    const age = this.now() - issued;
    if (age < 0 || age > STATE_TTL_MS) return null;
    return workspaceId;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.clientSecret).update(payload).digest('base64url');
  }

  // ---------------------------------------------------------------- tokens

  /**
   * The code exchange. The email comes off the id token's claims without a
   * signature check: it arrived over TLS from Google's own token endpoint in
   * the same response as the tokens, so verifying it would be checking that
   * Google is Google.
   */
  async handleCallback(code: string, state: string): Promise<{ workspaceId: string; email: string | null }> {
    const workspaceId = this.verifyState(state);
    if (!workspaceId) throw new Error('the state did not verify — start the connection again');

    const token = await this.tokenRequest({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });
    if (!token.refresh_token) {
      throw new Error(
        'Google did not return a refresh token — remove the app at ' +
          'myaccount.google.com/permissions and connect again',
      );
    }

    const claims = token.id_token ? jwtPayload(token.id_token) : {};
    const email = typeof claims.email === 'string' ? claims.email : null;
    const nowMs = this.now();
    this.repo.saveGoogleToken(workspaceId, {
      email,
      refresh_token: token.refresh_token,
      access_token: token.access_token ?? null,
      expires_at: this.expiresAt(token, nowMs),
      scopes: token.scope ?? CALENDAR_SCOPE,
      connected_at: new Date(nowMs).toISOString(),
    });
    return { workspaceId, email };
  }

  /**
   * A token good for at least another minute — the cached one when it is,
   * a fresh one otherwise. Throws rather than guessing: `not connected` when
   * there is no row, or Google's own `error` (an `invalid_grant` means the
   * person revoked access at Google, and the caller decides what that means).
   */
  async accessToken(workspaceId: string): Promise<string> {
    const row = this.repo.getGoogleToken(workspaceId);
    if (!row) throw new Error('not connected');

    const nowMs = this.now();
    if (row.access_token && row.expires_at && Date.parse(row.expires_at) - nowMs > REFRESH_MARGIN_MS) {
      return row.access_token;
    }

    const token = await this.tokenRequest({
      refresh_token: row.refresh_token,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
    });
    if (!token.access_token) throw new Error('Google returned no access token');
    this.repo.saveGoogleToken(workspaceId, {
      ...row,
      // Google rarely rotates the refresh token on refresh; keep it when it does.
      refresh_token: token.refresh_token ?? row.refresh_token,
      access_token: token.access_token,
      expires_at: this.expiresAt(token, nowMs),
    });
    return token.access_token;
  }

  /**
   * Revoke at Google first, so the grant does not linger in the person's
   * account list after Mado has forgotten it; then drop the row regardless —
   * a revoke that fails (offline, already revoked) must not keep a credential
   * the person asked to be rid of.
   */
  async disconnect(workspaceId: string): Promise<void> {
    const row = this.repo.getGoogleToken(workspaceId);
    if (!row) return;
    try {
      await this.fetchFn(`${REVOKE_URL}?token=${encodeURIComponent(row.refresh_token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      // Best effort — see above.
    }
    this.repo.deleteGoogleToken(workspaceId);
  }

  status(workspaceId: string): GoogleStatus {
    const row = this.repo.getGoogleToken(workspaceId);
    return { configured: true, connected: Boolean(row), email: row?.email ?? null };
  }

  // ---------------------------------------------------------------- wire

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || body.error) {
      const detail = body.error
        ? `${body.error}${body.error_description ? `: ${body.error_description}` : ''}`
        : `Google answered ${response.status}`;
      throw new Error(detail);
    }
    return body;
  }

  private expiresAt(token: TokenResponse, nowMs: number): string | null {
    return typeof token.expires_in === 'number'
      ? new Date(nowMs + token.expires_in * 1000).toISOString()
      : null;
  }
}
