import { test, expect } from '@playwright/test';

/**
 * Korean all the way down. A few strings were written straight into
 * components and never met the dictionary — '2 more' on the arc, '3
 * memories' under a source — and two badges on a source row ran together
 * as one word. Locked here so they stay in the viewer's language, apart.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1&lang=ko');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('the index card says what its count is a count of', async ({ page }) => {
  await expect(page.getByTestId('index-card-cat_hiring')).toContainText('하위 카테고리 2개');
});

test('home shows no overflow node on the arc — the index already shows everything', async ({ page }) => {
  await expect(page.getByTestId('category-index')).toBeVisible();
  await expect(page.getByTestId('arc-node-__more__')).toHaveCount(0);
});

test.describe('in a narrow frame', () => {
  // Narrow enough that six categories do not all fit on the open arc.
  test.use({ viewport: { width: 1280, height: 900 } });

  test('inside a category the arc overflows again, in Korean', async ({ page }) => {
    await page.getByTestId('index-card-cat_ai_tooling').click();
    await expect(page.getByTestId('reading-list')).toContainText('AI Tooling');
    await expect(page.getByTestId('arc-node-__more__')).toContainText('개 더');
  });
});

test('a source counts its memories in Korean, and its badges stand apart', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();
  const row = page.locator('.source-row').first();
  const held = row.locator('.source-row__safe');
  const review = row.locator('.source-row__review, .source-row__reviewed');
  const a = (await held.boundingBox())!;
  const b = (await review.first().boundingBox())!;
  expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(6);

  await row.click();
  await expect(page.getByTestId('inspector')).toContainText(/기억 \d+개/);
  await expect(page.getByTestId('inspector')).not.toContainText(/\d+ memories/);
});
