import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Keeps an uploaded capture image on disk, beside the database, and returns
 * the path the pipeline reads (provider.normalize loads imagePath from disk,
 * so a photo written alongside a thought goes through the same vision call a
 * dropped screenshot does).
 */

const TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_BYTES = 6_000_000;

export function imageSaver(dir: string): (dataUrl: string) => Promise<string> {
  return async (dataUrl) => {
    const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    const ext = m && TYPES[m[1]!];
    if (!m || !ext) throw new Error('images arrive as a png, jpeg, webp, or gif data URL');
    const bytes = Buffer.from(m[2]!, 'base64');
    if (bytes.length === 0) throw new Error('the image was empty');
    if (bytes.length > MAX_BYTES) throw new Error('images can be at most 6MB');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `img_${randomUUID().replace(/-/g, '').slice(0, 16)}${ext}`);
    await writeFile(file, bytes);
    return file;
  };
}
