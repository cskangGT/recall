import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Where a captured screenshot goes.
 *
 * On disk beside the database, not inside it. `getGraphPayload` returns every
 * row of every table to the client on every load, so a blob column would put
 * the bytes of every screenshot you have ever saved into every page load. A
 * path is 40 characters.
 *
 * Beside the database rather than in the checkout, for the reason `start.mjs`
 * already gives about the database itself: a checkout is a directory you might
 * delete or re-clone, and a screenshot you saved is not.
 *
 * **The filename is derived from the source id, never from the client.** The
 * old `imagePath` field was a string taken straight from the request body and
 * handed to `fs.readFile` — with the server now running all day, that was a
 * read primitive for any image file on the machine, shipped to a model. The
 * client no longer names anything; it sends bytes and a media type, and the
 * name comes from a row we just wrote.
 */

/** What the vision APIs accept — the intersection of both providers' MIME maps. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/**
 * 8MB of decoded image.
 *
 * The client downscales to 1568px on the longest edge before sending, which puts
 * an ordinary screenshot well under a megabyte — so this is not a working limit,
 * it is the backstop for something that skipped the client path. Anthropic and
 * OpenAI both reject images well above this, so accepting more would only mean
 * storing a file the model refuses to read.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface InlineImage {
  /** Base64, no data: prefix. */
  data: string;
  mediaType: string;
}

export interface SavedImage {
  path: string;
  bytes: number;
}

/** Null when the value is not an image we can store, with the reason for a 400. */
export function validateImage(value: unknown): { image: InlineImage } | { error: string } {
  const v = value as Partial<InlineImage> | null;
  if (!v || typeof v.data !== 'string' || typeof v.mediaType !== 'string') {
    return { error: 'image must be { data, mediaType }' };
  }
  if (!IMAGE_TYPES[v.mediaType]) {
    return { error: `unsupported image type ${v.mediaType} — png, jpeg, gif or webp` };
  }
  /*
   * Length before decoding. Base64 is 4 characters per 3 bytes, so this rejects
   * an oversized payload without first materialising it in memory — which is
   * the whole point of a limit on a server anyone on the machine can post to.
   */
  if (Math.floor((v.data.length * 3) / 4) > MAX_IMAGE_BYTES) {
    return { error: 'that image is too large — Recall stores up to 8MB' };
  }
  return { image: { data: v.data, mediaType: v.mediaType } };
}

/**
 * Writes the image and returns where it went.
 *
 * Synchronous on purpose: `ingest` persists the source row before any model
 * call so a capture is never lost, and the row records the path. If the write
 * and the row could drift apart, a screenshot would be half-saved — a row
 * pointing at nothing, which is worse than an error.
 */
export function saveImage(root: string, sourceId: string, image: InlineImage): SavedImage {
  const ext = IMAGE_TYPES[image.mediaType];
  if (!ext) throw new Error(`unsupported image type ${image.mediaType}`);

  const bytes = Buffer.from(image.data, 'base64');
  mkdirSync(root, { recursive: true });
  const file = path.join(root, `${sourceId}${ext}`);
  writeFileSync(file, bytes);
  return { path: file, bytes: bytes.length };
}

/**
 * True when `candidate` is a file this workspace's image directory owns.
 *
 * The seed's `image_path` points at a demo asset outside this root, and reading
 * that is fine — it is committed, and the fixture provider matches on the string
 * without touching the disk. What this guards is the serving route: an
 * `image_path` that somehow became an arbitrary filesystem path must not turn
 * the API into a file server for the home directory.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved.startsWith(resolvedRoot + path.sep);
}
