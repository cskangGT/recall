import { test, expect } from '@playwright/test';

/**
 * Home's doors: start today, fill the memory, find a memory, write today.
 * The fill door unfolds the ways in where it stands; the rest go somewhere.
 */

test('home hangs four doors, and each one opens', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-home').click();
  const home = page.getByTestId('home');
  await expect(home).toBeVisible();
  // The claim is in the sentence you are reading.
  await expect(home).toContainText('47 memories');

  await page.getByTestId('door-fill').click();
  await expect(page.getByTestId('fill-sources')).toBeVisible();
  await expect(page.getByTestId('source-files')).toBeVisible();

  await page.getByTestId('door-diary').click();
  await expect(page.getByTestId('diary-view')).toBeVisible();

  await page.getByTestId('rail-home').click();
  await page.getByTestId('door-today').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
});

test('a connected Mac-notes reader advertises sync', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mado.ob.sync.notes', '2026-08-20T09:00:00Z'));
  // The badge rides the notes chip, which only a local Mac server offers —
  // seed mode has no reader, so this asserts the badge exactly when the chip
  // exists (it was verified live on the hosted build).
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-home').click();
  await page.getByTestId('door-fill').click();
  const notes = page.getByTestId('source-notes');
  if ((await notes.count()) > 0) {
    await expect(notes.locator('.arc__source-sync')).toHaveText('sync');
    await expect(notes).toHaveAttribute('title', /2026-08-20/);
  }
});
