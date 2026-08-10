import { test, expect, type Page } from '@playwright/test';

/**
 * Context follows the eye into the composer: the placeholder recommends a
 * question about whatever is open, a selected keyword sharpens it further,
 * and stepping back returns the generic invitation. The summarize button is
 * API-mode only — the scripted demo answerer cannot summarize an arbitrary
 * list honestly, so seed mode must not offer to.
 */

const named = (page: Page, label: string) =>
  page.locator('.arc__node').filter({ hasText: label }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('the placeholder recommends a question about the open category', async ({ page }) => {
  const input = page.getByTestId('composer-input');

  // Before anything is open, the invitation is generic.
  await expect(input).toHaveAttribute('placeholder', /Ask anything/);

  await named(page, 'AI Tooling').click();
  await expect(input).toHaveAttribute('placeholder', /AI Tooling/);

  // A selected keyword sharpens the recommendation past the category.
  const chip = page.getByTestId('keyword-strip').locator('.kw').first();
  const label = (await chip.textContent())!.replace(/\d+$/, '').trim();
  await chip.click();
  await expect(input).toHaveAttribute('placeholder', new RegExp(label));

  // Removing the keyword steps the recommendation back to the category.
  // (A category never closes on Escape — the store reserves it for answers
  // and selections — so the generic line only returns on a fresh arrival.)
  await page.getByTestId('keyword-strip').locator('.kw--selected').click();
  await expect(input).toHaveAttribute('placeholder', /AI Tooling/);
});

test('seed mode does not offer a summary it cannot honestly produce', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  await expect(page.getByTestId('reading-list')).toBeVisible();
  await expect(page.getByTestId('reading-summarize')).toHaveCount(0);
});
