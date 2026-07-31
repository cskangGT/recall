/**
 * The shape of a category on the arc.
 *
 * Spheres were the second attempt (clouds were the first) and both failed for
 * the same reason: a perfect circle is anonymous. Six of them side by side are
 * six of the same thing at six sizes, so the only thing telling them apart is
 * the label underneath, and the arc stops being a picture of your memory and
 * becomes a bar chart drawn in circles.
 *
 * A water-worn stone is the fix. It is low and wide, so it reads as *resting*
 * on the waterline the figure already stands in, and no two are quite the same
 * outline — which is what lets you recognise `Fundraising` by its silhouette
 * before you have read a word.
 *
 * Two rules make that work rather than look like noise:
 *
 * - The outline is derived from the category **id**, not from anything that
 *   moves. A stone whose shape changed when you added a memory to it would be
 *   worse than a circle: you would learn its silhouette and then lose it.
 * - The variation is bounded. Every radius stays inside 42–62%, which is enough
 *   for a stone to have a character and not enough for one to become a bean.
 *
 * Kept out of the component and unit-tested for the same reason `layout.ts` is:
 * "is this stable across renders" is a question a test should answer, not
 * something you check by squinting at two screenshots.
 */

export interface PebbleShape {
  /** Across, in px. Grows with how much the category holds. */
  width: number;
  /** Tall, in px. Always the shorter of the two — a stone settles flat. */
  height: number;
  /** A CSS `border-radius`: four horizontal percentages, then four vertical. */
  radius: string;
}

/** Smallest stone, for a category holding nothing. */
export const MIN_WIDTH = 40;
/** Per-memory growth, and the count past which a big category stops growing. */
export const PER_MEMORY = 2.6;
export const COUNT_CAP = 14;
/** How flat a stone lies. Below ~0.5 it reads as a puddle, above ~0.75 as an egg. */
export const FLATNESS = 0.62;

/**
 * 34–68%, not the 42–62% of the first attempt.
 *
 * That narrower band was chosen to keep every stone convex and it worked, but
 * six of them side by side were indistinguishable from six ellipses — the
 * variation existed in the numbers and not on the screen. A corner has to be
 * able to reach a third of the box before the silhouette is something you could
 * pick out of a line-up.
 */
const RADIUS_MIN = 34;
const RADIUS_RANGE = 35; // 34–68 inclusive.

/** FNV-1a. Any stable string hash would do; this one is four lines. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Eight radii from one id.
 *
 * A 32-bit hash only carries four independent bytes, so the vertical set is
 * drawn from a second hash of a salted id rather than from the same bits
 * shifted — reusing them makes the horizontal and vertical profiles correlate,
 * and correlated radii produce a shape that is merely a tilted ellipse.
 */
export function pebbleRadius(id: string): string {
  const across = hash(id);
  const down = hash(`${id}~v`);
  const at = (h: number, byte: number) =>
    RADIUS_MIN + (((h >>> (byte * 8)) & 0xff) % RADIUS_RANGE);
  const four = (h: number) => [at(h, 0), at(h, 1), at(h, 2), at(h, 3)];
  return `${four(across).map((n) => `${n}%`).join(' ')} / ${four(down)
    .map((n) => `${n}%`)
    .join(' ')}`;
}

export function pebbleShape(id: string, count: number | null): PebbleShape {
  const width = Math.round(
    MIN_WIDTH + Math.min(count ?? 0, COUNT_CAP) * PER_MEMORY,
  );
  return {
    width,
    height: Math.round(width * FLATNESS),
    radius: pebbleRadius(id),
  };
}
