import { test, expect } from '@playwright/test';

/**
 * Browse opens on an index of your categories — name, size, the last two
 * things kept — and a click on one is how you enter the reading view. The
 * constellation stays above as the way to move between them, but the index
 * is what says "these are your categories" in words the eye can read.
 */
test('home shows the categories as an index, and a card opens one', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  const index = page.getByTestId('category-index');
  await expect(index).toBeVisible();
  const cards = index.locator('[data-testid^="index-card-"]');
  expect(await cards.count()).toBeGreaterThan(3);

  const ai = index.getByTestId('index-card-cat_ai_tooling');
  await expect(ai).toContainText('AI Tooling');
  await expect(ai).toContainText('9');
  // A card carries a taste of what is inside, not just a name.
  expect((await ai.locator('.index__peek').count())).toBeGreaterThan(0);

  await ai.click();
  await expect(page.getByTestId('reading-list')).toContainText('AI Tooling');
  await expect(page.locator('.reading .item').first()).toBeVisible();
  await expect(index).toHaveCount(0);

  // The logo is the way home — and for anyone past the greeting, home is
  // the index again.
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('category-index')).toBeVisible();
});

test('the home doors stand with the index', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('category-index')).toBeVisible();
  await expect(page.getByTestId('home-diary-link')).toBeVisible();
  await expect(page.getByTestId('home-import-link')).toBeVisible();
});

test('the Browse rail button, pressed inside a category, returns to the index', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('index-card-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toContainText('AI Tooling');
  await page.getByTestId('rail-tree').click();
  await expect(page.getByTestId('category-index')).toBeVisible();
  // And the T key does the same.
  await page.getByTestId('index-card-cat_hiring').click();
  await expect(page.getByTestId('reading-list')).toContainText('Hiring');
  await page.keyboard.press('t');
  await expect(page.getByTestId('category-index')).toBeVisible();
});

/**
 * Home and Browse are two places. The logo is home — the briefing, with the
 * categories beneath it — and says so on the rail. Browse is the categories
 * alone. They used to be one screen with Browse lit, so pressing the logo
 * looked like being sent to Browse.
 */
test('the logo is home and Browse is the categories alone', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('rail-home')).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('rail-tree').click();
  await expect(page.getByTestId('category-index')).toBeVisible();
  await expect(page.getByTestId('briefing')).toHaveCount(0);
  await expect(page.getByTestId('home-diary-link')).toHaveCount(0);
  await expect(page.getByTestId('rail-tree')).toHaveAttribute('aria-current', 'page');

  // From anywhere — a category, another view — the logo is the briefing again.
  await page.getByTestId('index-card-cat_ai_tooling').click();
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('rail-home')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('s');
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('rail-tree')).not.toHaveAttribute('aria-current', 'page');
});
