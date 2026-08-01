import { test, expect, type Page } from '@playwright/test';

/**
 * The spec 15.3 click path, automated. This is the proof of AC-42: the whole
 * 60-second demo runs with no backend, and the test fails if any request
 * touches an API path.
 */

function watchForBackendCalls(page: Page): string[] {
  const offences: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (/\/api\//.test(url) || /\/graphql/.test(url)) offences.push(`API call: ${url}`);
  });
  return offences;
}

test('the 60-second demo path runs end to end with no backend (AC-42)', async ({ page }) => {
  const offences = watchForBackendCalls(page);

  // ---- Beat 1: recognition
  //
  // The app opens in the folder browser — "everything you saved, already filed"
  // reads faster as folders than as a graph. G then turns the same corpus into
  // the map, which is the surface Beat 2 reorganizes.
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('inspector')).toContainText('47 memories');
  await expect(page.getByTestId('inspector')).toContainText('22 sources');

  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // ---- Beat 2: the magic
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('capture-bar')).toBeHidden();

  await expect(page.getByTestId('status-ticker')).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Split AI Tooling into Agent Frameworks and Evals & Observability',
    { timeout: 30_000 },
  );

  // ---- Beat 3: the payoff
  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('ask-bar')).toBeVisible();
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('answer')).toBeVisible();
  await expect(page.getByTestId('citation-3')).toBeVisible();
  await page.getByTestId('citation-3').click();
  await expect(page.getByTestId('source-card')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('Thread on eval harnesses');

  expect(offences).toEqual([]);
});

test('undo restores the map (AC-22)', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId('inspector')).toContainText('22 categories');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toBeHidden();
  await expect(page.getByTestId('toast')).toContainText('Reverted.');

  // Undo reverses the reorganization, not the capture: the two split children
  // are gone (22 -> 20 categories) but the captured memories stay. Undoing a
  // capture is out of scope (spec 14).
  await expect(page.getByTestId('inspector')).toContainText('20 categories');
  await expect(page.getByTestId('inspector')).toContainText('49 memories');
});

test('an unsupported question is refused verbatim (AC-35, AC-37)', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What is the capital of France?');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('answer')).toHaveText(
    "I don't have anything saved about that yet.",
  );
  await expect(page.getByTestId('citation-1')).toHaveCount(0);
});

test('below 1280px it refuses to render the app (AC-41)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/?skipWelcome=1');
  await expect(
    page.getByText('Recall is desktop-first. Please open on a larger screen.'),
  ).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toHaveCount(0);
});

/**
 * The width gate alone let the scene render into a window too short to hold it.
 * At 1280x720 the crest lands at 619px, the 190px figure's head reaches 429px,
 * the greeting starts at 187px and the arc's innermost node sits between them —
 * and `body { overflow: hidden }` means none of it can scroll apart.
 */
test('a wide but short window is refused too', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/?skipWelcome=1');
  await expect(
    page.getByText('Recall is desktop-first. Please open on a larger screen.'),
  ).toBeVisible();
  await expect(page.getByTestId('arc-browser')).toHaveCount(0);
});

test('the gate lets go as soon as the window is big enough', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});
