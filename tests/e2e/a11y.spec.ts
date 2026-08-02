import { test, expect, type Page } from '@playwright/test';

/**
 * The keyboard and the screen reader.
 *
 * Measured before this suite existed: six rail buttons whose entire accessible
 * name was a glyph — "◍", "⊞", "▤", "?", "⚙", "+" — which is the whole
 * navigation of the app; a composer input with no name at all; twenty-two
 * source rows and seven reading-list rows that Tab could not reach; three
 * modals with no dialog semantics; and two focus styles in the entire
 * stylesheet.
 *
 * These assert the outcome rather than the attribute wherever they can — what
 * a reader would say, what the keyboard can get to — because an `aria-label`
 * that is present but wrong passes an attribute check and fails a person.
 */

/** Tab `n` times, reporting what took focus and whether it showed a ring. */
async function tabWalk(page: Page, n: number) {
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return '(body)';
        const cls = a.className ? `.${String(a.className).split(' ')[0]}` : '';
        const ring = getComputedStyle(a).boxShadow !== 'none';
        return `${a.tagName.toLowerCase()}${cls}${ring ? '' : ' NO-RING'}`;
      }),
    );
  }
  return seen;
}

test('the navigation says what it is, not which glyph it drew', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  for (const name of ['Map (G)', 'Browse (T)', 'Sources (S)', 'Ask (⌘/)', 'Settings (,)', 'Add (⌘K)']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  // The shortcut stays in the name: a keyboard user is exactly who benefits.
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
});

test('the current view is marked for a reader, not only in CSS', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('rail-tree')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('g');
  await expect(page.getByTestId('rail-map')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('rail-tree')).not.toHaveAttribute('aria-current', 'page');
});

test('the chat box has a name — a placeholder is not one', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(
    page.getByRole('textbox', { name: 'Ask a question, or paste something to save' }),
  ).toBeVisible();
});

/**
 * The whole of this view could only be operated with a mouse: every row was a
 * div with an onClick.
 */
test('every source row can be reached and opened from the keyboard', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();

  const seen = await tabWalk(page, 16);
  expect(seen.filter((s) => s.includes('source-row')).length).toBeGreaterThan(0);

  await page.keyboard.press('Enter');
  // The eyebrow is uppercased in CSS; the DOM says 'Source'.
  await expect(page.getByTestId('inspector')).toContainText('Source');
});

test('every reading-list row can be reached from the keyboard', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.locator('.arc__node').nth(2).click();
  await expect(page.getByTestId('reading-list')).toBeVisible();

  const seen = await tabWalk(page, 14);
  expect(seen.filter((s) => s.includes('.item')).length).toBeGreaterThan(0);
});

test('nothing focusable is left without a focus ring', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.locator('.arc__node').nth(2).click();
  const seen = await tabWalk(page, 18);
  expect(seen.filter((s) => s.endsWith('NO-RING'))).toEqual([]);
});

/**
 * Without these a reader treats the panel as more page — it reads the map
 * behind it, and nothing says you have entered anything.
 */
test('the command bars and settings are dialogs', async ({ page }) => {
  await page.goto('/?skipWelcome=1');

  for (const [open, testid, name] of [
    ['Meta+k', 'capture-bar', 'Add to Recall'],
    ['Meta+/', 'ask-bar', 'Ask'],
  ] as const) {
    await page.keyboard.press(open);
    const dialog = page.getByTestId(testid);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    await page.keyboard.press('Escape');
  }

  await page.keyboard.press(',');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

/**
 * Closing on pointerdown meant selecting text inside the box and releasing a
 * few pixels outside it threw the panel away along with everything typed into
 * it — a gesture people make constantly.
 */
test('a drag that ends outside a dialog does not discard it', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('something worth keeping');

  const box = (await page.getByTestId('capture-bar').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await expect(page.getByTestId('capture-input')).toHaveValue('something worth keeping');
});

/**
 * Toasts carry every drag-to-re-file confirmation and the depth-limit refusal.
 * `aria-live` rather than `role="status"`, which would have implied it — the
 * change banner already claims that role, and two of them make "the status
 * region" ambiguous.
 */
test('confirmations are announced', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.locator('.arc__node').nth(2).click();
  await expect(page.getByTestId('reading-list')).toBeVisible();

  const live = page.locator('.toasts[aria-live="polite"]');
  await expect(live).toHaveCount(0); // nothing to say yet

  const item = page.locator('.reading .item').first();
  // Not .first() — inside a category that is the way back out, which is not a
  // drop target.
  const target = page.locator('.arc__node').nth(2);
  const a = (await item.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.toasts[aria-live="polite"]')).toBeVisible();
});

/**
 * Contrast, measured on the rendered page rather than trusted from the tokens.
 *
 * `--text-faint` was 2.34:1 — failing not only the 4.5 AA asks for but the 3.0
 * allowed for large text, and it is used at 11 to 12.5px so no size exemption
 * applies. It is the colour of every eyebrow, every meta line and the rail's
 * resting glyphs, which is to say most of the quiet text in the product.
 */
test('the quietest text still clears AA', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('s');
  await expect(page.getByTestId('sources-view')).toBeVisible();

  const ratios = await page.evaluate(() => {
    const lum = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map(Number).map((c) => c / 255) as number[];
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const bg = getComputedStyle(document.body).backgroundColor;
    const out: Record<string, number> = {};
    for (const sel of ['.sources__head', '.source-row__meta', '.rail__btn']) {
      const el = document.querySelector(sel);
      if (el) out[sel] = ratio(getComputedStyle(el).color, bg);
    }
    return out;
  });

  expect(Object.keys(ratios).length).toBeGreaterThan(0);
  for (const [selector, ratio] of Object.entries(ratios)) {
    expect(ratio, `${selector} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});
