import { test, expect, type Page } from '@playwright/test';

/**
 * The arc browser — categories fanned above a thinking figure, memories in a
 * reading list below.
 *
 * It replaced a two-pane list outright, so everything the list was responsible
 * for has to be proved here: re-filing a memory (AC-28), refusing a third level
 * (AC-31), the answer folder, and search landing you in the right place.
 */

const node = (page: Page, id: string) => page.getByTestId(`arc-node-${id}`);
const named = (page: Page, label: string) =>
  page.locator('.arc__node').filter({ hasText: label }).first();

const arcLabels = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.arc__node--folder')].map(
      (n) =>
        `${n.querySelector('.arc__label')?.textContent}=${n.querySelector('.arc__count')?.textContent}`,
    ),
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('opens on the top level with every parent category on the arc', async ({ page }) => {
  expect(await arcLabels(page)).toEqual([
    'Fundraising=11',
    'AI Tooling=9',
    'Hiring=7',
    'Product=8',
    'Go-to-Market=6',
    'Personal Systems=6',
  ]);
  // Nothing is open yet, so the reading list stays out of the way.
  await expect(page.getByTestId('reading-list')).toHaveCount(0);
});

test('drilling into a category fans out its children and fills the reading list', async ({
  page,
}) => {
  await node(page, 'cat_fundraising').click();

  await expect(named(page, 'Investor Notes')).toBeVisible();
  await expect(named(page, 'Pitch Feedback')).toBeVisible();
  await expect(named(page, 'Seed Benchmarks')).toBeVisible();
  // The list holds the parent's memories, subfolders included, so it agrees
  // with the count that was on the cloud.
  await expect(page.locator('.reading .item')).toHaveCount(11);
});

test('a category with no children opens its memories without descending', async ({ page }) => {
  // AI Tooling is flat in the seed — it is the one the demo splits.
  await node(page, 'cat_ai_tooling').click();

  await expect(page.locator('.reading .item')).toHaveCount(9);
  await expect(named(page, 'Back')).toHaveCount(0);
  await expect(named(page, 'Fundraising')).toBeVisible();
});

test('back returns to the top level', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await expect(named(page, 'Investor Notes')).toBeVisible();

  await named(page, 'Back').click();
  await expect(named(page, 'Investor Notes')).toHaveCount(0);
  expect(await arcLabels(page)).toHaveLength(6);
});

test('Backspace also climbs a level', async ({ page }) => {
  await node(page, 'cat_hiring').click();
  await expect(named(page, 'Interview Loops')).toBeVisible();

  await page.keyboard.press('Backspace');
  await expect(named(page, 'Interview Loops')).toHaveCount(0);
});

test('dragging a memory onto a category re-files it and locks it (AC-28)', async ({ page }) => {
  await node(page, 'cat_ai_tooling').click();
  const item = page.locator('.reading .item').first();

  const a = (await item.boundingBox())!;
  const target = (await named(page, 'Hiring').boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 14 });
  await page.mouse.up();

  await expect(page.getByTestId('toast')).toContainText("Moved. Recall won't change this again.");
  const labels = await arcLabels(page);
  expect(labels).toContain('AI Tooling=8');
  expect(labels).toContain('Hiring=8');
});

test('dragging a subcategory onto a parent re-parents it', async ({ page }) => {
  await node(page, 'cat_fundraising').click();

  // The parents arrive as an extra strip during the drag. They are added
  // alongside the arc rather than replacing it — replacing it unmounts the
  // dragged node's siblings and wedges the browser's drag loop.
  await named(page, 'Investor Notes').dragTo(page.getByTestId('reparent-target-cat_hiring'));

  await expect(page.getByTestId('toast')).toContainText('Moved Investor Notes into Hiring.');
});

test('a subcategory cannot be nested under another subcategory (AC-31)', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await named(page, 'Investor Notes').dragTo(named(page, 'Pitch Feedback'));

  await expect(page.getByTestId('toast')).toContainText('Recall keeps categories two levels deep.');
});

test('an answer becomes a cloud of its own with the citations below it', async ({ page }) => {
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('ask-input').press('Enter');

  await expect(page.getByTestId('arc-node-__answer__')).toBeVisible();
  await expect(page.getByTestId('browser-answer')).toBeVisible();
  expect(await page.locator('.reading .item').count()).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('arc-node-__answer__')).toHaveCount(0);
});

test('a search result opens its category rather than jumping to the map', async ({ page }) => {
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('LangChain');
  await expect(page.getByTestId('bar-mode')).toHaveText('Search');
  await page.getByTestId('ask-input').press('Enter');

  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toHaveCount(0);
  await expect(page.locator('.item--selected')).toHaveCount(1);
});

test('the selection survives switching to the map', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await expect(page.getByTestId('inspector')).toContainText('Fundraising');

  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('Fundraising');
});

test('capturing shows the classification happening', async ({ page }) => {
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');

  // The browsing screen has no ghost node, so without this panel the filing
  // would happen entirely invisibly.
  await expect(page.getByTestId('classify-panel')).toBeVisible();
  await expect(page.getByTestId('classify-panel')).toContainText('Reading');

  await expect(page.getByRole('status')).toContainText('Split AI Tooling', { timeout: 30_000 });
  await expect(page.getByTestId('classify-panel')).toHaveCount(0);
});

/**
 * The user story the demo is built around: drop something in, and the app tells
 * you what it read, whether it had seen it before, and where it put it.
 */
test('the capture story says what was read, what was new, and where it went', async ({ page }) => {
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');

  const story = page.getByTestId('capture-story');
  await expect(story).toBeVisible({ timeout: 30_000 });
  await expect(story).toContainText('What Recall saw');
  await expect(page.getByTestId('capture-story-memory')).toHaveCount(2);

  // One of the two echoes an eval memory already in the corpus — that verdict
  // is real cosine similarity against the pre-capture payload, not a caption.
  await expect(page.getByTestId('capture-story-echo')).toHaveCount(1);
  await expect(page.getByTestId('capture-story-new')).toHaveCount(1);

  await expect(page.getByTestId('capture-story-destination')).toContainText('AI Tooling');
});
