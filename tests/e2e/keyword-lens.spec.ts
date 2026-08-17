import { test, expect, type Page } from '@playwright/test';

/**
 * The keyword lens: an open category leads with keyword chips, a chip narrows
 * the reading list to exactly the count it promised, and removing it restores
 * the full list. The chips re-derive from what is left, so the lens is the
 * drill-down even in a flat category — AI Tooling has no subfolders at all.
 */

const named = (page: Page, label: string) =>
  page.locator('.arc__node').filter({ hasText: label }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('a chip narrows the list to its own count, and × restores it', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  await expect(page.getByTestId('reading-list')).toBeVisible();

  const strip = page.getByTestId('keyword-strip');
  await expect(strip).toBeVisible();

  const before = await page.locator('.item').count();
  expect(before).toBeGreaterThan(2);

  const chip = strip.locator('.kw').first();
  const promised = Number(await chip.locator('.kw__count').textContent());
  expect(promised).toBeGreaterThan(1);
  expect(promised).toBeLessThan(before);

  await chip.click();
  await expect(page.locator('.item')).toHaveCount(promised);

  // The pick is now a removable filter, and the remaining chips re-split the
  // remainder rather than echoing it.
  const selected = strip.locator('.kw--selected');
  await expect(selected).toHaveCount(1);
  const selectedLabel = (await selected.textContent())!.replace('×', '').trim();
  const others = await strip.locator('.kw:not(.kw--selected)').allTextContents();
  for (const label of others) expect(label).not.toContain(selectedLabel);

  await selected.click();
  await expect(page.locator('.item')).toHaveCount(before);
});

test('the lens resets when you walk into a different category', async ({ page }) => {
  await named(page, 'AI Tooling').click();
  const strip = page.getByTestId('keyword-strip');
  await strip.locator('.kw').first().click();
  await expect(strip.locator('.kw--selected')).toHaveCount(1);

  await named(page, 'Personal Systems').click();
  await expect(page.getByTestId('keyword-strip').locator('.kw--selected')).toHaveCount(0);
});
