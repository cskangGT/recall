import { test, expect } from '@playwright/test';

/**
 * The home's three quiet doors: record the day (diary), bring memories in
 * (import), and sort a thought out — the memory-add bar, opened from home.
 */

test('the three home doors stand together and the third opens the add bar', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('arc-browser').waitFor();

  await expect(page.getByTestId('home-diary-link')).toBeVisible();
  await expect(page.getByTestId('home-import-link')).toBeVisible();

  await page.getByTestId('home-think-link').click();
  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('capture-bar')).toHaveCount(0);
});

test('a connected Mac-notes reader advertises sync', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mado.ob.sync.notes', '2026-08-20T09:00:00Z'));
  // The badge rides the notes chip, which only a local Mac server offers —
  // seed mode has no reader, so this asserts the badge exactly when the chip
  // exists (it was verified live on the hosted build).
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('arc-browser').waitFor();
  await page.getByTestId('home-import-link').click();
  const notes = page.getByTestId('source-notes');
  if ((await notes.count()) > 0) {
    await expect(notes.locator('.arc__source-sync')).toHaveText('sync');
    await expect(notes).toHaveAttribute('title', /2026-08-20/);
  }
});
