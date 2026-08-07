/**
 * Everything between "the page" and "the notification", with no `chrome` in it.
 *
 * `background.js` is the glue that cannot be tested — the command listener, the
 * injection, the fetch. Keeping the decisions here means the part with any
 * judgement in it runs under Vitest.
 */

/**
 * 20,000 characters ≈ 3,300 words: a long-form article in full.
 *
 * Neither the model's context window nor the server's 5MB body limit is what
 * binds. Three other things do. Extraction quality: past a few thousand words
 * the model drifts from "pull out atomic claims" toward summarising, which is
 * exactly what the prompt forbids. Cost and latency: ~5k tokens is about a cent
 * and about a second, per save. And the one nobody notices — `getGraphPayload`
 * returns the full `raw_content` of every source, and the Inspector renders it,
 * so `raw_content` growing from a pasted snippet to an article is a cost paid on
 * every page load forever.
 */
export const MAX_PAGE_CHARS = 20_000;

/**
 * Below this there is nothing worth sending.
 *
 * A PDF viewer, a chrome:// page, a canvas app, or an injection that silently
 * returned nothing. Saving an empty source that then extracts no memories is
 * worse than refusing: it looks like it worked.
 */
export const MIN_PAGE_CHARS = 200;

export const TRUNCATION_MARKER = `\n\n[truncated at ${MAX_PAGE_CHARS.toLocaleString('en-US')} characters]`;

/** Cut at a word boundary and say so, so neither the model nor Sources is misled. */
function truncate(text) {
  if (text.length <= MAX_PAGE_CHARS) return text;
  const cut = text.slice(0, MAX_PAGE_CHARS);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > MAX_PAGE_CHARS * 0.9 ? cut.slice(0, boundary) : cut).trimEnd()
    + TRUNCATION_MARKER;
}

/**
 * Pages Mado must not try to save.
 *
 * Its own UI, because saving the tool into itself is never what you meant, and
 * anything that is not http(s) — chrome://, file://, about: — where the
 * injection either fails or returns furniture.
 */
export function skipReason(url, endpointOrigin) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'That page has no address Mado can read.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Mado can only read normal web pages.';
  }
  if (parsed.origin === endpointOrigin) return "That's Mado itself.";
  return null;
}

/**
 * The body the server will receive.
 *
 * `type: 'link'` with `content` filled, which is the point rather than a
 * compromise. A link is stored and never fetched — there is no `fetch(` in the
 * pipeline at all — and putting the fetch in the browser is strictly better
 * than putting it in the server: no bot-blocking, no paywall, no interstitial,
 * because it saves the page you can actually see with your own session. And it
 * keeps a URL-fetching proxy out of a service that now runs all day on
 * localhost.
 *
 * A selection is the same shape with the selection as `content` — the title and
 * URL already say where the quote came from, so nothing is prefixed into it.
 *
 * `referencedUrls` stays empty on purpose: that field is for URLs found *inside*
 * a text source, which is a different thing that is deliberately not fetched.
 */
export function buildCaptureRequest(page) {
  const body = page.selection || page.text;
  if (body.length < MIN_PAGE_CHARS) {
    return {
      skip:
        page.selection && page.selection.length > 0
          ? 'That selection is too short to be worth saving on its own.'
          : 'Nothing readable on this page — copy the text and use ⌘K.',
    };
  }

  return {
    body: {
      type: 'link',
      url: page.url,
      title: page.title || page.url,
      content: truncate(body),
      // The response otherwise carries the whole graph, every memory's
      // 1024-float vector included, and this closes a notification.
      includeGraph: false,
    },
  };
}

/**
 * What to put in the notification.
 *
 * A reorganization outranks everything: "Split AI Tooling into Agent Frameworks
 * and Evals & Observability" is the single best sentence this tool can show
 * you, because it is the tool telling you something you did not know about your
 * own notes. Below that, the category it landed in — which is how you know it
 * understood you rather than merely accepted the bytes.
 *
 * The server's own `note` is used verbatim for the unhappy paths. Those strings
 * were written once and are already right; rewriting them here would make two
 * places to keep honest.
 */
export function describeResult(result) {
  if (result.reorg?.banner_text) {
    return { title: 'Mado reorganized', message: result.reorg.banner_text.replace(/\*\*/g, '') };
  }
  if (result.status === 'complete' && result.addedMemoryIds?.length > 0) {
    const where = result.touchedCategories?.[0]?.name;
    const n = result.addedMemoryIds.length;
    return {
      title: `Saved ${n} ${n === 1 ? 'thing' : 'things'}`,
      message: where ? `to ${where}` : 'Mado filed it.',
    };
  }
  if (result.skipped?.length > 0) {
    return { title: 'Already saved', message: 'Nothing new in this one.' };
  }
  return { title: 'Mado', message: result.note ?? 'Saved, but nothing to remember in it.' };
}
