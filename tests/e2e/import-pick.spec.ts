import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The look before keeping, for an import. A reader's notes are listed —
 * read, not kept — and the person chooses: what is already in starts off,
 * a search narrows without changing what is on, and only the chosen go
 * through the batch, each with its way back.
 */

const seed = readFileSync(path.join(process.cwd(), 'seed/workspace.json'), 'utf8');
const known = (JSON.parse(seed) as { sources: { url: string | null; title: string; raw_content: string }[] }).sources[0]!;

const NOTES = [
  { title: 'Investor sync', firstLine: 'Kim: metrics first, team second.', content: 'Kim: metrics first, team second.\nBring the cohort chart.', chars: 55, modified: '2026-09-25T18:10:00Z', url: null },
  { title: 'Onboarding rework', firstLine: 'Eng: slipping a week slips the sprint.', content: 'Eng: slipping a week slips the sprint.\nSales: the demo needs that screen.', chars: 70, modified: '2026-09-24T09:00:00Z', url: null },
  { title: known.title, firstLine: known.raw_content.slice(0, 40), content: known.raw_content, chars: known.raw_content.length, modified: '2026-09-10T09:00:00Z', url: known.url },
];

async function liveServer(page: import('@playwright/test').Page) {
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: { error: 'not mocked' } }));
  await page.route('**/api/capabilities', (r) =>
    r.fulfill({ json: { appleNotes: true, notion: false, condense: false, google: false, pdf: false } }),
  );
  await page.route('**/api/workspaces/*/graph', (r) => r.fulfill({ contentType: 'application/json', body: seed }));
  await page.route('**/api/workspaces/*/import/apple-notes/list', (r) =>
    r.fulfill({ json: { notes: NOTES, total: 12, droppedSecretLines: 0 } }),
  );
  await page.addInitScript(() => localStorage.setItem('mado.ob.sync.notes', '2026-09-20T00:00:00Z'));
  await page.goto('/?api=1&skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('home')).toBeVisible();
}

test('the notes are listed before any is kept; what is already in starts off; only the chosen go through, with their way back', async ({ page }) => {
  await liveServer(page);
  let sent: { items?: { title: string; content: string; url?: string }[] } | null = null;
  await page.route('**/api/workspaces/*/capture/batch', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: (sent!.items ?? []).map((_, i) => ({ sourceId: `src_${i}`, status: 'complete', addedMemoryIds: [`mem_${i}`], touchedCategoryIds: [], skipped: [] })),
        reorgs: [],
        graph: JSON.parse(seed),
      }),
    });
  });

  await page.getByTestId('door-fill').click();
  await page.getByTestId('source-notes').click();
  const picker = page.getByTestId('import-picker');
  await expect(picker).toBeVisible();
  expect(sent).toBeNull();

  // Three rows; the new ones stand first; the one already in is dimmed and off.
  await expect(page.locator('[data-testid^="import-row-"]')).toHaveCount(3);
  await expect(page.getByTestId('import-group-new')).toContainText('Investor sync');
  await expect(page.getByTestId('import-row-2')).toHaveClass(/bar__section--off/);
  await expect(page.getByTestId('import-row-2')).toContainText('already in');
  await expect(page.getByTestId('import-count')).toContainText('2 of 3 on, 1 already in');
  await expect(page.getByTestId('import-keep')).toContainText('Bring in 2');

  // A search narrows the list without changing what is on.
  await page.getByTestId('import-search').fill('cohort');
  await expect(page.locator('[data-testid^="import-row-"]')).toHaveCount(1);
  await expect(page.getByTestId('import-keep')).toContainText('Bring in 2');
  await page.getByTestId('import-search').fill('');

  // One turned off by hand; the keep says so.
  await page.getByTestId('import-toggle-1').click();
  await expect(page.getByTestId('import-keep')).toContainText('Bring in 1');

  await page.getByTestId('import-keep').click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible();
  expect(sent!.items).toHaveLength(1);
  expect(sent!.items![0]).toMatchObject({ title: 'Investor sync', type: 'text' });
  expect(sent!.items![0]!.content).toContain('cohort chart');
});

test('nothing chosen keeps nothing; not now closes without a keep', async ({ page }) => {
  await liveServer(page);
  await page.getByTestId('door-fill').click();
  await page.getByTestId('source-notes').click();
  await expect(page.getByTestId('import-picker')).toBeVisible();
  await page.getByTestId('import-all-off').click();
  await expect(page.getByTestId('import-keep')).toBeDisabled();
  await page.getByTestId('import-cancel').click();
  await expect(page.getByTestId('import-picker')).toHaveCount(0);
});
