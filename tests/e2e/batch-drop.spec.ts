import { test, expect, type Page } from '@playwright/test';

/**
 * The bulk drop: several files at once become a batch, the reveal plays over
 * the sky, and the declaration says what was organized. Seed mode, no backend —
 * the same zero-network property the demo path asserts.
 */

function watchForBackendCalls(page: Page): string[] {
  const offences: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (/\/api\//.test(url) || /\/graphql/.test(url)) offences.push(`API call: ${url}`);
  });
  return offences;
}

/** Dispatches a real drop with N text files on the app shell. */
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

const FILES: [string, string][] = [
  [
    'agent-notes.md',
    'Considering LangChain against direct SDK calls for the agent runtime rewrite.\n' +
      'Braintrust looks like the strongest option for agent evals right now.',
  ],
  [
    'sourdough-log.txt',
    'Third sourdough bake collapsed because the starter was underfed overnight.\n' +
      'Doubling the autolyse window made the crumb noticeably more open.',
  ],
  [
    'fundraise-thoughts.md',
    'Partner meetings go better when the wedge story leads before the platform story.\n' +
      'Warm intros from portfolio founders convert at a much higher rate than cold email.',
  ],
];

test('a multi-file drop runs the batch reveal and lands in the corpus', async ({ page }) => {
  const offences = watchForBackendCalls(page);

  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('inspector')).toContainText('47 memories');

  await dropFiles(page, FILES);

  // The reveal opens immediately and reads the batch out loud.
  await expect(page.getByTestId('batch-reveal')).toBeVisible();
  await expect(page.getByTestId('batch-reveal-status')).toBeVisible();

  // The declaration: N memories from 3 saves into M interests.
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('batch-reveal-declare')).toContainText('from 3 saves');

  await page.getByTestId('batch-reveal-dismiss').click();
  await expect(page.getByTestId('batch-reveal')).toHaveCount(0);

  // The corpus grew — 6 claims across 3 files, minus any the corpus held.
  await expect(page.getByTestId('inspector')).not.toContainText('47 memories');
  await expect(page.getByTestId('inspector')).toContainText('25 sources');

  expect(offences).toEqual([]);
});

test('a second identical drop writes nothing twice', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await dropFiles(page, FILES);
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });
  const firstDeclaration = await page.getByTestId('batch-reveal-declare').textContent();
  await page.getByTestId('batch-reveal-dismiss').click();
  await expect(page.getByTestId('batch-reveal')).toHaveCount(0);

  await dropFiles(page, FILES);
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('batch-reveal-declare')).toContainText('Nothing new to remember');
  // And the return visits are counted out loud, not swallowed.
  await expect(page.getByTestId('batch-reveal-declare')).toContainText('came back again');
  expect(firstDeclaration).not.toContain('Nothing new to remember');
});

test('a single file drop keeps the single-capture path', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await dropFiles(page, [FILES[0]!]);

  // No reveal — the existing capture choreography owns this path.
  await expect(page.getByTestId('batch-reveal')).toHaveCount(0);
});
