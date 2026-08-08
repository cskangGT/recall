import type { BatchItem } from './batch';

/**
 * Instagram "Export your information" ZIP → batch items.
 *
 * There is no official API for a user's saved posts, so the import path is the
 * export Meta itself provides: Accounts Center → Export your information, JSON
 * format. Inside are `saved/saved_posts.json` and `saved/saved_collections.json`.
 *
 * Measured against a real export (2026-08), not folklore:
 *
 * - **Captions are in there.** Each entry is `{ timestamp, label_values }`
 *   where the labels carry the post URL and the full caption text — the one
 *   field the whole import turns on, and the one the folklore said was absent.
 *   A carousel repeats the label; `Title` exists but is always empty (there is
 *   no author in the export).
 * - **Non-ASCII arrives mojibake.** The JSON holds UTF-8 bytes that were
 *   escaped as Latin-1 code points — 한글 reads as `ì ëê°` until the bytes
 *   are re-decoded. `decodeMojibake` reverses exactly that, and nothing else.
 * - **Collections are the user's own taxonomy.** `saved_collections.json`
 *   names each collection and lists its posts; the name rides into the batch
 *   item so categorization can hear it.
 *
 * The parser stays tolerant of the older folklore shapes (`string_map_data`,
 * `string_list_data`) — an export from a different vintage should degrade to
 * fewer fields, not to a throw.
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
  /** Collections found in the export, by name. */
  collections: string[];
  /** The date range of the imported window, when any post carried a date. */
  period: { from: string; to: string } | null;
}

export const IMPORT_WINDOW_DAYS = 14;

const SAVED_POSTS_PATH = /(^|\/)saved(_posts)?\/.*saved_posts\.json$|(^|\/)saved_posts\.json$/i;
const COLLECTIONS_PATH = /(^|\/)saved_collections\.json$/i;

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

  // Collections are optional — an account that never made one has no file.
  let collectionOf = new Map<string, string>();
  let collectionNames: string[] = [];
  const collectionsEntry = await extractZipEntry(data, (name) => COLLECTIONS_PATH.test(name));
  if (collectionsEntry) {
    const parsed = parseCollections(new TextDecoder().decode(collectionsEntry));
    collectionOf = parsed.byUrl;
    collectionNames = parsed.names;
  }

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
      const collection = p.url ? collectionOf.get(p.url) : undefined;

      /*
       * The caption is the content — it is what the person actually saved.
       * The collection name and link ride along as context lines: the model
       * hears "the user filed this under 맛집" and the source keeps its way
       * back to the post. A post with no caption still imports; it just has
       * only its metadata to say.
       */
      const lines = [
        p.caption ?? `Saved an Instagram post on ${when}.`,
        collection ? `Saved to the "${collection}" collection on Instagram.` : null,
        `${p.url}`,
      ].filter((l): l is string => l !== null);

      const firstLine = (p.caption ?? '').split('\n')[0]?.trim() ?? '';
      return {
        title: firstLine.length > 0 ? firstLine.slice(0, 60) : `Instagram · ${when}`,
        content: lines.join('\n\n'),
      };
    }),
    total: posts.length,
    older: readable.length - within.length,
    unreadable: posts.length - readable.length,
    collections: collectionNames,
    period: (() => {
      const dated = within.map((p) => p.savedAt).filter((t): t is number => t !== null);
      if (dated.length === 0) return null;
      const day = (t: number) => new Date(t).toISOString().slice(0, 10);
      return { from: day(Math.min(...dated)), to: day(Math.max(...dated)) };
    })(),
  };
}

// ---------------------------------------------------------------- mojibake

/**
 * Reverses the export's Latin-1 mojibake, and only that.
 *
 * Every character being ≤ U+00FF means the string is really a byte sequence;
 * a UTF-8 lead byte among them means those bytes spell UTF-8. Decoded text
 * that contains no replacement character is accepted; anything else keeps the
 * original, so a genuinely Latin-1 caption ("café") survives untouched unless
 * it decodes cleanly — which plain Latin-1 prose does not.
 */
export function decodeMojibake(s: string): string {
  if (s.length === 0) return s;
  let hasLead = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s; // real text already — not bytes
    if (c >= 0xc2 && c <= 0xf4) hasLead = true;
  }
  if (!hasLead) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return decoded.includes('�') ? s : decoded;
}

// ---------------------------------------------------------------- saved_posts

interface SavedPost {
  /** Full caption text, decoded; null when the entry carried none. */
  caption: string | null;
  url: string | null;
  /** Epoch millis, null when the export carried no timestamp. */
  savedAt: number | null;
}

/** The `label_values` of an entry, flattened — nesting varies, labels do not. */
function collectLabels(value: unknown, out: { label: string; value: string }[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectLabels(v, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record.label === 'string') {
    const text = typeof record.href === 'string' ? record.href : record.value;
    if (typeof text === 'string') out.push({ label: record.label, value: text });
  }
  for (const v of Object.values(record)) collectLabels(v, out);
}

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
      const labels: { label: string; value: string }[] = [];
      collectLabels(entry, labels);

      const url =
        labels.find((l) => /^https?:\/\//.test(l.value) && /url/i.test(l.label))?.value ??
        // Folklore shapes carry the link as a bare href with no label.
        firstHref(entry);

      // A carousel repeats the caption label; keep each distinct part once.
      const captions = [
        ...new Set(
          labels
            .filter((l) => l.label === 'Caption')
            .map((l) => decodeMojibake(l.value).trim())
            .filter((c) => c.length > 0),
        ),
      ];

      // The entry's own timestamp is the save time (epoch seconds); folklore
      // shapes nest it, so fall back to the first one found anywhere.
      const seconds =
        typeof entry.timestamp === 'number' && entry.timestamp > 0
          ? entry.timestamp
          : firstTimestamp(entry);

      return {
        caption: captions.length > 0 ? captions.join('\n\n') : null,
        url,
        savedAt: seconds !== null ? seconds * 1000 : null,
      };
    });
}

function firstHref(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = firstHref(v);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.href === 'string' && /^https?:\/\//.test(record.href)) return record.href;
  for (const v of Object.values(record)) {
    const found = firstHref(v);
    if (found) return found;
  }
  return null;
}

function firstTimestamp(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = firstTimestamp(v);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.timestamp === 'number' && record.timestamp > 0) return record.timestamp;
  for (const v of Object.values(record)) {
    const found = firstTimestamp(v);
    if (found !== null) return found;
  }
  return null;
}

// ---------------------------------------------------------------- collections

/**
 * `saved_collections.json`: each entry is one collection — a `Name` label and
 * a nested list of the posts in it. What the import needs is the reverse map:
 * which collection a post URL belongs to. First name wins when a post sits in
 * two collections; a deliberate simplification, since a memory holds exactly
 * one category anyway (spec 8.5).
 */
export function parseCollections(json: string): { byUrl: Map<string, string>; names: string[] } {
  const byUrl = new Map<string, string>();
  const names: string[] = [];

  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return { byUrl, names };
  }
  const entries = Array.isArray(root)
    ? root
    : typeof root === 'object' && root !== null
      ? (Object.values(root).find((v) => Array.isArray(v)) as unknown[] | undefined)
      : undefined;
  if (!entries) return { byUrl, names };

  for (const entry of entries) {
    const labels: { label: string; value: string }[] = [];
    collectLabels(entry, labels);
    const name = decodeMojibake(labels.find((l) => l.label === 'Name')?.value ?? '').trim();
    if (name.length === 0) continue;
    names.push(name);
    for (const l of labels) {
      if (/^https?:\/\//.test(l.value) && !byUrl.has(l.value)) byUrl.set(l.value, name);
    }
  }
  return { byUrl, names };
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
