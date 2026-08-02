import { describe, it, expect } from 'vitest';
import {
  arcPositions,
  spanFor,
  fitArc,
  MAX_SPAN_DEG,
  DEG_PER_NODE,
  NODE_HALF_W,
  EDGE_GUTTER,
  NODE_WIDTH,
  chordFor,
  arcCapacity,
  seatByRank,
  paginate,
} from '../../src/arc/layout';

describe('spanFor', () => {
  it('opens wider as the fan gets more nodes, up to a cap', () => {
    expect(spanFor(3)).toBe(3 * DEG_PER_NODE);
    expect(spanFor(6)).toBe(MAX_SPAN_DEG);
    expect(spanFor(20)).toBe(MAX_SPAN_DEG);
  });

  it('gives a lone node no span — it belongs at the apex', () => {
    expect(spanFor(1)).toBe(0);
    expect(spanFor(0)).toBe(0);
  });
});

describe('arcPositions', () => {
  it('returns one point per node', () => {
    expect(arcPositions(6, 300)).toHaveLength(6);
    expect(arcPositions(0, 300)).toEqual([]);
  });

  it('puts a single node dead centre at the apex', () => {
    const [only] = arcPositions(1, 300);
    expect(only!.x).toBeCloseTo(0, 6);
    expect(only!.y).toBeCloseTo(-300, 6);
    expect(only!.angleDeg).toBe(0);
  });

  it('is symmetric about vertical', () => {
    const points = arcPositions(6, 300);
    for (let i = 0; i < points.length; i++) {
      const mirror = points[points.length - 1 - i]!;
      expect(points[i]!.x).toBeCloseTo(-mirror.x, 6);
      expect(points[i]!.y).toBeCloseTo(mirror.y, 6);
    }
  });

  it('runs left to right, so the arc reads in the same order as the list it replaced', () => {
    const xs = arcPositions(6, 300).map((p) => p.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    }
  });

  it('keeps every node on the circle', () => {
    for (const p of arcPositions(6, 300)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(300, 6);
    }
  });

  it('never puts a node below its focus — the rainbow opens upward', () => {
    for (const count of [1, 2, 3, 6, 12]) {
      for (const p of arcPositions(count, 300)) {
        expect(p.y).toBeLessThan(0);
      }
    }
  });

  it('leaves enough room between six nodes for a label', () => {
    const points = arcPositions(6, 300);
    for (let i = 1; i < points.length; i++) {
      const gap = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
      expect(gap).toBeGreaterThan(110);
    }
  });

  /**
   * The one that matters. Labels sit under their node at a fixed width, so if
   * two nodes are closer together than that width the labels overlap — which is
   * exactly what happened at four nodes in the open state, and no other
   * assertion here noticed.
   */
  it('never places nodes closer together than a label is wide', () => {
    const viewport = { w: 1096, h: 982 };

    for (const open of [false, true]) {
      const { radius } = fitArc(viewport, open);
      // 6 parents at the top level; up to 5 children plus a back node below.
      for (const count of [2, 3, 4, 5, 6]) {
        const points = arcPositions(count, radius);
        for (let i = 1; i < points.length; i++) {
          const chord = Math.hypot(
            points[i]!.x - points[i - 1]!.x,
            points[i]!.y - points[i - 1]!.y,
          );
          expect(
            chord,
            `${count} nodes, open=${open}: chord ${chord.toFixed(1)} < label width`,
          ).toBeGreaterThanOrEqual(NODE_WIDTH);
        }
      }
    }
  });

  it('honours an explicit span over the adaptive one', () => {
    const [first, , last] = arcPositions(3, 300, 60);
    expect(first!.angleDeg).toBe(-30);
    expect(last!.angleDeg).toBe(30);
  });
});

describe('fitArc', () => {
  const viewport = { w: 1096, h: 982 };

  it('centres the focus horizontally', () => {
    expect(fitArc(viewport, false).focus.x).toBe(548);
  });

  it('lifts the focus and shrinks the arc once a folder is open', () => {
    const browsing = fitArc(viewport, false);
    const open = fitArc(viewport, true);
    expect(open.focus.y).toBeLessThan(browsing.focus.y);
    expect(open.radius).toBeLessThan(browsing.radius);
  });

  it('gives the reading list the majority of the height when open', () => {
    const open = fitArc(viewport, true);
    expect(viewport.h - open.listTop).toBeGreaterThan(viewport.h * 0.5);
  });

  /*
   * This test was measuring a column the browsing screen no longer has.
   *
   * It used 1280 - 56 - 360 = 864: the rail plus the inspector, which is the
   * shell's layout everywhere *except* the view the arc lives in. `.shell--mono`
   * gives itself symmetric gutters so the scene sits on the window's centre
   * line, making the column 1280 - 360 - 360 = 560 — thirty-five percent
   * narrower than the width the guarantee was being checked against.
   *
   * It also compared `focus.x + radius` against the edge, but no node is ever
   * at focus.x + radius: that is the point the arc would reach if it opened a
   * full half-circle, and MAX_SPAN_DEG caps it at 120. Meanwhile every node
   * carries an 88px box centred on its point, and `.canvas-wrap` is
   * `overflow: hidden`. The old assertion was simultaneously too strict about
   * the angle and too lax about the box.
   */
  it('keeps every node box on screen at the minimum supported viewport', () => {
    // The app refuses to render below 1280px wide (AC-41). Browsing, the canvas
    // is that minus two inspector-width gutters.
    const tight = { w: 1280 - 360 - 360, h: 700 };

    for (const open of [false, true]) {
      const { focus, radius } = fitArc(tight, open);
      // Worst case is a full fan, whatever the node count happens to be.
      const points = arcPositions(MAX_SPAN_DEG / DEG_PER_NODE, radius);

      for (const p of points) {
        // Not merely on screen — on screen *by a stated amount*. Before the
        // width limit existed the outermost node cleared the edge by 3.2px,
        // which passes a "does it fit" assertion while telling nobody that the
        // next half-point of radius would have clipped a label in half.
        expect(focus.x + p.x - NODE_HALF_W).toBeGreaterThanOrEqual(EDGE_GUTTER);
        expect(focus.x + p.x + NODE_HALF_W).toBeLessThanOrEqual(tight.w - EDGE_GUTTER);
        // Above the focus and clear of the top edge, label included.
        expect(focus.y + p.y).toBeGreaterThan(0);
      }
    }
  });

  /*
   * The guarantee above is only worth having if it is the binding constraint
   * when it needs to be and invisible when it does not — a clamp that quietly
   * shrank the arc at every size would be a regression dressed as a fix.
   */
  it('does not shrink the arc at ordinary window sizes', () => {
    // A 1512px window, which is what the e2e suite runs at.
    const roomy = { w: 1512 - 360 - 360, h: 982 };
    expect(fitArc(roomy, false).radius).toBeCloseTo(roomy.w * 0.48, 5);
  });
});

describe('chordFor', () => {
  /**
   * The closed form has to agree with the positions actually rendered, or the
   * capacity it feeds is describing a different arc from the one on screen.
   */
  it('agrees with the gap between the points arcPositions produces', () => {
    for (const count of [2, 3, 4, 6, 9, 14]) {
      const points = arcPositions(count, 300);
      const measured = Math.min(
        ...points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y)),
      );
      expect(chordFor(count, 300)).toBeCloseTo(measured, 6);
    }
  });

  it('has no meaningful gap for a lone node', () => {
    expect(chordFor(1, 300)).toBe(Infinity);
  });
});

describe('arcCapacity', () => {
  /**
   * The numbers that decide the design. Measured against the radii fitArc
   * actually produces, so they move if the geometry does.
   */
  it('holds seven at the top level and four inside a category, at the minimum viewport', () => {
    const tight = { w: 1280 - 360 - 360, h: 800 };
    expect(arcCapacity(fitArc(tight, false).radius)).toBe(7);
    // And that four includes the way back out, so three children is the most a
    // category can show here.
    expect(arcCapacity(fitArc(tight, true).radius)).toBe(4);
  });

  it('holds more in a bigger window', () => {
    const roomy = { w: 1920 - 360 - 360, h: 1080 };
    expect(arcCapacity(fitArc(roomy, false).radius)).toBeGreaterThan(
      arcCapacity(fitArc({ w: 1280 - 360 - 360, h: 800 }, false).radius),
    );
  });

  it('never returns a count whose labels would collide', () => {
    for (const radius of [150, 200, 259, 300, 380, 470, 600]) {
      const n = arcCapacity(radius);
      expect(chordFor(n, radius)).toBeGreaterThanOrEqual(NODE_WIDTH);
      // And it is the *largest* such count, not merely a safe one.
      expect(chordFor(n + 1, radius)).toBeLessThan(NODE_WIDTH);
    }
  });

  it('always seats at least one', () => {
    expect(arcCapacity(1)).toBe(1);
  });
});

describe('seatByRank', () => {
  it('puts the strongest at the apex', () => {
    // Odd: a true middle.
    expect(seatByRank(5)[0]).toBe(2);
    // Even: the seat just left of centre, which is the higher of the two.
    expect(seatByRank(6)[0]).toBe(2);
  });

  it('alternates outward from the peak', () => {
    expect(seatByRank(5)).toEqual([2, 3, 1, 4, 0]);
    expect(seatByRank(6)).toEqual([2, 3, 1, 4, 0, 5]);
  });

  it('uses every seat exactly once', () => {
    for (const n of [1, 2, 3, 6, 7, 10]) {
      const seats = seatByRank(n);
      expect(seats).toHaveLength(n);
      expect([...seats].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  /**
   * The property that makes it a mountain: walking the arc from either end,
   * rank improves until the peak and worsens after it.
   */
  it('produces a single peak, never two humps', () => {
    for (const n of [4, 5, 6, 7, 9]) {
      const seats = seatByRank(n);
      // rank of the category sitting in each seat, left to right
      const rankAt = Array.from({ length: n }, (_, seat) => seats.indexOf(seat));
      const peak = rankAt.indexOf(0);
      for (let i = 1; i <= peak; i++) expect(rankAt[i]!).toBeLessThan(rankAt[i - 1]!);
      for (let i = peak + 1; i < n; i++) expect(rankAt[i]!).toBeGreaterThan(rankAt[i - 1]!);
    }
  });
});

describe('paginate', () => {
  it('shows everything and offers no more mark when it all fits', () => {
    expect(paginate(6, 7, 0)).toEqual({ start: 0, count: 6, hidden: 0, pages: 1 });
    expect(paginate(7, 7, 0)).toEqual({ start: 0, count: 7, hidden: 0, pages: 1 });
  });

  /** The mark takes a seat like anything else, so a paged arc shows one fewer. */
  it('gives up a seat to the more mark as soon as it is needed', () => {
    const page = paginate(8, 7, 0);
    expect(page.count).toBe(6);
    expect(page.hidden).toBe(2);
    expect(page.pages).toBe(2);
  });

  it('walks down the ranking a page at a time', () => {
    expect(paginate(20, 7, 0).start).toBe(0);
    expect(paginate(20, 7, 1).start).toBe(6);
    expect(paginate(20, 7, 2).start).toBe(12);
  });

  it('never runs off the end — the last page is short, not empty', () => {
    const last = paginate(20, 7, 3);
    expect(last.start).toBe(18);
    expect(last.count).toBe(2);
  });

  /** Pressing it repeatedly should cycle, not dead-end. */
  it('wraps in both directions', () => {
    expect(paginate(20, 7, 4)).toEqual(paginate(20, 7, 0));
    expect(paginate(20, 7, -1)).toEqual(paginate(20, 7, 3));
  });

  it('still shows something when there is room for the mark and nothing else', () => {
    const page = paginate(5, 1, 0);
    expect(page.count).toBeGreaterThanOrEqual(1);
    expect(page.hidden).toBeLessThan(5);
  });

  it('always accounts for every item across a full cycle', () => {
    for (const [total, capacity] of [[8, 7], [20, 7], [13, 4], [5, 2]] as const) {
      const seen = new Set<number>();
      const { pages } = paginate(total, capacity, 0);
      for (let p = 0; p < pages; p++) {
        const { start, count } = paginate(total, capacity, p);
        for (let i = start; i < start + count; i++) seen.add(i);
      }
      expect(seen.size).toBe(total);
    }
  });
});
