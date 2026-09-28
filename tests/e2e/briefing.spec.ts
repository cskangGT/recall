import { test, expect, type Page } from '@playwright/test';

/**
 * Today — the page home's first door opens.
 *
 * One sentence, and three lines. The sentence is whatever this hour is about
 * and is itself a door; the lines — schedule, mind, pile — are counts until
 * pressed, one open at a time, and the hour opens one of them. The seed has
 * no calendar door, so here there are two lines and the morning opens on the
 * mind. The clock is pinned in the suite's own zone (New York).
 */
async function today(page: Page, at: string) {
  await page.clock.setFixedTime(new Date(at));
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-today').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
}

test('home is the scene, and its first door opens today', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('briefing')).toHaveCount(0);
  // The door says what is behind it in a couple of counts.
  await expect(page.getByTestId('door-today')).toContainText('on the table');

  await page.getByTestId('door-today').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('rail-today')).toHaveAttribute('aria-current', 'page');
  // No calendar in the seed: two lines, not three.
  await expect(page.getByTestId('brief-row-schedule')).toHaveCount(0);
});

test('the morning is about what is held, and opens the mind', async ({ page }) => {
  await today(page, '2026-09-16T08:00:00-04:00');
  await expect(page.getByTestId('briefing')).toHaveAttribute('data-daypart', 'morning');
  await expect(page.getByTestId('brief-head')).toContainText('2 things are still on the table');
  await expect(page.getByTestId('brief-row-mind')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('brief-row-info')).toHaveAttribute('aria-expanded', 'false');

  // Each concern is a door to its page.
  await page.locator('[data-testid^="brief-concern-"]').first().click();
  await expect(page.getByTestId('memory-page')).toBeVisible();
});

test('the afternoon is about the pile — and the sentence itself starts on three', async ({ page }) => {
  await today(page, '2026-09-16T14:00:00-04:00');
  await expect(page.getByTestId('brief-head')).toContainText('22 originals are waiting');
  await expect(page.getByTestId('brief-row-info')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('brief-review-three')).toBeVisible();

  await page.getByTestId('brief-head').click();
  await expect(page.getByTestId('review-panel')).toContainText('1 of 3');
});

test('the evening closes the day: what came in, and the page to write', async ({ page }) => {
  await today(page, '2026-09-16T22:00:00-04:00');
  // The seed is older than today, so the sentence says so — and still points at the page.
  await expect(page.getByTestId('brief-head')).toContainText('Nothing came in today');
  await expect(page.getByTestId('brief-row-mind')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('brief-today-memories')).toBeVisible();
  await page.getByTestId('brief-write-today').click();
  await expect(page.getByTestId('diary-view')).toBeVisible();
});

test('one line open at a time, and the pile holds lately, its evidence and the way in', async ({ page }) => {
  await today(page, '2026-09-16T08:00:00-04:00');
  await page.getByTestId('brief-row-info').click();
  await expect(page.getByTestId('brief-row-info')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('brief-row-mind')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('brief-concerns')).toHaveCount(0);

  // Lately, in the memory's voice — and the memories it leaned on, one press away.
  await expect(page.getByTestId('brief-lately')).toContainText(/Lately/);
  await page.getByTestId('brief-evidence').click();
  expect(await page.getByTestId('brief-evidence-rows').locator('.memory-row').count()).toBeGreaterThan(0);

  // What is waiting, and the door to all of it.
  await expect(page.getByTestId('brief-awaiting')).toContainText(/22/);
  // The import door outlived the welcome; it lives with the pile it feeds.
  await page.getByTestId('home-import-link').click();
  await expect(page.getByTestId('fill-sources')).toBeVisible();
  await page.getByTestId('brief-awaiting').click();
  await expect(page.getByTestId('sources-view')).toBeVisible();
});

/**
 * What is held can be put down. The row leaves the table, the memory stays
 * where it was filed, and its page is where it can be picked back up.
 */
test('a concern can be put down and picked back up — the memory never leaves', async ({ page }) => {
  await today(page, '2026-09-16T08:00:00-04:00');
  const row = page.getByTestId('brief-concern-mem_11');
  await expect(row).toBeVisible();

  await row.hover();
  await page.getByTestId('brief-settle-mem_11').click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('.toast').last()).toContainText('put down');

  await page.getByTestId('brief-concern-mem_22').click();
  await page.getByTestId('memory-page-settle').click();
  await expect(page.getByTestId('memory-page-settled')).toContainText('Put down');
  await expect(page.getByTestId('memory-page-settle')).toHaveText('Pick back up');
  await page.getByTestId('memory-page-settle').click();
  await expect(page.getByTestId('memory-page-settled')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('brief-concern-mem_22')).toBeVisible();
  await expect(page.getByTestId('brief-concern-mem_11')).toHaveCount(0);
});
