/**
 * The night sky and the hill under it.
 *
 * Shared by the welcome screen and the browser, because the second one should
 * feel like walking further into the first rather than arriving somewhere else.
 * What differs between them is only the sky's palette — see `.sky--night` in
 * theme.css for why the working surface gets the darker end of the same evening.
 *
 * Everything here is the part the CSS gradients cannot express: the stars, which
 * need individual positions, and the hill, whose crest has to land on a
 * coordinate the caller computes.
 */

/** Mulberry32. Deterministic, so the sky is the same sky on every render. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far down the frame stars are allowed, as a percentage. */
const HORIZON = 64;

/**
 * A field rather than a handful.
 *
 * Four hand-placed stars read as punctuation; this reads as a sky. Two rules
 * keep it from reading as noise instead: they crowd the top, where the sky is
 * dark enough to hold them, and they thin out toward the horizon glow that
 * would wash them out anyway; and sizes are cubed, so almost all of them are
 * specks and three or four are bright. An even scatter of even dots is a
 * texture, not a night.
 */
const STARS = (() => {
  const r = rng(7);
  return Array.from({ length: 54 }, (_, i) => {
    const top = Math.pow(r(), 1.6) * HORIZON;
    const fade = 1 - top / HORIZON;
    return {
      id: i,
      left: r() * 100,
      top,
      size: 0.9 + Math.pow(r(), 3) * 2.4,
      opacity: 0.16 + fade * 0.72 * (0.45 + r() * 0.55),
    };
  });
})();

export function Sky({ crestTop }: { crestTop: number | string }) {
  return (
    <>
      {STARS.map((s) => (
        <span
          key={s.id}
          className="sky__star"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
          }}
        />
      ))}
      <div className="sky__hill" style={{ top: crestTop }} />
    </>
  );
}
