import { test, expect } from '@playwright/test';
import { makeZip } from '../helpers/makeZip';

/**
 * The Instagram wedge, end to end: an export ZIP dropped on the window becomes
 * a batch, plays the reveal, and lands as sources on the map. The fixture
 * mirrors the real 2026 export — `label_values` entries, captions present,
 * Korean arriving as Latin-1 mojibake — so what this pins is the whole
 * plumbing: drop → unzip → decode → parse → window filter → reveal.
 */

const mojibake = (s: string) => Buffer.from(s, 'utf8').toString('latin1');
const DAY = 86400;
const NEWEST = 1753500000;

const entry = (timestamp: number, url: string, caption: string) => ({
  timestamp,
  media: [],
  fbid: 'x',
  label_values: [
    { label: 'URL', value: url, href: url },
    { label: 'Caption', value: mojibake(caption) },
    { label: 'Title', value: '' },
  ],
});

const savedPosts = JSON.stringify([
  entry(
    NEWEST,
    'https://www.instagram.com/p/AAA/',
    'Five pasta places in Seongsu worth the waiting line, ranked by noodle texture.',
  ),
  entry(
    NEWEST - 4 * DAY,
    'https://www.instagram.com/reel/BBB/',
    'Running form drills that finally fixed my knee pain after long runs.',
  ),
  entry(
    NEWEST - 40 * DAY,
    'https://www.instagram.com/p/CCC/',
    'An old saved post from over a month ago.',
  ),
]);

test('an Instagram export ZIP dropped on the window imports the recent window', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('22 sources');

  const zipBase64 = Buffer.from(
    makeZip([['your_instagram_activity/saved/saved_posts.json', savedPosts, true]]),
  ).toString('base64');

  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'instagram-user-2026-08-06.zip', { type: 'application/zip' }));
    const shell = document.querySelector('.shell');
    if (!shell) throw new Error('no .shell');
    shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, zipBase64);

  await expect(page.getByTestId('batch-reveal')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('batch-reveal-declare')).toBeVisible({ timeout: 15_000 });
  // Two posts inside the 14-day window; the 40-day-old one stays behind.
  await expect(page.getByTestId('batch-reveal-declare')).toContainText('from 2 saves');

  await page.getByTestId('batch-reveal-dismiss').click();
  await expect(page.getByTestId('toast')).toContainText('1 older post stayed in the export');
  await expect(page.getByTestId('inspector')).toContainText('24 sources');
});

test('a ZIP with no saved posts says why instead of failing silently', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  const zipBase64 = Buffer.from(
    makeZip([['your_instagram_activity/comments/post_comments.json', '[]']]),
  ).toString('base64');

  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'export.zip', { type: 'application/zip' }));
    document.querySelector('.shell')!.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  }, zipBase64);

  await expect(page.getByTestId('toast')).toContainText('no saved_posts.json');
  await expect(page.getByTestId('batch-reveal')).toHaveCount(0);
});
