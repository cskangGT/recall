import type { Repository } from '../db/repository.ts';
import type { IngestPipeline } from '../pipeline/ingest.ts';
import type { AskPipeline } from '../pipeline/ask.ts';

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
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const badRequest = (message: string): ApiResponse => ({ status: 400, body: { error: message } });
const notFound = (message = 'not found'): ApiResponse => ({ status: 404, body: { error: message } });

export interface Deps {
  repo: Repository;
  ingest: IngestPipeline;
  ask: AskPipeline;
  /** Restores a workspace to the seed corpus. */
  reset: (workspaceId: string) => void;
}

const asRecord = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};

export async function handle(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  const segments = req.path.replace(/^\/+|\/+$/g, '').split('/');
  if (segments[0] !== 'api') return notFound();

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
    const result = await deps.ingest.ingest({
      workspaceId,
      type,
      content: typeof body.content === 'string' ? body.content : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      imagePath: typeof body.imagePath === 'string' ? body.imagePath : undefined,
      referencedUrls: Array.isArray(body.referencedUrls)
        ? body.referencedUrls.filter((u): u is string => typeof u === 'string')
        : undefined,
    });
    // The graph rides along: the client needs the new state anyway, and a
    // separate round trip would let the UI render a split before the payload
    // that contains it.
    return ok({ ...result, graph: deps.repo.getGraphPayload(workspaceId) });
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
