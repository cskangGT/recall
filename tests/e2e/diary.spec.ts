import { test, expect } from '@playwright/test';

/**
 * The diary — a room for days. Write an entry, and it is kept on its day
 * (the calendar marks it) while its content joins the corpus like any
 * capture. Seed mode runs the same surface through the local pipeline.
 */

test('write a day, see it marked, and its thoughts join the corpus', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await page.keyboard.press('d');
  await expect(page.getByTestId('diary-view')).toBeVisible();

  await page.getByTestId('diary-editor').fill(
    '오늘 하프마라톤 대비 인터벌을 뛰었다. 400미터 열 세트가 처음으로 편안했다.',
  );
  await page.getByTestId('diary-save').click();

  // The entry appears on the day's page…
  await expect(page.locator('[data-testid^="diary-entry-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="diary-entry-"]').first()).toContainText('인터벌');

  // …the calendar marks the day…
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await expect(page.getByTestId(`diary-day-${key}`).locator('.diary__mark-entry')).toBeVisible();

  // …and the extracted memory is now part of the corpus (search finds it).
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.getByTestId('map-search-input').fill('인터벌');
  await expect(page.getByTestId('map-search-count')).toContainText('1');
});

test('the rail knows the way in, and D is its key', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.getByTestId('rail-diary').click();
  await expect(page.getByTestId('diary-view')).toBeVisible();
});
