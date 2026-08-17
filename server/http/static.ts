import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serves the built client from the same process as the API.
 *
 * One origin, deliberately. The alternative — the SPA on a static host and the
 * API somewhere else — needs CORS, and `server.ts` already says why that is the
 * wrong thing to reach for on a service holding somebody's corpus: permissive
 * headers "just in case" are a real hole. Same origin means the question never
 * arises, and it makes the deployable unit one process with one URL.
 *
 * Everything that is not a file and not `/api` falls through to index.html,
 * because the client owns its routing and a deep link must not 404.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Hashed assets are immutable; index.html must never be.
 *
 * Vite fingerprints everything under /assets, so those can be cached for a
 * year — the name changes when the bytes do. index.html is the one file that
 * keeps its name across deploys, so caching it is how a browser ends up asking
 * for a bundle that no longer exists.
 */
function cacheFor(pathname: string): string {
  return pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

export function serveStatic(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const pathname = (req.url ?? '/').split('?')[0] ?? '/';

  /*
   * Resolved and then checked against the root, rather than trusted after
   * stripping "..". A request for %2e%2e%2f arrives already decoded, and
   * `path.join` will happily walk out of the directory; the containment check
   * is the thing that actually holds.
   */
  const candidate = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  const inside = candidate === root || candidate.startsWith(root + path.sep);

  let file = inside && isFile(candidate) ? candidate : null;
  if (!file) {
    if (pathname.startsWith('/api/')) return false;
    file = path.join(root, 'index.html');
    if (!isFile(file)) return false;
  }

  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': cacheFor(pathname),
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}
