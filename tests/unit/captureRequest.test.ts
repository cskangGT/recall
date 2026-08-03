import { describe, it, expect } from 'vitest';
import {
  MAX_PAGE_CHARS, MIN_PAGE_CHARS, TRUNCATION_MARKER,
  buildCaptureRequest, describeResult, skipReason,
} from '../../extension/src/captureRequest.js';
import type { PageText } from '../../extension/src/pageText.js';

const page = (over: Partial<PageText> = {}): PageText => ({
  title: 'Things You Should Never Do, Part I',
  url: 'https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/',
  selection: '',
  text: 'x'.repeat(1000),
  ...over,
});

describe('what gets sent', () => {
  it('is a link with the page body, because the browser is the fetcher', () => {
    // `type: 'link'` is stored and never fetched by the pipeline. The extension
    // is what makes that correct rather than a gap.
    const { body } = buildCaptureRequest(page());
    expect(body).toEqual({
      type: 'link',
      url: page().url,
      title: 'Things You Should Never Do, Part I',
      content: 'x'.repeat(1000),
      includeGraph: false,
    });
  });

  it('sends the selection instead of the page when there is one', () => {
    const selection = 'The idea that new code is better than old is patently absurd. '.repeat(5);
    const { body } = buildCaptureRequest(page({ selection }));
    expect(body!.content).toBe(selection);
    // The title and URL already say where the quote came from; nothing is
    // prefixed into the content, which is the source of truth for re-extraction.
    expect(body!.content).not.toContain('http');
  });

  it('falls back to the URL when the page has no title', () => {
    const { body } = buildCaptureRequest(page({ title: '' }));
    expect(body!.title).toBe(page().url);
  });

  it('declines the graph — it closes a notification and never renders one', () => {
    expect(buildCaptureRequest(page()).body!.includeGraph).toBe(false);
  });
});

describe('length', () => {
  it('truncates at a word boundary and says that it did', () => {
    const text = `${'word '.repeat(MAX_PAGE_CHARS)}`;
    const { body } = buildCaptureRequest(page({ text }));
    expect(body!.content.length).toBeLessThanOrEqual(MAX_PAGE_CHARS + TRUNCATION_MARKER.length);
    expect(body!.content).toContain('truncated at 20,000 characters');
    // Cut between words, not through one.
    const prose = body!.content.slice(0, -TRUNCATION_MARKER.length).trimEnd();
    expect(prose.endsWith('word')).toBe(true);
  });

  it('leaves anything short enough exactly alone', () => {
    const text = 'y'.repeat(MAX_PAGE_CHARS);
    expect(buildCaptureRequest(page({ text })).body!.content).toBe(text);
  });

  it('refuses a page with nothing readable on it, rather than saving an empty source', () => {
    // A PDF viewer, a canvas app, a failed injection. An empty source that
    // extracts no memories looks like it worked, which is worse than a refusal.
    const res = buildCaptureRequest(page({ text: 'x'.repeat(MIN_PAGE_CHARS - 1) }));
    expect(res.body).toBeUndefined();
    expect(res.skip).toMatch(/⌘K/);
  });

  it('says something different when it was the selection that was too short', () => {
    const res = buildCaptureRequest(page({ selection: 'ok' }));
    expect(res.skip).toMatch(/selection/i);
  });
});

describe('pages Recall will not try to save', () => {
  const HOME = 'http://127.0.0.1:5170';

  it('skips its own UI', () => {
    expect(skipReason('http://127.0.0.1:5170/', HOME)).toBe("That's Recall itself.");
  });

  it('skips anything that is not a web page', () => {
    for (const url of ['chrome://extensions', 'file:///Users/me/notes.txt', 'about:blank']) {
      expect(skipReason(url, HOME)).toMatch(/normal web pages/);
    }
  });

  it('allows an ordinary page', () => {
    expect(skipReason('https://example.com/article', HOME)).toBeNull();
  });

  it('does not throw on an address it cannot parse', () => {
    expect(skipReason('', HOME)).toMatch(/no address/);
  });
});

describe('what the notification says', () => {
  it('leads with a reorganization, stripped of its markdown', () => {
    // The best sentence this tool can show: it is telling you something you did
    // not know about your own notes.
    const d = describeResult({
      status: 'complete',
      addedMemoryIds: ['m1'],
      reorg: { banner_text: 'Split **AI Tooling** into **Agent Frameworks** and **Evals**' },
    });
    expect(d.message).toBe('Split AI Tooling into Agent Frameworks and Evals');
    expect(d.message).not.toContain('*');
  });

  it('names where it landed, which is how you know it understood you', () => {
    const d = describeResult({
      status: 'complete',
      addedMemoryIds: ['m1', 'm2'],
      touchedCategories: [{ id: 'c1', name: 'Software Rewrite Decisions' }],
      reorg: null,
    });
    expect(d.title).toBe('Saved 2 things');
    expect(d.message).toBe('to Software Rewrite Decisions');
  });

  it('counts one thing as a thing', () => {
    const d = describeResult({
      status: 'complete', addedMemoryIds: ['m1'],
      touchedCategories: [{ id: 'c1', name: 'Notes' }], reorg: null,
    });
    expect(d.title).toBe('Saved 1 thing');
  });

  it('says so when everything in it was already held', () => {
    const d = describeResult({
      status: 'complete', addedMemoryIds: [],
      skipped: [{ text: 'x', similarity: 0.9 }], reorg: null,
    });
    expect(d.title).toBe('Already saved');
  });

  it('uses the server’s own words when it could not remember anything', () => {
    // Those strings are already written and already good; a second copy here
    // would be a second place to keep honest.
    const note = "Saved, but Recall couldn't find anything to remember in this.";
    expect(describeResult({ status: 'no_memories', addedMemoryIds: [], note }).message).toBe(note);
  });

  it('still says something when the server said nothing', () => {
    const d = describeResult({ status: 'failed', addedMemoryIds: [] });
    expect(d.message.length).toBeGreaterThan(0);
  });
});
