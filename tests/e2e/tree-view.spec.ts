import { test, expect, type Page } from '@playwright/test';

/**
 * The browser is two panes: folders on the left, the open folder's contents on
 * the right. These tests assert that split — the taxonomy stays readable in the
 * left pane no matter how much is filed under it.
 */

const folder = (page: Page, text: string) =>
  page.locator('.folder').filter({ hasText: text }).first();

const parentCounts = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.folder--d0:not(.folder--answer)')].map(
      (r) =>
        `${r.querySelector('.folder__name')?.textContent}=${r.querySelector('.folder__count')?.textContent}`,
    ),
  );

/** Depth prefix per folder row, e.g. "0:Fundraising". */
const structure = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.folder:not(.folder--answer)')].map(
      (r) =>
        `${r.className.match(/folder--d(\d)/)?.[1]}:${r.querySelector('.folder__name')?.textContent}`,
    ),
  );

async function drag(page: Page, from: ReturnType<typeof folder>, to: ReturnType<typeof folder>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The browser is the landing view now — no key press to get here.
  await expect(page.getByTestId('tree-view')).toBeVisible();
});

test('lands in the browser with the first folder already open', async ({ page }) => {
  await expect(folder(page, 'Fundraising')).toHaveClass(/folder--open/);
  await expect(page.getByTestId('folder-contents')).toContainText('Fundraising');
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

test('the left pane holds folders only — memories live on the right', async ({ page }) => {
  await folder(page, 'AI Tooling').click();
  await expect(page.locator('.browser__folders .item')).toHaveCount(0);
  // A folder's contents include its subfolders', so the count agrees with the row.
  await expect(page.locator('.browser__contents .item')).toHaveCount(9);
});

test('expanding shows subfolders and never nests deeper than two', async ({ page }) => {
  await folder(page, 'Hiring').locator('.folder__twisty').click();
  await expect(folder(page, 'Interview Loops')).toBeVisible();

  for (const row of await structure(page)) {
    expect(Number(row.split(':')[0])).toBeLessThanOrEqual(1);
  }

  await folder(page, 'Hiring').locator('.folder__twisty').click();
  await expect(folder(page, 'Interview Loops')).toHaveCount(0);
});

// AI Tooling is flat in the seed — it is the folder the demo splits. A flat
// folder must not offer a control that does nothing.
test('a folder with no subfolders has no expand control', async ({ page }) => {
  await expect(folder(page, 'AI Tooling').locator('button.folder__twisty')).toHaveCount(0);
  await expect(folder(page, 'Hiring').locator('button.folder__twisty')).toHaveCount(1);
});

test('opening a folder drives the inspector', async ({ page }) => {
  await folder(page, 'Investor Notes').click();
  await expect(page.getByTestId('inspector')).toContainText('Investor Notes');
  await expect(page.getByTestId('inspector')).toContainText('4 memories');
});

test('dragging a memory onto a folder re-files it and locks it (AC-28)', async ({ page }) => {
  await folder(page, 'AI Tooling').click();
  await folder(page, 'Hiring').locator('.folder__twisty').click();

  const item = page.locator('.browser__contents .item').first();
  const target = folder(page, 'Interview Loops');
  const a = (await item.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByTestId('toast')).toContainText("Moved. Recall won't change this again.");
  const counts = await parentCounts(page);
  expect(counts).toContain('AI Tooling=8');
  expect(counts).toContain('Hiring=8');
});

test('dragging a subfolder onto another subfolder is refused and explained (AC-31)', async ({
  page,
}) => {
  const before = await structure(page);
  await drag(page, folder(page, 'Investor Notes'), folder(page, 'Pitch Feedback'));

  await expect(page.getByTestId('toast')).toContainText('Recall keeps categories two levels deep.');
  expect(await structure(page)).toEqual(before);
});

test('dragging a subfolder onto a different parent re-parents it', async ({ page }) => {
  await drag(page, folder(page, 'Investor Notes'), folder(page, 'Hiring'));

  await expect(page.getByTestId('toast')).toContainText('Moved Investor Notes into Hiring.');
  const counts = await parentCounts(page);
  expect(counts).toContain('Fundraising=7');
  expect(counts).toContain('Hiring=11');
});

test('the selection survives switching to the map', async ({ page }) => {
  await folder(page, 'Seed Benchmarks').click();
  await expect(page.getByTestId('inspector')).toContainText('Seed Benchmarks');

  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('Seed Benchmarks');
});

test('arrow keys walk the folders and open them', async ({ page }) => {
  await folder(page, 'Fundraising').click();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('inspector')).toContainText('Investor Notes');
  await expect(folder(page, 'Investor Notes')).toHaveClass(/folder--open/);

  await page.keyboard.press('ArrowUp');
  await expect(folder(page, 'Fundraising')).toHaveClass(/folder--open/);
  await page.keyboard.press('ArrowLeft');
  await expect(folder(page, 'Investor Notes')).toHaveCount(0);
});

test('an answer becomes a folder of what it cited', async ({ page }) => {
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('ask-input').press('Enter');

  // The answer opens its own folder, above the ones Recall built.
  await expect(page.getByTestId('folder-answer')).toBeVisible();
  await expect(page.getByTestId('folder-answer')).toHaveClass(/folder--open/);
  await expect(page.getByTestId('browser-answer')).toBeVisible();
  await expect(page.getByTestId('folder-contents')).toContainText('What Recall pulled');
  expect(await page.locator('.browser__contents .item').count()).toBeGreaterThan(0);

  // Escape clears the answer and the folder together.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-answer')).toHaveCount(0);
});

test('a search result opens in the browser instead of yanking you to the map', async ({ page }) => {
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('LangChain');
  await expect(page.getByTestId('bar-mode')).toHaveText('Search');
  await page.getByTestId('ask-input').press('Enter');

  await expect(page.getByTestId('tree-view')).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toHaveCount(0);
  await expect(page.locator('.item--selected')).toHaveCount(1);
});
