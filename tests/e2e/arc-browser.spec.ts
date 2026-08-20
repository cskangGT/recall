import { test, expect, type Page } from '@playwright/test';

/**
 * The arc browser — categories fanned above a thinking figure, memories in a
 * reading list below.
 *
 * It replaced a two-pane list outright, so everything the list was responsible
 * for has to be proved here: re-filing a memory (AC-28), refusing a third level
 * (AC-31), the answer folder, and search landing you in the right place.
 */

const node = (page: Page, id: string) => page.getByTestId(`arc-node-${id}`);
const named = (page: Page, label: string) =>
  page.locator('.arc__node').filter({ hasText: label }).first();

const arcLabels = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.arc__node--folder')].map(
      (n) =>
        `${n.querySelector('.arc__label')?.textContent}=${n.querySelector('.arc__count')?.textContent}`,
    ),
  );

/**
 * The arc in rank order rather than in screen order. Rank 1 sits at the apex and
 * the rest alternate outward, so the seating is a mountain — undo it by walking
 * out from the middle the same way.
 */
const arcRanking = async (page: Page) => {
  const labels = await arcLabels(page);
  const middle = Math.floor((labels.length - 1) / 2);
  return [...labels.keys()]
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || b - a)
    .map((seat) => labels[seat]!);
};

test.beforeEach(async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

/**
 * This used to assert the six categories in insertion order, which is a fact
 * about the database rather than about the person using it. Being on the arc now
 * means "this is what you have been on lately", so the assertion is about the
 * ranking, and the seed's dates are authored to make that ranking a story:
 * lately this person has been hiring and digging into agent tooling, while the
 * fundraise was the spring and is over — so Fundraising comes last despite
 * holding the most memories of anything.
 *
 * Read by rank rather than left to right, because the arc seats rank 1 at the
 * apex and works outward — the middle of an upward arc is the position the eye
 * lands on, and left-to-right would spend it on whatever sorted first.
 */
test('opens on the top level ranked by what the user has been on', async ({ page }) => {
  expect(await arcRanking(page)).toEqual([
    'Hiring=7',
    'AI Tooling=9',
    'Product=8',
    'Personal Systems=6',
    'Go-to-Market=6',
    'Fundraising=11',
  ]);
  // Nothing is open yet, so the reading list stays out of the way.
  await expect(page.getByTestId('reading-list')).toHaveCount(0);
});

test('seats the strongest at the apex, not at the left end', async ({ page }) => {
  const labels = await arcLabels(page);
  expect(labels[Math.floor((labels.length - 1) / 2)]).toBe('Hiring=7');
});

test('drilling into a category fans out its children and fills the reading list', async ({
  page,
}) => {
  await node(page, 'cat_fundraising').click();

  await expect(named(page, 'Investor Notes')).toBeVisible();
  await expect(named(page, 'Pitch Feedback')).toBeVisible();
  await expect(named(page, 'Seed Benchmarks')).toBeVisible();
  // The list holds the parent's memories, subfolders included, so it agrees
  // with the count that was on the cloud.
  await expect(page.locator('.reading .item')).toHaveCount(11);
});

test('a category with no children opens its memories without descending', async ({ page }) => {
  // AI Tooling is flat in the seed — it is the one the demo splits.
  await node(page, 'cat_ai_tooling').click();

  await expect(page.locator('.reading .item')).toHaveCount(9);
  await expect(node(page, '__back__')).toHaveCount(0);
  await expect(named(page, 'Fundraising')).toBeVisible();
});

test('back returns to the top level', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await expect(named(page, 'Investor Notes')).toBeVisible();

  await node(page, '__back__').click();
  await expect(named(page, 'Investor Notes')).toHaveCount(0);
  expect(await arcLabels(page)).toHaveLength(6);
});

/**
 * It used to read "Back", on the grounds that the breadcrumb already named the
 * parent. But the breadcrumb names where you *are*; nothing named what is one
 * level up, and a category's place in the structure is most of what it means
 * here. It carries the destination, not the direction.
 */
test('the way up names where it goes', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await expect(node(page, '__back__')).toContainText('Everything');
});

test('Backspace also climbs a level', async ({ page }) => {
  await node(page, 'cat_hiring').click();
  await expect(named(page, 'Interview Loops')).toBeVisible();

  await page.keyboard.press('Backspace');
  await expect(named(page, 'Interview Loops')).toHaveCount(0);
});

test('dragging a memory onto a category re-files it and locks it (AC-28)', async ({ page }) => {
  await node(page, 'cat_ai_tooling').click();
  const item = page.locator('.reading .item').first();

  const a = (await item.boundingBox())!;
  const target = (await named(page, 'Hiring').boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 14 });
  await page.mouse.up();

  await expect(page.getByTestId('toast')).toContainText("Moved. Mado won't change this again.");
  const labels = await arcLabels(page);
  expect(labels).toContain('AI Tooling=8');
  expect(labels).toContain('Hiring=8');
});

test('dragging a subcategory onto a parent re-parents it', async ({ page }) => {
  await node(page, 'cat_fundraising').click();

  /*
   * The parents arrive as an extra surface during the drag. They are added
   * alongside the arc rather than replacing it — replacing it unmounts the
   * dragged node's siblings and wedges the browser's drag loop.
   *
   * Driven by hand rather than with `dragTo` because the targets do not exist
   * until the drag is under way: at rest the panel is a caption, so `dragTo`
   * would be waiting for a box to measure that only appears once the mouse is
   * already down. Which is also the honest version of the gesture.
   */
  await named(page, 'Investor Notes').hover();
  await page.mouse.down();
  await page.mouse.move(700, 380, { steps: 10 });

  const target = page.getByTestId('reparent-target-cat_hiring');
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('toast')).toContainText('Moved Investor Notes into Hiring.');
});

/**
 * The drop targets used to be 33px tall and 38px apart, in a panel pinned to the
 * bottom-left corner — about 720px diagonally from the node you had just picked
 * up. Overshooting by twenty pixels filed the group under the wrong parent,
 * which is the one mistake this product's trust story says it must not make.
 */
test('the re-parent targets are large and near the arc while dragging', async ({ page }) => {
  await node(page, 'cat_fundraising').click();

  await named(page, 'Investor Notes').hover();
  await page.mouse.down();
  await page.mouse.move(700, 380, { steps: 10 });

  const target = page.getByTestId('reparent-target-cat_hiring');
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);
  expect(box.width).toBeGreaterThanOrEqual(150);

  // Below the arc, not in a corner: the whole surface is in the upper half.
  const panel = (await page.getByTestId('reparent-hint').boundingBox())!;
  expect(panel.y).toBeLessThan(page.viewportSize()!.height * 0.55);

  await page.mouse.up();
});

/** At rest it is a caption. A menu of six names with nothing to act on reads as
    something someone left open, and it cannot be dropped on anyway. */
test('the re-parent targets stay out of the way until something is dragged', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await expect(page.getByTestId('reparent-hint')).toBeVisible();
  await expect(page.getByTestId('reparent-target-cat_hiring')).toBeHidden();
});

test('a subcategory cannot be nested under another subcategory (AC-31)', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await named(page, 'Investor Notes').dragTo(named(page, 'Pitch Feedback'));

  await expect(page.getByTestId('toast')).toContainText('Mado keeps categories two levels deep.');
});

/**
 * The other half of the trust loop. Dragging a memory says "not there";
 * renaming says "not that". Both have to stick.
 */
test('renaming a category locks it against the AI', async ({ page }) => {
  await node(page, 'cat_ai_tooling').click();
  await expect(page.getByTestId('category-name')).toHaveText('AI Tooling');

  await page.getByTestId('category-name').click();
  await page.getByTestId('category-name-input').fill('Agent Stack');
  await page.getByTestId('category-name-input').press('Enter');

  await expect(page.getByTestId('category-name')).toHaveText('Agent Stack');
  await expect(page.getByTestId('inspector')).toContainText("Named by you");
  // The arc is the same category, so it renames there too.
  await expect(named(page, 'Agent Stack')).toBeVisible();
});

test('Escape abandons a rename instead of committing it', async ({ page }) => {
  await node(page, 'cat_hiring').click();
  await page.getByTestId('category-name').click();
  await page.getByTestId('category-name-input').fill('Recruiting');
  await page.getByTestId('category-name-input').press('Escape');

  await expect(page.getByTestId('category-name')).toHaveText('Hiring');
  // Escape must not have fallen through and cleared the selection either.
  await expect(page.getByTestId('inspector')).toContainText('Hiring');
});

test('a renamed category no longer reorganizes — the correction is permanent', async ({ page }) => {
  await node(page, 'cat_ai_tooling').click();
  await page.getByTestId('category-name').click();
  await page.getByTestId('category-name-input').fill('Agent Stack');
  await page.getByTestId('category-name-input').press('Enter');
  await expect(page.getByTestId('category-name')).toHaveText('Agent Stack');

  // The capture that normally splits AI Tooling now files without restructuring.
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('capture-story')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('capture-story')).not.toContainText('reorganized around it');
  await expect(named(page, 'Agent Stack')).toBeVisible();
});

test('an answer becomes a folder of its own with the citations below it', async ({ page }) => {
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.getByTestId('ask-input').press('Enter');

  await expect(page.getByTestId('arc-node-__answer__')).toBeVisible();
  await expect(page.getByTestId('browser-answer')).toBeVisible();
  expect(await page.locator('.reading .item').count()).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('arc-node-__answer__')).toHaveCount(0);
});

test('a search result opens its category rather than jumping to the map', async ({ page }) => {
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('LangChain');
  await expect(page.getByTestId('bar-mode')).toHaveText('Search');
  await page.getByTestId('ask-input').press('Enter');

  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toHaveCount(0);
  await expect(page.locator('.item--selected')).toHaveCount(1);
});

test('the selection survives switching to the map', async ({ page }) => {
  await node(page, 'cat_fundraising').click();
  await expect(page.getByTestId('inspector')).toContainText('Fundraising');

  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('Fundraising');
});

test('capturing shows the classification happening', async ({ page }) => {
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');

  // The browsing screen has no ghost node, so without this panel the filing
  // would happen entirely invisibly.
  await expect(page.getByTestId('classify-panel')).toBeVisible();
  await expect(page.getByTestId('classify-panel')).toContainText('Reading');

  await expect(page.getByRole('status')).toContainText('Split AI Tooling', { timeout: 30_000 });
  await expect(page.getByTestId('classify-panel')).toHaveCount(0);
});

/**
 * The user story the demo is built around: drop something in, and the app tells
 * you what it read, whether it had seen it before, and where it put it.
 */
test('the capture story says what was read, what was new, and where it went', async ({ page }) => {
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');

  const story = page.getByTestId('capture-story');
  await expect(story).toBeVisible({ timeout: 30_000 });
  await expect(story).toContainText('What Mado saw');
  await expect(page.getByTestId('capture-story-memory')).toHaveCount(2);

  /*
   * Both read as new, and the echo is gone on purpose.
   *
   * Under the authored 8-dimensional vectors one of these two echoed a seeded
   * eval memory, and that line — "You already saved something close to this" —
   * was the best thing the capture story said. Measured against real
   * embeddings the pair scores 0.3567 while the 99th percentile of every
   * ordinary pair in the corpus is 0.4550: it is *less* alike than one random
   * pair in a hundred. The two sentences were never saying the same thing, they
   * shared a theme, and a theme is all those vectors encoded.
   *
   * A threshold low enough to catch it calls 104 of 1,081 pairs an echo, so
   * ECHO_SIMILARITY is parked above 1 and the verdict stays honest. The
   * assertion is kept rather than deleted because this is the thing real
   * de-duplication has to bring back, and it should fail here when it does.
   */
  await expect(page.getByTestId('capture-story-echo')).toHaveCount(0);
  await expect(page.getByTestId('capture-story-new')).toHaveCount(2);

  await expect(page.getByTestId('capture-story-destination')).toContainText('AI Tooling');
});

/**
 * One home per action.
 *
 * `Ask` used to sit in the header next to `See the big picture`, duplicating both
 * the rail's `?` and the composer that *is* the ask box; the floating `+`
 * duplicated the rail's `+` and, being absolute inside the middle column, landed
 * against a blank inspector rather than the window's edge.
 */
test('the capture affordance is in the composer, not floating, while browsing', async ({
  page,
}) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await expect(page.getByTestId('fab')).toHaveCount(0);
  await page.getByTestId('composer-add').click();
  await expect(page.getByTestId('capture-input')).toBeVisible();
  await page.keyboard.press('Escape');

  // The map has no composer, so it keeps the floating button.
  await page.keyboard.press('g');
  await expect(page.getByTestId('fab')).toBeVisible();
});

test('the map is still one labelled click away from its new home', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('go-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

/**
 * The composer is docked and always mounted, so unlike the two command bars
 * there is no dialog to close — and App's keyboard handler steps aside for INPUT
 * targets. Clicking the box therefore killed G, T, S and `,` outright: they
 * typed their letters into it instead of navigating, nothing on screen said so,
 * and the only way back was the mouse.
 */
test('Escape hands the keyboard back after clicking the chat box', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await page.getByTestId('composer-input').click();
  await page.keyboard.press('g');
  // Still browsing, and the shortcut went into the box as a letter.
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveValue('g');

  await page.getByTestId('composer-input').fill('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

/**
 * Escape in the composer means "give me my keyboard back", not "throw away what
 * I was reading" — App's Escape also clears the answer and the selection, and
 * losing an answer because you wanted the arrow keys is not the same gesture.
 */
test('Escape in the composer does not discard the answer', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await page.getByTestId('composer-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browser-answer')).toBeVisible();

  await page.getByTestId('composer-input').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('browser-answer')).toBeVisible();

  // A second Escape, now that the window can hear it, does clear it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('browser-answer')).toHaveCount(0);
});

/**
 * The point of the whole thing. Asking is the strongest of the three signals —
 * framing a question is deliberate in a way that saving and browsing are not —
 * so the category an answer drew on should be the one at the apex afterwards.
 *
 * Until now asking left no trace anywhere: the server wrote `ask_history` and
 * read it back nowhere, and the client never saw it at all.
 */
test('asking about something moves it to the top of the arc', async ({ page }) => {
  expect((await arcRanking(page))[0]).toBe('Hiring=7');

  await page.getByTestId('composer-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browser-answer')).toBeVisible();

  expect((await arcRanking(page))[0]).toBe('AI Tooling=9');
});

/**
 * And it has to survive a reload, or "lately" means "since you opened the tab".
 * This is the first thing in the client that persists anything.
 */
test('what you asked about is still there after a reload', async ({ page }) => {
  await page.getByTestId('composer-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browser-answer')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  expect((await arcRanking(page))[0]).toBe('AI Tooling=9');
});

/** A fresh browser has no history, so the arc ranks on the corpus alone. */
test('a workspace with no interaction history still ranks, on its saves', async ({ page }) => {
  expect((await arcRanking(page))[0]).toBe('Hiring=7');
});

test('the logo is the way home — pressed on instinct, and the instinct is right', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  // Walk somewhere: open a category, read its list.
  await page.locator('.arc__node').filter({ hasText: 'AI Tooling' }).first().click();
  await expect(page.getByTestId('reading-list')).toBeVisible();

  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('reading-list')).toHaveCount(0);
  await expect(page.getByTestId('arc-browser')).toContainText('Where would you like to look?');

  // From the map too — home means the browse start, wherever you were.
  await page.keyboard.press('g');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.getByTestId('rail-home').click();
  await expect(page.getByTestId('arc-browser')).toBeVisible();
});

test('recent memories hang in the sky — hover whispers, click opens', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  const stars = page.locator('.recentstar');
  await expect(page.getByTestId('recent-stars')).toBeVisible();
  expect(await stars.count()).toBeGreaterThan(5);

  // Click a star: the memory opens in the inspector…
  await stars.first().click();
  await expect(page.getByTestId('inspector')).toContainText('Memory');

  // …and the recent sky steps back while a category list is open.
  await page.keyboard.press('Escape');
  await page.locator('.arc__node').filter({ hasText: 'AI Tooling' }).first().click();
  await expect(page.getByTestId('reading-list')).toBeVisible();
  await expect(page.getByTestId('recent-stars')).toHaveCount(0);
});
