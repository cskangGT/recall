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
  [100.8, 107.8],
  [98.7, 109.2],
  [65.1, 109.7],
  [64.2, 109.5],
  [54.2, 98.8],
  [53, 99.4],
  [49, 104.8],
  [44.1, 108.8],
  [42.5, 111.3],
  [22, 113.9],
  [10.3, 116],
  [8.2, 114.8],
  [8.2, 113],
  [12.4, 109.5],
  [14.8, 106.7],
  [15.9, 106.4],
  [18.7, 103.9],
  [19.7, 101.1],
  [19, 98.1],
  [19.4, 95.3],
  [20.6, 94.1],
  [21.3, 90.8],
  [25.7, 83.6],
  [24.6, 78.5],
  [25.9, 67.7],
  [26.9, 65.4],
  [27.1, 60.8],
  [30.4, 55.9],
  [35, 51.2],
  [39.9, 50.5],
  [43.7, 47.2],
  [47.9, 45.8],
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
  [55.3, 60.5],
  [56.7, 60.8],
  [58.1, 65.9],
  [62.1, 71],
  [62.1, 71.7],
  [58.6, 68.4],
  [54.4, 66.1],
  [50.9, 63.1],
  [51.1, 62.4],
  [55.1, 60.8],
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
  { name: 'Shin', from: 36, to: 45, colour: '#ff6bd6' },
  { name: 'Knee', from: 46, to: 47, colour: '#ff4f9a' },
  { name: 'Forearm', from: 48, to: 52, colour: '#ffffff' },
  { name: 'Chest', from: 53, to: 54, colour: '#c9a06b' },
  { name: 'Bill and cap front', from: 55, to: 58, colour: '#6bd0ff' },
];

const pt = ([x, y]: Pt) => `${x} ${y}`;
const ring = (pts: readonly Pt[]) => `M${pts.map(pt).join(' L')} Z`;

/** The `d` attribute: outer contour then hole, for `fill-rule: evenodd`. */
export function pathD(): string {
  return `${ring(OUTER)} ${ring(VOID)}`;
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
