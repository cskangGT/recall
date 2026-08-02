import { describe, it, expect } from 'vitest';
import {
  starShape,
  starTilt,
  MIN_CORE,
  PER_MEMORY,
  COUNT_CAP,
  GLOW_SCALE,
  SPIKE_SCALE,
  MAX_TILT,
} from '../../src/arc/star';

describe('starTilt', () => {
  it('is stable for an id — a star must not turn when the page re-renders', () => {
    for (const id of ['cat_hiring', 'cat_ai_tooling', 'x']) {
      expect(starTilt(id)).toBe(starTilt(id));
    }
  });

  it('stays inside the legible range', () => {
    // A four-point star is symmetric every 90 degrees, so past about 25 a tilt
    // stops reading as a star at an angle and starts reading as an X.
    for (let i = 0; i < 400; i++) {
      const t = starTilt(`cat_${i}`);
      expect(Math.abs(t)).toBeLessThanOrEqual(MAX_TILT);
    }
  });

  it('actually varies — a constant would be individuality that is not there', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => starTilt(`cat_${i}`)));
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('starShape', () => {
  it('burns wider the more the category holds', () => {
    const small = starShape('a', 1);
    const large = starShape('a', 12);
    expect(large.core).toBeGreaterThan(small.core);
    expect(large.glow).toBeGreaterThan(small.glow);
    expect(large.spikes).toBeGreaterThan(small.spikes);
  });

  it('stops growing past the cap, so one huge category cannot dominate the sky', () => {
    expect(starShape('a', COUNT_CAP).core).toBe(starShape('a', COUNT_CAP * 10).core);
  });

  it('gives an empty category the minimum rather than nothing', () => {
    expect(starShape('a', 0).core).toBe(MIN_CORE);
    expect(starShape('a', null).core).toBe(MIN_CORE);
  });

  it('grows at the documented rate', () => {
    expect(starShape('a', 10).core).toBeCloseTo(MIN_CORE + 10 * PER_MEMORY, 5);
  });

  /**
   * The spikes have to leave the halo. Contained inside their own glow they
   * read as a blurred dot rather than as points, which is the whole difference
   * between a star and a circle.
   */
  it('always reaches further with its spikes than with its glow', () => {
    expect(SPIKE_SCALE).toBeGreaterThan(GLOW_SCALE);
    for (const count of [0, 1, 5, 11, 14, 40]) {
      const s = starShape('cat_x', count);
      expect(s.spikes).toBeGreaterThan(s.glow);
      expect(s.glow).toBeGreaterThan(s.core);
    }
  });

  it('depends on the id only through the tilt', () => {
    // Size is what the category holds; identity is the angle. A star whose
    // brightness changed with its name would be telling you the wrong thing.
    const a = starShape('cat_hiring', 6);
    const b = starShape('cat_product', 6);
    expect(b.core).toBe(a.core);
    expect(b.glow).toBe(a.glow);
    expect(b.spikes).toBe(a.spikes);
  });
});
