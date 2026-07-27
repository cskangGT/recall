import { test, expect } from '@playwright/test';

/** Captures the three demo beats for visual review. Not an assertion suite. */
test('capture the three demo beats', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tree-view')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'test-results/beat1-map.png' });

  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.screenshot({ path: 'test-results/beat2a-capture.png' });
  await page.keyboard.press('Enter');

  await page.waitForTimeout(2200);
  await page.screenshot({ path: 'test-results/beat2b-processing.png' });

  await expect(page.getByRole('status')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/beat2c-split.png' });

  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/beat3-answer.png' });
});
