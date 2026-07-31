import { describe, it, expect } from 'vitest';
import { OUTER, VOID, PARTS, pathD, partPoints, spanPolygon } from '../../src/components/thinkerPath';

/**
 * The figure is tuned by conversation, and the conversation runs on `PARTS`.
 * A range off by one does not break anything visible — it silently relabels a
 * limb, and then an instruction about the knee lands on the shin. That is the
 * failure these cover.
 */

describe('pathD', () => {
  it('emits both rings, each closed', () => {
    const d = pathD();
    expect(d.startsWith('M72.8 14.8')).toBe(true);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });

  it('emits every point exactly once', () => {
    const numbers = pathD().match(/-?\d+(\.\d+)?/g)!;
    expect(numbers).toHaveLength((OUTER.length + VOID.length) * 2);
  });

  /** Trailing zeros would be harmless but they are noise in a file we hand-edit. */
  it('writes whole numbers without a decimal point', () => {
    expect(pathD()).toContain('L108 87.1');
  });
});

describe('the traced rings', () => {
  /**
   * No assertion on the outer ring's length. It was a tripwire for accidental
   * change, and the shape is now edited on purpose every few minutes, so it
   * fired on every legitimate edit — which teaches you to ignore it. The hole is
   * not being edited, so it keeps its count.
   */
  it('still has exactly one hole, of the size it was traced at', () => {
    expect(VOID).toHaveLength(10);
  });

  it('has no repeated point, which would be a zero-length segment', () => {
    for (let i = 1; i < OUTER.length; i++) {
      expect(OUTER[i]).not.toEqual(OUTER[i - 1]);
    }
  });

  it('stay inside the viewBox', () => {
    for (const [x, y] of [...OUTER, ...VOID]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(116);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(120);
    }
  });

  /** The figure sits on the ground; nothing may hang below it. */
  it('never dips past the ground line', () => {
    expect(Math.max(...OUTER.map(([, y]) => y))).toBeLessThanOrEqual(116);
  });
});

describe('PARTS', () => {
  it('covers the outline exactly once, with no gaps and no overlaps', () => {
    const sorted = [...PARTS].sort((a, b) => a.from - b.from);
    expect(sorted[0]!.from).toBe(0);
    expect(sorted[sorted.length - 1]!.to).toBe(OUTER.length - 1);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.from).toBe(sorted[i - 1]!.to + 1);
    }
  });

  it('gives every part at least one point and a distinct name', () => {
    for (const p of PARTS) expect(p.to).toBeGreaterThanOrEqual(p.from);
    expect(new Set(PARTS.map((p) => p.name)).size).toBe(PARTS.length);
  });

  /**
   * Each run is drawn starting from its predecessor's last point, so the
   * coloured outline is continuous rather than dashed at every boundary — and
   * the first part reaches back to the last, because the contour is a loop.
   */
  it('overlaps its neighbour by one point so the outline draws unbroken', () => {
    for (const p of PARTS) {
      expect(partPoints(p)).toHaveLength(p.to - p.from + 2);
    }
    expect(partPoints(PARTS[0]!)[0]).toEqual(OUTER[OUTER.length - 1]);
  });
});

describe('spanPolygon', () => {
  it('returns the stretch inclusive of both ends', () => {
    const p = spanPolygon(41, 49);
    expect(p).toHaveLength(9);
    expect(p[0]).toEqual(OUTER[41]);
    expect(p[8]).toEqual(OUTER[49]);
  });

  /**
   * The ring's seam sits partway along the top of the cap, so a span across the
   * head has to cross index 0. Nothing anatomical needs that today, which is
   * exactly why it is the case that would be got wrong and not noticed.
   */
  it('wraps past the start of the ring', () => {
    const last = OUTER.length - 1;
    const p = spanPolygon(last - 1, 2);
    expect(p).toHaveLength(5);
    expect(p[0]).toEqual(OUTER[last - 1]);
    expect(p[1]).toEqual(OUTER[last]);
    expect(p[2]).toEqual(OUTER[0]);
    expect(p[4]).toEqual(OUTER[2]);
  });

  it('treats a single-point span as one point, not the whole ring', () => {
    expect(spanPolygon(12, 12)).toEqual([OUTER[12]]);
  });
});
