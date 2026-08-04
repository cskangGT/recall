import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Reads the `<head>` of a URL, and nothing else.
 *
 * Recall's link capture used to store the address and hand it to the extractor
 * as if it were prose, so the model answered from what it knew about that URL —
 * a real essay produced four confident memories and an invented URL produced
 * one entirely fabricated claim, with nothing fetched either time. This is the
 * reader that was missing.
 *
 * **`<head>` only, deliberately.** Spec AC-2 asks for title, description,
 * canonical URL and hero image, and those all live in a meta block. The article
 * *body* is what the browser extension already takes — with your session, past
 * bot walls and paywalls and JS rendering — so fetching it here would be a worse
 * copy of something that works. Reading only the head means no Readability
 * dependency and a 64KB cap instead of an unbounded download.
 *
 * **This is the first thing in Recall that takes a URL from a request body and
 * opens a socket with it**, on a server that now runs from login to shutdown.
 * That is an SSRF primitive unless every one of the guards below holds, and the
 * one people forget is the redirect: a perfectly public URL can answer 302 with
 * `Location: http://127.0.0.1:5170/…`, so the address is re-checked at every
 * hop rather than once at the start.
 */

export const MAX_HEAD_BYTES = 64 * 1024;
export const MAX_REDIRECTS = 3;
export const TIMEOUT_MS = 8000;

export interface PageMeta {
  /** og:title, then <title>. Never the URL — the caller decides that fallback. */
  title: string | null;
  description: string | null;
  /** og:url or <link rel=canonical>, resolved against the request URL. */
  canonicalUrl: string | null;
  imageUrl: string | null;
}

export type FetchOutcome =
  | { meta: PageMeta; finalUrl: string }
  | { refused: string };

/* ------------------------------------------------------------------ address */

/**
 * Ranges a request from this machine must never be pointed at.
 *
 * Loopback and private space are the obvious ones. `169.254.0.0/16` is the one
 * that matters most on a cloud host — it is where instance metadata lives, and
 * an SSRF that reaches it hands out credentials.
 */
export function isForbiddenAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number, number, number];
    return (
      a === 0 ||        // "this network"
      a === 10 ||       // private
      a === 127 ||      // loopback
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||           // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||  // private
      (a === 192 && b === 168) ||           // private
      a >= 224                              // multicast and reserved
    );
  }
  if (v === 6) {
    const a = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd')) return true;
    // ::ffff:127.0.0.1 and friends — an IPv4 address wearing a hat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isForbiddenAddress(mapped[1]!);
    return a.startsWith('ff'); // multicast
  }
  return true; // not an address at all
}

/** Null when the URL is fine to fetch, or a sentence saying why it is not. */
export async function checkUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That doesn't look like an address Recall can open.";
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Recall only opens http and https addresses.';
  }

  /*
   * Resolved, not string-matched. `localtest.me` and a thousand other public
   * names resolve to 127.0.0.1, so refusing the literal string `localhost`
   * would catch nobody who meant it.
   */
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isForbiddenAddress(host) ? 'That address is on your own machine or network.' : null;
  }
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return "Recall couldn't find that address.";
    // Every answer, not the first: a name can resolve to a public address and a
    // private one, and the socket may take either.
    if (addresses.some((a) => isForbiddenAddress(a.address))) {
      return 'That address is on your own machine or network.';
    }
    return null;
  } catch {
    return "Recall couldn't find that address.";
  }
}

/* --------------------------------------------------------------- parsing */

const meta = (html: string, attr: 'property' | 'name', key: string): string | null => {
  // Both attribute orders, both quote styles. Written out rather than parsed
  // with a DOM because this reads one block of a document we already truncated.
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m?.[1]) return decodeEntities(m[1]).trim() || null;
  }
  return null;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Pure, so the interesting cases are testable without opening a socket. */
export function parseHead(html: string, baseUrl: string): PageMeta {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const canonicalTag = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1]
    ?? /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i.exec(html)?.[1];

  /*
   * Resolved, and then restricted to http(s).
   *
   * `og:image` is attacker-controlled on any page you save, and it ends up in
   * an `<img src>`. `javascript:` and `data:` both resolve happily through
   * `new URL`, so the protocol check is the part that matters.
   */
  const absolute = (value: string | null | undefined) => {
    if (!value) return null;
    try {
      const url = new URL(value, baseUrl);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  };

  return {
    title:
      meta(html, 'property', 'og:title') ??
      meta(html, 'name', 'twitter:title') ??
      (titleTag ? decodeEntities(titleTag).replace(/\s+/g, ' ').trim() || null : null),
    description:
      meta(html, 'property', 'og:description') ??
      meta(html, 'name', 'description') ??
      meta(html, 'name', 'twitter:description'),
    canonicalUrl: absolute(meta(html, 'property', 'og:url') ?? canonicalTag),
    imageUrl: absolute(meta(html, 'property', 'og:image') ?? meta(html, 'name', 'twitter:image')),
  };
}

/* --------------------------------------------------------------- fetching */

/**
 * Follows redirects by hand, checking the address at every hop.
 *
 * `redirect: 'follow'` would do the hops inside undici, where the guard cannot
 * see them — and the hop is exactly where an attacker puts the loopback
 * address. So each response is inspected and the next URL re-checked.
 */
export async function fetchPageMeta(
  raw: string,
  now: () => number = Date.now,
): Promise<FetchOutcome> {
  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refused = await checkUrl(target);
    if (refused) return { refused };

    let response: Response;
    try {
      response = await fetch(target, {
        redirect: 'manual',
        // No cookies, no credentials, nothing ambient. This request must not be
        // able to act as you on any site.
        credentials: 'omit',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Recall/0.1 (personal memory tool; +https://github.com/cskangGT/recall)',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        refused: /timeout|abort/i.test(detail)
          ? "That page took too long to answer."
          : "Recall couldn't reach that page.",
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { refused: "That page redirected to nowhere." };
      try {
        target = new URL(location, target).href;
      } catch {
        return { refused: 'That page redirected somewhere Recall could not follow.' };
      }
      continue;
    }

    if (!response.ok) return { refused: `That page answered ${response.status}.` };

    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(type)) {
      return { refused: 'That address is not a web page.' };
    }

    const html = await readCapped(response, MAX_HEAD_BYTES);
    void now;
    return { meta: parseHead(html, target), finalUrl: target };
  }

  return { refused: 'That page redirected too many times.' };
}

/**
 * Reads at most `limit` bytes and stops.
 *
 * The head is at the top of the document, so there is no reason to download a
 * two-megabyte page to read forty characters of it — and a cap is also what
 * stops a hostile server streaming forever into a process that holds your notes.
 */
async function readCapped(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    void reader.cancel();
  }
  return new TextDecoder('utf-8', { fatal: false })
    .decode(Buffer.concat(chunks).subarray(0, limit));
}
