/**
 * A dropped or pasted file, turned into something the server can take.
 *
 * The capture bar used to set a boolean when it saw an image on the clipboard
 * and then send the path of a demo asset that is not even in the repository —
 * so "paste a screenshot" ingested the same fictional item every time, and
 * dropping a file read nothing at all. This is the part that was missing.
 *
 * **It downscales before sending, and that is the interesting decision.** A
 * retina screenshot is 5120px wide and several megabytes; the vision models do
 * not see more for it. Anthropic's guidance is that the long edge past ~1568px
 * buys nothing, so a full-resolution upload costs seconds of transfer and a
 * multiple of the tokens to read exactly the same text. Downscaling first turns
 * a 5MB capture into a few hundred kilobytes, keeps it inside the request body
 * limit without raising it, and leaves OCR quality where it was.
 *
 * PNG rather than JPEG on the way out: the subject is a screenshot, and JPEG
 * puts ringing around small text, which is the one thing being read.
 */

/** The longest edge we send. Past this the model reads no more than it already did. */
export const MAX_EDGE = 1568;

/** What both vision APIs accept. Anything else is refused before it is read. */
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * 20MB *before* downscaling.
 *
 * Generous, because this is a local tool and the file is about to get much
 * smaller. It exists so that dropping a video or a disk image fails as a
 * sentence rather than as a tab that stops responding while it decodes.
 */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export interface InlineImage {
  data: string;
  mediaType: string;
}

export type ReadImageResult = { image: InlineImage } | { error: string };

/** Dimensions after fitting the long edge to `MAX_EDGE`, preserving the ratio. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  // Rounded, and never to zero: a 4000x3 banner must not become 1568x0.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The first image on a clipboard or a drop, or null if there is not one. */
export function firstImageFile(items: readonly File[]): File | null {
  return items.find((f) => f.type.startsWith('image/')) ?? null;
}

export function checkFile(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) {
    return `Recall reads PNG, JPEG, GIF and WebP — not ${file.type || 'that'}.`;
  }
  if (file.size > MAX_SOURCE_BYTES) return 'That image is too large for Recall to read.';
  return null;
}

/**
 * Decode, downscale, re-encode. Browser-only — it needs a canvas.
 *
 * `createImageBitmap` rather than an `<img>` and a load event: it decodes off
 * the main thread, so a large screenshot does not freeze the frame the user is
 * looking at while they wait to see their own thumbnail.
 */
export async function readImage(file: File): Promise<ReadImageResult> {
  const rejected = checkFile(file);
  if (rejected) return { error: rejected };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: "That file looks like an image but couldn't be read." };
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { error: "This browser wouldn't give Recall a canvas to resize with." };
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return { error: "Couldn't encode that image." };
  return { image: { data: dataUrl.slice(comma + 1), mediaType: 'image/png' } };
}
