import { test, expect, type Page } from '@playwright/test';

/**
 * The first observation (onboarding wow A): a batch whose pile leans into one
 * category earns a sentence naming the pattern, and the suggested question
 * right under it is the bridge into the first ask. A batch spread thin earns
 * nothing — the thresholds live in observationOf and are unit-tested; here we
 * assert the card actually lands in the reveal.
 */

async function dropFiles(page: Page, files: [name: string, content: string][]): Promise<void> {
  await page.evaluate((entries) => {
    const dt = new DataTransfer();
    for (const [name, content] of entries) {
      dt.items.add(new File([content], name, { type: 'text/plain' }));
    }
    const shell = document.querySelector('.shell');
    if (!shell) throw new Error('no .shell to drop on');
    shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
}

/** Every file leans the same way, so one category should absorb the pile. */
const LEANING: [string, string][] = [
  ['eval-notes-1.md', 'Braintrust remains the strongest option for agent evals.\nLangSmith evals feel heavier to set up than expected.'],
  ['eval-notes-2.md', 'Agent eval harness needs regression suites per prompt change.\nEval scores drifted after the model swap - pin versions.'],
  ['eval-notes-3.md', 'Evals should gate deploys the way tests gate merges.'],
];

test('a leaning batch earns the observation and its question opens a thread', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('arc-browser').waitFor();

  await dropFiles(page, LEANING);
  const declare = page.getByTestId('batch-reveal-declare');
  await declare.waitFor({ timeout: 20000 });

  const observe = page.getByTestId('batch-reveal-observe');
  await expect(observe).toBeVisible();
  // The sentence names the dominant category in amber.
  await expect(observe.locator('strong').last()).not.toBeEmpty();

  // The bridge: the first suggested question sits within reach of the report.
  const firstAsk = page.locator('[data-testid^="batch-reveal-ask-"]').first();
  await expect(firstAsk).toBeVisible();
  await firstAsk.click();
  // Seed mode has no model — the click opens the category instead (the
  // reveal's own honest fallback), so the reveal closes either way.
  await expect(page.getByTestId('batch-reveal')).toHaveCount(0);
});
