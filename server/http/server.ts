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

async function readBody(
  req: import('node:http').IncomingMessage,
): Promise<{ parsed: unknown; raw: string | undefined }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return { parsed: null, raw: undefined };
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) return { parsed: null, raw: undefined };
  // The raw text rides along for signature verification: Stripe signs the
  // bytes it sent, and JSON.parse→stringify is not an identity on them.
  return { parsed: JSON.parse(text), raw: text };
}

/**
 * Refuses a request whose `Host` is not this machine.
 *
 * The defence against **DNS rebinding**, and the only thing protecting reads.
 * `originAllowed` in routes.ts guards writes, but a page on evil.com whose DNS
 * is rebound to 127.0.0.1 is *same-origin* from the browser's point of view, so
 * no Origin header appears and `GET /graph` — the entire corpus — comes back
 * readable. A rebound name cannot survive being compared against the name we
 * expect to be called by.
 *
 * Only when bound to loopback. A deployment that binds a real interface is
 * reached by its real hostname and is guarded by `RECALL_INVITE` instead;
 * applying this there would refuse every legitimate request.
 */
function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  // A default-port request may omit it, though nothing does on 5170.
  return (
    host === `127.0.0.1:${port}` ||
    host === `localhost:${port}` ||
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === `[::1]:${port}`
  );
}

/**
 * `staticRoot` turns this into the whole deployable: the built client and the
 * API from one process on one origin, so no CORS response header is ever needed.
 * Omit it and this stays the API-only server the dev proxy expects.
 *
 * No `Access-Control-Allow-Origin` is sent, deliberately — permissive headers
 * "just in case" would be a real hole on a service holding somebody's corpus.
 * But absent CORS headers only stop an attacker *reading* a response; they do
 * not stop the request arriving. What actually keeps a webpage out is
 * `originAllowed` (writes) and `hostAllowed` (reads), both of which run before
 * anything is touched.
 *
 * `loopbackPort` enables the Host check. Passing it says "I am bound to
 * localhost", which is the only situation where the check is correct.
 */
export function createApiServer(
  deps: Deps,
  staticRoot?: string,
  loopbackPort?: number,
): Server {
  return createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: unknown) => {
        const payload = JSON.stringify(body);
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
          'cache-control': 'no-store',
        });
        res.end(payload);
      };

      // Before the static handler, not after: a rebound name must not be able
      // to read index.html either, and this is cheaper than serving a file.
      if (loopbackPort !== undefined && !hostAllowed(req.headers.host, loopbackPort)) {
        send(403, { error: 'Mado only answers to localhost.' });
        return;
      }

      if (staticRoot && serveStatic(staticRoot, req, res)) return;

      try {
        const path = (req.url ?? '/').split('?')[0] ?? '/';
        let body: unknown = null;
        let rawBody: string | undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try {
            ({ parsed: body, raw: rawBody } = await readBody(req));
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
            rawBody,
            stripeSignature: typeof req.headers['stripe-signature'] === 'string'
              ? req.headers['stripe-signature']
              : undefined,
            // A header rather than a query parameter: query strings end up in
            // access logs, browser history and shared links, which is exactly
            // where a shared secret should not be.
            invite: typeof req.headers['x-recall-invite'] === 'string'
              ? req.headers['x-recall-invite']
              : undefined,
            // A browser attaches this to every non-GET and a page cannot forge
            // it; `originAllowed` is what it is for.
            origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
            // What same-origin means here: an Origin naming this same host is
            // the deployment's own client, wherever it is hosted.
            host: typeof req.headers.host === 'string' ? req.headers.host : undefined,
          },
          deps,
        );
        if (result.events) {
          /*
           * Server-sent events. Headers first, then one frame per event; an
           * error mid-stream becomes an `error` frame rather than a broken
           * pipe, because the status line already said 200 and the client's
           * only way to hear about it is in-band.
           */
          res.writeHead(result.status, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          });
          try {
            for await (const frame of result.events) {
              res.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
            }
          } catch (err) {
            res.write(
              `event: error\ndata: ${JSON.stringify({
                error: err instanceof Error ? err.message : 'stream failed',
              })}\n\n`,
            );
          }
          res.end();
          return;
        }
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
