import { test, expect } from '@playwright/test';

/**
 * The welcome screen is a conversation, not a splash.
 *
 * The test that earns its keep is the second one: whatever you type here has to
 * actually be answered, or the chat box is a decorative door.
 */

test('greets you before any data, with nothing else on screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByText('Want to think something through?')).toBeVisible();
  // No rail and no inspector — a welcome framed by the app is just a modal.
  await expect(page.getByTestId('arc-browser')).toHaveCount(0);
  await expect(page.getByTestId('inspector')).toHaveCount(0);
});

test('the first thing you type is answered, not discarded', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('welcome-input').press('Enter');

  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('browser-answer')).toBeVisible();
  await expect(page.getByTestId('arc-node-__answer__')).toBeVisible();
  // The answer reads in the browser, not the Inspector — the Inspector stops
  // repeating what the middle of the screen is already showing.
  await expect(page.getByTestId('browser-answer')).toContainText('LangChain');
});

test('an empty submit just goes in', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome-send').click();

  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('browser-answer')).toHaveCount(0);
});

test('?skipWelcome=1 bypasses it for automation', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});
