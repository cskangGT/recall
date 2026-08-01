/**
 * The shape of a category on the arc.
 *
 * This replaces a water-worn stone, which replaced a sphere, which replaced a
 * cloud. The stone was the best of those and it was still wrong, for a reason
 * none of the earlier attempts had: it did not belong to the picture it was in.
 * Six pale grey ovals were the brightest objects on a violet night sky, so the
 * eye went to them before it went to the figure, and the arc read as controls
 * laid over a painting rather than as part of one.
 *
 * A star is what that sky already contains. The categories become the brighter
 * ones — the same kind of thing as the field behind them, a magnitude up — and
 * the labels stop competing with a shape for attention and become the thing you
 * actually read.
 *
 * **What this gives up, deliberately.** The stone's whole argument was that no
 * two outlines were alike, so you could learn `Fundraising` by its silhouette
 * before reading a word. Points of light cannot carry that; a star is a star.
 * What survives is size — a category that holds more burns brighter and wider —
 * and a deterministic tilt, which is individuality you notice without being
 * able to name. Recognition now rests on position and label, which is what the
 * arc's fixed left-to-right order was always for.
 *
 * Two rules carry over from the stone, for the same reasons:
 *
 * - Everything is derived from the category **id**, not from anything that
 *   moves, so a star does not change character when you add a memory to it.
 * - The variation is bounded. A tilt is a few degrees of personality, not a
 *   pinwheel.
 *
 * Kept out of the component and unit-tested for the same reason `layout.ts` is:
 * "is this stable across renders" is a question a test should answer, not
 * something you check by squinting at two screenshots.
 */

export interface StarShape {
  /** The bright core, in px. Grows with how much the category holds. */
  core: number;
  /** The soft halo around it. Always the largest of the three. */
  glow: number;
  /** Tip to tip across the diffraction spikes. */
  spikes: number;
  /** Degrees. A deterministic tilt, so no two sit at quite the same angle. */
  tilt: number;
}

/** Smallest core, for a category holding nothing. */
export const MIN_CORE = 5;
/** Per-memory growth, and the count past which a big category stops growing. */
export const PER_MEMORY = 0.34;
export const COUNT_CAP = 14;

/**
 * How far the halo and the spikes reach, as multiples of the core.
 *
 * The spikes overshoot the halo on purpose. A glow that contains its own spikes
 * reads as a blurred dot; the spikes have to leave the light to be spikes.
 */
export const GLOW_SCALE = 5.2;
export const SPIKE_SCALE = 6.4;

/**
 * Bounded at 22 degrees.
 *
 * A four-point star is symmetric every 90, so tilt is only legible in the first
 * half of that range — and past about 25 it stops reading as a star at a slight
 * angle and starts reading as an X. Small enough that you would not notice two
 * neighbours differ; large enough that the field does not look stamped.
 */
export const MAX_TILT = 22;

/** FNV-1a. Any stable string hash would do; this one is four lines. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A tilt in (-MAX_TILT, MAX_TILT), stable for a given id. */
export function starTilt(id: string): number {
  return ((hash(id) % (MAX_TILT * 2 + 1)) - MAX_TILT) * 1;
}

export function starShape(id: string, count: number | null): StarShape {
  const core = Math.round((MIN_CORE + Math.min(count ?? 0, COUNT_CAP) * PER_MEMORY) * 10) / 10;
  return {
    core,
    glow: Math.round(core * GLOW_SCALE * 10) / 10,
    spikes: Math.round(core * SPIKE_SCALE * 10) / 10,
    tilt: starTilt(id),
  };
}
