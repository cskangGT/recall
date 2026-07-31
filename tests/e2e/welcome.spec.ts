import { test, expect } from '@playwright/test';

/**
 * There is no welcome *screen* any more — the first frame is the app, on the
 * hilltop, with nothing on the arc yet. "Look around" is a reveal in place, not
 * a navigation, so the tests here are about state changing under a screen that
 * never gets replaced.
 *
 * The one that earns its keep is still the second: whatever you type on the
 * first frame has to actually be answered, or the chat box is a decorative door.
 */

test('greets you on the app itself, with nothing on the arc yet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByText('Want to think something through?')).toBeVisible();
  // The scene is already the app — no separate frame to leave.
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  // But the categories are not out yet. That is what looking around does.
  await expect(page.locator('[data-testid^="arc-node-"]')).toHaveCount(0);
});

test('the first thing you type is answered, not discarded', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('welcome-input').press('Enter');

  await expect(page.getByTestId('browser-answer')).toBeVisible();
  await expect(page.getByTestId('arc-node-__answer__')).toBeVisible();
  // The answer reads in the browser, not the Inspector — the Inspector stops
  // repeating what the middle of the screen is already showing.
  await expect(page.getByTestId('browser-answer')).toContainText('LangChain');
});

test('looking around fans the categories in without changing screen', async ({ page }) => {
  await page.goto('/');
  const browser = page.getByTestId('arc-browser');
  await expect(browser).toBeVisible();

  await page.getByTestId('welcome-send').click();

  // Same element, still mounted — the reveal is content, not navigation.
  await expect(browser).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(page.getByText('Where would you like to look?')).toBeVisible();
  await expect(page.locator('[data-testid^="arc-node-"]').first()).toBeVisible();
  await expect(page.getByTestId('browser-answer')).toHaveCount(0);
});

/**
 * The Inspector's empty state used to be three lines of 25px display type, sized
 * for a screen you only reached after the welcome. Merging the two screens put
 * it in the first frame, where it was the loudest thing on it. The greeting
 * carries the scale now, so the panel has to stay quiet until you are inside.
 */
test('the workspace counts stay out of the first frame', async ({ page }) => {
  await page.goto('/');
  // The claim is in the sentence you are reading, not in the corner.
  await expect(page.getByTestId('welcome')).toContainText('47 memories');
  await expect(page.getByTestId('inspector')).not.toContainText('47 memories');

  await page.getByTestId('welcome-send').click();
  await expect(page.getByTestId('inspector')).toContainText('47 memories');
});

test('?skipWelcome=1 starts with the categories already out', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(page.locator('[data-testid^="arc-node-"]').first()).toBeVisible();
});
