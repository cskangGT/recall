import { test, expect } from '@playwright/test';

/**
 * First visit and every visit after are two different arrivals. The greeting
 * is the first one's: once a person has left it through any door, the next
 * visit opens on home — the index of what they have — and the logo means
 * home for them too. Settings keeps a way to see the first screen again.
 */
test('the greeting is for the first visit; after it, home is home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByTestId('door-browse').click();
  await expect(page.getByTestId('category-index')).toBeVisible();

  // Next visit: straight to home, no greeting.
  await page.reload();
  await expect(page.getByTestId('category-index')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);

  // The logo, for someone who has been here, is home — not the greeting.
  await page.getByTestId('index-card-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toContainText('AI Tooling');
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('category-index')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);

  // Settings keeps the way back to the first screen.
  await page.keyboard.press(',');
  await page.getByTestId('settings-welcome-again').click();
  await expect(page.getByTestId('welcome')).toBeVisible();
});

test('leaving the greeting through the diary counts as having seen it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('kind-thoughts').click();
  await page.getByTestId('unfold-diary').click();
  await expect(page.getByTestId('diary-view')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});
