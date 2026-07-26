import { test, expect, type Page } from '@playwright/test';

/**
 * The demo against a live backend — the claim the whole architecture rests on.
 *
 * Every phase has asserted that swapping the data source changes nothing above
 * it. This is where that stops being an assertion. Same click path as
 * `demo-path.spec.ts`, same expected strings, but the map, the split, and the
 * citations all come over HTTP from SQLite instead of out of a JSON file.
 *
 * Requires the API: `npm run dev:api` (port 5174, proxied by the dev server).
 */

const API_MODE = '/?api=1';

async function apiReachable(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get('/api/workspaces/ws_demo/graph');
    return res.ok();
  } catch {
    return false;
  }
}

test.beforeEach(async ({ page }) => {
  test.skip(!(await apiReachable(page)), 'API not running — start it with `npm run dev:api`');
  // The server holds one database for its whole lifetime, so without this each
  // test would inherit whatever the previous one wrote. Seed mode gets a clean
  // slate from a page reload; API mode has to ask for one.
  await page.request.post('/api/workspaces/ws_demo/reset');
});

test('the map loads from the database, not the seed file', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });

  await page.goto(API_MODE);
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('47 memories');
  await expect(page.getByTestId('inspector')).toContainText('22 sources');

  // The inverse of demo-path.spec.ts, which fails if *any* API call happens.
  expect(apiCalls).toContain('GET /api/workspaces/ws_demo/graph');
});

test('seed mode still makes no API calls at all', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) apiCalls.push(r.url());
  });

  await page.goto('/');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForTimeout(500);

  // The demo, the rehearsal harness, and the E2E suite all depend on this.
  // Adding an API must not have quietly spent it.
  expect(apiCalls).toEqual([]);
});

test('a user correction persists to the server (AC-28)', async ({ page }) => {
  await page.goto(API_MODE);
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  await page.keyboard.press('t');
  await expect(page.getByTestId('tree-view')).toBeVisible();

  const rowByText = (text: string) =>
    page.locator('[data-row-id]').filter({ hasText: text }).first();
  await rowByText('AI Tooling').locator('.tree__twisty').click();
  await rowByText('Hiring').locator('.tree__twisty').click();

  const from = await page.locator('.tree__row--memory').first().boundingBox();
  const to = await rowByText('Interview Loops').boundingBox();
  await page.mouse.move(from!.x + 40, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + 40, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByTestId('toast')).toContainText("Moved. Recall won't change this again.");

  // Reload: if the move only happened in the store, it is gone now.
  await page.reload();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.keyboard.press('t');
  await rowByText('Hiring').locator('.tree__twisty').click();

  const counts = await page.evaluate(() =>
    [...document.querySelectorAll('.tree__row--d0')].map(
      (r) =>
        `${r.querySelector('.tree__label')?.textContent}=${r.querySelector('.tree__count')?.textContent}`,
    ),
  );
  expect(counts).toContain('Hiring=8');
  expect(counts).toContain('AI Tooling=8');
});
