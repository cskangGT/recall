import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  IMAGE_TYPES, MAX_IMAGE_BYTES, isInsideRoot, saveImage, validateImage,
} from '../../server/storage/images';

/**
 * A screenshot is the first thing this server takes bytes for, so it is the
 * first place a request body can name a location. It does not get to.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'recall-img-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// A 1x1 PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('what counts as an image', () => {
  it('accepts the four types both vision APIs read', () => {
    for (const mediaType of Object.keys(IMAGE_TYPES)) {
      expect(validateImage({ data: PNG, mediaType })).toEqual({
        image: { data: PNG, mediaType },
      });
    }
  });

  it('refuses anything else, naming what it would have taken', () => {
    const result = validateImage({ data: PNG, mediaType: 'image/svg+xml' });
    expect('error' in result && result.error).toMatch(/png, jpeg, gif or webp/);
  });

  it('refuses a shape that is not an image at all', () => {
    for (const value of [null, undefined, 'a string', {}, { data: PNG }, { mediaType: 'image/png' }]) {
      expect(validateImage(value)).toHaveProperty('error');
    }
  });

  it('rejects an oversized payload by its length, before decoding it', () => {
    // The point of a limit on a server anything on this machine can post to is
    // that it never materialises the thing it is refusing.
    const tooBig = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1024) * 4 / 3));
    const result = validateImage({ data: tooBig, mediaType: 'image/png' });
    expect('error' in result && result.error).toMatch(/too large/);
  });
});

describe('saving', () => {
  it('writes the bytes and names the file after the source, not the client', () => {
    const { path: file, bytes } = saveImage(root, 'src_abc123', { data: PNG, mediaType: 'image/png' });
    expect(path.basename(file)).toBe('src_abc123.png');
    expect(path.dirname(file)).toBe(root);
    expect(bytes).toBe(Buffer.from(PNG, 'base64').length);
    expect(readFileSync(file)).toEqual(Buffer.from(PNG, 'base64'));
  });

  it('creates the directory rather than failing on a fresh install', () => {
    const nested = path.join(root, 'a', 'b');
    expect(existsSync(nested)).toBe(false);
    saveImage(nested, 'src_1', { data: PNG, mediaType: 'image/png' });
    expect(existsSync(path.join(nested, 'src_1.png'))).toBe(true);
  });

  it('gives each media type its own extension, because serving reads it back', () => {
    expect(path.extname(saveImage(root, 's1', { data: PNG, mediaType: 'image/jpeg' }).path)).toBe('.jpg');
    expect(path.extname(saveImage(root, 's2', { data: PNG, mediaType: 'image/webp' }).path)).toBe('.webp');
  });
});

describe('containment, for the serving route', () => {
  it('accepts a file the root owns', () => {
    expect(isInsideRoot(root, path.join(root, 'src_1.png'))).toBe(true);
  });

  it('refuses a traversal out of it', () => {
    expect(isInsideRoot(root, path.join(root, '..', '..', '.ssh', 'id_rsa'))).toBe(false);
  });

  it('refuses a sibling directory whose name merely starts the same', () => {
    // `startsWith(root)` without the separator would accept `/tmp/recall-img-1-evil`.
    expect(isInsideRoot(root, `${root}-evil/secret.png`)).toBe(false);
  });

  it('refuses the root itself, which is a directory and not an image', () => {
    expect(isInsideRoot(root, root)).toBe(false);
  });

  it('refuses an absolute path somewhere else entirely', () => {
    expect(isInsideRoot(root, '/etc/passwd')).toBe(false);
    expect(isInsideRoot(root, '/seed/demo-screenshot.png')).toBe(false);
  });
});
