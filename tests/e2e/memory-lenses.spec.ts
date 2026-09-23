import { test, expect } from '@playwright/test';

/**
 * Memory is one place with three lenses — browse the categories, spread it
 * out to brainstorm, open the archive — and one bar at the bottom of all
 * three. The bar carries a switch, and the switch is the whole rule: Search
 * shows what was kept, within the lens you are in; Ask Mado has the memory
 * answer. Each lens remembers its own side — browsing and brainstorming are
 * conversations and start on asking, the archive starts on search — and what
 * was found belongs to its lens: it does not follow you into the next one.
 */
test('the switch decides: search finds within the lens, asking answers', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('lens-browse')).toHaveAttribute('aria-selected', 'true');

  // Browse is a conversation: it starts on asking.
  await expect(page.getByTestId('find-mode-ask')).toHaveAttribute('aria-checked', 'true');
  const input = page.getByTestId('composer-input');
  await expect(input).toHaveAttribute('placeholder', 'Ask Mado anything');

  // Switched to search, a word opens what was kept as rows — even one that
  // would have read as a question under the old guessing rule.
  await page.getByTestId('find-mode-search').click();
  await expect(input).toHaveAttribute('placeholder', 'Search what you kept');
  await input.fill('LangChain');
  await input.press('Enter');
  await expect(page.getByTestId('reading-list')).toContainText('Found');
  await expect(page.getByTestId('browser-answer')).toContainText('Found 1 memories');
  await expect(page.locator('.reading .item')).toHaveCount(1);

  // Brainstorm starts on asking too; switched to search, the word lights the
  // map — and the find from Browse did not follow.
  await page.getByTestId('lens-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).not.toContainText('Found');
  await expect(page.getByTestId('find-mode-ask')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('find-mode-search').click();
  await page.getByTestId('map-search-input').fill('hiring');
  await expect(page.getByTestId('map-search-count')).toContainText('of 47');

  // Archive: the ledger narrows to the originals that carry the word.
  await page.getByTestId('lens-sources').click();
  const rows = page.locator('[data-testid^="source-row-"]');
  const all = await rows.count();
  await page.getByTestId('archive-find-input').fill('hiring');
  await expect.poll(() => rows.count()).toBeLessThan(all);
  expect(await rows.count()).toBeGreaterThan(0);

  // Browse kept its own side of the switch.
  await page.getByTestId('lens-browse').click();
  await expect(page.getByTestId('find-mode-search')).toHaveAttribute('aria-checked', 'true');
});

/**
 * Brainstorming is a conversation held over the map. The talk rises from the
 * bar — newest at the bottom, what was said before stepping back above it —
 * the panel beside holds the memories the answer took out, whole and numbered
 * the way the answer numbers them, and the map goes to what is being talked
 * about: each answer moves the camera, and ← walks the conversation back.
 */
test('asking from the map: the talk rises from the bar, the evidence stands beside it', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // Asking is where it starts: no type filters, and typing lights nothing.
  await expect(page.getByTestId('find-mode-ask')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('map-filter-all')).toHaveCount(0);
  await expect(page.getByTestId('map-conversation')).toHaveCount(0);
  const input = page.getByTestId('map-search-input');
  await input.fill('What did we decide about our eval stack');
  await expect(page.getByTestId('map-search-count')).toHaveCount(0);
  await input.press('Enter');

  // The answer is in the conversation, not the side panel…
  const talk = page.getByTestId('map-conversation');
  await expect(talk.getByTestId('answer')).toContainText('LangChain');
  await expect(input).toHaveValue('');
  // …and the side panel is what Mado took out to say it, each memory whole.
  const used = page.getByTestId('used-memories');
  await expect(used).toContainText('What Mado took out');
  expect(await used.locator('.used').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('inspector').getByTestId('answer')).toHaveCount(0);
  // The camera went to them, and the way back is offered.
  await expect(page.getByTestId('map-back')).toBeVisible();

  // A follow-up stacks beneath; the first turn is still there, above it.
  await input.fill('And which tool won?');
  await input.press('Enter');
  await expect(talk.locator('.mapchat__turn--past')).toHaveCount(1);
  await expect(talk.locator('.mapchat__turn--past')).toContainText('eval stack');
  await expect(talk.getByTestId('answer')).toBeVisible();

  // A row of evidence goes to that memory.
  await used.locator('.used').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Memory');

  // Ending the conversation folds it away.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test('ending the conversation clears the talk, the evidence and the thread', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('g');
  await page.getByTestId('map-search-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('map-search-input').press('Enter');
  await expect(page.getByTestId('map-conversation')).toBeVisible();

  await page.getByTestId('map-conversation-end').click();
  await expect(page.getByTestId('map-conversation')).toHaveCount(0);
  await expect(page.getByTestId('used-memories')).toHaveCount(0);
  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('ask-followup')).toHaveCount(0);
});

test('home and today only ask — the switch belongs to Memory', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('composer-add')).toBeVisible();
  await expect(page.getByTestId('find-mode')).toHaveCount(0);
  await page.getByTestId('rail-today').click();
  await expect(page.getByTestId('find-mode')).toHaveCount(0);
});

/**
 * Thinking with picked memories. A mode, switched on by hand: while it is on
 * a press picks a star — a category picks what it holds — and a search's
 * results can be taken in at once. The picks are what Mado thinks with, can
 * be spread out on their own, and can be bundled into a category of one's
 * own. Off, the map is exactly what it was.
 */
test('pick, spread, think with, and bundle', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('think-picks')).toHaveCount(0);

  await page.getByTestId('think-switch').click();
  await expect(page.getByTestId('think-switch')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('think-picks')).toContainText('Press a star');

  // Search is a way to find things to pick: the results go in at once.
  await page.getByTestId('find-mode-search').click();
  await page.getByTestId('map-search-input').fill('hiring');
  await page.getByTestId('think-pick-results').click();
  await expect(page.getByTestId('think-picks')).toContainText('memories picked');
  const picked = page.locator('[data-testid^="pick-"]');
  const n = await picked.count();
  expect(n).toBeGreaterThan(1);
  await page.getByTestId('map-search-input').fill('');

  // One can be taken back out.
  await picked.first().locator('.pick__x').click();
  await expect(page.locator('[data-testid^="pick-"]')).toHaveCount(n - 1);

  // Spread out on their own; ← brings the map back.
  await page.getByTestId('think-spread').click();
  await expect(page.getByTestId('map-back')).toBeVisible();
  await page.getByTestId('map-back').click();

  // Thinking with them: the answer is never a refusal, and the evidence beside
  // it says which were the person's own.
  await page.getByTestId('find-mode-ask').click();
  await page.getByTestId('map-search-input').fill('zzqx');
  await page.getByTestId('map-search-input').press('Enter');
  await expect(page.getByTestId('map-conversation').getByTestId('answer')).toContainText('side by side');
  await expect(page.getByTestId('used-memories')).toContainText('What you picked');

  // Bundled into a category of one's own: named, locked, the picks inside.
  await page.getByTestId('think-bundle').click();
  await page.getByTestId('bundle-name').fill('Hiring rules');
  await page.getByTestId('bundle-make').click();
  await expect(page.getByTestId('toast').last()).toContainText('“Hiring rules” is yours now');
  await expect(page.getByTestId('think-switch')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('inspector')).toContainText('Hiring rules');
  await page.keyboard.press('t');
  await expect(page.getByTestId('category-index')).toContainText('Hiring rules');
});

test('switching the mode off puts the picks down and leaves the map as it was', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.keyboard.press('g');
  await page.getByTestId('think-switch').click();
  await page.getByTestId('find-mode-search').click();
  await page.getByTestId('map-search-input').fill('eval');
  await page.getByTestId('think-pick-results').click();
  expect(await page.locator('[data-testid^="pick-"]').count()).toBeGreaterThan(0);
  await page.getByTestId('map-search-input').fill('');
  await page.getByTestId('think-switch').click();
  await expect(page.getByTestId('think-picks')).toHaveCount(0);
  await page.getByTestId('think-switch').click();
  await expect(page.getByTestId('think-picks')).toContainText('Press a star');
});
