import { test, expect } from '@playwright/test';

/**
 * The first kept thought flies to the big picture — once. Sorting a thought
 * out through the home door ends, the first time, on the map with the new
 * star lit; the second capture stays where the person works.
 */

test('the first thought lands on the map, the second stays home', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('arc-browser').waitFor();

  await page.getByTestId('home-think-link').click();
  await page.getByTestId('capture-input').fill('Braintrust is the strongest option for agent evals right now.');
  await page.keyboard.press('Enter');

  // After the capture beat, the view is the big picture.
  await expect(page.getByTestId('map-canvas')).toBeVisible({ timeout: 10000 });

  // Back home; a second thought does not hijack the view.
  await page.getByTestId('rail-home').click();
  await page.getByTestId('capture-story-close').click();
  await page.getByTestId('home-think-link').click();
  await page.getByTestId('capture-input').fill('Zone 2 rides moved the resting heart rate more than intervals.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2600);
  await expect(page.getByTestId('map-canvas')).toHaveCount(0);
});
