/**
 * Read the page the way a person read it.
 *
 * Injected by `chrome.scripting.executeScript({ func })`, which **serialises
 * the function** and runs it in the page — it cannot close over anything in the
 * service worker's scope. So every helper lives inside the body. That is a
 * constraint and a good one: it forces the thing to be pure, and pure means
 * testable without a browser.
 *
 * Hand-written rather than Mozilla Readability, and the reason is what reads
 * the output. Readability's value is *presentation* fidelity — images, captions,
 * bylines, paragraph structure — and we call `.textContent` and throw all of it
 * away. Once only text survives, the distance between its scored-node algorithm
 * and "prefer the article, strip the chrome" is a handful of adversarial
 * layouts. Against that: a ~100KB UMD bundle committed here, or a bundler for a
 * directory that Chrome currently loads as-is. It also mutates the DOM it is
 * given, so it would have to be handed a clone or it strips the page the user
 * is looking at.
 *
 * The failure mode is gentle. Some navigation text leaks in, and the extract
 * prompt already says "Returning none is a valid answer — an empty list is
 * better than padding", with MAX_MEMORIES capping the rest.
 */
export function extractReadableText() {
  const STRIP = [
    'nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript',
    'form', 'iframe', 'svg', 'button', 'select', 'textarea',
    '[aria-hidden="true"]',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[role="search"]', '[role="complementary"]',
  ].join(',');

  const clean = (node) => {
    if (!node) return '';
    // Cloned, because removing from the live document would strip the page out
    // from under the person reading it.
    const copy = node.cloneNode(true);
    for (const el of copy.querySelectorAll(STRIP)) el.remove();
    return (copy.textContent ?? '')
      .replace(/[ \t ]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const bodyText = clean(document.body);

  let text = bodyText;
  for (const selector of ['article', 'main', '[role="main"]']) {
    const candidate = clean(document.querySelector(selector));
    /*
     * A single-page app often renders into a `<main>` shell that is nearly
     * empty at the moment the selector matches, and the naive "prefer main"
     * rule then throws the entire page away. Preferring the narrower root only
     * when it actually contains something is four lines and saves the case.
     */
    if (candidate.length >= 200) {
      text = candidate;
      break;
    }
  }

  const meta = document.querySelector('meta[property="og:title"]');
  const title =
    document.title.trim() ||
    (meta?.getAttribute('content') ?? '').trim() ||
    (document.querySelector('h1')?.textContent ?? '').trim();

  return {
    title,
    url: location.href,
    selection: (window.getSelection()?.toString() ?? '').trim(),
    text,
  };
}
