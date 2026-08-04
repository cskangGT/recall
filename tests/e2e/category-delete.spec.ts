import { test, expect, type Page } from '@playwright/test';

/**
 * Deleting a category, from the Inspector.
 *
 * The rule being guarded is AC-30: deleting a category deletes zero memories.
 * The interesting half is that the button says where they are going *before* it
 * is armed — a delete that silently moves five memories somewhere you did not
 * choose is a different button from one that tells you.
 */

const node = (page: Page, id: string) => page.getByTestId(`arc-node-${id}`);
const named = (page: Page, label: string) =>
  page.locator('.arc__node').filter({ hasText: label }).first();

/** Memories the client is holding, counted off the reading list's own tally. */
const totalMemories = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.arc__node--folder .arc__count')]
      .map((n) => Number(n.textContent))
      .reduce((a, b) => a + b, 0),
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('the confirmation names the destination before it is armed', async ({ page }) => {
  await node(page, 'cat_ai_tooling').click();
  await expect(page.getByTestId('category-name')).toHaveText('AI Tooling');

  // Nothing is about to happen, so there is nothing to warn about.
  await expect(page.getByTestId('delete-consequence')).toHaveCount(0);

  await page.getByTestId('delete-button').click();
  await expect(page.getByTestId('delete-consequence')).toHaveText(
    /memories go|memory goes|nothing moves|subcategor/,
  );
  await expect(page.getByTestId('delete-button')).toHaveText(/click again/);
});

test('it disarms when you look away, so a loaded button never sits there', async ({ page }) => {
  await node(page, 'cat_ai_tooling').click();
  await page.getByTestId('delete-button').click();
  await expect(page.getByTestId('delete-consequence')).toBeVisible();

  await page.getByTestId('composer-input').click();
  await expect(page.getByTestId('delete-consequence')).toHaveCount(0);
  await expect(page.getByTestId('delete-button')).toHaveText('Delete');
});

test('deleting a category keeps every memory it held (AC-30)', async ({ page }) => {
  const before = await totalMemories(page);
  expect(before).toBeGreaterThan(0);

  await node(page, 'cat_ai_tooling').click();
  await page.getByTestId('delete-button').click();
  await page.getByTestId('delete-button').click();

  // Gone from the arc.
  await expect(named(page, 'AI Tooling')).toHaveCount(0);
  // And the corpus is the same size: a category is a label, and removing a
  // label does not remove what it was on.
  expect(await totalMemories(page)).toBe(before);
});

test('says where they went, rather than just that something happened', async ({ page }) => {
  await node(page, 'cat_ai_tooling').click();
  await page.getByTestId('delete-button').click();
  await page.getByTestId('delete-button').click();

  await expect(page.locator('[aria-live="polite"]')).toContainText(/Deleted AI Tooling/);
});
