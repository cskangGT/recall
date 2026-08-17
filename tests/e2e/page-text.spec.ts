import { test, expect } from '@playwright/test';
import { extractReadableText } from '../../extension/src/pageText.js';

/**
 * The extractor against a real Blink DOM.
 *
 * `tests/unit/pageText.test.ts` covers the same function under jsdom, which is
 * fast and close enough to be useful. It is not close enough to be trusted
 * alone: `textContent` on hidden nodes, the shape of whitespace between block
 * elements, and `getSelection` are all places where jsdom and a browser have
 * disagreed. This is the one that matters, because it is the environment the
 * function actually runs in.
 *
 * `page.evaluate(fn)` serialises the function the same way
 * `chrome.scripting.executeScript({ func })` does, so this exercises the real
 * constraint too: it closes over nothing.
 */

const ARTICLE = `
  <!doctype html>
  <html><head>
    <title>Write-Ahead Logging — SQLite</title>
    <meta property="og:title" content="WAL mode">
  </head>
  <body>
    <nav><a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="/login">Log in</a></nav>
    <header><h1 class="site">SQLite Documentation</h1></header>
    <main>
      <article>
        <h1>Write-Ahead Logging</h1>
        <p>${'WAL mode allows many readers and one writer at the same time. '.repeat(8)}</p>
        <p>${'A reader does not block a writer and a writer does not block readers. '.repeat(8)}</p>
        <script>window.__analytics = 'do not save me';</script>
        <style>.site { color: red }</style>
      </article>
      <aside>See also: rollback journals, checkpointing</aside>
    </main>
    <footer>Copyright 2026. Terms. Privacy.</footer>
  </body></html>
`;

test('reads the article out of a real page and leaves the chrome behind', async ({ page }) => {
  await page.setContent(ARTICLE);
  const result = await page.evaluate(extractReadableText);

  expect(result.title).toBe('Write-Ahead Logging — SQLite');
  expect(result.text).toContain('WAL mode allows many readers');
  expect(result.text).toContain('does not block readers');

  for (const chrome of ['Pricing', 'Log in', 'See also', 'Copyright', 'do not save me', 'color: red']) {
    expect(result.text).not.toContain(chrome);
  }
  // Blink collapses differently from jsdom; the cleanup has to hold here too.
  expect(result.text).not.toMatch(/\n{3,}/);
  expect(result.text).not.toMatch(/ {2,}/);
});

test('sends the selection when the reader highlighted something', async ({ page }) => {
  await page.setContent(ARTICLE);
  await page.evaluate(() => {
    const p = document.querySelector('article p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });

  const result = await page.evaluate(extractReadableText);
  expect(result.selection).toContain('WAL mode allows many readers');
  expect(result.selection.length).toBeGreaterThan(0);
});

test('falls back to the body on a page with no article or main', async ({ page }) => {
  await page.setContent(`
    <!doctype html><html><head><title>Plain</title></head>
    <body><div id="app"><p>${'Just a div and some prose in it. '.repeat(12)}</p></div></body></html>
  `);
  const result = await page.evaluate(extractReadableText);
  expect(result.text).toContain('Just a div and some prose');
});

test('ignores an empty shell that a single-page app has not filled yet', async ({ page }) => {
  await page.setContent(`
    <!doctype html><html><head><title>SPA</title></head>
    <body>
      <main></main>
      <div id="root"><p>${'The content actually rendered over here. '.repeat(12)}</p></div>
    </body></html>
  `);
  const result = await page.evaluate(extractReadableText);
  expect(result.text).toContain('actually rendered over here');
});

test('leaves the page it read exactly as it found it', async ({ page }) => {
  await page.setContent(ARTICLE);
  await page.evaluate(extractReadableText);
  // It strips a clone. Stripping the live document would take the page out from
  // under the person reading it.
  await expect(page.locator('nav')).toHaveCount(1);
  await expect(page.locator('footer')).toHaveCount(1);
});
