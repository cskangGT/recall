import { test, expect } from '@playwright/test';

/**
 * The first conversation, and every visit after it.
 *
 * Not a tour: the thing on this person's mind, talked through with Mado —
 * two questions and a closing, every answer theirs — then the lines of it
 * worth keeping, picked in their words, each on or off, and what stays
 * becomes their first memories and their first category; only then what
 * just happened, said in three lines with the four places. However the
 * greeting is left, the next visit opens on home, and the morning after
 * asks after the thing by name.
 */
// Not a thing the demo corpus already holds: the seed pipeline folds a repeat into the memory it met.
const THOUGHT = 'I keep wondering whether to move the whole team to a four-day week before the winter push.';
const ANSWER_1 = 'It started after the last board call. The runway covers fourteen months and I want eighteen.';
const ANSWER_2 = 'If it went well we would ship the platform work by spring. I already know the first five engineers would refer someone.';

test('the thing on their mind, talked through, and what of it kept', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('prologue-next').click();
  const welcome = page.getByTestId('welcome');
  await expect(welcome).toHaveAttribute('data-step', 'thought');
  // Who they are, in one press — then the question, with an example that is theirs.
  await expect(welcome).toContainText('second memory');
  await expect(page.getByTestId('welcome-roles')).toBeVisible();
  await expect(page.getByTestId('welcome-first-input')).toHaveCount(0);
  await page.getByTestId('role-ceo').click();
  await expect(welcome).toContainText('on your mind');
  await expect(page.getByTestId('welcome-first-input')).toHaveAttribute('placeholder', /runway|growing/);
  await expect(page.getByTestId('welcome-first-send')).toBeDisabled();

  // Beat 1 → 2: said, not kept — the talk opens on it, Mado asking after it.
  await page.getByTestId('welcome-first-input').fill(THOUGHT);
  await page.getByTestId('welcome-first-input').press('Enter');
  await expect(welcome).toHaveAttribute('data-step', 'talk');
  await expect(page.getByTestId('welcome-turn-you-0')).toContainText('four-day week');
  await expect(page.getByTestId('welcome-mado')).toContainText('Say a bit more');

  // Two answers, two questions, then the closing — and the way to what is worth keeping.
  await page.getByTestId('welcome-talk-input').fill(ANSWER_1);
  await page.getByTestId('welcome-talk-send').click();
  await expect(page.getByTestId('welcome-mado')).toContainText('went the way');
  await page.getByTestId('welcome-talk-input').fill(ANSWER_2);
  await page.getByTestId('welcome-talk-input').press('Enter');
  await expect(page.getByTestId('welcome-mado')).toContainText('worth keeping');
  await expect(page.getByTestId('welcome-talk-input')).toHaveCount(0);
  await page.getByTestId('welcome-talk-keep').click();

  // Beat 3: the lines, in their words — each on or off, each editable.
  await expect(welcome).toHaveAttribute('data-step', 'keep');
  const rows = page.locator('[data-testid^="welcome-line-toggle-"]');
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('welcome-line-input-0')).toHaveValue(/four-day week/);
  await page.getByTestId('welcome-line-toggle-1').click();
  await expect(page.getByTestId('welcome-line-1')).toHaveClass(/bar__section--off/);
  await page.getByTestId('welcome-line-input-0').fill('Whether to move the team to a four-day week before the winter push.');
  const total = await rows.count();
  await expect(page.getByTestId('welcome-keep')).toContainText(`Keep ${total - 1} lines`);
  await page.getByTestId('welcome-keep').click();

  // Beat 4: what just happened, the four places, the doors — then begin.
  await expect(welcome).toHaveAttribute('data-step', 'learn');
  await expect(welcome).toContainText('put something in, asked, and kept');
  await expect(page.getByTestId('welcome-learn-past')).toContainText('past self');
  await expect(page.getByTestId('welcome-places')).toContainText('Diary');
  const bundle = await page.evaluate(() => localStorage.getItem('mado.ob.firstBundle'));
  expect(bundle).toBeTruthy();
  await expect(welcome).toContainText(bundle!);

  // The meeting beat: one upcoming meeting in a line, and — from their own
  // words so far — what Mado would put in front of them before it.
  await page.getByTestId('welcome-meeting-input').fill('Thursday with Sujin, about the infra hire');
  await page.getByTestId('welcome-meeting-preview').click();
  const card = page.getByTestId('welcome-meeting-card');
  await expect(card).toContainText('Before that meeting, Mado brings this up');
  expect(await card.locator('.memory-row').count()).toBeGreaterThan(0);
  await expect(card).toContainText('comes back before the next');
  await page.getByTestId('welcome-meeting-keep').click();
  await expect(page.getByTestId('welcome-meeting-kept')).toContainText('Kept');
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

test('the talk can be cut short, and the morning after asks after the thing by name', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('prologue-next').click();
  await page.getByTestId('role-skip').click();
  await page.getByTestId('welcome-first-input').fill(THOUGHT);
  await page.getByTestId('welcome-first-input').press('Enter');
  await expect(page.getByTestId('welcome-mado')).toContainText('Say a bit more');
  // Enough — straight to the lines, which are their own sentences.
  await page.getByTestId('welcome-talk-enough').click();
  await expect(page.getByTestId('welcome')).toHaveAttribute('data-step', 'keep');
  await expect.poll(() => page.locator('[data-testid^="welcome-line-toggle-"]').count()).toBeGreaterThanOrEqual(1);
  await page.getByTestId('welcome-keep').click();
  await expect(page.getByTestId('welcome')).toHaveAttribute('data-step', 'learn');
  const name = (await page.evaluate(() => localStorage.getItem('mado.ob.firstBundle')))!;
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
  await page.getByTestId('prologue-next').click();
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByTestId('role-developer').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('welcome-first-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

test('looking around first skips the hour — home, the logo, and the way back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('prologue-next').click();
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
  // The greeting again plays the first words again.
  await expect(page.getByTestId('welcome')).toHaveAttribute('data-step', 'prologue');
  await page.getByTestId('prologue-next').click();
  await expect(page.getByTestId('welcome')).toHaveAttribute('data-step', 'thought');
});

test('leaving the greeting through the diary counts as having seen it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('prologue-next').click();
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.getByTestId('diary-view')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});

test('the role is remembered, can be changed, and skipping keeps the question general', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('prologue-next').click();
  await page.getByTestId('role-researcher').click();
  await expect(page.getByTestId('role-chosen')).toContainText('Researcher');
  await page.reload();
  await expect(page.getByTestId('role-chosen')).toContainText('Researcher');
  await page.getByTestId('role-chosen').click();
  await expect(page.getByTestId('welcome-roles')).toBeVisible();
  await page.getByTestId('role-skip').click();
  await expect(page.getByTestId('role-chosen')).toHaveCount(0);
  await expect(page.getByTestId('welcome-first-input')).toHaveAttribute('placeholder', /e\.g\./);
});
