/**
 * Reads a link before it becomes a memory.
 *
 * A pasted URL used to go straight into the corpus as a bare address — the
 * extractor read the string "https://…" and nothing else. Now the client asks
 * for a look first: the server fetches the page, hands back its title, the
 * text of what the page is actually about, and the person decides whether it
 * belongs in their memory. The same fetched text then rides into capture, so
 * a kept link's memories come from what the page says, not what its address
 * spells.
 *
 * Two honesties this used to lack. The text is the page's main content, up to
 * a generous cap, not the first four hundred characters of whatever the body
 * starts with (which is the navigation). And when the page could not be read
 * well — it answered with an error, it is drawn by a script, it wants a login,
 * it is a PDF, or there simply is not much on it — that is said, with the
 * reason, instead of a bare "couldn't open" or worse, a memory made of nothing.
 */

export type LinkNote = 'thin' | 'app' | 'login' | 'not-html' | null;

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  /** The opening of the text, for the card. */
  excerpt: string | null;
  /** The page's main text, capped at MAX_TEXT — what rides into capture. */
  text: string | null;
  /** Characters of main text found on the page, before the cap. */
  chars: number;
  /** Whether `text` was cut at the cap. */
  truncated: boolean;
  /** Why the text may be less than the page: null when it read well. */
  note: LinkNote;
  contentType: string | null;
}

export type LinkFailure = 'invalid' | 'scheme' | 'private' | 'status' | 'timeout' | 'network';

/** A read that failed, with the reason the client can say out loud. */
export class LinkError extends Error {
  // Written out, not as parameter properties: Node's strip-only TypeScript
  // loader rejects those, and the server runs with no build step.
  readonly reason: LinkFailure;
  readonly httpStatus: number | undefined;

  constructor(message: string, reason: LinkFailure, httpStatus?: number) {
    super(message);
    this.name = 'LinkError';
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

const MAX_BYTES = 1_500_000;
/** Characters of main text handed on. Enough for a long article; short of a book. */
export const MAX_TEXT = 12_000;
/** Below this, the page as read is not the page as seen. */
const THIN_CHARS = 200;
const TIMEOUT_MS = 8_000;

/**
 * A hosted box fetching visitor-supplied URLs is an SSRF hole unless the
 * private address space is off the table. Hostname checks only — a DNS name
 * resolving privately still gets through, which is acceptable for a preview
 * endpoint that returns text to the same person who supplied the address.
 */
function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0 || a === 169) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
  }
  if (h.includes(':')) return false; // IPv6 literals: not worth the parse.
  return true;
}

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));

const dropTags = (html: string, ...tags: string[]): string =>
  tags.reduce((h, tag) => h.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' '), html);

/*
 * Block boundaries become line breaks before tags are stripped, so a list of
 * paragraphs does not arrive as one run-on sentence — the extractor reads
 * structure off whitespace, and so does the person looking at the excerpt.
 */
const BLOCK_RE = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|blockquote|section|article|pre|dd|dt|figcaption)\b[^>]*>/gi;

const toText = (html: string): string =>
  decode(html.replace(BLOCK_RE, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

const strip = (html: string): string => toText(html).replace(/\s+/g, ' ').trim();

const meta = (html: string, name: string): string | null => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
  const m = re.exec(html) ?? alt.exec(html);
  return m?.[1] ? strip(m[1]) : null;
};

const firstOf = (html: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(html);
  return m?.[1] ?? null;
};

/**
 * The page's own text: the article or main region where the page marks one,
 * else the body with its furniture (navigation, header, footer, asides) taken
 * off. Scripts, styles, and templates never count as text.
 */
export function mainText(html: string): string {
  const clean = dropTags(html, 'script', 'style', 'noscript', 'template', 'svg', 'iframe');
  const body = firstOf(clean, 'body') ?? clean.replace(/<head[\s\S]*?<\/head>/i, ' ');
  const roleMain = /<[a-z]+\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/[a-z]+\s*>/i.exec(body)?.[1] ?? null;
  const region = firstOf(body, 'article') ?? firstOf(body, 'main') ?? roleMain;
  const furnitureOff = dropTags(body, 'nav', 'header', 'footer', 'aside', 'form');
  // A marked region that is nearly empty (a shell the script fills) is not the page.
  const regionText = region ? toText(region) : '';
  const bodyText = toText(furnitureOff);
  return regionText.length >= THIN_CHARS || regionText.length >= bodyText.length / 2 ? regionText : bodyText;
}

/** Why a page that answered 200 still reads as almost nothing. */
export function noteFor(html: string, text: string, url: URL, title: string | null): LinkNote {
  if (text.length >= THIN_CHARS) return null;
  const path = url.pathname.toLowerCase();
  const head = (title ?? '').toLowerCase();
  if (/log ?in|sign ?in|로그인/.test(head) || /\/(login|signin|sign-in|auth|account\/login)\b/.test(path)) return 'login';
  const shell = /<noscript\b[^>]*>[\s\S]*?(javascript|자바스크립트)[\s\S]*?<\/noscript>/i.test(html)
    || /<(?:div|main)\b[^>]*\bid=["'](?:root|app|__next|__nuxt|main-app)["'][^>]*>\s*<\/(?:div|main)>/i.test(html);
  if (shell) return 'app';
  return 'thin';
}

export async function previewLink(url: string, fetchImpl: typeof fetch = fetch): Promise<LinkPreview> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LinkError('not a valid address', 'invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new LinkError('only http(s) links can be read', 'scheme');
  }
  if (!hostAllowed(parsed.hostname)) {
    throw new LinkError('that address cannot be read from here', 'private');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html: string;
  let contentType: string | null = null;
  let finalUrl = parsed;
  try {
    let response: Response;
    try {
      response = await fetchImpl(parsed.href, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.5', 'user-agent': 'Mado/1.0 (+link preview)' },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new LinkError('the page took too long to answer', 'timeout');
      throw new LinkError('could not reach the page', 'network');
    }
    if (!response.ok) throw new LinkError(`the page answered ${response.status}`, 'status', response.status);
    contentType = response.headers?.get?.('content-type')?.split(';')[0]?.trim().toLowerCase() || null;
    try {
      finalUrl = new URL(response.url || parsed.href);
    } catch {
      finalUrl = parsed;
    }
    // Not a page: a PDF, an image, a file. There is no text to read here — say so
    // rather than hand the extractor a binary's first bytes.
    if (contentType && !/^(text\/html|application\/xhtml\+xml|text\/plain)$/.test(contentType)) {
      return { url: parsed.href, title: null, description: null, excerpt: null, text: null, chars: 0, truncated: false, note: 'not-html', contentType };
    }
    html = (await response.text()).slice(0, MAX_BYTES);
  } finally {
    clearTimeout(timer);
  }

  if (contentType === 'text/plain') {
    const text = html.trim();
    return {
      url: parsed.href,
      title: null,
      description: null,
      excerpt: text ? text.slice(0, 400) : null,
      text: text ? text.slice(0, MAX_TEXT) : null,
      chars: text.length,
      truncated: text.length > MAX_TEXT,
      note: text.length < THIN_CHARS ? 'thin' : null,
      contentType,
    };
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = meta(html, 'og:title') ?? (titleTag?.[1] ? strip(titleTag[1]) : null);
  const description = meta(html, 'og:description') ?? meta(html, 'description');
  const full = mainText(html);
  const text = full ? full.slice(0, MAX_TEXT) : null;
  const excerpt = full ? full.replace(/\s+/g, ' ').slice(0, 400) : null;

  return {
    url: parsed.href,
    title,
    description,
    excerpt,
    text,
    chars: full.length,
    truncated: full.length > MAX_TEXT,
    note: noteFor(html, full, finalUrl, title),
    contentType,
  };
}
