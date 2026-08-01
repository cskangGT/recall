import { describe, it, expect } from 'vitest';
import {
  arcPositions,
  spanFor,
  fitArc,
  MAX_SPAN_DEG,
  DEG_PER_NODE,
  NODE_HALF_W,
  EDGE_GUTTER,
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
    // Must match `.arc__node { width }` in theme.css.
    const NODE_WIDTH = 88;
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
