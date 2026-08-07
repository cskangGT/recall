import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { SqliteRepository } from '../../server/db/sqlite';
import { importSeed } from '../../server/seed/import';
import { IngestPipeline } from '../../server/pipeline/ingest';
import { AskPipeline } from '../../server/pipeline/ask';
import { FixtureProvider, FixtureEmbeddings } from '../../server/ai/fixture';
import { handle, type Deps } from '../../server/http/routes';
import { selectBilling, StripeBilling } from '../../server/billing/stripe';

const WS = 'ws_demo';
const SECRET = 'whsec_test_secret';

/** A Stripe-Signature header actually signed the way Stripe signs. */
function sign(rawBody: string, secret = SECRET, atMs = Date.now()): string {
  const t = Math.floor(atMs / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const completedEvent = (workspaceId: string) =>
  JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: workspaceId } },
  });

describe('selectBilling', () => {
  it('prefers the test key and refuses to practice on a live one', () => {
    const both = selectBilling({
      STRIPE_SECRET_KEY: 'sk_live_x',
      STRIPE_TEST_SECRET_KEY: 'sk_test_x',
      STRIPE_TEST_PRICE_ID: 'price_test',
      STRIPE_LIVE_PRICE_ID: 'price_live',
    } as NodeJS.ProcessEnv);
    expect(both!.secretKey).toBe('sk_test_x');
    expect(both!.priceId).toBe('price_test');
    expect(both!.livemode).toBe(false);

    // Only a live key, live not requested: off, not silently live.
    expect(
      selectBilling({
        STRIPE_SECRET_KEY: 'sk_live_x',
        STRIPE_PRICE_ID: 'price_x',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('goes live only when told to by name', () => {
    const live = selectBilling({
      RECALL_BILLING: 'live',
      STRIPE_SECRET_KEY: 'sk_live_x',
      STRIPE_TEST_SECRET_KEY: 'sk_test_x',
      STRIPE_LIVE_PRICE_ID: 'price_live',
      STRIPE_TEST_PRICE_ID: 'price_test',
    } as NodeJS.ProcessEnv);
    expect(live!.secretKey).toBe('sk_live_x');
    expect(live!.priceId).toBe('price_live');
    expect(live!.livemode).toBe(true);
  });

  it('is null without a key and price', () => {
    expect(selectBilling({} as NodeJS.ProcessEnv)).toBeNull();
    expect(selectBilling({ STRIPE_TEST_SECRET_KEY: 'sk_test_x' } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('webhook signatures', () => {
  const billing = new StripeBilling({
    secretKey: 'sk_test_x',
    priceId: 'price_x',
    webhookSecret: SECRET,
    livemode: false,
  });

  it('accepts a correctly signed body and rejects everything else', () => {
    const body = completedEvent(WS);
    expect(billing.verifySignature(body, sign(body))).toBe(true);
    expect(billing.verifySignature(body + ' ', sign(body))).toBe(false); // tampered body
    expect(billing.verifySignature(body, sign(body, 'whsec_other'))).toBe(false); // wrong secret
    expect(billing.verifySignature(body, undefined)).toBe(false); // unsigned
    expect(billing.verifySignature(body, 't=notanumber,v1=abc')).toBe(false);
  });

  it('rejects a replay from outside the tolerance window', () => {
    const body = completedEvent(WS);
    const staleHeader = sign(body, SECRET, Date.now() - 10 * 60 * 1000);
    expect(billing.verifySignature(body, staleHeader)).toBe(false);
  });

  it('never verifies anything without an endpoint secret configured', () => {
    const noSecret = new StripeBilling({ secretKey: 'sk_test_x', priceId: 'price_x', livemode: false });
    const body = completedEvent(WS);
    expect(noSecret.verifySignature(body, sign(body))).toBe(false);
  });
});

describe('checkout sessions', () => {
  it('posts the price, the workspace, and the return trip', async () => {
    let captured: { url: string; body: string } | null = null;
    const billing = new StripeBilling(
      { secretKey: 'sk_test_x', priceId: 'price_recall', livemode: false },
      async (url, init) => {
        captured = { url, body: init.body };
        return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/x' }) };
      },
    );

    const session = await billing.createCheckoutSession(WS, 'http://127.0.0.1:5170/');
    expect(session.url).toContain('checkout.stripe.com');

    const params = new URLSearchParams(captured!.body);
    expect(captured!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('line_items[0][price]')).toBe('price_recall');
    expect(params.get('client_reference_id')).toBe(WS);
    expect(params.get('subscription_data[metadata][workspace_id]')).toBe(WS);
    expect(params.get('success_url')).toBe('http://127.0.0.1:5170/?upgraded=1');
    expect(params.get('cancel_url')).toBe('http://127.0.0.1:5170/');
  });

  it('surfaces Stripe errors as errors, not as a missing url', async () => {
    const billing = new StripeBilling(
      { secretKey: 'sk_test_x', priceId: 'price_x', livemode: false },
      async () => ({
        ok: false,
        status: 402,
        json: async () => ({ error: { message: 'No such price' } }),
      }),
    );
    await expect(billing.createCheckoutSession(WS, 'http://x.test/')).rejects.toThrow('No such price');
  });

  it('refuses a non-http return url', async () => {
    const billing = new StripeBilling({ secretKey: 'sk_test_x', priceId: 'price_x', livemode: false });
    await expect(billing.createCheckoutSession(WS, 'javascript:alert(1)')).rejects.toThrow('http');
  });
});

describe('billing routes and the plan column', () => {
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
      reset: () => {},
      billing: new StripeBilling({
        secretKey: 'sk_test_x',
        priceId: 'price_x',
        webhookSecret: SECRET,
        livemode: false,
      }),
    };
  });

  afterEach(() => repo.close());

  it('a signed completed-checkout event flips the plan to pro, and a cancellation back', async () => {
    repo.setPlan(WS, 'free');

    const body = completedEvent(WS);
    const res = await handle(
      { method: 'POST', path: '/api/billing/webhook', body: JSON.parse(body), rawBody: body, stripeSignature: sign(body) },
      deps,
    );
    expect(res.status).toBe(200);
    expect(repo.getWorkspace(WS)!.plan).toBe('pro');
    expect(repo.getGraphPayload(WS).workspace.plan).toBe('pro');

    const cancel = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { workspace_id: WS } } },
    });
    await handle(
      { method: 'POST', path: '/api/billing/webhook', body: JSON.parse(cancel), rawBody: cancel, stripeSignature: sign(cancel) },
      deps,
    );
    expect(repo.getWorkspace(WS)!.plan).toBe('free');
  });

  it('a bad signature changes nothing and says 400', async () => {
    repo.setPlan(WS, 'free');
    const body = completedEvent(WS);
    const res = await handle(
      { method: 'POST', path: '/api/billing/webhook', body: JSON.parse(body), rawBody: body, stripeSignature: sign(body, 'whsec_wrong') },
      deps,
    );
    expect(res.status).toBe(400);
    expect(repo.getWorkspace(WS)!.plan).toBe('free');
  });

  it('the webhook does not need an invite token — the signature is the auth', async () => {
    deps.inviteToken = 'letmein';
    const body = completedEvent(WS);
    const res = await handle(
      { method: 'POST', path: '/api/billing/webhook', body: JSON.parse(body), rawBody: body, stripeSignature: sign(body) },
      deps,
    );
    expect(res.status).toBe(200);
  });

  it('billing routes answer 503 when billing is off', async () => {
    delete deps.billing;
    const webhook = await handle(
      { method: 'POST', path: '/api/billing/webhook', body: {}, rawBody: '{}' },
      deps,
    );
    expect(webhook.status).toBe(503);
    const checkout = await handle(
      { method: 'POST', path: `/api/workspaces/${WS}/billing/checkout`, body: { returnUrl: 'http://x.test/' } },
      deps,
    );
    expect(checkout.status).toBe(503);
  });

  it('checkout validates the return url', async () => {
    const res = await handle(
      { method: 'POST', path: `/api/workspaces/${WS}/billing/checkout`, body: { returnUrl: 'ftp://nope' } },
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('a database created before the plan column grows it on migrate (the ALTER TABLE insurance)', () => {
    const old = new SqliteRepository(':memory:');
    // The workspaces table as it shipped before billing existed.
    (old as unknown as { db: { exec(sql: string): void } }).db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        auto_reorganize INTEGER NOT NULL DEFAULT 1,
        model_tier TEXT NOT NULL DEFAULT 'fast',
        is_demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    old.migrate(); // must not throw, must add the column
    old.createWorkspace({ id: 'ws_old', name: 'Old' });
    expect(old.getWorkspace('ws_old')!.plan).toBe('pro');
    old.setPlan('ws_old', 'free');
    expect(old.getWorkspace('ws_old')!.plan).toBe('free');
    old.close();
  });
});
