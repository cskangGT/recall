import { test, expect } from '@playwright/test';

/**
 * Memory is one place with three lenses — browse the categories, spread it
 * out to brainstorm, open the archive — and one bar at the bottom of all
 * three: a word finds within the lens you are in, a question is asked. What
 * was found belongs to its lens; it does not follow you into the next one.
 */
test('one bar in every lens: a word finds, a question asks', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('lens-browse')).toHaveAttribute('aria-selected', 'true');

  // Browse: the bar says which verb Enter will use, and a find opens as rows.
  const input = page.getByTestId('composer-input');
  await input.fill('LangChain');
  await expect(page.getByTestId('find-mode')).toHaveText('find');
  await input.fill('What did we decide about LangChain?');
  await expect(page.getByTestId('find-mode')).toHaveText('ask');
  await input.fill('LangChain');
  await input.press('Enter');
  await expect(page.getByTestId('reading-list')).toContainText('Found');
  await expect(page.getByTestId('browser-answer')).toContainText('Found 1 memories');
  await expect(page.locator('.reading .item')).toHaveCount(1);

  // Brainstorm: the same word lights the map instead — and the find did not follow.
  await page.getByTestId('lens-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).not.toContainText('Found');
  await page.getByTestId('map-search-input').fill('hiring');
  await expect(page.getByTestId('map-search-count')).toContainText('of 47');

  // Archive: the ledger narrows to the originals that carry the word.
  await page.getByTestId('lens-sources').click();
  const rows = page.locator('[data-testid^="source-row-"]');
  const all = await rows.count();
  await page.getByTestId('archive-find-input').fill('hiring');
  await expect.poll(() => rows.count()).toBeLessThan(all);
  expect(await rows.count()).toBeGreaterThan(0);
});

test('a question from the map is answered beside it', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('g');
  await page.getByTestId('map-search-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('map-search-input').press('Enter');
  await expect(page.getByTestId('inspector')).toContainText('LangChain');
});
