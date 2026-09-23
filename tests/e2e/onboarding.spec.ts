import { test, expect } from '@playwright/test';

/**
 * The first conversation, and every visit after it.
 *
 * Not a tour: one thing this person cannot decide, taken all the way through
 * with Mado — what it is, what is in the way, those words threaded on the
 * map and tied into one thought, a line of it kept as their first category,
 * and only then what just happened said in three lines with the four
 * places. However the greeting is left, the next visit opens on home, and
 * the morning after asks after the thing by name.
 */
const THOUGHT = 'I still cannot decide whether to hire a second infrastructure engineer before the round closes.';
const WHY = [
  'The runway should cover eighteen months and it covers fourteen right now.',
  'I have not asked the first five engineers whether they would refer someone.',
].join('\n');

test('one thing undecided, taken all the way through', async ({ page }) => {
  await page.goto('/');
  const welcome = page.getByTestId('welcome');
  await expect(welcome).toHaveAttribute('data-step', 'thought');
  await expect(welcome).toContainText('keep not deciding');
  await expect(page.getByTestId('welcome-first-send')).toBeDisabled();

  // Beat 1 → 2: their words quoted back, and Mado asking after them.
  await page.getByTestId('welcome-first-input').fill(THOUGHT);
  await page.getByTestId('welcome-first-input').press('Enter');
  await expect(welcome).toHaveAttribute('data-step', 'why');
  await expect(page.getByTestId('welcome-quote')).toContainText('second infrastructure engineer');
  await expect(page.getByTestId('welcome-ask')).toContainText('keeping you from deciding');

  // Beat 2 → 3: what is in the way goes in, and the map opens on all of it,
  // picked and threaded, with Mado's first answer already asked for.
  await page.getByTestId('welcome-why-input').fill(WHY);
  await page.getByTestId('welcome-why-send').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('onboarding-guide')).toBeVisible();
  await expect(page.getByTestId('think-switch')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('[data-testid^="pick-"]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('map-conversation').getByTestId('answer')).toContainText('side by side');
  await expect(page.getByTestId('onboarding-guide')).toContainText('Keep a line of it');

  // A line kept makes the first category — theirs, named, their stars inside.
  await page.getByTestId('map-keep').click();
  await expect(page.getByTestId('map-kept')).toContainText('Kept in');
  await expect(page.getByTestId('think-bundle-name')).toBeVisible();
  await expect(page.getByTestId('onboarding-guide')).toContainText('is yours now');

  // Beat 4: what just happened, the four places, the doors — then begin.
  await page.getByTestId('onboarding-next').click();
  await expect(welcome).toHaveAttribute('data-step', 'learn');
  await expect(welcome).toContainText('put something in, asked, and kept');
  await expect(page.getByTestId('welcome-places')).toContainText('Diary');
  await expect(page.getByTestId('fill-sources')).toBeVisible();
  await page.getByTestId('welcome-finish').click();
  await expect(page.getByTestId('home')).toBeVisible();

  // The category is real: it is in Memory.
  await page.keyboard.press('t');
  const index = page.getByTestId('category-index');
  await expect(index).toBeVisible();
  expect(await index.locator('[data-testid^="index-card-"]').count()).toBeGreaterThan(6);

  // Next visit: straight to home, no greeting.
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});

test('the morning after asks after the thing by name', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome-first-input').fill(THOUGHT);
  await page.getByTestId('welcome-first-input').press('Enter');
  await page.getByTestId('welcome-why-skip').click();
  await expect(page.getByTestId('map-conversation').getByTestId('answer')).toBeVisible();
  await page.getByTestId('map-keep').click();
  await expect(page.getByTestId('think-bundle-name')).toBeVisible();
  const name = (await page.getByTestId('think-bundle-name').textContent())!.replace('✦', '').trim();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('welcome-finish').click();
  await expect(page.getByTestId('home')).toBeVisible();

  await page.clock.setFixedTime(new Date(Date.now() + 24 * 3600 * 1000));
  await page.reload();
  await page.getByTestId('door-today').click();
  await expect(page.getByTestId('morning-holding')).toContainText(name);
  await expect(page.getByTestId('morning-holding')).toContainText('Still?');
});

test('Enter on the greeting goes to the thought box, and the shortcuts still work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('welcome-first-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

test('looking around first skips the hour — home, the logo, and the way back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('door-browse').click();
  await expect(page.getByTestId('category-index')).toBeVisible();

  await page.getByTestId('index-card-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toContainText('AI Tooling');
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  // Nothing was handed over, so there is no first day to announce.
  await page.getByTestId('door-today').click();
  await expect(page.getByTestId('morning-first-day')).toHaveCount(0);

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
