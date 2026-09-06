/**
 * Reads a link before it becomes a memory.
 *
 * A pasted URL used to go straight into the corpus as a bare address — the
 * extractor read the string "https://…" and nothing else. Now the client asks
 * for a look first: the server fetches the page, hands back its title and a
 * short excerpt, and the person decides whether it belongs in their memory.
 * The same fetched text then rides into capture, so a kept link's memories
 * come from what the page says, not what its address spells.
 */

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  excerpt: string | null;
}

const MAX_BYTES = 400_000;
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

const strip = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const meta = (html: string, name: string): string | null => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
    'i',
  );
  const m = re.exec(html) ?? alt.exec(html);
  return m?.[1] ? strip(m[1]) : null;
};

export async function previewLink(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkPreview> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('not a valid address');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http(s) links can be read');
  }
  if (!hostAllowed(parsed.hostname)) {
    throw new Error('that address cannot be read from here');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html: string;
  try {
    const response = await fetchImpl(parsed.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/html,*/*;q=0.5', 'user-agent': 'Mado/1.0 (+link preview)' },
    });
    if (!response.ok) throw new Error(`the page answered ${response.status}`);
    html = (await response.text()).slice(0, MAX_BYTES);
  } finally {
    clearTimeout(timer);
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = meta(html, 'og:title') ?? (titleTag?.[1] ? strip(titleTag[1]) : null);
  const description = meta(html, 'og:description') ?? meta(html, 'description');
  const body = strip(html.replace(/<head[\s\S]*?<\/head>/i, ' '));
  const excerpt = body ? body.slice(0, 400) : null;

  return { url: parsed.href, title, description, excerpt };
}
