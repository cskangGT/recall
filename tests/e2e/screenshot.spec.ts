import { test, expect } from '@playwright/test';
import { fitWithin, MAX_EDGE } from '../../src/capture/readImage';

/**
 * `readImage` needs `createImageBitmap` and a canvas, so this is the only place
 * it can run. The pure decisions around it are in `tests/unit/readImage.test.ts`.
 *
 * What this proves is the thing that was broken for the whole life of the
 * project: the bytes on the clipboard actually become the bytes that get sent.
 * Before it, pasting an image set a boolean and shipped the path of a demo file
 * that is not in the repository.
 */

/** Draws a PNG of the given size in the page and returns it as a File. */
const makeFile = `
  (w, h, type) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, Math.floor(w / 2), Math.floor(h / 2));
    return new Promise((resolve) => c.toBlob((b) => resolve(new File([b], 'shot.png', { type })), type));
  }
`;

test('a pasted screenshot becomes real bytes, downscaled', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  const result = await page.evaluate(
    async ([fn, mod]) => {
      const file = await (0, eval)(`(${fn})`)(2400, 1200, 'image/png');
      const { readImage } = await import(mod as string);
      return readImage(file);
    },
    [makeFile, '/src/capture/readImage.ts'],
  );

  expect(result).toHaveProperty('image');
  const image = (result as { image: { data: string; mediaType: string } }).image;
  expect(image.mediaType).toBe('image/png');
  expect(image.data.length).toBeGreaterThan(0);
  // Base64 decodes cleanly and is a PNG — the magic bytes, so this is an image
  // and not a string that merely survived a round trip.
  const head = Buffer.from(image.data.slice(0, 16), 'base64');
  expect([...head.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  // And it was actually resized: 2400 wide in, MAX_EDGE out.
  const size = await page.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const bmp = await createImageBitmap(blob);
    return { width: bmp.width, height: bmp.height };
  }, image.data);
  expect(size).toEqual(fitWithin(2400, 1200));
  expect(size.width).toBe(MAX_EDGE);
});

test('a small screenshot is left at its own size', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  const size = await page.evaluate(
    async ([fn, mod]) => {
      const file = await (0, eval)(`(${fn})`)(640, 480, 'image/png');
      const { readImage } = await import(mod as string);
      const out = await readImage(file);
      const blob = await (await fetch(`data:image/png;base64,${out.image.data}`)).blob();
      const bmp = await createImageBitmap(blob);
      return { width: bmp.width, height: bmp.height };
    },
    [makeFile, '/src/capture/readImage.ts'],
  );
  expect(size).toEqual({ width: 640, height: 480 });
});

test('dropping an image opens the capture bar with it attached', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('capture-bar')).toHaveCount(0);

  // A drop, built in the page because DataTransfer cannot cross the bridge.
  await page.evaluate(async (fn) => {
    const file = await (0, eval)(`(${fn})`)(800, 600, 'image/png');
    const dt = new DataTransfer();
    dt.items.add(file);
    document
      .querySelector('[data-testid="shell"], #root > *')!
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, makeFile);

  // Spec AC-5: the bar opens *with the image attached*, because a screenshot
  // usually wants a sentence of context beside it.
  await expect(page.getByTestId('capture-bar')).toBeVisible();
  const thumb = page.getByTestId('capture-image').locator('img');
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute('src', /^data:image\/png;base64,/);
});

test('dropping something that is not an image says so and saves nothing', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
    document
      .querySelector('[data-testid="shell"], #root > *')!
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });

  // The overlay promises "Recall will read it". When it cannot, it has to say
  // so — this used to silently ingest a demo screenshot instead.
  await expect(page.getByText(/Recall reads images/)).toBeVisible();
  await expect(page.getByTestId('capture-bar')).toHaveCount(0);
});

test('the attached image can be taken off again', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await page.evaluate(async (fn) => {
    const file = await (0, eval)(`(${fn})`)(400, 300, 'image/png');
    const dt = new DataTransfer();
    dt.items.add(file);
    document
      .querySelector('[data-testid="shell"], #root > *')!
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, makeFile);

  await expect(page.getByTestId('capture-image')).toBeVisible();
  await page.getByTestId('capture-image-remove').click();
  await expect(page.getByTestId('capture-image')).toHaveCount(0);
});
