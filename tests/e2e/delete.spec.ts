import { test, expect } from '@playwright/test';

/**
 * Throwing something away.
 *
 * Until now nothing at any layer could remove a memory — no repository method,
 * no route, no DataSource method, no store action — so a user who saved the
 * wrong thing had no way to unsave it, and the first minute of a tester's life
 * is full of wrong things.
 *
 * It asks rather than offering an undo, and that is not timidity: the server's
 * undo re-assigns the memories in a reorganization's before_state instead of
 * re-inserting them, so a row this takes away cannot be put back by it. An Undo
 * button that quietly fails is worse than no Undo button.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.locator('.arc__node').nth(2).click();
  await expect(page.getByTestId('reading-list')).toBeVisible();
});

test('one click arms, the second deletes', async ({ page }) => {
  const before = await page.locator('.reading .item').count();
  await page.locator('.reading .item').first().click();

  const button = page.getByTestId('delete-button');
  await expect(button).toHaveText('Delete');

  await button.click();
  // The confirm says what is about to go, rather than asking in the abstract.
  await expect(button).toContainText('this memory');
  await expect(page.locator('.reading .item')).toHaveCount(before);

  await button.click();
  await expect(page.locator('.reading .item')).toHaveCount(before - 1);
  await expect(page.getByTestId('toast')).toContainText('Deleted');
});

test('one click alone does nothing', async ({ page }) => {
  const before = await page.locator('.reading .item').count();
  await page.locator('.reading .item').first().click();
  await page.getByTestId('delete-button').click();

  // Whatever happens next, the memory is still there.
  await expect(page.locator('.reading .item')).toHaveCount(before);
});

/** A stray click must not leave a loaded button sitting on the screen. */
test('it disarms when it loses focus', async ({ page }) => {
  await page.locator('.reading .item').first().click();
  const button = page.getByTestId('delete-button');
  await button.click();
  await expect(button).toContainText('click again');

  await page.locator('.reading .item').nth(1).click();
  await expect(page.getByTestId('delete-button')).toHaveText('Delete');
});

/**
 * Spec 6.1 binds Backspace to deleting the selection. It was bound only inside
 * the arc, where it climbs a level, so the keyboard could not remove anything.
 */
test('Backspace deletes the selected memory', async ({ page }) => {
  const before = await page.locator('.reading .item').count();
  await page.locator('.reading .item').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Memory');

  await page.keyboard.press('Backspace');
  await expect(page.locator('.reading .item')).toHaveCount(before - 1);
});

/**
 * Backspace still climbs the arc — its older binding, which the delete must not
 * have stolen. With a *category* selected rather than a memory, the new handler
 * has to fall through and let the arc have the key.
 */
test('Backspace still climbs the arc, and deletes nothing doing it', async ({ page }) => {
  const inside = await page.locator('.arc__node').allTextContents();
  const items = await page.locator('.reading .item').count();

  await page.keyboard.press('Backspace');

  const after = await page.locator('.arc__node').allTextContents();
  expect(after).not.toEqual(inside); // it climbed
  expect(after.join()).toContain('AI Tooling'); // back at the top level
  await expect(page.locator('.reading .item')).toHaveCount(items); // and took nothing with it
});

test('the edges of a deleted memory go with it', async ({ page }) => {
  await page.locator('.reading .item').first().click();
  const id = await page.evaluate(
    () => document.querySelector('.reading .item.item--selected')?.getAttribute('data-testid') ?? '',
  );
  await page.getByTestId('delete-button').click();
  await page.getByTestId('delete-button').click();
  await expect(page.getByTestId('toast')).toContainText('Deleted');

  // Nothing on the map may point at a node that is gone.
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  expect(id).toBeTruthy();
});
