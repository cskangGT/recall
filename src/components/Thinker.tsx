/**
 * The thinking figure.
 *
 * Built from filled, tapered shapes rather than uniform round-capped strokes.
 * Strokes of one width read as a stick figure however carefully the joints are
 * placed — what makes a body look like a body is that a thigh is broad at the
 * hip and narrow at the knee. Each limb is therefore a closed path that changes
 * width along its length, and everything shares one fill so overlaps merge into
 * a single silhouette rather than a pile of parts.
 *
 * Faceless and airbrushed, standing in its own reflection, per the reference.
 * Greyscale, because the browsing screen is monochrome and the colour lives on
 * the map.
 */
export function Thinker({
  size = 150,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`thinker ${className}`}
      width={size}
      height={(size * 200) / 120}
      viewBox="0 0 120 200"
      role="img"
      aria-label="A seated figure, thinking"
    >
      <defs>
        <filter id="thinker-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id="thinker-softer" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>

        {/* User space, not bounding box: per-element units would give every
            limb its own private ramp instead of one light across the figure. */}
        <linearGradient
          id="thinker-tone"
          gradientUnits="userSpaceOnUse"
          x1="34"
          y1="18"
          x2="76"
          y2="130"
        >
          <stop offset="0" stopColor="#EDEDF2" />
          <stop offset="0.45" stopColor="#9A9AA6" />
          <stop offset="1" stopColor="#2E2E36" />
        </linearGradient>

        <radialGradient id="thinker-air">
          <stop offset="0" stopColor="#C9C9D4" stopOpacity="0.12" />
          <stop offset="1" stopColor="#C9C9D4" stopOpacity="0" />
        </radialGradient>

        {/*
          Authored once, used twice — the figure and its reflection cannot be
          allowed to drift apart. Fill is inherited from the group, because a
          <use> clone lives in a shadow tree that outside selectors never reach.
        */}
        <g id="thinker-figure">
          {/* The rock. Part of the silhouette, not a separate prop. */}
          <path d="M62 122 Q86 120 90 128 Q92 134 82 134 L46 134 Q40 128 46 124 Z" />

          {/* Back and torso: broad across the shoulders, tapering to the hip,
              carrying the forward lean that is the whole pose. */}
          <path d="M63 44 Q74 50 78 68 Q82 92 80 112 Q78 124 66 124 Q56 122 58 108 Q62 86 60 68 Q58 52 63 44 Z" />

          {/* Thigh: broad at the hip, narrow at the knee. */}
          <path d="M70 104 Q52 92 36 88 Q28 87 27 94 Q26 101 34 103 Q50 108 66 118 Z" />

          {/* Calf, and the foot flat on the ground. */}
          <path d="M28 92 Q33 92 34 100 Q35 114 33 126 Q32 132 27 132 Q22 132 23 125 Q25 110 24 98 Q24 93 28 92 Z" />
          <path d="M20 128 Q34 126 38 130 Q40 134 34 135 L20 135 Q17 132 20 128 Z" />

          {/* Upper arm, shoulder down to the elbow resting on the knee. */}
          <path d="M64 48 Q70 54 60 72 Q52 86 44 92 Q39 95 36 90 Q34 86 39 82 Q50 74 56 58 Q59 50 64 48 Z" />

          {/* Forearm, elbow back up to the chin. Narrower than the upper arm so
              the wedge between them stays open and the pose stays legible. */}
          <path d="M38 88 Q36 82 42 74 Q48 62 51 52 Q53 46 58 48 Q62 50 59 58 Q55 72 47 86 Q43 93 38 88 Z" />

          {/* Head: a small oval, tipped forward. Roughly one seventh of the
              standing height — caricature proportions read as a mascot. */}
          <ellipse cx="51" cy="33" rx="11" ry="12.5" transform="rotate(-14 51 33)" />
          {/* Fist under the chin. */}
          <ellipse cx="53" cy="47" rx="7" ry="6" />
        </g>
      </defs>

      {/* Air. Does most of the atmospheric work. */}
      <ellipse cx="56" cy="76" rx="56" ry="66" fill="url(#thinker-air)" />

      <g className="thinker__body">
        <g className="thinker__shape" filter="url(#thinker-soft)">
          <use href="#thinker-figure" />
        </g>

        {/*
          Mirrored about the waterline at y=135 and squashed to 55%, the way a
          reflection foreshortens. It fades via a CSS mask on the group: an SVG
          <mask> zeroed it outright, and a page-coloured veil left a visible
          black rectangle wherever the backdrop was not exactly that colour.
        */}
        <g
          className="thinker__shape thinker__reflection"
          filter="url(#thinker-softer)"
          transform="matrix(1 0 0 -0.55 0 209.25)"
        >
          <use href="#thinker-figure" />
        </g>
      </g>

      {/* The waterline — a single soft band, no horizon rule. */}
      <ellipse
        className="thinker__water"
        cx="55"
        cy="136"
        rx="48"
        ry="3"
        filter="url(#thinker-soft)"
      />
    </svg>
  );
}
