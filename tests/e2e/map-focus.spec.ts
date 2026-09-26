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
async function clickA(page: Page, eyebrow: RegExp): Promise<void> {
  const box = (await page.getByTestId('map-canvas').boundingBox())!;
  const inspector = page.getByTestId('inspector');
  const step = 24;
  for (let y = box.y + 80; y < box.y + box.height - 120; y += step) {
    for (let x = box.x + 40; x < box.x + box.width - 40; x += step) {
      await page.mouse.click(x, y);
      if (eyebrow.test(((await inspector.textContent()) ?? '').trim())) return;
    }
  }
  throw new Error(`nothing matching ${eyebrow} found on the canvas`);
}
const clickACategory = (page: Page) => clickA(page, /^CATEGORY/i);
const clickAMemory = (page: Page) => clickA(page, /^MEMORY/i);

test('clicking a category stone zooms into it, and ← walks back', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('map-back')).toHaveCount(0);

  await clickACategory(page);

  // The zoom leaves a trail: ← appears, and walking it all the way back
  // removes it. (The sweep may have stepped on a dot or two on its way to
  // the stone — each of those is a place now, and a step on the trail.)
  const back = page.getByTestId('map-back');
  await expect(back).toBeVisible();
  for (let i = 0; i < 12 && (await back.count()) > 0; i++) {
    await back.click();
    await page.waitForTimeout(80);
  }
  await expect(back).toHaveCount(0);
});

test('a memory dot is a place too: click it and the camera goes to it', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForTimeout(1000);

  await clickAMemory(page);
  await expect(page.getByTestId('map-back')).toBeVisible();
});
