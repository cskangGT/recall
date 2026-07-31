import { describe, it, expect } from 'vitest';
import {
  pebbleShape,
  pebbleRadius,
  MIN_WIDTH,
  PER_MEMORY,
  COUNT_CAP,
} from '../../src/arc/pebble';

/**
 * The stone's whole job is to be recognisable, so the properties worth pinning
 * are the ones that would quietly destroy that: a shape that drifts between
 * renders, or one that drifts as the category fills up.
 */

const percentages = (radius: string) =>
  radius.match(/\d+(?=%)/g)!.map(Number);

describe('pebbleRadius', () => {
  it('gives the same id the same stone, every time', () => {
    expect(pebbleRadius('cat_fundraising')).toBe(pebbleRadius('cat_fundraising'));
  });

  it('gives different categories different stones', () => {
    const ids = ['cat_1', 'cat_2', 'cat_3', 'cat_4', 'cat_5', 'cat_6'];
    expect(new Set(ids.map(pebbleRadius)).size).toBe(ids.length);
  });

  it('emits eight percentages — four across, four down', () => {
    const parts = pebbleRadius('cat_1').split('/');
    expect(parts).toHaveLength(2);
    expect(percentages(parts[0]!)).toHaveLength(4);
    expect(percentages(parts[1]!)).toHaveLength(4);
  });

  /**
   * The bound is what keeps a hundred stones looking like stones. Without it
   * some id eventually hashes into a bean; with it too tight — the first pass
   * used 42–62 — they all come out as the same ellipse.
   */
  it('keeps every radius inside 34–68%', () => {
    for (let i = 0; i < 400; i++) {
      for (const n of percentages(pebbleRadius(`cat_${i}`))) {
        expect(n).toBeGreaterThanOrEqual(34);
        expect(n).toBeLessThanOrEqual(68);
      }
    }
  });

  /**
   * Horizontal and vertical radii come from separately-salted hashes. Drawing
   * both from one hash correlates them and the result is a tilted ellipse
   * rather than a stone, which is exactly the anonymity we left the sphere over.
   */
  it('does not repeat the horizontal profile vertically', () => {
    let identical = 0;
    for (let i = 0; i < 200; i++) {
      const [across, down] = pebbleRadius(`cat_${i}`).split('/');
      if (percentages(across!).join() === percentages(down!).join()) identical++;
    }
    expect(identical).toBe(0);
  });
});

describe('pebbleShape', () => {
  it('lies flatter than it is wide', () => {
    const { width, height } = pebbleShape('cat_1', 9);
    expect(height).toBeLessThan(width);
  });

  it('grows with what the category holds', () => {
    expect(pebbleShape('cat_1', 9).width).toBeGreaterThan(pebbleShape('cat_1', 2).width);
  });

  /** One huge category must not dwarf the arc it sits on. */
  it('stops growing past the cap', () => {
    expect(pebbleShape('cat_1', COUNT_CAP).width).toBe(
      pebbleShape('cat_1', COUNT_CAP + 90).width,
    );
    expect(pebbleShape('cat_1', 999).width).toBe(
      Math.round(MIN_WIDTH + COUNT_CAP * PER_MEMORY),
    );
  });

  /** The back and answer nodes carry no count. */
  it('handles a null count as the smallest stone', () => {
    expect(pebbleShape('cat_1', null).width).toBe(MIN_WIDTH);
  });

  /**
   * The outline must survive the category filling up — you learn a stone's
   * silhouette, and a silhouette that changed on every capture would be worse
   * than no silhouette at all.
   */
  it('changes size with the count but never shape', () => {
    expect(pebbleShape('cat_1', 2).radius).toBe(pebbleShape('cat_1', 13).radius);
  });

  /** Every stone has to fit the 88px node without shoving its neighbour. */
  it('never outgrows the arc node it sits in', () => {
    expect(pebbleShape('cat_1', 999).width).toBeLessThanOrEqual(80);
  });
});
