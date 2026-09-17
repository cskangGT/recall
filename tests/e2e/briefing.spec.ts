import { test, expect } from '@playwright/test';

/**
 * Home opens on a briefing, not a filing cabinet: the day, what has been on
 * the table lately, the questions and decisions of the fortnight, where the
 * thinking has been growing, what is still waiting to be checked — and only
 * then the categories. Everything in it is a door: a concern opens as a
 * page, a growing category opens its reading list.
 */
test('home is a briefing first, and every line is a door', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('category-index')).toBeVisible();

  const brief = page.getByTestId('briefing');
  await expect(brief).toBeVisible();
  // The briefing stands above the categories.
  const briefBox = (await brief.boundingBox())!;
  const firstCard = (await page.locator('[data-testid^="index-card-"]').first().boundingBox())!;
  expect(briefBox.y).toBeLessThan(firstCard.y);

  // Lately, in the memory's voice, from the seed's own counts — and the
  // memories it leaned on, one press away.
  await expect(brief.getByTestId('brief-lately')).toContainText(/Lately/);
  await brief.getByTestId('brief-evidence').click();
  expect(await brief.getByTestId('brief-evidence-rows').locator('.memory-row').count()).toBeGreaterThan(0);

  // The fortnight's decisions, newest first, each a door to its page.
  const concerns = brief.locator('[data-testid^="brief-concern-"]');
  expect(await concerns.count()).toBeGreaterThan(0);
  await concerns.first().click();
  await expect(page.getByTestId('memory-page')).toBeVisible();
  await page.keyboard.press('Escape');

  // Where the thinking has been growing — a category, one press away.
  await brief.getByTestId('brief-growing-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toContainText('AI Tooling');

  // What is waiting: the originals not yet checked, and the way to them.
  await page.getByTestId('rail-tree').click();
  await expect(brief.getByTestId('brief-awaiting')).toContainText(/22/);
  await brief.getByTestId('brief-awaiting').click();
  await expect(page.getByTestId('sources-view')).toBeVisible();
});

/**
 * The same blocks, a different order by the hour. Mornings open on what is
 * on the table, afternoons on what there is to sort — three at a time, not
 * twenty-two — and evenings on what came in today and the page that closes
 * the day. The clock is pinned in the suite's own zone (New York).
 */
const top = async (page: import('@playwright/test').Page, id: string) =>
  (await page.getByTestId(id).boundingBox())!.y;

test('the morning greets and leads with what is on the table', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-16T08:00:00-04:00'));
  await page.goto('/?skipWelcome=1');
  const brief = page.getByTestId('briefing');
  await expect(brief).toHaveAttribute('data-daypart', 'morning');
  await expect(page.getByTestId('brief-greeting')).toHaveText('Good morning.');
  expect(await top(page, 'brief-concerns')).toBeLessThan(await top(page, 'brief-lately'));
  await expect(page.getByTestId('brief-today-memories')).toHaveCount(0);
});

test('the afternoon leads with sorting — just three, the oldest first', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-16T14:00:00-04:00'));
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('briefing')).toHaveAttribute('data-daypart', 'day');
  await expect(page.getByTestId('brief-greeting')).toHaveCount(0);
  expect(await top(page, 'brief-organizing')).toBeLessThan(await top(page, 'brief-lately'));

  await page.getByTestId('brief-review-three').click();
  await expect(page.getByTestId('review-panel')).toContainText('1 of 3');
});

test('the evening closes the day: what came in, and the page to write', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-16T22:00:00-04:00'));
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('briefing')).toHaveAttribute('data-daypart', 'evening');
  await expect(page.getByTestId('brief-greeting')).toHaveText('Time to close the day.');

  // The seed is older than today, so the block says so — and still offers the page.
  const today = page.getByTestId('brief-today-memories');
  await expect(today).toContainText('Nothing came in today');
  expect(await top(page, 'brief-today-memories')).toBeLessThan(await top(page, 'brief-concerns'));
  await page.getByTestId('brief-write-today').click();
  await expect(page.getByTestId('diary-view')).toBeVisible();
});
