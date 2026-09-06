import { test, expect } from '@playwright/test';

/**
 * The folder view (2번): the desktop-window grammar inside Sources. Folders
 * are categories, files are memories; double-click walks in, the trail walks
 * back, and the toggle is a remembered taste.
 */

test('toggle to folders, walk into one, and back out by the trail', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();

  await page.getByTestId('sources-mode-folders').click();
  await expect(page.getByTestId('folder-view')).toBeVisible();

  // Top level: parent categories as folders, no files yet.
  const folders = page.locator('[data-testid^="folder-"]:not([data-testid="folder-view"])');
  expect(await folders.count()).toBeGreaterThan(3);
  expect(await page.locator('[data-testid^="file-"]').count()).toBe(0);

  // Walk into the first folder: subfolders and/or memory files appear.
  await folders.first().dblclick();
  const inside =
    (await page.locator('[data-testid^="file-"]').count()) +
    (await folders.count());
  expect(inside).toBeGreaterThan(0);

  // The trail leads home.
  await page.getByTestId('folders-crumb-root').click();
  expect(await page.locator('[data-testid^="file-"]').count()).toBe(0);
  expect(await folders.count()).toBeGreaterThan(3);
});

test('a file click inspects the memory; the taste is remembered across reloads', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  await page.getByTestId('sources-mode-folders').click();

  // Find a folder that holds files directly (AI Tooling is flat in the seed).
  const aiTooling = page.locator('.folder', { hasText: 'AI Tooling' });
  await aiTooling.dblclick();
  const firstFile = page.locator('[data-testid^="file-"]').first();
  await expect(firstFile).toBeVisible();
  await firstFile.click();
  await expect(page.getByTestId('inspector')).toContainText('Memory');

  // Reload: still in folder mode.
  await page.reload();
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByTestId('folder-view')).toBeVisible();
});
