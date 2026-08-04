import type { BatchItem } from './batch';

/**
 * Instagram "Export your information" ZIP → batch items.
 *
 * There is no official API for a user's saved posts, so the import path is the
 * export Meta itself provides: Accounts Center → Export your information, JSON
 * format. Somewhere inside is `saved/saved_posts.json`, and this file reads it.
 *
 * Two honesty notes, both load-bearing:
 *
 * - **The schema is folklore.** Meta documents that the export exists, not what
 *   is in it, and the shape has changed before. The parser is deliberately
 *   tolerant — it walks for the fields (author, href, timestamp) rather than
 *   trusting a fixed layout — and everything it cannot read it counts and
 *   reports rather than throwing. Validate against real exports before trusting
 *   it further (docs task; a synthetic fixture is what the tests pin).
 * - **The export carries no captions or thumbnails** — author, link, saved-at
 *   is the whole record. Enrichment (reading the post as the logged-in user)
 *   belongs to the browser extension, the same place page saves already live.
 *
 * Only the most recent window is imported (14 days by default — the product's
 * free window). A year of saves in one drop is a worse first reveal than a
 * fortnight: the batch pipeline is serial, and the reveal reads best at a
 * glanceable size. The rest stays in the ZIP, and the caller says so.
 */

export interface InstagramImport {
  /** One batch item per saved post inside the window, newest first. */
  items: BatchItem[];
  /** Saved posts parsed out of the export, any age. */
  total: number;
  /** Posts older than the window, left unimported. */
  older: number;
  /** Entries the parser could not read a link out of. */
  unreadable: number;
}

export const IMPORT_WINDOW_DAYS = 14;

const SAVED_POSTS_PATH = /(^|\/)saved(_posts)?\/.*saved_posts\.json$|(^|\/)saved_posts\.json$/i;

export async function parseInstagramZip(
  data: ArrayBuffer,
  windowDays: number = IMPORT_WINDOW_DAYS,
): Promise<InstagramImport> {
  const entry = await extractZipEntry(data, (name) => SAVED_POSTS_PATH.test(name));
  if (!entry) {
    throw new Error(
      "no saved_posts.json in this export — was 'Saved' included when you requested it?",
    );
  }

  const posts = parseSavedPosts(new TextDecoder().decode(entry));
  const readable = posts.filter((p) => p.url !== null);

  // Anchored to the newest save, like the free window is anchored to the newest
  // memory: an export requested last month should still import its last two
  // weeks of activity, not zero days of ours.
  const newest = readable.reduce((max, p) => Math.max(max, p.savedAt ?? 0), 0);
  const cutoff = newest - windowDays * 864e5;
  const within = readable
    .filter((p) => (p.savedAt ?? newest) >= cutoff)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

  return {
    items: within.map((p) => {
      const when =
        p.savedAt !== null ? new Date(p.savedAt).toISOString().slice(0, 10) : 'an unknown date';
      const author = p.author || 'an unknown account';
      return {
        title: `@${author} on Instagram`,
        // One claim per post, shaped to pass the local extractor (≥5 words,
        // not URL-only). The extension's enrichment can replace it later.
        content: `Saved an Instagram post by @${author} on ${when} — ${p.url}`,
      };
    }),
    total: posts.length,
    older: readable.length - within.length,
    unreadable: posts.length - readable.length,
  };
}

// ---------------------------------------------------------------- saved_posts

interface SavedPost {
  author: string;
  url: string | null;
  /** Epoch millis, null when the export carried no timestamp. */
  savedAt: number | null;
}

/**
 * Reads whatever array of entries the JSON holds. Known shapes:
 *
 *   { "saved_saved_media": [ { "title": "author",
 *       "string_map_data": { "Saved on": { "href": "…", "timestamp": 169… } } } ] }
 *
 * and the `string_list_data: [{ href, timestamp }]` variant other export files
 * use. Anything else: the first array of objects found at the top level.
 */
export function parseSavedPosts(json: string): SavedPost[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    throw new Error('saved_posts.json is not valid JSON');
  }

  const entries = Array.isArray(root)
    ? root
    : typeof root === 'object' && root !== null
      ? (Object.values(root).find((v) => Array.isArray(v)) as unknown[] | undefined)
      : undefined;
  if (!entries) return [];

  return entries
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((entry) => {
      const author = typeof entry.title === 'string' ? entry.title : '';
      let url: string | null = null;
      let savedAt: number | null = null;

      // Walk every nested record for the first href and timestamp — field
      // names and nesting vary between export vintages; the fields do not.
      const walk = (value: unknown): void => {
        if (url !== null && savedAt !== null) return;
        if (Array.isArray(value)) {
          for (const v of value) walk(v);
          return;
        }
        if (typeof value !== 'object' || value === null) return;
        const record = value as Record<string, unknown>;
        if (url === null && typeof record.href === 'string' && /^https?:\/\//.test(record.href)) {
          url = record.href;
        }
        if (savedAt === null && typeof record.timestamp === 'number' && record.timestamp > 0) {
          // Export timestamps are epoch seconds.
          savedAt = record.timestamp * 1000;
        }
        for (const v of Object.values(record)) walk(v);
      };
      walk(entry);

      return { author, url, savedAt };
    });
}

// ---------------------------------------------------------------- zip reading

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Finds one entry by name and inflates it. Central-directory walk, methods 0
 * (stored) and 8 (deflate, via the browser's own DecompressionStream) — which
 * is every entry a Meta export contains. No dependency, because the app has
 * none and one ZIP file is not the reason to start.
 */
async function extractZipEntry(
  buf: ArrayBuffer,
  match: (name: string) => boolean,
): Promise<Uint8Array | null> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // EOCD: scan backwards through the trailing comment's possible 64KB.
  let eocd = -1;
  const floor = Math.max(0, buf.byteLength - 65558);
  for (let i = buf.byteLength - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP file');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff || count === 0xffff) {
    // ZIP64 — a media-heavy export can get there. Say so rather than misread it.
    throw new Error('this export is too large to read here — re-export without photos and videos');
  }

  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG) throw new Error('corrupt ZIP directory');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (match(name)) {
      if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error('corrupt ZIP entry');
      // The local header repeats the lengths; trust its own copy for the offset.
      const localName = view.getUint16(localOffset + 26, true);
      const localExtra = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localName + localExtra;
      const compressed = bytes.subarray(start, start + compressedSize);

      if (method === 0) return compressed;
      if (method === 8) return inflateRaw(compressed);
      throw new Error(`unsupported compression method ${method}`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  // Fed and read by hand rather than through Blob/Response — jsdom, which the
  // unit suite runs in, implements neither, and the loop is the same four lines.
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // The copy pins the view to a plain ArrayBuffer — `subarray` carries its
  // parent's ArrayBufferLike type, which BufferSource refuses.
  const writing = writer.write(new Uint8Array(compressed)).then(() => writer.close());

  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  await writing;

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}
