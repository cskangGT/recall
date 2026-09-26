import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Keeps an uploaded capture file on disk, beside the database, and returns
 * the path the pipeline reads (provider.normalize loads it from disk, so a
 * photo written alongside a thought goes through the same vision call a
 * dropped screenshot does).
 *
 * A PDF rides the same road: it is kept here, and normalize hands it to the
 * model as a document. The extension is how every later step tells the two
 * apart — see `isPdfPath`.
 */

const TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const MAX_BYTES = 6_000_000;
/** A PDF is pages, not pixels; the providers take far more, the request body is the limit. */
const MAX_PDF_BYTES = 10_000_000;

export const isPdfPath = (file: string | null | undefined): boolean =>
  typeof file === 'string' && file.toLowerCase().endsWith('.pdf');

export function imageSaver(dir: string): (dataUrl: string) => Promise<string> {
  return async (dataUrl) => {
    const m = /^data:(image\/[a-z+]+|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    const ext = m && TYPES[m[1]!];
    if (!m || !ext) throw new Error('files arrive as a png, jpeg, webp, gif or pdf data URL');
    const bytes = Buffer.from(m[2]!, 'base64');
    if (bytes.length === 0) throw new Error('the file was empty');
    if (ext === '.pdf') {
      if (bytes.length > MAX_PDF_BYTES) throw new Error('PDFs can be at most 10MB');
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('that is not a PDF');
    } else if (bytes.length > MAX_BYTES) {
      throw new Error('images can be at most 6MB');
    }
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${ext === '.pdf' ? 'doc' : 'img'}_${randomUUID().replace(/-/g, '').slice(0, 16)}${ext}`);
    await writeFile(file, bytes);
    return file;
  };
}
