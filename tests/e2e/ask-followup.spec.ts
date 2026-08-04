import { test, expect } from '@playwright/test';

/**
 * Follow-up questions: the conversation rides along, so a question with no
 * keywords of its own still lands — and "start fresh" ends the thread without
 * dismissing the answer on screen.
 */

const REFUSAL = "I don't have anything saved about that yet.";

test('a follow-up with no keywords of its own is answered through the thread', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // Alone, this question refuses — it names nothing the corpus knows.
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('And which tool won?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toHaveText(REFUSAL);
  await page.keyboard.press('Escape');

  // Asked as a follow-up, the thread resolves the referent.
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toBeVisible();
  await expect(page.getByTestId('answer')).not.toHaveText(REFUSAL);

  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('ask-followup')).toContainText('eval stack');
  await page.getByTestId('ask-input').fill('And which tool won?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toBeVisible();
  await expect(page.getByTestId('answer')).not.toHaveText(REFUSAL);
});

test('start fresh ends the thread but keeps the answer on screen', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');

  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toBeVisible();

  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('ask-followup')).toBeVisible();
  await page.getByTestId('ask-followup-clear').click();
  await expect(page.getByTestId('ask-followup')).toHaveCount(0);

  // The answer survives; only the conversation ended.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('answer')).toBeVisible();
});

test('escape ends the conversation with the answer', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');

  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toBeVisible();
  await page.keyboard.press('Escape'); // clears highlight + answer + thread

  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('ask-followup')).toHaveCount(0);
});
