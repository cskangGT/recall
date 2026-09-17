import { test, expect } from '@playwright/test';

/**
 * The first screen says what Mado is and asks for what you want kept: four
 * kinds — screenshots, links, notes, thoughts — and pressing one unfolds
 * the way to bring that kind in, right beneath it. No question to answer
 * first, no confirm; the press is the answer. The pick survives a reload so
 * the unfold is simply open next time.
 */
test('a kind unfolds its way in, and the pick holds across a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();
  await expect(page.getByTestId('welcome')).toContainText('second brain');
  await expect(page.getByTestId('welcome-unfold')).toHaveCount(0);

  await page.getByTestId('kind-shots').click();
  const unfold = page.getByTestId('welcome-unfold');
  await expect(unfold).toBeVisible();
  await expect(unfold).toContainText('Screenshots piling up');
  await expect(unfold.getByTestId('source-files')).toBeVisible();
  await expect(page.getByTestId('kind-shots')).toHaveAttribute('aria-pressed', 'true');

  // Another kind, another unfold — one open at a time.
  await page.getByTestId('kind-links').click();
  await expect(unfold).toContainText('links saved for later');
  await expect(unfold.getByTestId('unfold-paste')).toBeVisible();
  await expect(page.getByTestId('kind-shots')).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await page.getByTestId('welcome').waitFor();
  await expect(page.getByTestId('welcome-unfold')).toContainText('links saved for later');
});

test('notes unfold the readers, thoughts unfold today’s page', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();

  await page.getByTestId('kind-notes').click();
  await expect(page.getByTestId('fill-sources')).toBeVisible();
  await expect(page.getByTestId('source-files')).toBeVisible();

  await page.getByTestId('kind-thoughts').click();
  await expect(page.getByTestId('welcome-unfold')).toContainText('in your head');
  await page.getByTestId('unfold-diary').click();
  await expect(page.getByTestId('diary-view')).toBeVisible();
});

test('looking around first is always one press away', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();
  await expect(page.getByTestId('door-browse')).toBeVisible();
  await page.getByTestId('door-browse').click();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(page.getByTestId('category-index')).toBeVisible();
});
