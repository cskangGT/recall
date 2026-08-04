import type { Repository } from '../db/repository.ts';
import type { IngestPipeline } from '../pipeline/ingest.ts';
import type { AskPipeline } from '../pipeline/ask.ts';
import { exportFilename, toJson, toMarkdown } from '../../src/core/exportCorpus.ts';

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
  /** The invite token the caller presented, if any. See `writesAllowed`. */
  invite?: string;
  /** The browser's `Origin` header, if the caller was a browser. See `originAllowed`. */
  origin?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  /**
   * A file to send as an attachment instead of `body`.
   *
   * Described here rather than written here, so routing stays pure and
   * `server.ts` keeps being the only thing that touches a socket — the same
   * split every other route already has.
   */
  download?: { filename: string; contentType: string; text: string };
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
  /** Mints a fresh workspace seeded from the demo corpus, returning its id. */
  createWorkspace?: () => string;
  /**
   * The token a request must carry to change anything, or undefined to let
   * every request through — which is what local development and the test suite
   * want, and what a public deployment must not have.
   */
  inviteToken?: string;
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
    return forbidden(`${req.origin} may not write to Recall.`);
  }

  if (!writesAllowed(req, deps)) {
    return forbidden('This demo is read-only without an invite.');
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
    return ok({ workspaceId: deps.createWorkspace() });
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

  /*
   * GET /api/workspaces/:id/export?format=json|markdown
   *
   * `server.ts` strips the query string before this function sees it, and that
   * is deliberate — routing stays a pure function over a parsed request. So the
   * format is a path segment: `/export/json`, `/export/markdown`.
   */
  if (req.method === 'GET' && resource === 'export') {
    const format = resourceId ?? 'json';
    if (format !== 'json' && format !== 'markdown') {
      return badRequest('format must be json or markdown');
    }
    const payload = deps.repo.getGraphPayload(workspaceId);
    const at = new Date();
    return {
      status: 200,
      body: null,
      download: format === 'markdown'
        ? {
            filename: exportFilename('md', at),
            contentType: 'text/markdown; charset=utf-8',
            text: toMarkdown(payload, at),
          }
        : {
            filename: exportFilename('json', at),
            contentType: 'application/json; charset=utf-8',
            text: JSON.stringify(toJson(payload, at), null, 2),
          },
    };
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
    const result = await deps.ingest.ingest({
      workspaceId,
      type,
      content: typeof body.content === 'string' ? body.content : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      imagePath: typeof body.imagePath === 'string' ? body.imagePath : undefined,
      referencedUrls: Array.isArray(body.referencedUrls)
        ? body.referencedUrls.filter((u): u is string => typeof u === 'string')
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
    return ok(await deps.ask.ask(workspaceId, body.question));
  }

  // POST /api/workspaces/:id/reorgs/:reorgId/undo
  if (req.method === 'POST' && resource === 'reorgs' && resourceId && action === 'undo') {
    const event = deps.repo.listReorgEvents(workspaceId, 50).find((e) => e.id === resourceId);
    if (!event) return notFound(`unknown reorganization ${resourceId}`);
    if (event.status === 'undone') return badRequest('already undone');
    deps.ingest.undo(workspaceId, event);
    return ok({ undone: event.id, graph: deps.repo.getGraphPayload(workspaceId) });
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
          return badRequest('Recall keeps categories two levels deep.');
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
