import { test, expect } from '@playwright/test';
import { makeZip } from '../helpers/makeZip';

/**
 * The Instagram wedge, end to end: an export ZIP dropped on the window becomes
 * a batch, plays the reveal, and lands as sources on the map. The ZIP is
 * synthetic (see instagramZip.test.ts on schema folklore); what this pins is
 * the plumbing — drop → unzip → parse → window filter → reveal.
 */

const DAY = 86400;
const NEWEST = 1753500000;

const savedPosts = JSON.stringify({
  saved_saved_media: [
    {
      title: 'chef_maria',
      string_map_data: {
        'Saved on': { href: 'https://www.instagram.com/p/AAA/', timestamp: NEWEST },
      },
    },
    {
      title: 'run_club_nyc',
      string_map_data: {
        'Saved on': { href: 'https://www.instagram.com/reel/BBB/', timestamp: NEWEST - 4 * DAY },
      },
    },
    {
      title: 'old_account',
      string_map_data: {
        'Saved on': { href: 'https://www.instagram.com/p/CCC/', timestamp: NEWEST - 40 * DAY },
      },
    },
  ],
});

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
    dt.items.add(new File([bytes], 'instagram-gceohoony-2026-08-04.zip', { type: 'application/zip' }));
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
