import { test, expect } from '@playwright/test';

/**
 * The sixty-second question (onboarding wow D): an inline, ignorable row on
 * the welcome. Picking what piles up re-words the fill door's promise, and
 * the answer survives a reload; ignoring the row changes nothing.
 */

test('picking screenshots tailors the fill door and survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();

  const hint = page.getByTestId('door-fill').locator('.arc__door-hint');
  await expect(hint).toContainText('screenshots, PDFs, or notes');

  await page.getByTestId('profile-shots').click();
  await expect(page.getByTestId('profile-shots')).toHaveAttribute('aria-pressed', 'true');
  await expect(hint).toContainText('a few of those screenshots');

  await page.reload();
  await page.getByTestId('welcome').waitFor();
  await expect(page.getByTestId('profile-shots')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('door-fill').locator('.arc__door-hint')).toContainText(
    'a few of those screenshots',
  );
});

test('the row is ignorable — doors work untouched', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();
  await page.getByTestId('door-browse').click();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});
