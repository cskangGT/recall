import { test, expect } from '@playwright/test';

/**
 * The free window (?plan=free): the whole corpus stays visible as structure,
 * but memories older than two weeks read as archived, and the one paywall line
 * under the reading list is where the product asks for money. Default (pro)
 * must be untouched — the demo path depends on the full corpus.
 */

test('the free plan archives old rows and shows the paywall line', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  // AI Tooling's seed memories are months old — all of them archive.
  await page.getByTestId('arc-node-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toBeVisible();

  await expect(page.getByTestId('plan-paywall')).toBeVisible();
  await expect(page.getByTestId('plan-paywall')).toContainText('last 14 days');
  await expect(page.getByTestId('plan-paywall')).toContainText('sleep');

  // Every wake CTA passes through the sheet — price and terms before checkout.
  await page.getByTestId('plan-upgrade').click();
  const sheet = page.getByTestId('upgrade-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('$20');
  await expect(sheet).toContainText('Cancel anytime');
  await page.getByTestId('sheet-upgrade').click();
  await expect(page.getByTestId('toast')).toContainText('Mado Pro remembers everything');
});

test('an archived row is present but not draggable, and says why on click', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.getByTestId('arc-node-cat_ai_tooling').click();

  const archived = page.locator('.item--archived').first();
  await expect(archived).toBeVisible();
  await expect(archived).not.toHaveAttribute('draggable', 'true');

  await archived.click();
  await expect(page.getByTestId('toast')).toContainText('asleep on Mado Free');
});

test('pro (the default) shows no paywall anywhere', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.getByTestId('arc-node-cat_ai_tooling').click();
  await expect(page.getByTestId('reading-list')).toBeVisible();
  await expect(page.getByTestId('plan-paywall')).toHaveCount(0);
  await expect(page.locator('.item--archived')).toHaveCount(0);
});

test('settings names the plan and offers the upgrade on free', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press(',');
  await expect(page.getByTestId('settings-plan')).toContainText('Free');
  await expect(page.getByTestId('settings-upgrade')).toBeVisible();
});

test('the inspector counts the sleeping and its counter opens the sheet', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  const counter = page.getByTestId('sleeping-count');
  await expect(counter).toBeVisible();
  await expect(counter).toContainText('asleep');
  await counter.click();
  await expect(page.getByTestId('upgrade-sheet')).toBeVisible();
  // Escape is enough to leave — the sheet never traps.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('upgrade-sheet')).toHaveCount(0);
});

test('the weekly sleep card shows real blurred memories, once a week, after a first drop', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mado.ob.firstDrop', '1'));
  await page.goto('/?skipWelcome=1&plan=free');
  const card = page.getByTestId('sleep-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('fell asleep');
  await expect(card.locator('.arc__sleep-mem').first()).toBeVisible();

  await card.getByTestId('sleep-card-wake').click();
  await expect(page.getByTestId('upgrade-sheet')).toBeVisible();
  await page.keyboard.press('Escape');

  // Dismissal holds for the week.
  await page.reload();
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('sleep-card')).toHaveCount(0);
});

test('without a first drop of your own, no sleep card — value first', async ({ page }) => {
  await page.goto('/?skipWelcome=1&plan=free');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('sleep-card')).toHaveCount(0);
});
