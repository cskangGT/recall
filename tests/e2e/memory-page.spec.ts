import { test, expect, type Page } from '@playwright/test';

/**
 * Found it — now read it. Picking a memory in the reading list opens it as a
 * page in the middle of the screen: the memory large, its original beneath,
 * what else came from that original, and what relates. The inspector stays
 * as the quick look and the control panel; from the map it offers the same
 * page with a button. Escape closes the page and keeps the selection.
 */
const named = (page: Page, label: string) =>
  page.locator('.arc__node').filter({ hasText: label }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('a memory picked from the list opens as a page, and Escape closes it', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  const first = page.locator('.reading .item').first();
  const text = (await first.locator('.item__text').textContent())!.trim();
  await first.click();

  const memoryPage = page.getByTestId('memory-page');
  await expect(memoryPage).toBeVisible();
  await expect(memoryPage.getByTestId('memory-page-text')).toHaveText(text);
  await expect(memoryPage.getByTestId('memory-page-original')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(memoryPage).toHaveCount(0);
  // The selection survives the page: the inspector still shows the memory.
  await expect(page.locator('.item--selected')).toHaveCount(1);
});

test('the inspector offers the page from the map', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  await page.locator('.reading .item').first().click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  await page.getByTestId('inspector-expand').click();
  await expect(page.getByTestId('memory-page')).toBeVisible();
});

test('another memory from the same original swaps the page, not the stack', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  await page.locator('.reading .item').first().click();
  const memoryPage = page.getByTestId('memory-page');
  const sibling = memoryPage.locator('[data-testid^="memory-page-also-"]').first();
  test.skip((await sibling.count()) === 0, 'this memory has no siblings from its original');
  const siblingText = (await sibling.locator('.memory-row__text').textContent())!.trim();
  await sibling.click();
  await expect(memoryPage.getByTestId('memory-page-text')).toHaveText(siblingText);
  await page.keyboard.press('Escape');
  await expect(memoryPage).toHaveCount(0);
});

test('while the page is open the inspector steps back — no second copy, no expand button', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  await page.locator('.reading .item').first().click();
  await expect(page.getByTestId('memory-page')).toBeVisible();
  await expect(page.getByTestId('inspector-expand')).toHaveCount(0);
  await expect(page.getByTestId('inspector-reading-here')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector-expand')).toBeVisible();
  await expect(page.getByTestId('inspector-reading-here')).toHaveCount(0);
});
