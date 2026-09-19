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
