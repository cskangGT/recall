import { test, expect } from '@playwright/test';

/**
 * Instant search — spec §5.6.
 *
 * The defect this closes: the bar showed a "Search" chip for non-question
 * input and then ran Ask on Enter. The first test is the one that matters —
 * the chip and the behaviour have to agree.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('ask-bar')).toBeVisible();
});

test('the mode chip matches what Enter actually does', async ({ page }) => {
  await page.getByTestId('ask-input').fill('langchain');
  await expect(page.getByTestId('bar-mode')).toHaveText('Search');
  await expect(page.getByTestId('search-results')).toBeVisible();

  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await expect(page.getByTestId('bar-mode')).toHaveText('Ask');
  await expect(page.getByTestId('search-results')).toHaveCount(0);
});

test('results appear as you type, grouped by category, with terms bolded', async ({ page }) => {
  await page.getByTestId('ask-input').fill('eval');
  await expect(page.getByTestId('search-results')).toBeVisible();

  await expect(page.locator('.bar__result')).not.toHaveCount(0);
  await expect(page.locator('.bar__group-name').first()).toBeVisible();
  await expect(page.locator('.bar__result mark').first()).toContainText(/eval/i);
});

test('Enter opens the top result on the map instead of answering', async ({ page }) => {
  await page.getByTestId('ask-input').fill('langchain');
  await expect(page.locator('.bar__result').first()).toBeVisible();

  await page.keyboard.press('Enter');

  await expect(page.getByTestId('ask-bar')).toHaveCount(0);
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  // A memory is selected, not an answer rendered.
  await expect(page.getByTestId('inspector')).toContainText('Memory');
  await expect(page.getByTestId('inspector')).toContainText('LangChain');
  await expect(page.getByTestId('answer')).toHaveCount(0);
});

/**
 * Regression: Enter used to read the debounced query, so anyone who typed and
 * hit Enter inside 120ms got an empty result list and no reaction at all. Enter
 * must act on what is in the box.
 */
test('Enter acts on what you typed, even inside the search debounce', async ({ page }) => {
  await page.getByTestId('ask-input').fill('langchain');
  await page.getByTestId('ask-input').press('Enter');

  await expect(page.getByTestId('ask-bar')).toHaveCount(0);
  await expect(page.getByTestId('inspector')).toContainText('LangChain');
});

test('clicking a result selects that memory', async ({ page }) => {
  await page.getByTestId('ask-input').fill('dilution');
  const first = page.locator('.bar__result').first();
  await expect(first).toBeVisible();
  await first.click();

  await expect(page.getByTestId('ask-bar')).toHaveCount(0);
  await expect(page.getByTestId('inspector')).toContainText('dilution');
});

test('a memory captured seconds ago is searchable', async ({ page }) => {
  // Nothing in the seed corpus mentions Braintrust — it arrives with the demo
  // capture. Search reads live state, not a build-time index.
  await expect(page.getByTestId('search-results')).toHaveCount(0);
  await page.getByTestId('ask-input').fill('braintrust');
  await expect(page.getByTestId('search-results')).toContainText('No matches.');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('braintrust');
  await expect(page.locator('.bar__result').first()).toContainText('Braintrust');
});

test('a query nobody saved says so rather than showing an empty box', async ({ page }) => {
  await page.getByTestId('ask-input').fill('zzzznotathing');
  await expect(page.getByTestId('search-results')).toContainText('No matches.');
});

test('Ask still works and still refuses', async ({ page }) => {
  await page.getByTestId('ask-input').fill('What is the capital of France?');
  await expect(page.getByTestId('bar-mode')).toHaveText('Ask');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toHaveText(
    "I don't have anything saved about that yet.",
  );
});
