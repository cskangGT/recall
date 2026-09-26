import { describe, it, expect } from 'vitest';
import { observationOf } from '../../src/capture/batch';

/**
 * The first observation speaks only when the pattern is actually there —
 * a dominant category with real weight — and stays silent otherwise. A forced
 * insight reads as horoscope.
 */

const cat = (name: string, added: number) => ({ id: `cat_${name}`, name, added, isNew: false });

describe('observationOf', () => {
  it('names the category that quietly absorbed the pile', () => {
    const top = observationOf({ memories: 5, categories: [cat('마케팅 아이디어', 3), cat('레시피', 2)] });
    expect(top?.name).toBe('마케팅 아이디어');
  });

  it('stays silent when the pile is spread thin', () => {
    expect(
      observationOf({ memories: 6, categories: [cat('a', 2), cat('b', 2), cat('c', 2)] }),
    ).toBeNull();
  });

  it('stays silent on a single memory — one is not a pattern', () => {
    expect(observationOf({ memories: 1, categories: [cat('a', 1)] })).toBeNull();
  });

  it('stays silent on an empty batch', () => {
    expect(observationOf({ memories: 0, categories: [] })).toBeNull();
  });

  it('speaks at exactly the 40% threshold', () => {
    expect(observationOf({ memories: 5, categories: [cat('a', 2), cat('b', 1), cat('c', 1), cat('d', 1)] })?.name).toBe('a');
  });
});
