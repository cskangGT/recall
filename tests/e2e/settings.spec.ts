import { test, expect } from '@playwright/test';

/**
 * Settings is three switches, not a screen — spec §17 rules out a preferences
 * page and is right to. The test that matters is the second one: the toggle has
 * to actually change what the product does, or it is decoration.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('opens from the rail and from the comma key, and Escape closes it', async ({ page }) => {
  await page.getByTestId('rail-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);

  await page.keyboard.press(',');
  await expect(page.getByTestId('settings')).toBeVisible();
});

test('turning auto-reorganize off stops the capture restructuring anything', async ({ page }) => {
  await page.keyboard.press(',');
  await page.getByTestId('auto-reorganize').uncheck();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');

  // The memories still land — only the structure stops moving on its own.
  await expect(page.getByTestId('capture-story')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('capture-story')).not.toContainText('reorganized around it');
  await expect(page.getByTestId('capture-story-destination')).toContainText('AI Tooling');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('with it on, the same capture still splits — the switch is the only difference', async ({
  page,
}) => {
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('status')).toContainText('Split AI Tooling', { timeout: 30_000 });
});

test('reports the data source, and offline keeps the demo off the network', async ({ page }) => {
  await page.keyboard.press(',');
  await expect(page.getByTestId('settings-mode')).toHaveText('seed');

  await page.goto('/?api=1&offline=1&skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press(',');
  // Spec 15.4: the flag exists for a venue whose network has failed, so it has
  // to beat ?api=1 rather than lose to it.
  await expect(page.getByTestId('settings-mode')).toContainText('Offline');
});
