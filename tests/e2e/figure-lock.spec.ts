import { test, expect, type Page } from '@playwright/test';

/**
 * The figure and the hill are finished. Nothing may change them.
 *
 * They took the longest of anything in this app to get right — the flashlight
 * was rebuilt from an axis after measuring its barrel at a 23-degree wedge, the
 * base was flattened and re-measured column by column until 91 of them touched
 * the crest, and the proportions were matched to the reference photograph to
 * within 3.2%. Every one of those passes was driven by a measurement, and the
 * one thing measurement cannot catch is a change nobody looked for: a token
 * renamed three screens away, a shell class that stops applying, a stacking
 * context that quietly reorders the beam.
 *
 * So this suite is a lock rather than a review. It does not judge whether the
 * figure looks right; that question is settled. It asserts only that the pixels
 * are the ones that were settled on, and it fails loudly if they are not.
 *
 * If a change here is ever genuinely wanted, the baselines are regenerated with
 * `npx playwright test figure-lock --update-snapshots` — which should be a
 * deliberate act, visible in a diff, and never a side effect of styling work
 * somewhere else.
 *
 * Reduced motion is mandatory: `.thinker__body` carries a 6.5s `breathe`
 * animation (theme.css), so without it two screenshots of an untouched figure
 * differ by a couple of thousand pixels purely from where the breath was caught.
 * Applied per page rather than through `test.use`, so the reason it is here
 * sits next to the call that needs it.
 */
async function stillFigure(page: Page, url: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
}

/**
 * The figure's own box is 190x190, but its `<svg>` is `overflow: visible` and
 * the flashlight beam is drawn well outside it — up and to the left, roughly
 * 220px by 225px at the welcome screen's scale. Clipping to the element would
 * therefore lock the silhouette and leave the beam unguarded. Derive the region
 * from the box at runtime instead, so the same margins hold when the figure
 * shrinks to 120px on the open-category screen.
 */
async function figureRegion(page: Page) {
  const box = await page.locator('.arc__thinker').boundingBox();
  if (!box) throw new Error('.arc__thinker is not on the page');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');

  const x = Math.max(0, Math.round(box.x - 300));
  const y = Math.max(0, Math.round(box.y - 250));
  return {
    x,
    y,
    width: Math.min(viewport.width - x, Math.round(box.width + 360)),
    // Past the feet by a little, so the seam where the figure meets the crest is
    // inside the lock. Floating above the hill was a real regression once.
    height: Math.min(viewport.height - y, Math.round(box.height + 280)),
  };
}

test('the figure is unchanged on the welcome screen', async ({ page }) => {
  await stillFigure(page, '/');
  await expect(page.locator('.arc__thinker')).toBeVisible();
  // The greeting fades in; the figure does not, but the two share a frame and a
  // half-faded neighbour is not a stable backdrop.
  await page.waitForTimeout(900);

  await expect(page).toHaveScreenshot('figure-welcome.png', {
    clip: await figureRegion(page),
  });
});

test('the figure is unchanged with a category open', async ({ page }) => {
  await stillFigure(page, '/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.locator('.arc__node').first().click();
  // The arc fans out and the figure travels to the higher crest.
  await page.waitForTimeout(900);

  await expect(page).toHaveScreenshot('figure-open.png', {
    clip: await figureRegion(page),
  });
});

/**
 * The hill is one enormous rounded box positioned by its crest, so a pixel
 * snapshot of it would be a near-solid rectangle — it would pass while the
 * curvature quietly changed off-screen. Its geometry is the thing worth
 * asserting, and the numbers below are the ones the comment in theme.css
 * reasons about: 112vw against 32vh, which drops ~17.6vh from crest to frame
 * edge and reads as a mound rather than a ridge.
 */
test('the hill keeps its geometry', async ({ page }) => {
  await stillFigure(page, '/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  const hill = await page.locator('.sky__hill').evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: s.width,
      height: s.height,
      radius: s.borderRadius,
      background: s.backgroundColor,
      position: s.position,
      pointerEvents: s.pointerEvents,
    };
  });

  const viewport = page.viewportSize()!;
  expect(Math.round(parseFloat(hill.width))).toBe(Math.round(viewport.width * 1.12));
  expect(Math.round(parseFloat(hill.height))).toBe(Math.round(viewport.height * 1.4));
  expect(hill.radius).toBe(
    `50% 50% 0px 0px / ${(viewport.height * 0.32).toFixed(2)}px ${(viewport.height * 0.32).toFixed(2)}px 0px 0px`,
  );
  expect(hill.background).toBe('rgb(15, 11, 22)');
  expect(hill.position).toBe('absolute');
  // It is scenery. A hill that eats clicks would swallow the composer.
  expect(hill.pointerEvents).toBe('none');
});

/**
 * The seam. The figure is seated *on* the crest, overlapping it by a pixel —
 * `translate(-50%, calc(-100% + 1px))` in theme.css — because a hair of daylight
 * under someone who is supposed to be sitting is the tell that gives away a
 * pasted-on figure. This asserts the arrangement rather than the rule, so it
 * still catches a break that comes from the crest moving instead.
 */
test('the figure sits on the crest, not above it', async ({ page }) => {
  await stillFigure(page, '/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.waitForTimeout(600);

  const seam = await page.evaluate(() => {
    const figure = document.querySelector('.arc__thinker')!.getBoundingClientRect();
    const hill = document.querySelector('.sky__hill')!.getBoundingClientRect();
    return { feet: figure.bottom, crest: hill.top };
  });

  // Overlapping, never floating: the feet are at or below the crest line.
  expect(seam.feet).toBeGreaterThanOrEqual(seam.crest);
  // …but only just. More than a couple of pixels and the figure is sunk into it.
  expect(seam.feet - seam.crest).toBeLessThanOrEqual(3);
});
