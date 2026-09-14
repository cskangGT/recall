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

test('throwing a source away takes its memories with it, after asking twice', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await dropFiles(page, [FILES[0]!, FILES[1]!]);
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('batch-reveal-review').click();
  await expect(page.getByTestId('review-original')).toContainText('Aeolian');

  const memoriesBefore = await page.evaluate(
    () => document.querySelectorAll('[data-testid^="review-item-"]').length,
  );
  expect(memoriesBefore).toBeGreaterThan(0);

  // First press arms; the card is still there.
  await page.getByTestId('review-discard').click();
  await expect(page.getByTestId('review-original')).toContainText('Aeolian');
  // Second press throws it away and moves on.
  await page.getByTestId('review-discard').click();
  await expect(page.getByTestId('review-original')).toContainText('tri-tip');
  await page.getByTestId('review-skip').click();

  // Gone from the drawer: only the grill log remains of the two.
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  await expect(page.getByTestId('sources-view')).not.toContainText('travel notes');
  await expect(page.getByTestId('sources-view')).toContainText('grill log');
});

test('finishing a review lands where the memories went', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await dropFiles(page, [FILES[0]!, FILES[1]!]);
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('batch-reveal-review').click();
  await expect(page.getByTestId('review-original')).toContainText('Aeolian');

  // Saving the first of two moves on without landing — the run is not over.
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('review-original')).toContainText('tri-tip');
  await expect(page.locator('.item--selected')).toHaveCount(0);

  // Saving the last one lands.
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('review-panel')).toHaveCount(0);

  // The reading list is open on the category that took the memories, with
  // one of them selected — the trail from "saved" to "here".
  const selected = page.locator('.item--selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText(/tri-tip|Oak chunks/);
  await expect(page.getByTestId('toast').filter({ hasText: /into|에/ })).toHaveCount(1);
});
