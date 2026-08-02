import { test, expect, type Page } from '@playwright/test';

/**
 * Search on the map.
 *
 * The map is everything at once, and until now it had no way to find one thing
 * in it — search lived behind ⌘/ and a glyph in the rail, which is a keyboard
 * shortcut for a feature whose whole point is that you do not know where the
 * thing is.
 *
 * It lights the map rather than opening a list, because the answer to "where is
 * the thing about evals" is a position.
 */

/** Mean luminance of the map canvas — the highlight dims everything else to 15%. */
const meanBrightness = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
    return sum / (data.length / 4) / 3;
  });

const toMap = async (page: Page) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
};

test('the map carries a search bar where browsing carries its composer', async ({ page }) => {
  await toMap(page);
  await expect(page.getByTestId('map-search')).toBeVisible();

  // And only there — the browsing screen already has an input in that slot.
  await page.keyboard.press('t');
  await expect(page.getByTestId('map-search')).toHaveCount(0);
});

test('typing narrows the map instead of replacing it', async ({ page }) => {
  await toMap(page);
  await page.getByTestId('map-search-input').fill('eval');

  await expect(page.getByTestId('map-search-count')).toContainText('of 47');
  // The map is still the map: no list took its place.
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

/**
 * A filter on its own is a legitimate question about the map — "show me every
 * screenshot" should not need a word typed at it.
 */
test('a source filter works with nothing typed', async ({ page }) => {
  await toMap(page);
  await page.getByTestId('map-filter-screenshot').click();

  await expect(page.getByTestId('map-filter-screenshot')).toHaveAttribute('aria-pressed', 'true');
  const count = await page.getByTestId('map-search-count').innerText();
  expect(count).toBe('9 of 47');
});

test('All puts the whole map back', async ({ page }) => {
  await toMap(page);
  await page.getByTestId('map-filter-link').click();
  await expect(page.getByTestId('map-search-count')).toBeVisible();

  await page.getByTestId('map-filter-all').click();
  // No claim about the map means no count and nothing dimmed.
  await expect(page.getByTestId('map-search-count')).toHaveCount(0);
});

/**
 * The highlight is shared with the answer. Without a guard, mounting this bar
 * cleared it — so asking a question and then pressing G to see where the answer
 * lives arrived at a map that had just thrown away the highlight it came for.
 */
test('arriving on the map does not clear an answer’s highlight', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  // A map with nothing highlighted, to measure against.
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForTimeout(1400);
  const lit = await meanBrightness(page);

  await page.keyboard.press('t');
  await page.getByTestId('composer-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browser-answer')).toBeVisible();

  // Focus is in the composer, where G is a letter rather than a shortcut. One
  // Escape hands the keyboard back without discarding the answer — which is the
  // whole reason that ladder exists.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('browser-answer')).toBeVisible();

  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForTimeout(1400);
  const dimmed = await meanBrightness(page);

  // The renderer drops everything unhighlighted to 15%, so a surviving
  // highlight is measurably darker than a map with no claim on it.
  expect(dimmed).toBeLessThan(lit * 0.9);
  // And the search bar is making no claim of its own.
  await expect(page.getByTestId('map-search-count')).toHaveCount(0);
});

test('Escape clears the query, then hands the keyboard back', async ({ page }) => {
  await toMap(page);
  const input = page.getByTestId('map-search-input');
  await input.click();
  await input.fill('eval');

  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');

  await page.keyboard.press('Escape');
  // The single-key view shortcuts work again.
  await page.keyboard.press('t');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});
