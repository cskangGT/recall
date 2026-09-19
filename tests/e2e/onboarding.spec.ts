import { test, expect } from '@playwright/test';

/**
 * The first hour, and every visit after it.
 *
 * The greeting asks for the cheapest thing a person has — one thought, typed
 * — and the memory answers it in its own voice: what it kept and where. Then
 * what has piled up (the calendar beat is only drawn where the server has
 * that door; the seed has none). However the greeting is left, the next
 * visit opens on home, the logo means home, and Settings keeps the way back.
 */
const THOUGHT =
  'I need to decide whether we should hire a second infrastructure engineer this quarter or wait until the seed round closes.';

test('one thought in, the memory answers, and home opens on the first day', async ({ page }) => {
  await page.goto('/');
  const welcome = page.getByTestId('welcome');
  await expect(welcome).toHaveAttribute('data-step', 'thought');
  await expect(page.getByTestId('welcome-step')).toHaveText('1 / 2');

  // Nothing to hand over yet, nothing to press.
  await expect(page.getByTestId('welcome-first-send')).toBeDisabled();
  await page.getByTestId('welcome-first-input').fill(THOUGHT);
  await page.getByTestId('welcome-first-input').press('Enter');

  // The payoff: read back in the memory's voice, and where it went.
  const reply = page.getByTestId('welcome-reply');
  await expect(reply).toContainText('Read it.');
  await expect(reply).toContainText('hire a second');

  // The second beat: what has piled up — every way in, and a way past.
  await page.getByTestId('welcome-next').click();
  await expect(welcome).toHaveAttribute('data-step', 'pile');
  await expect(page.getByTestId('welcome-step')).toHaveText('2 / 2');
  await expect(page.getByTestId('fill-sources')).toBeVisible();
  await page.getByTestId('welcome-finish').click();

  // The hour ends at home; today, behind its first door, says the first day once.
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('door-today').click();
  await expect(page.getByTestId('morning-first-day')).toContainText('came to Mado today');

  // Next visit: straight to home, no greeting.
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});

test('Enter on the greeting goes to the thought box, and the shortcuts still work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('welcome-first-input')).toBeFocused();

  // Escape hands the keyboard back; a single-key shortcut navigates again.
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

test('looking around first skips the hour — home, the logo, and the way back', async ({ page }) => {
  await page.goto('/');
  // "Look around" means it: the categories, not another set of doors.
  await page.getByTestId('door-browse').click();
  await expect(page.getByTestId('category-index')).toBeVisible();

  // The logo, for someone who has been here, is home — not the greeting.
  await page.getByTestId('index-card-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toContainText('AI Tooling');
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  // Nothing was handed over, so there is no first day to announce.
  await page.getByTestId('door-today').click();
  await expect(page.getByTestId('morning-first-day')).toHaveCount(0);

  // Settings keeps the way back, and the hour starts over from its first beat.
  await page.keyboard.press(',');
  await page.getByTestId('settings-welcome-again').click();
  await expect(page.getByTestId('welcome')).toHaveAttribute('data-step', 'thought');
});

test('leaving the greeting through the diary counts as having seen it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.getByTestId('diary-view')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});
