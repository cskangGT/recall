import { test, expect, type Page } from '@playwright/test';

/**
 * A second capture during the first (spec AC-7).
 *
 * It used to hit `if (busy.current) return;` and vanish — no toast, no badge,
 * no retry. In a tool whose job is not losing things, a save that silently does
 * not happen is the worst failure available, because it looks exactly like one
 * that did.
 *
 * Seed mode is the right place to test this: `ingestItem` replays the demo item
 * on its own timer, so the busy window is real and deterministic without a
 * server or an API key.
 */

const capture = async (page: Page, text: string) => {
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await page.getByTestId('capture-input').fill(text);
  await page.getByTestId('capture-input').press('Enter');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('a second capture is queued rather than dropped', async ({ page }) => {
  await capture(page, 'the first thing');
  await expect(page.getByTestId('classify-panel')).toBeVisible();

  await capture(page, 'the second thing');

  // It said so, which is the whole point: the old behaviour was silence.
  await expect(page.locator('[aria-live="polite"]')).toContainText(/Queued/);
  await expect(page.getByTestId('queue-badge')).toHaveText('1 waiting');
});

test('the badge counts everything waiting and empties as they run', async ({ page }) => {
  await capture(page, 'one');
  await expect(page.getByTestId('classify-panel')).toBeVisible();
  await capture(page, 'two');
  await capture(page, 'three');

  await expect(page.getByTestId('queue-badge')).toHaveText('2 waiting');

  // Drains on its own, serially, and the badge goes with it.
  await expect(page.getByTestId('queue-badge')).toHaveCount(0, { timeout: 30_000 });
});

test('the queue actually runs — the panel comes back for the next one', async ({ page }) => {
  await capture(page, 'first');
  await expect(page.getByTestId('classify-panel')).toBeVisible();
  await capture(page, 'second');
  await expect(page.getByTestId('queue-badge')).toBeVisible();

  // The badge clearing is the queued item *starting*, not being thrown away.
  await expect(page.getByTestId('queue-badge')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('classify-panel')).toBeVisible();
});

test('nothing is queued when nothing is in flight', async ({ page }) => {
  await capture(page, 'the only thing');
  await expect(page.getByTestId('queue-badge')).toHaveCount(0);
});
