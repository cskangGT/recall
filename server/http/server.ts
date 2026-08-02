import { createServer, type Server } from 'node:http';
import { handle, type Deps } from './routes.ts';
import { serveStatic } from './static.ts';

/**
 * Thin node:http adapter over the pure router in `routes.ts`.
 *
 * Everything interesting is testable without this file; it exists to read a
 * body, call `handle`, and write JSON back.
 */

const MAX_BODY_BYTES = 5 * 1024 * 1024;

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) return null;
  return JSON.parse(text);
}

/**
 * `staticRoot` turns this into the whole deployable: the built client and the
 * API from one process on one origin, so no CORS header is ever needed. Omit it
 * and this stays the API-only server the dev proxy expects.
 */
export function createApiServer(deps: Deps, staticRoot?: string): Server {
  return createServer((req, res) => {
    void (async () => {
      if (staticRoot && serveStatic(staticRoot, req, res)) return;
      const send = (status: number, body: unknown) => {
        const payload = JSON.stringify(body);
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
          // The dev server proxies /api, so requests are same-origin and no
          // CORS headers are needed. Adding permissive ones "just in case"
          // would be a real hole for a local service holding a user's corpus.
          'cache-control': 'no-store',
        });
        res.end(payload);
      };

      try {
        const path = (req.url ?? '/').split('?')[0] ?? '/';
        let body: unknown = null;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try {
            body = await readBody(req);
          } catch (err) {
            send(400, { error: err instanceof Error ? err.message : 'malformed body' });
            return;
          }
        }
        const result = await handle(
          {
            method: req.method ?? 'GET',
            path,
            body,
            // A header rather than a query parameter: query strings end up in
            // access logs, browser history and shared links, which is exactly
            // where a shared secret should not be.
            invite: typeof req.headers['x-recall-invite'] === 'string'
              ? req.headers['x-recall-invite']
              : undefined,
          },
          deps,
        );
        send(result.status, result.body);
      } catch (err) {
        // A handler throwing is a bug, not a client error — say so plainly
        // rather than returning a 400 that sends the caller looking at their
        // own request.
        send(500, { error: err instanceof Error ? err.message : 'internal error' });
      }
    })();
  });
}
