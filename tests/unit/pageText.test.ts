import { describe, it, expect, afterEach } from 'vitest';
import { extractReadableText } from '../../extension/src/pageText.js';

/**
 * The extractor runs in the page, injected as a serialised function, so it
 * closes over nothing and can be called directly here against jsdom.
 *
 * `tests/e2e/page-text.spec.ts` runs the same function against a real Blink
 * DOM, because jsdom's `textContent` and selector semantics are close enough to
 * be useful and not close enough to be trusted alone.
 */

function render(html: string, title = 'A Page') {
  document.title = title;
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.title = '';
});

const long = (word: string) => `${word} `.repeat(60).trim();

describe('extractReadableText', () => {
  it('keeps the article and drops the furniture around it', () => {
    render(`
      <nav>Home Pricing Careers Login</nav>
      <header>Site Banner</header>
      <article><p>${long('substance')}</p></article>
      <aside>Related stories you may enjoy</aside>
      <footer>Copyright 2026 Terms Privacy</footer>
    `);

    const { text } = extractReadableText();
    expect(text).toContain('substance');
    for (const chrome of ['Pricing', 'Site Banner', 'Related stories', 'Copyright']) {
      expect(text).not.toContain(chrome);
    }
  });

  it('drops scripts and styles, whose text is not text', () => {
    render(`
      <article>
        <style>.a{color:red}</style>
        <script>var secret = 'do not save me';</script>
        <p>${long('readable')}</p>
      </article>
    `);
    const { text } = extractReadableText();
    expect(text).not.toContain('do not save me');
    expect(text).not.toContain('color:red');
  });

  it('collapses the whitespace a DOM leaves behind', () => {
    render(`<article><p>${long('word')}</p>\n\n\n\n   <p>   spaced     out   </p></article>`);
    const { text } = extractReadableText();
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).not.toMatch(/ {2,}/);
  });

  it('falls back to the body when there is no article or main', () => {
    render(`<div id="app"><p>${long('plain')}</p></div>`);
    expect(extractReadableText().text).toContain('plain');
  });

  it('ignores an empty <main> shell rather than throwing the page away', () => {
    // The single-page-app case: `main` matches before it has rendered anything,
    // and a naive "prefer main" returns nothing at all.
    render(`
      <main></main>
      <div id="root"><p>${long('actually here')}</p></div>
    `);
    expect(extractReadableText().text).toContain('actually here');
  });

  it('prefers <main> when it does hold the content', () => {
    render(`
      <div>sidebar junk that is fairly long but not the article itself</div>
      <main><p>${long('the real thing')}</p></main>
    `);
    const { text } = extractReadableText();
    expect(text).toContain('the real thing');
    expect(text).not.toContain('sidebar junk');
  });

  it('reads the title, then og:title, then the first h1', () => {
    render(`<h1>Heading</h1><p>body</p>`, 'Document Title');
    expect(extractReadableText().title).toBe('Document Title');

    document.title = '';
    document.head.innerHTML = `<meta property="og:title" content="Open Graph Title">`;
    expect(extractReadableText().title).toBe('Open Graph Title');

    document.head.innerHTML = '';
    expect(extractReadableText().title).toBe('Heading');
  });

  it('reports the selection separately from the page', () => {
    render(`<article><p>${long('body')}</p></article>`);
    expect(extractReadableText().selection).toBe('');
  });

  it('does not mutate the page it is reading', () => {
    // It strips a clone. Stripping the live document would take the page out
    // from under the person looking at it.
    render(`<nav>Nav</nav><article><p>${long('kept')}</p></article>`);
    extractReadableText();
    expect(document.querySelector('nav')).not.toBeNull();
  });
});
