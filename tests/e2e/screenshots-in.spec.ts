import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A screenshot is the file people hand over most, and every natural way of
 * handing it over used to be shut: the picker greyed it out, and a drop was
 * called unreadable. One picture now lands in the add bar with room for
 * words beside it; a PDF is named honestly rather than called unreadable.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('a picked screenshot lands in the add bar, ready for words beside it', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-home').click();
  await page.getByTestId('door-fill').click();
  await page
    .getByTestId('door-fill-input')
    .setInputFiles({ name: 'Screenshot 2026-09-19.png', mimeType: 'image/png', buffer: PNG });

  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await expect(page.getByTestId('capture-photo')).toBeVisible();
});

test('against a live server, a dropped screenshot is kept — not refused', async ({ page }) => {
  const seed = readFileSync(path.join(process.cwd(), 'seed/workspace.json'), 'utf8');
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: { error: 'not mocked' } }));
  await page.route('**/api/capabilities', (r) =>
    r.fulfill({ json: { appleNotes: false, notion: false, condense: false, google: false } }),
  );
  await page.route('**/api/workspaces/*/graph', (r) => r.fulfill({ contentType: 'application/json', body: seed }));
  await page.goto('/?api=1&skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  const drop = (name: string, type: string) =>
    page.evaluate(
      ({ name, type, b64 }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name, { type }));
        document.querySelector('.shell')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      },
      { name, type, b64: PNG.toString('base64') },
    );

  await drop('shot.png', 'image/png');
  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await expect(page.getByTestId('capture-photo')).toBeVisible();
  await page.keyboard.press('Escape');

  // A PDF is not read yet — and the toast says that, not "unreadable".
  await drop('deck.pdf', 'application/pdf');
  await expect(page.getByTestId('toast').last()).toContainText("PDFs can't be read yet");
});
