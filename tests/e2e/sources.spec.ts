import { test, expect } from '@playwright/test';

/**
 * Sources — spec §5.7.
 *
 * The reason this screen exists is the last test here: the app has always told
 * users a capture that produced nothing is "in your Sources", and until now
 * that sentence pointed at a screen that did not exist.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tree-view')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

test('S opens Sources and lists every capture newest first', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  await expect(page.locator('.source-row')).toHaveCount(22);

  const dates = await page.evaluate(() =>
    [...document.querySelectorAll('.source-row__meta')].map((e) => e.textContent ?? ''),
  );
  expect(dates.length).toBe(22);
});

test('filters narrow to one source type', async ({ page }) => {
  await page.keyboard.press('s');
  await page.getByTestId('sources-filter-screenshot').click();
  await expect(page.locator('.source-row')).toHaveCount(5);

  await page.getByTestId('sources-filter-link').click();
  await expect(page.locator('.source-row')).toHaveCount(8);

  await page.getByTestId('sources-filter-all').click();
  await expect(page.locator('.source-row')).toHaveCount(22);
});

test('selecting a source shows its provenance in the inspector', async ({ page }) => {
  await page.keyboard.press('s');
  await page.locator('.source-row').first().click();

  const inspector = page.getByTestId('inspector');
  await expect(inspector).toContainText('Source');
  // Every memory the capture produced, so a claim can be traced back to it.
  await expect(inspector.locator('.memory-row').first()).toBeVisible();
});

test('the screen the "It\'s in your Sources" toast points at actually shows the capture', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();

  // 23 now, and the new one is first because it is the newest.
  await expect(page.locator('.source-row')).toHaveCount(23);
  await expect(page.locator('.source-row').first()).toContainText('Thread on eval harnesses');

  await page.locator('.source-row').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Thread on eval harnesses');
  await expect(page.getByTestId('inspector')).toContainText('2 memories');
});

test('navigation between the three views keeps working', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByTestId('tree-view')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});
