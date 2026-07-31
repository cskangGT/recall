/**
 * The figure's outline, as data.
 *
 * It was a template literal of fifty-nine `L` commands on one line, which made
 * every shape edit an exercise in string surgery — and shape edits are the point
 * of this file. As points, "move the three at the top of the shin" is a change
 * you can make without counting characters, and the debug overlay in
 * `Thinker.tsx` falls out of the same data for free.
 *
 * The numbers came from tracing the reference photograph, not from drawing; see
 * the header of `Thinker.tsx` for what that involved and what it cost.
 *
 * Units are the `Thinker` viewBox: 116 wide, 120 tall, ground at y=116, figure
 * facing left. x grows right, y grows down.
 */

/** A point on the outline. */
export type Pt = readonly [number, number];

/**
 * The outer contour, in path order: it starts partway along the top of the cap
 * and runs clockwise — back of the head, the back, the seat, along the ground,
 * the foot, up the shin, over the knee, along the forearm, the chest, and back
 * over the face to where it started.
 */
export const OUTER: readonly Pt[] = [
  [72.8, 14.8],
  [84.9, 16.9],
  [87.5, 19.3],
  [89.8, 23.5],
  [90.3, 29.1],
  [89.4, 33.9],
  [87, 38.6],
  [87, 39.8],
  [90.3, 47.5],
  [94.5, 52.1],
  [101.7, 64.5],
  [104.3, 71.7],
  [105.9, 80.6],
  [108, 87.1],
  [107.5, 90.6],
  [105.7, 95],
  [105.9, 100.4],
  [105.4, 102],
  [102.2, 104.6],
  [100.8, 112.6],
  [98.7, 115.4],
  [65.1, 115.9],
  [64.2, 115.7],
  [54.2, 103],
  [53, 103.6],
  [49, 108.5],
  [44.1, 113.5],
  [42.5, 115.6],
  [22, 115.8],
  [10.3, 116],
  [8.2, 115.4],
  [8.2, 113],
  [12.4, 109.5],
  [14.8, 106.7],
  [15.9, 106.4],
  [18.7, 103.9],
  [19.7, 101.1],
  [19, 98.1],
  [19.4, 95.3],
  [20.6, 94.1],
  [20.8, 90.4],
  [23.6, 83.4],
  [24.1, 81.6],
  [20.9, 83],
  [16.9, 81.4],
  [15.1, 78],
  [15.7, 74.6],
  [17.1, 73.4],
  [10.5, 64.6],
  [9.5, 65.4],
  [6.8, 61.8],
  [12.6, 57.4],
  [15.3, 61],
  [14.3, 61.8],
  [20.9, 70.6],
  [23.9, 73.2],
  [22.4, 68.5],
  [23, 66],
  [22.2, 60.2],
  [24.6, 54.4],
  [30, 49.8],
  [35.5, 48.8],
  [40.5, 46],
  [46, 45],
  [50.7, 45.6],
  [58.1, 41.2],
  [59.7, 32.8],
  [59.3, 29.3],
  [63.2, 26.5],
  [65.1, 16.7],
  [67.4, 15.3],
  [72.6, 15.1],
];

/**
 * The hole: sky showing through between forearm, chest and thigh. Punched out of
 * the same path with `evenodd`.
 *
 * The other gap in the silhouette — between the near shin and the seat — is not
 * here, because it is open to the ground and so belongs to the outer contour as
 * a notch rather than being a hole.
 */
export const VOID: readonly Pt[] = [
  [45.2, 62],
  [52, 59],
  [56.7, 60.2],
  [60.5, 65.5],
  [66, 75.5],
  [66, 76.6],
  [59.5, 71.5],
  [52, 68],
  [44.6, 63.2],
];

/*
 * The flashlight (indices 47–55) is built from an axis, not drawn freehand,
 * because the three things that say "torch" are all relationships:
 *
 *   - the barrel's two sides are **parallel**. They were at 32 degrees and 55,
 *     so it was a wedge, and a wedge is a spike or a horn but never a cylinder.
 *     That one mistake is why it did not read.
 *   - the head **steps** out from the barrel. A smooth swelling is a bulb.
 *   - the lens end is **cut square**. A rounded end is a match, or a lollipop.
 *
 * Grip at (20.5, 72) along (-0.6, -0.8); barrel 11 long by 4.8 across, housing
 * 4.5 by 7.2. Fifteen and a half units end to end, against the reference's
 * sixteen.
 */

/**
 * The lacing, as two hairlines of sky across the instep.
 *
 * A silhouette has no interior, so detail on it can only be absence: the same
 * trick as the gap under the forearm, at a twentieth of the size. Each sliver is
 * about a unit thick, which is a pixel and a half at the size the figure renders
 * — enough to break the boot's edge and suggest a lacing, not enough to be read
 * as damage. They lie across the instep, roughly square to it.
 *
 * Punched out by the same `evenodd` as {@link VOID}.
 */
export const LACES: readonly (readonly Pt[])[] = [
  [
    [11.6, 110.4],
    [12.5, 109.7],
    [15.3, 111.9],
    [14.4, 112.6],
  ],
  [
    [14.2, 107.7],
    [15.1, 107.0],
    [17.7, 109.3],
    [16.8, 110.0],
  ],
];

/**
 * Names for stretches of the outline, so that a change can be asked for in
 * words. `from` and `to` are inclusive indices into {@link OUTER}, and together
 * they cover it exactly once — a unit test holds that, because a range off by
 * one silently relabels a limb and then a conversation about the knee is really
 * about the shin.
 *
 * `colour` is only ever used by the `?figure=debug` overlay.
 */
export interface Part {
  name: string;
  from: number;
  to: number;
  colour: string;
}

export const PARTS: readonly Part[] = [
  { name: 'Back of cap', from: 0, to: 4, colour: '#ff5f5f' },
  { name: 'Nape', from: 5, to: 7, colour: '#ff9f2f' },
  { name: 'Shoulder', from: 8, to: 9, colour: '#ffe14d' },
  { name: 'Back', from: 10, to: 13, colour: '#8fe36b' },
  { name: 'Seat', from: 14, to: 20, colour: '#3fd6a0' },
  { name: 'Ground', from: 21, to: 21, colour: '#3fd0e0' },
  { name: 'Leg notch', from: 22, to: 27, colour: '#4fa8ff' },
  { name: 'Foot', from: 28, to: 30, colour: '#7c7cff' },
  { name: 'Heel', from: 31, to: 35, colour: '#b06bff' },
  { name: 'Shin, lower', from: 36, to: 41, colour: '#ff6bd6' },
  { name: 'Fist', from: 42, to: 46, colour: '#ffb03f' },
  { name: 'Flashlight', from: 47, to: 55, colour: '#ffd166' },
  { name: 'Shin, upper', from: 56, to: 58, colour: '#ff8fdf' },
  { name: 'Knee', from: 59, to: 60, colour: '#ff4f9a' },
  { name: 'Forearm', from: 61, to: 65, colour: '#ffffff' },
  { name: 'Chest', from: 66, to: 67, colour: '#c9a06b' },
  { name: 'Bill and cap front', from: 68, to: 71, colour: '#6bd0ff' },
];

const pt = ([x, y]: Pt) => `${x} ${y}`;
const ring = (pts: readonly Pt[]) => `M${pts.map(pt).join(' L')} Z`;

/** The `d` attribute: outer contour, then every hole, for `fill-rule: evenodd`. */
export function pathD(): string {
  return [OUTER, VOID, ...LACES].map(ring).join(' ');
}

/**
 * The points a part owns, plus the one before it, so consecutive parts share an
 * endpoint and the overlay draws as one unbroken outline rather than as a dashed
 * one with a gap at every boundary.
 */
export function partPoints(part: Part): readonly Pt[] {
  const start = part.from === 0 ? OUTER.length - 1 : part.from - 1;
  return [OUTER[start]!, ...OUTER.slice(part.from, part.to + 1)];
}

/**
 * The points of a stretch of the outline, inclusive of both ends, ready to be
 * filled as a closed polygon — the chord back from `to` to `from` is the polygon
 * closing itself.
 *
 * Wraps when `to < from`, because the ring's seam sits partway along the top of
 * the cap and a span across the head has to be able to cross it. Nothing needs
 * that today, which is exactly why it is the case that would be got wrong.
 */
export function spanPolygon(from: number, to: number): readonly Pt[] {
  const n = OUTER.length;
  const a = ((from % n) + n) % n;
  const b = ((to % n) + n) % n;
  const count = ((b - a + n) % n) + 1;
  return Array.from({ length: count }, (_, i) => OUTER[(a + i) % n]!);
}
