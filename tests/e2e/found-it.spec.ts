import { test, expect, type Page } from '@playwright/test';

/**
 * Found it — so the screen should say so. Four places where it did not:
 * the inspector fell silent beside an answer; a source opened only in the
 * side column; the memory page could show but not act; and the rail was
 * glyphs with no names.
 */
const named = (page: Page, label: string) =>
  page.locator('.arc__node').filter({ hasText: label }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1&lang=ko');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('beside an answer, the inspector shows the question and what it leaned on', async ({ page }) => {
  await page.getByTestId('composer-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browser-answer')).toBeVisible();
  const compact = page.getByTestId('inspector-answer');
  await expect(compact).toBeVisible();
  await expect(compact).toContainText('eval stack');
  expect(await page.getByTestId('inspector').locator('.memory-row').count()).toBeGreaterThan(1);
  // The full text lives in the middle; the side does not repeat it.
  await expect(page.getByTestId('inspector')).not.toContainText('Braintrust replaced');
});

test('a source opens as a page in the middle, and its memories lead on', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  await page.locator('.source-row').first().click();
  const sourcePage = page.getByTestId('source-page');
  await expect(sourcePage).toBeVisible();
  await expect(sourcePage.getByTestId('source-page-original')).toBeVisible();
  await expect(page.getByTestId('inspector-expand')).toHaveCount(0);

  await sourcePage.locator('.memory-row').first().click();
  await expect(page.getByTestId('memory-page')).toBeVisible();
  await expect(sourcePage).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('memory-page')).toHaveCount(0);
});

test('the memory page can move and delete, not only show', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  const before = await page.locator('.reading .item').count();
  await page.locator('.reading .item').first().click();
  const memoryPage = page.getByTestId('memory-page');
  await expect(memoryPage).toBeVisible();

  await memoryPage.getByTestId('memory-page-move').selectOption({ label: 'Hiring' });
  await expect(page.getByTestId('toast').filter({ hasText: /옮겼|Moved/ })).toHaveCount(1);
  await expect(memoryPage.getByTestId('memory-page-crumb')).toContainText('Hiring');

  await memoryPage.getByTestId('memory-page-delete').click();
  await memoryPage.getByTestId('memory-page-delete').click();
  await expect(memoryPage).toHaveCount(0);
  // Moved out, then deleted: the list it came from is one shorter either way.
  expect(await page.locator('.reading .item').count()).toBe(before - 1);
});

test('the rail names its views', async ({ page }) => {
  await expect(page.getByTestId('rail-tree').locator('.rail__label')).toHaveText('둘러보기');
  await expect(page.getByTestId('rail-map').locator('.rail__label')).toHaveText('지도');
  await expect(page.getByTestId('rail-sources').locator('.rail__label')).toHaveText('원본');
  await expect(page.getByTestId('rail-diary').locator('.rail__label')).toHaveText('일기');
});
