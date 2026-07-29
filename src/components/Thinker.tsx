/**
 * The thinking figure: a head in profile, airbrushed, over its own reflection.
 *
 * Earlier passes drew a seated Rodin and never got it to read — the head always
 * looked like a ball resting on the body, because a head authored as its own
 * shape and butted against a torso leaves a seam wherever they meet. The
 * reference was two profiles over water the whole time. A profile is one
 * unbroken contour from crown to throat, so the failure mode simply does not
 * exist here.
 *
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
      aria-label="A face in profile, thinking"
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
          {/*
            A head in profile, as one closed contour.

            The reference is two of these facing away from each other over water,
            and it took an embarrassing number of attempts at a seated Rodin
            before I looked at it properly: the subject was never a body. A
            profile is also far more tractable — forehead, brow, nose, lip, chin,
            neck is a single unbroken line, so there is no join to come apart
            the way a head attached to a torso kept doing.

            Wound clockwise from the crown: back of the skull, nape, neck, then
            up the throat and along the face.

            The features carry it. A smooth cranium with a small nose reads as a
            balloon however the outline is proportioned — what says "face" is the
            brow stepping out, the nose leaving it, and the notch under the lip
            before the chin.
          */}
          <path
            d="M60 17
               Q78 19 82 42
               Q85 62 80 81
               Q77 91 76 102
               L76 136
               L54 136
               Q53 120 52 106
               Q51 99 45 96
               Q39 93 41 86
               Q42 82 38 80
               Q34 78 37 74
               Q32 70 27 65
               Q22 61 26 58
               Q31 56 33 50
               Q35 43 35 36
               Q38 24 46 18
               Q51 15 60 17
               Z"
          />
        </g>
      </defs>

      {/* Air. Does most of the atmospheric work. */}
      <ellipse cx="55" cy="92" rx="58" ry="46" fill="url(#thinker-air)" />

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
