import { test, expect, type Page } from '@playwright/test';

const rowByText = (page: Page, text: string) =>
  page.locator('[data-row-id]').filter({ hasText: text }).first();

const parentCounts = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tree__row--d0')].map(
      (r) =>
        `${r.querySelector('.tree__label')?.textContent}=${r.querySelector('.tree__count')?.textContent}`,
    ),
  );

/** Depth prefix per category row, e.g. "0:Fundraising". */
const structure = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tree__row--category')].map(
      (r) =>
        `${r.className.match(/tree__row--d(\d)/)?.[1]}:${r.querySelector('.tree__label')?.textContent}`,
    ),
  );

async function dragRow(page: Page, from: ReturnType<typeof rowByText>, to: ReturnType<typeof rowByText>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByTestId('tree-view')).toBeVisible();
});

test('renders the two-level taxonomy with counts', async ({ page }) => {
  expect(await parentCounts(page)).toEqual([
    'Fundraising=11',
    'AI Tooling=9',
    'Hiring=7',
    'Product=8',
    'Go-to-Market=6',
    'Personal Systems=6',
  ]);
});

test('expands and collapses, and never nests deeper than two categories', async ({ page }) => {
  await rowByText(page, 'AI Tooling').locator('.tree__twisty').click();
  await expect(page.locator('.tree__row--memory')).toHaveCount(9);

  await rowByText(page, 'AI Tooling').locator('.tree__twisty').click();
  await expect(page.locator('.tree__row--memory')).toHaveCount(0);

  for (const row of await structure(page)) {
    expect(Number(row.split(':')[0])).toBeLessThanOrEqual(1);
  }
});

test('selecting a row drives the inspector', async ({ page }) => {
  await rowByText(page, 'Investor Notes').click();
  await expect(page.getByTestId('inspector')).toContainText('Investor Notes');
  await expect(page.getByTestId('inspector')).toContainText('4 memories');
});

test('dragging a memory re-files it and locks the assignment (AC-28)', async ({ page }) => {
  await rowByText(page, 'AI Tooling').locator('.tree__twisty').click();
  await rowByText(page, 'Hiring').locator('.tree__twisty').click();

  await dragRow(page, page.locator('.tree__row--memory').first(), rowByText(page, 'Interview Loops'));

  await expect(page.getByTestId('toast')).toContainText("Moved. Recall won't change this again.");
  const counts = await parentCounts(page);
  expect(counts).toContain('AI Tooling=8');
  expect(counts).toContain('Hiring=8');
});

test('dragging a child onto another child is refused and explained (AC-31)', async ({ page }) => {
  const before = await structure(page);
  await dragRow(page, rowByText(page, 'Investor Notes'), rowByText(page, 'Pitch Feedback'));

  await expect(page.getByTestId('toast')).toContainText('Recall keeps categories two levels deep.');
  expect(await structure(page)).toEqual(before);
});

test('dragging a child onto a different parent re-parents it', async ({ page }) => {
  await dragRow(page, rowByText(page, 'Investor Notes'), rowByText(page, 'Hiring'));

  await expect(page.getByTestId('toast')).toContainText('Moved Investor Notes into Hiring.');
  const counts = await parentCounts(page);
  expect(counts).toContain('Fundraising=7');
  expect(counts).toContain('Hiring=11');
});

test('the selection survives switching back to the map', async ({ page }) => {
  await rowByText(page, 'Seed Benchmarks').click();
  await expect(page.getByTestId('inspector')).toContainText('Seed Benchmarks');

  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('Seed Benchmarks');
});

test('arrow keys walk the visible rows and open a category', async ({ page }) => {
  await rowByText(page, 'Fundraising').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('inspector')).toContainText('Investor Notes');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tree__row--memory')).toHaveCount(4);

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.tree__row--memory')).toHaveCount(0);
});
