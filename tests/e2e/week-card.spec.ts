import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Once a week, where the server can look back: the first visit of a week
 * whose predecessor has diary pages offers "the you of last week". The card
 * is a door — it opens the diary on that look-back — and, taken or put
 * away, it is not offered again that week. The clock is pinned to Wednesday
 * 2026-09-16 (New York, the suite's zone); last week is the 7th to the 13th.
 */
const seed = JSON.parse(readFileSync(path.join(process.cwd(), 'seed/workspace.json'), 'utf8'));
const withDiary = {
  ...seed,
  sources: seed.sources.map((s: { id: string }, i: number) =>
    i === 0 ? { ...s, diary_date: '2026-09-09' } : i === 1 ? { ...s, diary_date: '2026-09-11' } : s,
  ),
};

async function mockServer(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: { error: 'not mocked' } }));
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { appleNotes: false, notion: false, condense: false, google: false } }),
  );
  await page.route('**/api/workspaces/*/graph', (route) => route.fulfill({ json: withDiary }));
  await page.route('**/api/workspaces/*/diary/retro', (route) => {
    const body = route.request().postDataJSON() as { from: string; to: string };
    return route.fulfill({ json: { reflection: `looked back ${body.from}..${body.to}`, days: 2 } });
  });
}

test('last week is offered once, and opens the diary on its look-back', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-16T09:00:00-04:00'));
  await mockServer(page);
  await page.goto('/?api=1&skipWelcome=1');
  await page.getByTestId('rail-today').click();

  const card = page.getByTestId('morning-week');
  await expect(card).toContainText('2 diary days');
  await card.click();

  await expect(page.getByTestId('diary-view')).toBeVisible();
  const retro = page.getByTestId('diary-retro-card');
  await expect(retro).toContainText('The you of last week');
  await expect(retro).toContainText('looked back 2026-09-07..2026-09-13');

  // Not again this week.
  await page.reload();
  await page.getByTestId('rail-today').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('morning-week')).toHaveCount(0);
});

test('seed mode has no look-back door, so no weekly card', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-16T09:00:00-04:00'));
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-today').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('morning-week')).toHaveCount(0);
});
