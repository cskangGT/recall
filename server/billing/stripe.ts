import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Repository } from '../db/repository.ts';

/**
 * Stripe, without the SDK.
 *
 * Two calls and one verification do not justify a dependency in a server that
 * has avoided them everywhere else. Checkout sessions are one form-encoded
 * POST; the webhook signature is one HMAC — both are stable, documented wire
 * formats, and implementing them directly means the whole module is testable
 * with an injected fetch and a made-up signing secret.
 *
 * What billing is *for* here: flipping `workspaces.plan`. Free remembers two
 * weeks; Pro remembers everything. Nothing else in the product knows Stripe
 * exists.
 */

export interface BillingConfig {
  secretKey: string;
  priceId: string;
  /** Needed to accept webhooks; checkout works without it. */
  webhookSecret?: string;
  /** True when running against real money. */
  livemode: boolean;
}

/**
 * Test keys win unless live is asked for by name.
 *
 * The user's `.env.local` holds both — a live key pasted first, a test key
 * added for development. Preferring live silently would mean every checkout
 * built during development charges a real card; that must take a deliberate
 * act (`RECALL_BILLING=live`), the same reasoning as binding localhost.
 */
export function selectBilling(env: NodeJS.ProcessEnv = process.env): BillingConfig | null {
  const wantLive = env.RECALL_BILLING?.toLowerCase() === 'live';
  const secretKey = wantLive
    ? env.STRIPE_SECRET_KEY
    : (env.STRIPE_TEST_SECRET_KEY ?? env.STRIPE_SECRET_KEY);
  const priceId = wantLive
    ? (env.STRIPE_LIVE_PRICE_ID ?? env.STRIPE_PRICE_ID)
    : (env.STRIPE_TEST_PRICE_ID ?? env.STRIPE_PRICE_ID);
  if (!secretKey || !priceId) return null;
  if (!wantLive && secretKey.startsWith('sk_live_')) {
    // Only a live key available and live mode not requested: refuse rather
    // than practice on real cards.
    return null;
  }
  return {
    secretKey,
    priceId,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    livemode: secretKey.startsWith('sk_live_'),
  };
}

/** Seconds a webhook timestamp may lag before it is replayable — Stripe's own default. */
const SIGNATURE_TOLERANCE_S = 300;

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class StripeBilling {
  private readonly config: BillingConfig;
  private readonly fetchFn: FetchLike;

  constructor(config: BillingConfig, fetchFn: FetchLike = fetch as unknown as FetchLike) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  get livemode(): boolean {
    return this.config.livemode;
  }

  /**
   * One subscription checkout for one workspace. The workspace id rides in
   * `client_reference_id` and in the subscription's metadata, so both the
   * completion event and any later cancellation can find their way back
   * without a customer table on our side.
   */
  async createCheckoutSession(
    workspaceId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    if (!/^https?:\/\//.test(returnUrl)) throw new Error('returnUrl must be http(s)');

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': this.config.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: workspaceId,
      'metadata[workspace_id]': workspaceId,
      'subscription_data[metadata][workspace_id]': workspaceId,
      success_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}upgraded=1`,
      cancel_url: returnUrl,
    });

    const response = await this.fetchFn('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const body = (await response.json()) as { url?: string; error?: { message?: string } };
    if (!response.ok || !body.url) {
      throw new Error(body.error?.message ?? `stripe answered ${response.status}`);
    }
    return { url: body.url };
  }

  /**
   * The `Stripe-Signature` scheme: HMAC-SHA256 of `${t}.${rawBody}` with the
   * endpoint secret, compared in constant time, with the timestamp bounded so
   * a captured request cannot be replayed next week. Verified against the RAW
   * bytes — a re-serialized JSON body is a different string and a dead check.
   */
  verifySignature(rawBody: string, header: string | undefined, nowMs = Date.now()): boolean {
    const secret = this.config.webhookSecret;
    if (!secret || !header) return false;

    let timestamp: number | null = null;
    const candidates: string[] = [];
    for (const part of header.split(',')) {
      const [key, value] = part.split('=', 2);
      if (key?.trim() === 't' && value) timestamp = Number(value);
      if (key?.trim() === 'v1' && value) candidates.push(value.trim());
    }
    if (timestamp === null || !Number.isFinite(timestamp) || candidates.length === 0) return false;
    if (Math.abs(nowMs / 1000 - timestamp) > SIGNATURE_TOLERANCE_S) return false;

    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    return candidates.some((candidate) => {
      const candidateBuf = Buffer.from(candidate, 'utf8');
      return candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf);
    });
  }

  /**
   * The two events that mean anything here. Everything else is acknowledged
   * and ignored — a webhook endpoint that 400s on unfamiliar events gets
   * retried into the ground and eventually disabled by Stripe.
   */
  handleEvent(rawBody: string, repo: Repository): { handled: string } {
    const event = JSON.parse(rawBody) as {
      type?: string;
      data?: { object?: { client_reference_id?: string; metadata?: { workspace_id?: string } } };
    };
    const object = event.data?.object;
    const workspaceId = object?.client_reference_id ?? object?.metadata?.workspace_id;

    if (event.type === 'checkout.session.completed' && workspaceId) {
      if (repo.getWorkspace(workspaceId)) {
        repo.setPlan(workspaceId, 'pro');
        return { handled: `pro:${workspaceId}` };
      }
      return { handled: 'unknown-workspace' };
    }

    if (event.type === 'customer.subscription.deleted' && workspaceId) {
      if (repo.getWorkspace(workspaceId)) {
        repo.setPlan(workspaceId, 'free');
        return { handled: `free:${workspaceId}` };
      }
      return { handled: 'unknown-workspace' };
    }

    return { handled: `ignored:${event.type ?? 'unknown'}` };
  }
}
