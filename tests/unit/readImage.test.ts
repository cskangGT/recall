import { describe, it, expect } from 'vitest';
import {
  ACCEPTED, MAX_EDGE, MAX_SOURCE_BYTES, checkFile, firstImageFile, fitWithin,
} from '../../src/capture/readImage';

/**
 * The decisions that happen before a byte is sent.
 *
 * `readImage` itself needs `createImageBitmap` and a canvas, so it is exercised
 * in `tests/e2e/screenshot.spec.ts` against a real browser. Everything it
 * decides *with* is here.
 */

const file = (type: string, size = 1000, name = 'shot.png') =>
  ({ type, size, name }) as unknown as File;

describe('downscaling', () => {
  it('leaves anything already small alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_EDGE, 900)).toEqual({ width: MAX_EDGE, height: 900 });
  });

  it('fits the long edge and keeps the aspect ratio', () => {
    // A retina screenshot. The model reads no more from the extra pixels, and
    // they cost seconds of transfer and a multiple of the tokens.
    const { width, height } = fitWithin(5120, 2880);
    expect(width).toBe(MAX_EDGE);
    expect(Math.abs(width / height - 5120 / 2880)).toBeLessThan(0.01);
  });

  it('fits by height when the image is tall', () => {
    const { width, height } = fitWithin(1000, 4000);
    expect(height).toBe(MAX_EDGE);
    expect(width).toBe(392);
  });

  it('never rounds an edge down to zero', () => {
    // A 4000x3 banner would otherwise become 1568x0, and a canvas of zero
    // height encodes to nothing at all.
    const { width, height } = fitWithin(4000, 3);
    expect(width).toBe(MAX_EDGE);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('does not divide by zero on a degenerate image', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('what Recall will read', () => {
  it('takes the four types both vision APIs accept', () => {
    for (const type of ACCEPTED) expect(checkFile(file(type))).toBeNull();
  });

  it('refuses anything else, and names what it got', () => {
    expect(checkFile(file('application/pdf'))).toMatch(/not application\/pdf/);
    expect(checkFile(file('image/svg+xml'))).toMatch(/PNG, JPEG, GIF and WebP/);
  });

  it('has something to say about a file with no type at all', () => {
    expect(checkFile(file(''))).toMatch(/not that/);
  });

  it('refuses a file too large to decode without freezing the tab', () => {
    expect(checkFile(file('image/png', MAX_SOURCE_BYTES + 1))).toMatch(/too large/);
  });
});

describe('picking the file out of a drop', () => {
  it('takes the first image and ignores what came with it', () => {
    const picked = firstImageFile([
      file('text/plain', 10, 'notes.txt'),
      file('image/png', 10, 'shot.png'),
      file('image/jpeg', 10, 'other.jpg'),
    ]);
    expect(picked?.name).toBe('shot.png');
  });

  it('returns null when nothing dropped was an image', () => {
    // The drop overlay promises Recall will read it; when it cannot, the caller
    // has to be able to say so rather than saving something else.
    expect(firstImageFile([file('application/pdf', 10, 'paper.pdf')])).toBeNull();
    expect(firstImageFile([])).toBeNull();
  });
});
