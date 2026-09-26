import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * On a hosted Mado a visitor's workspace is known only to their browser.
 * Until there is an account the link is the account: Settings shows the way
 * back, the first conversation ends on it, and a link that names a workspace
 * makes the browser that opens it that workspace's. `?api=visitor` is the
 * hosted case in development — each visitor minted their own workspace.
 */
const seed = readFileSync(path.join(process.cwd(), 'seed/workspace.json'), 'utf8');

async function hosted(page: Page) {
  const seen: string[] = [];
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: { error: 'not mocked' } }));
  await page.route('**/api/capabilities', (r) =>
    r.fulfill({ json: { appleNotes: false, notion: false, condense: false, google: false, pdf: false, askBack: false } }),
  );
  await page.route('**/api/workspaces', (r) => r.fulfill({ json: { workspaceId: 'ws_minted' } }));
  await page.route('**/api/workspaces/*/graph', (r) => {
    seen.push(new URL(r.request().url()).pathname);
    return r.fulfill({ contentType: 'application/json', body: seed });
  });
  return seen;
}

test('a fresh visitor is minted a workspace, and Settings shows the way back to it', async ({ page }) => {
  const seen = await hosted(page);
  await page.addInitScript(() => localStorage.setItem('mado.ob.welcomed', '1'));
  await page.goto('/?api=visitor');
  await expect(page.getByTestId('home')).toBeVisible();
  expect(seen[0]).toContain('/workspaces/ws_minted/');

  await page.keyboard.press(',');
  const url = page.getByTestId('return-link-url');
  await expect(url).toHaveValue(/\?ws=ws_minted$/);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('return-link-copy').click();
  await expect(page.getByTestId('toast').last()).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\?ws=ws_minted$/);
});

test('a link that names a workspace is followed, remembered, and stripped from the address', async ({ page }) => {
  const seen = await hosted(page);
  await page.addInitScript(() => localStorage.setItem('mado.ob.welcomed', '1'));
  // This browser already has a workspace of its own…
  await page.goto('/?api=visitor');
  await expect(page.getByTestId('home')).toBeVisible();
  expect(seen.at(-1)).toContain('/workspaces/ws_minted/');
  // …and a link naming another wins: that is what following it means.
  await page.goto('/?api=visitor&ws=ws_from_link&invite=tok');
  await expect(page.getByTestId('home')).toBeVisible();
  expect(seen.at(-1)).toContain('/workspaces/ws_from_link/');
  await expect(page).toHaveURL(/\?api=visitor$/);

  // Remembered: the next visit, with nothing in the address, is the same workspace — and the link carries the invite.
  await page.goto('/?api=visitor');
  await expect(page.getByTestId('home')).toBeVisible();
  expect(seen.at(-1)).toContain('/workspaces/ws_from_link/');
  await page.keyboard.press(',');
  await expect(page.getByTestId('return-link-url')).toHaveValue(/\?ws=ws_from_link&invite=tok$/);
});

test('the first conversation ends on the way back', async ({ page }) => {
  await hosted(page);
  await page.route('**/api/workspaces/*/capture', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ addedMemoryIds: ['mem_11'], reorg: null, graph: JSON.parse(seed) }) }),
  );
  await page.route('**/api/workspaces/*/ask', (r) =>
    r.fulfill({ json: { answer: 'Held side by side these say one thing [1].', citations: [{ n: 1, memory_id: 'mem_11', source_id: 'src_11' }], highlighted_node_ids: ['mem_11'], refused: false } }),
  );
  await page.route('**/api/workspaces/*/ask/stream', (r) => r.fulfill({ status: 404, json: {} }));
  await page.route('**/api/workspaces/*/categories', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ categoryId: 'cat_new', graph: JSON.parse(seed) }) }),
  );
  await page.route('**/api/workspaces/*/memories/*/category', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ graph: JSON.parse(seed) }) }),
  );
  await page.goto('/?api=visitor');
  await page.getByTestId('role-skip').click();
  await page.getByTestId('welcome-first-input').fill('Whether to take the offer or stay.');
  await page.getByTestId('welcome-first-input').press('Enter');
  await page.getByTestId('welcome-why-skip').click();
  await expect(page.getByTestId('onboarding-guide')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('welcome')).toHaveAttribute('data-step', 'learn');
  await expect(page.getByTestId('return-link')).toContainText('Keep this link');
  await expect(page.getByTestId('return-link-url')).toHaveValue(/\?ws=ws_minted$/);
});
