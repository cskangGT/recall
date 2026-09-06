import type { Repository } from '../db/repository.ts';
import type { IngestPipeline, IngestInput } from '../pipeline/ingest.ts';
import type { AskPipeline } from '../pipeline/ask.ts';
import type { StripeBilling } from '../billing/stripe.ts';
import type { NotesReadResult } from '../notes/appleNotes.ts';

/**
 * The HTTP surface — Phase 4.
 *
 * Routing lives here as pure functions over a parsed request so it can be
 * tested without opening a socket; `server.ts` is the thin node:http adapter.
 *
 * Written against `node:http` rather than a framework. Six routes over one
 * resource does not justify a dependency, and the whole point of this phase is
 * to prove the data-source swap, not to introduce new moving parts.
 */

export interface ApiRequest {
  method: string;
  path: string;
  body: unknown;
  /**
   * The body exactly as it arrived, for signature verification — Stripe signs
   * the bytes it sent, and a re-serialized `body` is a different string.
   */
  rawBody?: string;
  /** The webhook caller's `Stripe-Signature` header, if present. */
  stripeSignature?: string;
  /** The invite token the caller presented, if any. See `writesAllowed`. */
  invite?: string;
  /** The browser's `Origin` header, if the caller was a browser. See `originAllowed`. */
  origin?: string;
  /** The request's own `Host` header — what `originAllowed` compares against. */
  host?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  /**
   * Server-sent events. When present the adapter streams these frames instead
   * of writing `body` — the router stays a pure function (a generator is a
   * value; iterating it is the adapter's side effect), so a streaming route is
   * tested by iterating, exactly like any other route is tested by asserting.
   */
  events?: AsyncIterable<{ event: string; data: unknown }>;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const badRequest = (message: string): ApiResponse => ({ status: 400, body: { error: message } });
const notFound = (message = 'not found'): ApiResponse => ({ status: 404, body: { error: message } });
const forbidden = (message: string): ApiResponse => ({ status: 403, body: { error: message } });

export interface Deps {
  repo: Repository;
  ingest: IngestPipeline;
  ask: AskPipeline;
  /** Restores a workspace to the seed corpus. */
  reset: (workspaceId: string) => void;
  /** Mints a fresh workspace seeded from the demo corpus, returning its id.
   *  The locale picks which corpus — a Korean visitor starts in Korean. */
  createWorkspace?: (locale?: 'en' | 'ko') => string;
  /**
   * The token a request must carry to change anything, or undefined to let
   * every request through — which is what local development and the test suite
   * want, and what a public deployment must not have.
   */
  inviteToken?: string;
  /** Absent means billing is not configured and its routes answer 503. */
  billing?: StripeBilling;
  /**
   * Reads the Mac's own Notes.app — a capability only a local darwin server
   * has, injected so the route can be tested without one and a hosted
   * deployment simply lacks it.
   */
  readNotes?: (days: number) => Promise<NotesReadResult>;
  /** Where uploaded capture images land; absent means images cannot be kept. */
  saveImage?: (dataUrl: string) => Promise<string>;
  /** Fetches a pasted link's title and excerpt, for the keep-or-not question. */
  previewLink?: (url: string) => Promise<import('../link/preview.ts').LinkPreview>;
  /** Reads Notion pages via the official API — present when a token is configured. */
  readNotionPages?: (days: number) => Promise<NotesReadResult>;
}

const asRecord = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};

/**
 * Reading is free; changing anything is not.
 *
 * A public deployment runs extraction and embedding on somebody's paid account,
 * so an open POST /capture is an open invitation to spend it. The token gates
 * every method that writes and leaves GET alone, which is enough for the demo
 * to be shown to anyone while only invited people can add to it.
 *
 * Absent `inviteToken` the gate is off entirely. That is what local development
 * and the test suite want, and it is the setting a deployment must never be
 * left in — `main.ts` says so out loud when it starts without one.
 */
function writesAllowed(req: ApiRequest, deps: Deps): boolean {
  if (!deps.inviteToken) return true;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return req.invite === deps.inviteToken;
}

/**
 * A webpage you are merely *visiting* must not be able to write here.
 *
 * This was reasoned about once and got the wrong answer, so the reasoning is
 * written down. The belief was that a cross-origin write is impossible because
 * `content-type: application/json` is not CORS-safelisted, which forces a
 * preflight, and this server answers OPTIONS with a 404 carrying no CORS
 * headers. Every clause is true. The conclusion is false, because **the
 * attacker picks the content-type**: `readBody` never looks at it, so
 *
 *     fetch('http://127.0.0.1:5170/api/workspaces/ws_demo/reset',
 *           { method: 'POST', mode: 'no-cors' })
 *
 * is a *simple* request — no preflight, delivered and executed. The response is
 * unreadable, and the corpus is already gone. `/capture` spends real API credit
 * the same way. `DELETE /memories/:id` was the one route the old reasoning held
 * for, because DELETE is not a simple method.
 *
 * So the check is on `Origin`, which a browser attaches to every non-GET and
 * which a page cannot forge.
 *
 * **No `Origin` at all is allowed.** curl, a script, the installer's health
 * probe — none of them are browsers, and anything running as you on this machine
 * can already read the database file directly. There is nothing to defend
 * against there, and refusing would break the probe.
 *
 * Reads stay free; `server.ts`'s Host check is what protects those, because the
 * threat to a read is DNS rebinding rather than a cross-origin fetch.
 */
function originAllowed(req: ApiRequest): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (!req.origin) return true;

  // The served client and the Vite dev proxy — which forwards the browser's own
  // `Origin: http://localhost:5173` even with `changeOrigin: true`.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.origin)) return true;

  /*
   * Same-origin, by comparison rather than by list. A hosted deployment's own
   * client sends `Origin: http://<its address>` on every POST — a browser
   * attaches it to all non-GETs, same-origin or not — and the localhost list
   * above refused the server's own pages. The page a stranger's site serves
   * still loses: their Origin names their host, not this one.
   */
  if (req.host) {
    try {
      if (new URL(req.origin).host === req.host) return true;
    } catch {
      // An unparseable Origin ("null", garbage) falls through to refusal.
    }
  }

  /*
   * Any extension, not a pinned id. An extension that can reach 127.0.0.1 holds
   * host permissions the user granted it at install time; the boundary that
   * means something here is webpage-versus-extension, not extension-versus-
   * extension. Pinning would also break the moment the unpacked id changes.
   */
  if (req.origin.startsWith('chrome-extension://')) return true;
  if (req.origin.startsWith('safari-web-extension://')) return true;
  if (req.origin.startsWith('moz-extension://')) return true;

  return false;
}

export async function handle(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  const segments = req.path.replace(/^\/+|\/+$/g, '').split('/');
  if (segments[0] !== 'api') return notFound();

  if (!originAllowed(req)) {
    return forbidden(`${req.origin} may not write to Mado.`);
  }

  /*
   * POST /api/billing/webhook — before the invite gate, because Stripe cannot
   * present an invite token and does not need to: the signature *is* the
   * authentication, checked against the raw bytes with the endpoint secret.
   * An unsigned or mis-signed request learns nothing and changes nothing.
   */
  if (req.method === 'POST' && segments[1] === 'billing' && segments[2] === 'webhook' && !segments[3]) {
    if (!deps.billing) return { status: 503, body: { error: 'billing is not configured' } };
    if (!req.rawBody || !deps.billing.verifySignature(req.rawBody, req.stripeSignature)) {
      return badRequest('invalid webhook signature');
    }
    return ok({ received: true, ...deps.billing.handleEvent(req.rawBody, deps.repo) });
  }

  if (!writesAllowed(req, deps)) {
    return forbidden('This demo is read-only without an invite.');
  }

  /*
   * GET /api/capabilities — which doors this server can actually open.
   *
   * The client used to assume every server could do what the local Mac server
   * does, and drew an Apple Notes chip that a hosted Ubuntu box could only
   * answer with a 501. A button that produces a refusal is worse than no
   * button — so the server says what it can reach, and the client draws only
   * those doors.
   */
  if (req.method === 'GET' && segments[1] === 'capabilities' && !segments[2]) {
    return ok({
      appleNotes: Boolean(deps.readNotes),
      notion: Boolean(deps.readNotionPages),
    });
  }

  /*
   * POST /api/workspaces — a copy of the corpus, for one visitor.
   *
   * Everyone shared `ws_demo` before this, which is fine until the first person
   * deletes something and every visitor after them sees the gap. The schema was
   * always multi-tenant — every table carries a workspace_id with a foreign key
   * and an index — so this is a seed import under a new id rather than a
   * migration.
   */
  if (req.method === 'POST' && segments[1] === 'workspaces' && !segments[2]) {
    if (!deps.createWorkspace) return notFound();
    const body = asRecord(req.body);
    const locale: 'en' | 'ko' | undefined =
      body.locale === 'ko' ? 'ko' : body.locale === 'en' ? 'en' : undefined;
    return ok({ workspaceId: deps.createWorkspace(locale) });
  }

  // /api/workspaces/:id/...
  if (segments[1] === 'workspaces' && segments[2]) {
    const workspaceId = decodeURIComponent(segments[2]);
    if (!deps.repo.getWorkspace(workspaceId)) return notFound(`unknown workspace ${workspaceId}`);
    return handleWorkspace(req, deps, workspaceId, segments.slice(3));
  }

  return notFound();
}

async function handleWorkspace(
  req: ApiRequest,
  deps: Deps,
  workspaceId: string,
  rest: string[],
): Promise<ApiResponse> {
  const [resource, resourceId, action] = rest;

  // GET /api/workspaces/:id/graph — the one read the frontend needs, in exactly
  // the shape SeedDataSource returns.
  if (req.method === 'GET' && resource === 'graph' && !resourceId) {
    return ok(deps.repo.getGraphPayload(workspaceId));
  }

  if (req.method === 'GET' && resource === 'reorgs' && !resourceId) {
    return ok(deps.repo.listReorgEvents(workspaceId, 10));
  }

  if (req.method === 'POST' && resource === 'capture' && !resourceId) {
    const body = asRecord(req.body);
    const type = body.type;
    if (type !== 'text' && type !== 'link' && type !== 'screenshot') {
      return badRequest('type must be one of text, link, screenshot');
    }
    // A photo written alongside the words: the client sends the image itself
    // as a data URL, the server keeps it on disk, and from there the existing
    // imagePath pipeline (normalize reads the file) carries it.
    let uploadedPath: string | undefined;
    if (typeof body.imageData === 'string' && body.imageData) {
      if (!deps.saveImage) return badRequest('this server cannot store images');
      try {
        uploadedPath = await deps.saveImage(body.imageData);
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : 'could not store the image');
      }
    }
    const result = await deps.ingest.ingest({
      workspaceId,
      type,
      content: typeof body.content === 'string' ? body.content : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      imagePath: uploadedPath ?? (typeof body.imagePath === 'string' ? body.imagePath : undefined),
      referencedUrls: Array.isArray(body.referencedUrls)
        ? body.referencedUrls.filter((u): u is string => typeof u === 'string')
        : undefined,
      locale: body.locale === 'ko' || body.locale === 'en' ? body.locale : undefined,
      // A diary entry names its day; anything else leaves it unset.
      diaryDate:
        typeof body.diaryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.diaryDate)
          ? body.diaryDate
          : undefined,
    });

    /*
     * Where it landed, always. A few hundred bytes, and it is the whole content
     * of "Saved to Pricing Strategy Debates" — the sentence that tells you the
     * tool understood you. Without it a caller has to search the graph payload
     * to name a category it already has the id of.
     */
    const categories = deps.repo.getGraphPayload(workspaceId).categories;
    const touchedCategories = result.touchedCategoryIds
      .map((id) => categories.find((c) => c.id === id))
      .filter((c) => c !== undefined)
      .map((c) => ({ id: c.id, name: c.name }));

    /*
     * The graph rides along by default: the web client needs the new state
     * anyway, and a separate round trip would let the UI render a split before
     * the payload that contains it.
     *
     * `includeGraph: false` is for callers that do not — the extension shows a
     * notification and closes. The payload carries every memory's 1024-float
     * vector and grows forever, so this is not a micro-optimisation.
     *
     * A body field rather than a query parameter, because `server.ts` splits
     * the query string off before calling `handle` and `routes.ts` stays a pure
     * function over a parsed request.
     */
    if (body.includeGraph === false) return ok({ ...result, touchedCategories });
    return ok({
      ...result,
      touchedCategories,
      graph: deps.repo.getGraphPayload(workspaceId),
    });
  }

  /*
   * POST /api/workspaces/:id/capture/batch — many sources, one reorganization.
   *
   * The single-capture route stays exactly as it is: the extension and the
   * command bar are one-item surfaces and their contract must not grow a shape
   * it never sends. This one takes `{ items: [...] }`, runs them serially with
   * per-item reorganize suppressed, and lets the gates fire once at the end —
   * the server half of the bulk-drop reveal.
   */
  if (req.method === 'POST' && resource === 'capture' && resourceId === 'batch' && !action) {
    const body = asRecord(req.body);
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return badRequest('items must be a non-empty array');
    }
    // A cap, because the pipeline is serial and a request that takes minutes
    // looks exactly like one that hung. 100 items ≈ a two-week Instagram export.
    if (body.items.length > 100) {
      return badRequest('at most 100 items per batch');
    }

    const items: IngestInput[] = [];
    for (const raw of body.items) {
      const item = asRecord(raw);
      const type = item.type;
      // Text and links only. A screenshot needs an imagePath the server reads
      // off disk, and a batch of those is an upload feature, not a loop.
      if (type !== 'text' && type !== 'link') {
        return badRequest('batch items must have type text or link');
      }
      items.push({
        workspaceId,
        type,
        content: typeof item.content === 'string' ? item.content : undefined,
        title: typeof item.title === 'string' ? item.title : undefined,
        url: typeof item.url === 'string' ? item.url : undefined,
        locale: body.locale === 'ko' || body.locale === 'en' ? body.locale : undefined,
      });
    }

    const { results, reorgs } = await deps.ingest.ingestBatch(items);
    const summaries = results.map((r) => ({
      sourceId: r.sourceId,
      status: r.status,
      addedMemoryIds: r.addedMemoryIds,
      touchedCategoryIds: r.touchedCategoryIds,
      skipped: r.skipped,
      note: r.note,
    }));

    if (body.includeGraph === false) return ok({ results: summaries, reorgs });
    return ok({ results: summaries, reorgs, graph: deps.repo.getGraphPayload(workspaceId) });
  }

  // POST /api/workspaces/:id/reset — back to the pristine seed corpus.
  //
  // Seed mode gets this for free: a reload re-reads the JSON file. Once the
  // corpus lives in a database that stops being true, and the demo runbook
  // promises the presenter that a reload is a full reset. This gives it back.
  if (req.method === 'POST' && resource === 'reset' && !resourceId) {
    deps.reset(workspaceId);
    return ok({ graph: deps.repo.getGraphPayload(workspaceId) });
  }

  if (req.method === 'POST' && resource === 'ask' && !resourceId) {
    const body = asRecord(req.body);
    if (typeof body.question !== 'string' || body.question.trim().length === 0) {
      return badRequest('question is required');
    }
    // Optional conversation context for follow-ups. Malformed turns are
    // dropped rather than rejected — history disambiguates a question, and a
    // question must not fail because its context was oddly shaped. Capped at
    // the last three: further back is a different subject more often than not.
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter(
        (t): t is { question: string; answer: string } =>
          typeof t === 'object' && t !== null &&
          typeof (t as Record<string, unknown>).question === 'string' &&
          typeof (t as Record<string, unknown>).answer === 'string',
      )
      .slice(-3);
    return ok(await deps.ask.ask(workspaceId, body.question, history));
  }

  /*
   * POST /api/workspaces/:id/ask/stream — the same ask, with the answer text
   * arriving as it is generated: `delta` frames of new text, then one `done`
   * frame carrying the exact AskResult POST /ask would have returned. Every
   * guarantee (retrieval floor, citation validation, refusal) runs in the
   * pipeline's generator; a draft that fails validation is superseded by the
   * refusal in `done`.
   */
  if (req.method === 'POST' && resource === 'ask' && resourceId === 'stream' && !action) {
    const body = asRecord(req.body);
    if (typeof body.question !== 'string' || body.question.trim().length === 0) {
      return badRequest('question is required');
    }
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter(
        (t): t is { question: string; answer: string } =>
          typeof t === 'object' && t !== null &&
          typeof (t as Record<string, unknown>).question === 'string' &&
          typeof (t as Record<string, unknown>).answer === 'string',
      )
      .slice(-3);
    return { status: 200, body: null, events: deps.ask.askStream(workspaceId, body.question, history) };
  }

  /*
   * POST /api/workspaces/:id/diary/retro — the look back: diary days in
   * [from, to] gathered and reflected on in the memory's own voice. 501
   * where no model can do it honestly; an empty range answers plainly.
   */
  if (req.method === 'POST' && resource === 'diary' && resourceId === 'retro' && !action) {
    if (!deps.ask.canRetrospect()) {
      return { status: 501, body: { error: 'this server cannot look back' } };
    }
    const body = asRecord(req.body);
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof body.from !== 'string' || typeof body.to !== 'string' || !DAY.test(body.from) || !DAY.test(body.to)) {
      return badRequest('from and to must be YYYY-MM-DD');
    }
    const locale: 'en' | 'ko' | undefined =
      body.locale === 'ko' ? 'ko' : body.locale === 'en' ? 'en' : undefined;
    try {
      return ok(await deps.ask.retrospect(workspaceId, body.from, body.to, locale));
    } catch (err) {
      return { status: 502, body: { error: err instanceof Error ? err.message : 'retro failed' } };
    }
  }

  // POST /api/workspaces/:id/reorgs/:reorgId/undo
  if (req.method === 'POST' && resource === 'reorgs' && resourceId && action === 'undo') {
    const event = deps.repo.listReorgEvents(workspaceId, 50).find((e) => e.id === resourceId);
    if (!event) return notFound(`unknown reorganization ${resourceId}`);
    if (event.status === 'undone') return badRequest('already undone');
    deps.ingest.undo(workspaceId, event);
    return ok({ undone: event.id, graph: deps.repo.getGraphPayload(workspaceId) });
  }

  /*
   * POST /api/workspaces/:id/import/apple-notes
   * POST /api/workspaces/:id/import/notion
   *
   * Two doors, one handler. Each source is an injected reader capability —
   * Apple Notes exists only on a local Mac, Notion only when a token is
   * configured — and everything a reader returns takes the exact same batch
   * path a file drop takes, so no two ways in can behave differently.
   */
  /*
   * POST /api/workspaces/:id/link/preview — read a link before keeping it.
   * The client shows what came back and asks; nothing is written here.
   */
  if (req.method === 'POST' && resource === 'link' && resourceId === 'preview' && !action) {
    if (!deps.previewLink) return { status: 501, body: { error: 'this server cannot read links' } };
    const body = asRecord(req.body);
    if (typeof body.url !== 'string' || !body.url.trim()) return badRequest('url is required');
    try {
      return ok(await deps.previewLink(body.url.trim()));
    } catch (err) {
      return {
        status: 502,
        body: { error: err instanceof Error ? err.message : 'could not read the link' },
      };
    }
  }

  if (req.method === 'POST' && resource === 'import' && resourceId && !action) {
    const reader =
      resourceId === 'apple-notes' ? deps.readNotes
      : resourceId === 'notion' ? deps.readNotionPages
      : undefined;
    if (resourceId !== 'apple-notes' && resourceId !== 'notion') return notFound();
    if (!reader) {
      return { status: 501, body: { error: `this server cannot reach ${resourceId}` } };
    }

    const body = asRecord(req.body);
    const days =
      typeof body.days === 'number' && body.days > 0 ? Math.min(body.days, 3650) : 14;
    const locale: 'en' | 'ko' | undefined =
      body.locale === 'ko' ? 'ko' : body.locale === 'en' ? 'en' : undefined;

    let read: NotesReadResult;
    try {
      read = await reader(days);
    } catch (err) {
      return {
        status: 502,
        body: { error: err instanceof Error ? err.message : `could not read ${resourceId}` },
      };
    }

    const items = read.notes.slice(0, 100).map((n) => ({
      workspaceId,
      // Still 'text': the content was already read by the reader, and a
      // 'link' type would invite the pipeline to fetch it. The url is the
      // way back to the original — provenance, not something to scrape.
      type: 'text' as const,
      title: n.title || n.content.slice(0, 60),
      content: n.content,
      url: n.url,
      locale,
    }));

    if (items.length === 0) {
      return ok({
        results: [], reorgs: [],
        notes: { total: read.total, imported: 0, droppedSecretLines: read.droppedSecretLines },
        graph: deps.repo.getGraphPayload(workspaceId),
      });
    }

    const { results, reorgs } = await deps.ingest.ingestBatch(items);
    return ok({
      results: results.map((r) => ({
        sourceId: r.sourceId,
        status: r.status,
        addedMemoryIds: r.addedMemoryIds,
        touchedCategoryIds: r.touchedCategoryIds,
        skipped: r.skipped,
        note: r.note,
      })),
      reorgs,
      notes: { total: read.total, imported: items.length, droppedSecretLines: read.droppedSecretLines },
      graph: deps.repo.getGraphPayload(workspaceId),
    });
  }

  /*
   * POST /api/workspaces/:id/billing/checkout — the way into Pro.
   *
   * Returns the Stripe-hosted checkout URL; the client redirects to it and
   * comes back to `returnUrl` (with `?upgraded=1` on success). The plan flips
   * when the webhook confirms payment, never here — a closed checkout tab
   * proves nothing.
   */
  if (req.method === 'POST' && resource === 'billing' && resourceId === 'checkout' && !action) {
    if (!deps.billing) return { status: 503, body: { error: 'billing is not configured' } };
    const body = asRecord(req.body);
    if (typeof body.returnUrl !== 'string' || !/^https?:\/\//.test(body.returnUrl)) {
      return badRequest('returnUrl must be an http(s) URL');
    }
    try {
      return ok(await deps.billing.createCheckoutSession(workspaceId, body.returnUrl));
    } catch (err) {
      return {
        status: 502,
        body: { error: err instanceof Error ? err.message : 'checkout failed' },
      };
    }
  }

  // PATCH /api/workspaces/:id/settings — the workspace's own switches.
  if (req.method === 'PATCH' && resource === 'settings' && !resourceId) {
    const body = (req.body ?? {}) as { autoReorganize?: unknown };
    if (typeof body.autoReorganize !== 'boolean') {
      return badRequest('autoReorganize must be a boolean');
    }
    deps.repo.setAutoReorganize(workspaceId, body.autoReorganize);
    return ok({ graph: deps.repo.getGraphPayload(workspaceId) });
  }

  /*
   * POST /api/workspaces/:id/sources/:sourceId/review — one source's review
   * verdicts, applied atomically (spec §21). Unlisted memories are keeps.
   * Discards keep their text in a verdict row; edits re-embed and lock; the
   * source is stamped reviewed. The signal teaches the next extraction.
   */
  if (req.method === 'POST' && resource === 'sources' && resourceId && action === 'review') {
    const source = deps.repo.listSources(workspaceId).find((s) => s.id === resourceId);
    if (!source) return notFound(`unknown source ${resourceId}`);

    const body = asRecord(req.body);
    const discard = (Array.isArray(body.discard) ? body.discard : []).filter(
      (v): v is string => typeof v === 'string',
    );
    const edits = (Array.isArray(body.edits) ? body.edits : [])
      .map((raw) => asRecord(raw))
      .filter(
        (e): e is { memoryId: string; text: string } =>
          typeof e.memoryId === 'string' && typeof e.text === 'string',
      )
      .map((e) => ({ memoryId: e.memoryId, text: e.text }));

    try {
      await deps.ingest.reviewSource(workspaceId, resourceId, { discard, edits });
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'review failed');
    }
    return ok({ graph: deps.repo.getGraphPayload(workspaceId) });
  }

  // POST /api/workspaces/:id/sources/:sourceId/retry — re-run a failed capture.
  if (req.method === 'POST' && resource === 'sources' && resourceId && action === 'retry') {
    const source = deps.repo.listSources(workspaceId).find((s) => s.id === resourceId);
    if (!source) return notFound(`unknown source ${resourceId}`);
    if (source.status !== 'failed') {
      return badRequest(`source is ${source.status}, only a failed source can be retried`);
    }
    const result = await deps.ingest.retry(workspaceId, resourceId);
    return ok({
      status: result.status,
      note: result.note ?? null,
      graph: deps.repo.getGraphPayload(workspaceId),
    });
  }

  // POST /api/workspaces/:id/memories/:memoryId/category — a user correction,
  // which locks the assignment against every future reorganization pass.
  if (req.method === 'POST' && resource === 'memories' && resourceId && action === 'category') {
    const body = asRecord(req.body);
    if (typeof body.categoryId !== 'string') return badRequest('categoryId is required');

    const payload = deps.repo.getGraphPayload(workspaceId);
    const memory = payload.memories.find((m) => m.id === resourceId);
    if (!memory) return notFound(`unknown memory ${resourceId}`);
    if (!payload.categories.some((c) => c.id === body.categoryId)) {
      return notFound(`unknown category ${body.categoryId}`);
    }

    deps.repo.assign({
      memoryId: resourceId,
      categoryId: body.categoryId,
      confidence: memory.confidence,
      assignedBy: 'user',
    });
    deps.repo.updateMemoryPosition(resourceId, null, null, memory.pinned);
    return ok({ graph: deps.repo.getGraphPayload(workspaceId) });
  }

  /*
   * POST /api/workspaces/:id/memories/merge-preview — the AI's half of a
   * user-driven merge: why these overlap, and the one text that would hold
   * everything. Writes nothing; the user is about to decide.
   *
   * POST /api/workspaces/:id/memories/merge — applies a merge the user
   * confirmed, with the exact text they saw. Entity links union, times_seen
   * sums, the originals' sources stay; only the redundant rows go.
   */
  if (
    req.method === 'POST' && resource === 'memories' &&
    (resourceId === 'merge-preview' || resourceId === 'merge') && !action
  ) {
    const body = asRecord(req.body);
    const memoryIds = Array.isArray(body.memoryIds)
      ? body.memoryIds.filter((v): v is string => typeof v === 'string')
      : [];
    if (memoryIds.length < 2) return badRequest('memoryIds must name at least two memories');
    if (memoryIds.length > 8) return badRequest('at most 8 memories per merge');
    const known = new Set(deps.repo.listMemories(workspaceId).map((m) => m.id));
    for (const mid of memoryIds) {
      if (!known.has(mid)) return notFound(`unknown memory ${mid}`);
    }

    if (resourceId === 'merge-preview') {
      if (!deps.ingest.canMerge()) {
        return { status: 501, body: { error: 'this server cannot draft merges' } };
      }
      const locale: 'en' | 'ko' | undefined =
        body.locale === 'ko' ? 'ko' : body.locale === 'en' ? 'en' : undefined;
      try {
        return ok(await deps.ingest.previewMerge(workspaceId, memoryIds, locale));
      } catch (err) {
        return {
          status: 502,
          body: { error: err instanceof Error ? err.message : 'merge preview failed' },
        };
      }
    }

    if (typeof body.mergedText !== 'string' || body.mergedText.trim().length === 0) {
      return badRequest('mergedText is required — the user approves the exact text');
    }
    const merged = deps.ingest.applyMerge(workspaceId, memoryIds, body.mergedText);
    return ok({ mergedMemoryId: merged.id, graph: deps.repo.getGraphPayload(workspaceId) });
  }

  /*
   * DELETE /api/workspaces/:id/memories/:memoryId — throw one away.
   *
   * The first DELETE this API has had. Nothing at any layer could remove a
   * memory: no repository method, no route, no DataSource method, no store
   * action — which meant a user who saved the wrong thing had no way to unsave
   * it, and the first minute of a tester's life is full of wrong things.
   *
   * Returns the whole graph like every other mutation here, rather than a
   * status: the client keeps no delta machinery, and a fresh payload is what
   * every other route has taught it to expect.
   */
  if (req.method === 'DELETE' && resource === 'memories' && resourceId && !action) {
    const payload = deps.repo.getGraphPayload(workspaceId);
    if (!payload.memories.some((m) => m.id === resourceId)) {
      return notFound(`unknown memory ${resourceId}`);
    }
    deps.repo.deleteMemory(resourceId);
    return ok({ graph: deps.repo.getGraphPayload(workspaceId) });
  }

  // PATCH /api/workspaces/:id/categories/:categoryId — rename or re-parent.
  if (req.method === 'PATCH' && resource === 'categories' && resourceId && !action) {
    const body = asRecord(req.body);
    const payload = deps.repo.getGraphPayload(workspaceId);
    const category = payload.categories.find((c) => c.id === resourceId);
    if (!category) return notFound(`unknown category ${resourceId}`);

    const fields: Record<string, unknown> = {};
    if (typeof body.name === 'string') {
      // A rename is a user edit, and a user edit is a fact: lock it so no
      // reorganization renames or merges it away (spec §6.3).
      fields.name = body.name;
      fields.name_locked = true;
    }
    if ('parentId' in body) {
      const parentId = body.parentId;
      if (parentId !== null && typeof parentId !== 'string') {
        return badRequest('parentId must be a category id or null');
      }
      if (typeof parentId === 'string') {
        const parent = payload.categories.find((c) => c.id === parentId);
        if (!parent) return notFound(`unknown category ${parentId}`);
        // The schema trigger would also catch this, but a 400 explains it in
        // the words the UI already uses.
        if (parent.parent_id !== null) {
          return badRequest('Mado keeps categories two levels deep.');
        }
      }
      fields.parent_id = parentId;
    }
    if (Object.keys(fields).length === 0) return badRequest('nothing to update');

    deps.repo.updateCategory(resourceId, fields);
    return ok({ graph: deps.repo.getGraphPayload(workspaceId) });
  }

  return notFound();
}
