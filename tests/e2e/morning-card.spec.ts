import { test, expect } from '@playwright/test';

/**
 * The morning card only speaks when something new found something old
 * overnight. The untouched seed corpus is all old — so a fresh visit shows
 * no card. (When the card does speak is unit-tested in morning.test.ts.)
 */

test('a plain seed visit earns no morning card', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('arc-browser').waitFor();
  await expect(page.getByTestId('morning-card')).toHaveCount(0);
});
