/**
 * Where the folders sit on the rainbow.
 *
 * Pure geometry, kept out of the component for the same reason `buildTree` is:
 * an arc that puts a label off-screen or overlaps two nodes is a bug you want a
 * unit test to catch, not something you discover by squinting at a screenshot.
 *
 * The arc opens upward from a focus point — the Thinker — with index 0 on the
 * left and the last item on the right, so it reads in the same order as the
 * list it replaces.
 */

export interface ArcPoint {
  /** Offset from the focus, in px. Negative y is above the focus. */
  x: number;
  y: number;
  /** Degrees clockwise from straight up. Negative is left of centre. */
  angleDeg: number;
}

/**
 * Widest the fan ever opens.
 *
 * Kept well under a half-circle on purpose. At 170° the end nodes sit almost
 * level with the focus and the whole thing reads as a ring of scattered items;
 * a rainbow is a shallow arc, and 120° is where it starts looking like one.
 */
export const MAX_SPAN_DEG = 120;
/** Angular room each node wants. Fewer nodes means a tighter, calmer fan. */
export const DEG_PER_NODE = 22;

/**
 * Half a node's hit area — `.arc__node` is 88px wide with `margin-left: -44px`,
 * so it hangs symmetrically off the point it is placed on.
 *
 * The fan has to fit the *boxes*, not the centres. `.canvas-wrap` is
 * `overflow: hidden`, so a node whose centre is comfortably inside the column
 * can still have its label clipped in half.
 */
export const NODE_HALF_W = 44;

/** Room left between the outermost node and the edge of the column. */
export const EDGE_GUTTER = 12;

/**
 * A node's box width. Must match `.arc__node { width }` in theme.css.
 *
 * It is the label that sets it, not the star: two stars can sit almost on top of
 * each other and still read as two stars, whereas two labels that overlap are
 * unreadable. So it is also the number that decides how many categories the arc
 * can hold at all.
 */
export const NODE_WIDTH = 88;

/**
 * The straight-line distance between two neighbours on the arc.
 *
 * Every gap is the same — the nodes are evenly spaced on a circle — so one chord
 * describes the whole fan.
 */
export function chordFor(count: number, radius: number): number {
  if (count < 2) return Infinity;
  const stepRad = ((spanFor(count) / (count - 1)) * Math.PI) / 180;
  return 2 * radius * Math.sin(stepRad / 2);
}

/**
 * How many categories this arc can actually hold.
 *
 * Derived rather than typed, because the answer changes with the window: at the
 * narrowest viewport the app will render it is seven at the top level and four
 * inside a category — and that four *includes* the way back out, so a category
 * with four children already overflows today. Anything past the limit has its
 * labels collide, which is a worse failure than not being shown, because it
 * makes the categories that are there unreadable too.
 */
export function arcCapacity(radius: number, nodeWidth: number = NODE_WIDTH): number {
  let capacity = 1;
  // The fan stops widening at MAX_SPAN_DEG, so past that point every extra node
  // makes every gap smaller and the search can stop at the first failure.
  for (let n = 2; n <= 64; n++) {
    if (chordFor(n, radius) < nodeWidth) break;
    capacity = n;
  }
  return capacity;
}

/**
 * Which seat each rank gets, most interesting first.
 *
 * The apex, then alternating outward. On an upward arc the middle is the highest
 * point and the one the eye lands on, so ranking left-to-right would spend the
 * best position on whatever happened to sort first. The result is a mountain
 * with the strongest at the peak.
 *
 * Returns seat indices in rank order: `seatByRank(5)[0]` is where rank 1 sits.
 */
export function seatByRank(count: number): number[] {
  const middle = Math.floor((count - 1) / 2);
  return Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle) || b - a,
  );
}

/**
 * The fan is only as wide as it needs to be. Three children spread across a
 * half-circle look flung apart rather than related, so the span grows with the
 * count and stops at {@link MAX_SPAN_DEG}.
 */
export function spanFor(count: number): number {
  if (count <= 1) return 0;
  return Math.min(MAX_SPAN_DEG, count * DEG_PER_NODE);
}

/**
 * Positions `count` nodes on an arc of `radius`, symmetric about vertical.
 *
 * A single node sits dead centre at the apex rather than off to one side — the
 * seed has categories with one child, and an arc of one leaning left looks
 * broken.
 */
export function arcPositions(count: number, radius: number, spanDeg?: number): ArcPoint[] {
  if (count <= 0) return [];
  const span = spanDeg ?? spanFor(count);
  const step = count === 1 ? 0 : span / (count - 1);
  const start = -span / 2;

  return Array.from({ length: count }, (_, i) => {
    const angleDeg = start + step * i;
    const rad = (angleDeg * Math.PI) / 180;
    return {
      // Straight up is -y in screen space, hence the sign on the cosine.
      x: Math.sin(rad) * radius,
      y: -Math.cos(rad) * radius,
      angleDeg,
    };
  });
}

/**
 * Where the focus sits, as a fraction of the canvas height.
 *
 * Exported because the hill's crest has to land on exactly this line — the
 * figure sits on it — and the hill is drawn at window level, outside the
 * component that calls {@link fitArc}. Two hand-copied constants would drift
 * and the figure would start floating.
 */
export const FOCUS_FRACTION = { open: 0.32, closed: 0.86 } as const;

export interface ArcGeometry {
  /** Focus of the arc in canvas coordinates — where the Thinker stands. */
  focus: { x: number; y: number };
  radius: number;
  /** Height reserved below the focus for the reading list. */
  listTop: number;
}

/**
 * Fits the arc to the available canvas.
 *
 * In the open state the reading list is the workhorse — that is where the time
 * actually goes — so the arc gives up radius rather than letting the list get
 * squeezed into a strip.
 */
export function fitArc(
  viewport: { w: number; h: number },
  open: boolean,
): ArcGeometry {
  // Browsing, the figure sits low and the arc has the room above it. Open, the
  // whole assembly lifts so the reading list gets the bottom two thirds.
  //
  // Closed is 0.86 because the hill's crest is drawn on this line, and the
  // reference puts its crest at 90% of the frame. That is what makes it a hill:
  // measured off the photograph the figure is 23% of the frame's height and the
  // hill below it only 10%, so the person is more than twice the landform. At
  // 0.72 the ratio was inverted — 13% of figure over 28% of dark ground — and a
  // small mark on a large mass reads as standing on a plain.
  const focusY = viewport.h * (open ? FOCUS_FRACTION.open : FOCUS_FRACTION.closed);
  // Bounded by both axes so a short window narrows the fan instead of pushing
  // the top nodes off-screen.
  // The closed arc reaches much further than it used to, for two reasons that
  // both came from making the scene match the reference. The focus went down to
  // 0.86 to put the hill's crest where the photograph has it, so a radius sized
  // for 0.72 leaves the fan in the pale band above the horizon where grey stones
  // on lilac have almost no contrast. And the figure grew to the reference's
  // share of the frame, so a short radius puts the inner nodes' labels straight
  // through its head — the innermost node sits only r·cos(12°) above the focus,
  // which has to clear the whole figure.
  //
  // The width factor is 0.48 rather than 0.32 because the browsing shell gives
  // itself symmetric gutters, so the column it measures is narrower than the
  // window. Half the fan is r·sin(60°) plus a node's half-width, which at 0.48
  // still lands inside the column.
  /*
   * The width factor above is a proportion, not a guarantee. At the narrowest
   * viewport the app will render — 1280px, which the browsing shell's symmetric
   * gutters cut to a 560px column — 0.48 put the outermost node's right edge
   * 3.2px inside an `overflow: hidden` container. It fit, but by luck rather
   * than by construction, and nothing in the code said 3.2px was the margin.
   *
   * So state it. Half the fan is r·sin(half-span) and the node hangs
   * NODE_HALF_W past that; the widest the fan ever opens is MAX_SPAN_DEG, so
   * that half-angle is the case to survive regardless of how many nodes are on
   * the arc. Above roughly 1300px the proportion is still the smaller number
   * and this changes nothing.
   */
  const widthLimit =
    (viewport.w / 2 - NODE_HALF_W - EDGE_GUTTER) /
    Math.sin(((MAX_SPAN_DEG / 2) * Math.PI) / 180);

  const radius = Math.max(
    120,
    Math.min(
      viewport.w * (open ? 0.32 : 0.48),
      viewport.h * (open ? 0.34 : 0.52),
      focusY - 80,
      widthLimit,
      open ? 240 : 470,
    ),
  );
  return {
    focus: { x: viewport.w / 2, y: focusY },
    radius,
    listTop: focusY + (open ? 112 : 0),
  };
}

/** Which slice of a ranking the arc is currently showing. */
export interface ArcPage {
  /** Index of the first item on this page. */
  start: number;
  /** How many items this page shows. */
  count: number;
  /** How many are not on it. Zero means there is no `more` mark. */
  hidden: number;
  /** Total number of pages. Always at least 1. */
  pages: number;
}

/**
 * How to split a ranking across an arc that cannot hold all of it.
 *
 * The `more` mark takes a seat like anything else, so a paged arc shows one
 * fewer category than an unpaged one — and it stays on every page, including the
 * last, so paging wraps instead of dead-ending. `page` is taken modulo the page
 * count for the same reason: pressing it repeatedly should cycle rather than run
 * off the end.
 *
 * Out here rather than inline in the component because the seeded workspace
 * never overflows — its biggest category has three children against a capacity
 * of four — so nothing in the demo would ever exercise it, and untested paging
 * is paging that does not work.
 */
export function paginate(total: number, capacity: number, page: number): ArcPage {
  const seats = Math.max(1, capacity);
  if (total <= seats) return { start: 0, count: total, hidden: 0, pages: 1 };

  const perPage = Math.max(1, seats - 1);
  const pages = Math.ceil(total / perPage);
  const current = ((page % pages) + pages) % pages;
  const start = current * perPage;
  const count = Math.min(perPage, total - start);
  return { start, count, hidden: total - count, pages };
}
