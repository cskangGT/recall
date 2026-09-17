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
