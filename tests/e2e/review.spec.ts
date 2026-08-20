import { test, expect, type Page } from '@playwright/test';

/**
 * The review (spec §21), end to end in seed mode: drop → reveal → the review
 * door → one drop verdict → the corpus shrinks and the source is stamped.
 * Offered, never owed — skipping works too.
 */

async function dropFiles(page: Page, files: [name: string, content: string][]): Promise<void> {
  await page.evaluate((entries) => {
    const dt = new DataTransfer();
    for (const [name, content] of entries) {
      dt.items.add(new File([content], name, { type: 'text/plain' }));
    }
    const shell = document.querySelector('.shell');
    if (!shell) throw new Error('no .shell to drop on');
    shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
}

const FILES: [string, string][] = [
  [
    'travel-notes.md',
    'Booked the Aeolian islands ferry for the second week of June.\n' +
      'The Salina vineyard stay needs a deposit by Friday.',
  ],
  [
    'grill-log.md',
    'Resting the tri-tip twenty minutes made a bigger difference than the rub.\n' +
      'Oak chunks over briquettes beat the pellet smoker on flavour.',
  ],
];

test('review after the reveal: a drop verdict shrinks the corpus and stamps the source', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await dropFiles(page, FILES);
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });

  // The second door out of the reveal.
  await page.getByTestId('batch-reveal-review').click();
  await expect(page.getByTestId('review-panel')).toBeVisible();
  await expect(page.getByTestId('review-step')).toContainText('1');
  await expect(page.getByTestId('review-original')).toContainText('Aeolian');

  // Drop the first memory, keep the rest, confirm.
  const first = page.locator('[data-testid^="review-drop-"]').first();
  await first.click();
  const before = await page.evaluate(
    () => document.querySelectorAll('[data-testid^="review-item-"]').length,
  );
  await page.getByTestId('review-confirm').click();

  // Stepper moves to the second source; skip it.
  await expect(page.getByTestId('review-step')).toContainText('2');
  await expect(page.getByTestId('review-original')).toContainText('tri-tip');
  await page.getByTestId('review-skip').click();
  await expect(page.getByTestId('review-panel')).toHaveCount(0);

  // The dropped memory is gone from the corpus.
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  const reviewedBadges = page.locator('[data-testid^="reviewed-"]');
  expect(await reviewedBadges.count()).toBe(1); // reviewed one, skipped one
  expect(before).toBeGreaterThan(1);
});

test('escape walks away having changed nothing', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await dropFiles(page, [FILES[0]!, FILES[1]!]);
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('batch-reveal-review').click();
  await expect(page.getByTestId('review-panel')).toBeVisible();

  await page.locator('[data-testid^="review-drop-"]').first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('review-panel')).toHaveCount(0);

  // Nothing applied: no source is stamped reviewed.
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  expect(await page.locator('[data-testid^="reviewed-"]').count()).toBe(0);
});
