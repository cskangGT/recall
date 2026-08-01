import { describe, it, expect } from 'vitest';
import { search, tokenize, highlight, groupByCategory, MAX_RESULTS } from '../../src/search/search';
import { isQuestion } from '../../src/ask/scriptedAsk';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';

const payload = validateSeed(workspaceJson);

describe('tokenize', () => {
  it('drops stop words and single characters', () => {
    expect(tokenize('the eval of a stack')).toEqual(['eval', 'stack']);
  });

  it('strips punctuation without losing the words around it', () => {
    expect(tokenize("what's our eval-stack?")).toEqual(['what', 'our', 'eval-stack']);
  });

  it('returns nothing for a query with no usable terms', () => {
    expect(tokenize('?? !! a')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('highlight', () => {
  it('marks a matched term and leaves the rest alone', () => {
    const segments = highlight('Eval suites run on every commit', ['eval']);
    expect(segments.filter((s) => s.matched).map((s) => s.text)).toEqual(['Eval']);
    expect(segments.map((s) => s.text).join('')).toBe('Eval suites run on every commit');
  });

  it('extends a prefix match to the whole word', () => {
    // Searching "eval" should light up the whole of "evals", not leave a
    // dangling "s" outside the mark.
    const segments = highlight('offline evals catch regressions', ['eval']);
    expect(segments.find((s) => s.matched)!.text).toBe('evals');
  });

  it('does not match inside a word', () => {
    const segments = highlight('retrieval is not eval', ['eval']);
    const matched = segments.filter((s) => s.matched).map((s) => s.text);
    expect(matched).toEqual(['eval']);
  });

  it('never loses or duplicates text', () => {
    const text = 'Braintrust is the current front-runner for eval tooling over Langfuse';
    for (const terms of [['eval'], ['braintrust', 'langfuse'], ['is'], []]) {
      expect(highlight(text, terms).map((s) => s.text).join('')).toBe(text);
    }
  });

  it('handles a regex metacharacter in the query', () => {
    expect(() => highlight('a (b) c', ['(b)'])).not.toThrow();
  });
});

describe('search', () => {
  it('finds a memory by a literal term', () => {
    const results = search(payload, 'langchain');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.memory.text).toContain('LangChain');
  });

  it('ranks an exact phrase above a scattered term match', () => {
    const phrase = 'eval rubric';
    const results = search(payload, phrase);
    expect(results[0]!.memory.text.toLowerCase()).toContain(phrase);
  });

  it('prefers a memory containing every term', () => {
    const results = search(payload, 'seed dilution');
    expect(results[0]!.memory.text.toLowerCase()).toContain('dilution');
  });

  it('caps results', () => {
    expect(search(payload, 'the a to').length).toBeLessThanOrEqual(MAX_RESULTS);
    expect(search(payload, 'pricing').length).toBeLessThanOrEqual(MAX_RESULTS);
  });

  it('returns nothing rather than everything for an empty query', () => {
    expect(search(payload, '')).toEqual([]);
    expect(search(payload, '   ')).toEqual([]);
    expect(search(payload, '???')).toEqual([]);
  });

  it('returns nothing for a term nobody saved', () => {
    expect(search(payload, 'zzzznotathing')).toEqual([]);
  });

  it('matches on source title as well as memory text', () => {
    // Spec §9.1 searches both. "Calendar audit" is a source title; no memory
    // text contains the word "audit".
    const noMemoryHasIt = payload.memories.every((m) => !m.text.toLowerCase().includes('audit'));
    expect(noMemoryHasIt).toBe(true);
    expect(search(payload, 'audit').length).toBeGreaterThan(0);
  });

  it('is deterministic under ties', () => {
    const first = search(payload, 'pricing').map((r) => r.memory.id);
    for (let i = 0; i < 10; i++) {
      expect(search(payload, 'pricing').map((r) => r.memory.id)).toEqual(first);
    }
  });

  it('carries the category and source each result belongs to', () => {
    for (const result of search(payload, 'eval')) {
      expect(result.categoryName).not.toBe('Uncategorised');
      expect(result.sourceTitle).not.toBe('Unknown source');
      expect(result.segments.map((s) => s.text).join('')).toBe(result.memory.text);
    }
  });
});

describe('groupByCategory', () => {
  it('groups without reordering within a group', () => {
    const results = search(payload, 'eval');
    const groups = groupByCategory(results);
    expect(groups.flatMap((g) => g.results.map((r) => r.memory.id)))
      .toEqual(results.sort((a, b) => {
        const gi = (r: typeof a) => groups.findIndex((g) => g.categoryId === r.categoryId);
        return gi(a) - gi(b);
      }).map((r) => r.memory.id));
  });

  it('puts each category in exactly one group', () => {
    const groups = groupByCategory(search(payload, 'the pricing seed eval'));
    const ids = groups.map((g) => g.categoryId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('search and ask split the bar between them', () => {
  it('routes a question to Ask and a keyword to Search', () => {
    // The chip reads from exactly this predicate, so a disagreement here is the
    // chip lying about what Enter will do.
    expect(isQuestion('What did we decide about our eval stack?')).toBe(true);
    expect(isQuestion('langchain')).toBe(false);
    expect(isQuestion('pricing')).toBe(false);
  });
});
