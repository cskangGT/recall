import { test, expect } from '@playwright/test';

/**
 * The free window (?plan=free): the whole corpus stays visible as structure,
 * but memories older than two weeks read as archived, and the one paywall line
 * under the reading list is where the product asks for money. Default (pro)
 * must be untouched — the demo path depends on the full corpus.
 */

test('the free plan archives old rows and shows the paywall line', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  // AI Tooling's seed memories are months old — all of them archive.
  await page.getByTestId('arc-node-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toBeVisible();

  await expect(page.getByTestId('plan-paywall')).toBeVisible();
  await expect(page.getByTestId('plan-paywall')).toContainText('last 14 days');
  await expect(page.getByTestId('plan-paywall')).toContainText('archived');

  await page.getByTestId('plan-upgrade').click();
  await expect(page.getByTestId('toast')).toContainText('Mado Pro remembers everything');
});

test('an archived row is present but not draggable, and says why on click', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.getByTestId('arc-node-cat_ai_tooling').click();

  const archived = page.locator('.item--archived').first();
  await expect(archived).toBeVisible();
  await expect(archived).not.toHaveAttribute('draggable', 'true');

  await archived.click();
  await expect(page.getByTestId('toast')).toContainText('Archived on Mado Free');
});

test('pro (the default) shows no paywall anywhere', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.getByTestId('arc-node-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toBeVisible();
  await expect(page.getByTestId('plan-paywall')).toHaveCount(0);
  await expect(page.locator('.item--archived')).toHaveCount(0);
});

test('settings names the plan and offers the upgrade on free', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press(',');
  await expect(page.getByTestId('settings-plan')).toContainText('Free');
  await expect(page.getByTestId('settings-upgrade')).toBeVisible();
});
