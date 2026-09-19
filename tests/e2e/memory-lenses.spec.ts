import { test, expect } from '@playwright/test';

/**
 * Memory is one place with three lenses — browse the categories, spread it
 * out to brainstorm, open the archive — and one bar at the bottom of all
 * three. The bar carries a switch, and the switch is the whole rule: Search
 * shows what was kept, within the lens you are in; Ask Mado has the memory
 * answer. Each lens remembers its own side, and what was found belongs to its
 * lens — it does not follow you into the next one.
 */
test('the switch decides: search finds within the lens, asking answers', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('lens-browse')).toHaveAttribute('aria-selected', 'true');

  // Browse is a conversation: it starts on asking.
  await expect(page.getByTestId('find-mode-ask')).toHaveAttribute('aria-checked', 'true');
  const input = page.getByTestId('composer-input');
  await expect(input).toHaveAttribute('placeholder', 'Ask Mado anything');

  // Switched to search, a word opens what was kept as rows — even one that
  // would have read as a question under the old guessing rule.
  await page.getByTestId('find-mode-search').click();
  await expect(input).toHaveAttribute('placeholder', 'Search what you kept');
  await input.fill('LangChain');
  await input.press('Enter');
  await expect(page.getByTestId('reading-list')).toContainText('Found');
  await expect(page.getByTestId('browser-answer')).toContainText('Found 1 memories');
  await expect(page.locator('.reading .item')).toHaveCount(1);

  // Brainstorm starts on search: the word lights the map — and the find did not follow.
  await page.getByTestId('lens-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).not.toContainText('Found');
  await expect(page.getByTestId('find-mode-search')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('map-search-input').fill('hiring');
  await expect(page.getByTestId('map-search-count')).toContainText('of 47');

  // Archive: the ledger narrows to the originals that carry the word.
  await page.getByTestId('lens-sources').click();
  const rows = page.locator('[data-testid^="source-row-"]');
  const all = await rows.count();
  await page.getByTestId('archive-find-input').fill('hiring');
  await expect.poll(() => rows.count()).toBeLessThan(all);
  expect(await rows.count()).toBeGreaterThan(0);

  // Browse kept its own side of the switch.
  await page.getByTestId('lens-browse').click();
  await expect(page.getByTestId('find-mode-search')).toHaveAttribute('aria-checked', 'true');
});

test('asking from the map: the filters step aside, and the answer reads beside it', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-filter-all')).toBeVisible();

  await page.getByTestId('find-mode-ask').click();
  await expect(page.getByTestId('map-filter-all')).toHaveCount(0);
  // While asking, typing lights nothing — it is a question, not a query.
  await page.getByTestId('map-search-input').fill('What did we decide about our eval stack');
  await expect(page.getByTestId('map-search-count')).toHaveCount(0);
  await page.getByTestId('map-search-input').press('Enter');
  await expect(page.getByTestId('inspector')).toContainText('LangChain');
});

test('home and today only ask — the switch belongs to Memory', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('composer-add')).toBeVisible();
  await expect(page.getByTestId('find-mode')).toHaveCount(0);
  await page.getByTestId('rail-today').click();
  await expect(page.getByTestId('find-mode')).toHaveCount(0);
});
