import { test, expect, type Page } from '@playwright/test';

/**
 * A category on the map is a place. Clicking it pulls the camera in around
 * the category and what it holds, and ← walks back out — the same trail a
 * search hit leaves. Before this, a click selected and the camera stayed
 * where it stood, which made the biggest stones the hardest to look into.
 *
 * The map is a canvas, so there is no element to click; the test sweeps the
 * canvas in a coarse grid until a click lands on a category stone (the
 * inspector's eyebrow says so). Stones are far larger than the grid step.
 */
async function clickACategory(page: Page): Promise<void> {
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  const inspector = page.getByTestId('inspector');
  const step = 24;
  for (let y = box.y + 80; y < box.y + box.height - 120; y += step) {
    for (let x = box.x + 40; x < box.x + box.width - 40; x += step) {
      await page.mouse.click(x, y);
      if (/^CATEGORY/i.test(((await inspector.textContent()) ?? '').trim())) return;
    }
  }
  throw new Error('no category stone found on the canvas');
}

test('clicking a category stone zooms into it, and ← walks back', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('map-back')).toHaveCount(0);

  await clickACategory(page);

  // The zoom leaves a trail: ← appears, and walking it back removes it.
  await expect(page.getByTestId('map-back')).toBeVisible();
  await page.getByTestId('map-back').click();
  await expect(page.getByTestId('map-back')).toHaveCount(0);
});
