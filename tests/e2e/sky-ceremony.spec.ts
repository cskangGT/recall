import { test, expect, type Page } from '@playwright/test';

/**
 * The first-drop ceremony (onboarding wow B): after the reveal closes on the
 * very first drop into a seeded sky, the demo stars step back and the drop's
 * own categories hold the light, under one sentence handing the sky over.
 * Plays exactly once — the second drop gets no ceremony.
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

const FIRST: [string, string][] = [
  ['bread.md', 'Cold retard overnight gives the sourdough crust its blisters.'],
  ['bread2.md', 'A hotter oven spring needs steam for the first fifteen minutes.'],
];
// Two files — a single file takes the single-capture path, not the batch.
const SECOND: [string, string][] = [
  ['gym.md', 'Zone 2 rides twice a week moved the resting heart rate more than intervals.'],
  ['gym2.md', 'Grip strength plateaued until the dead hangs became daily.'],
];

test('the first drop hands the sky over, exactly once', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('arc-browser').waitFor();

  await dropFiles(page, FIRST);
  await page.getByTestId('batch-reveal-declare').waitFor({ timeout: 20000 });
  await page.getByTestId('batch-reveal-dismiss').click();

  // The ceremony: sentence up, seed stars dimmed, then everything returns.
  const line = page.getByTestId('sky-ceremony');
  await expect(line).toBeVisible();
  await expect(page.getByTestId('arc-browser')).toHaveClass(/arc--ceremony/);
  await expect(line).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByTestId('arc-browser')).not.toHaveClass(/arc--ceremony/);

  // The second drop is ordinary — the sky is already theirs.
  await dropFiles(page, SECOND);
  await page.getByTestId('batch-reveal-declare').waitFor({ timeout: 20000 });
  await page.getByTestId('batch-reveal-dismiss').click();
  await expect(page.getByTestId('sky-ceremony')).toHaveCount(0);
});
