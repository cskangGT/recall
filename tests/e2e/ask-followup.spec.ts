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

test('the conversation stacks in the browse answer view', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  // First question: its own bubble above the answer, no past yet.
  await page.getByTestId('composer-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.getByTestId('browser-answer')).toBeVisible();
  await expect(page.getByTestId('thread-question')).toContainText('eval stack');
  await expect(page.getByTestId('ask-thread')).toHaveCount(0);

  // Second question: the first turn dims into the thread above the new answer.
  await page.getByTestId('composer-input').fill('And which tool won?');
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.getByTestId('thread-question')).toContainText('which tool won');
  await expect(page.getByTestId('ask-thread')).toContainText('eval stack');
  await expect(page.getByTestId('ask-thread')).toBeVisible();

  // Escape ends the conversation; nothing of the thread survives it. Twice,
  // because focus is still in the composer: the first Escape only hands the
  // keyboard back (the composer's own ladder), the second reaches the store.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ask-thread')).toHaveCount(0);
  await expect(page.getByTestId('browser-answer')).toHaveCount(0);
});
