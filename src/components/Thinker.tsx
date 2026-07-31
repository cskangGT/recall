/**
 * Rodin's Thinker, in profile, seated in his own reflection.
 *
 * Thirteen attempts at this shape failed before it read, and the same four
 * mistakes account for all of them. Every one is the natural thing to do if you
 * are drawing from the idea of the sculpture rather than looking at it.
 *
 * **The shoulders are up around the ears.** He is hunched, so the trapezius
 * rises *above* the base of the skull — the shoulder hump peaks higher than the
 * nape. Drawing the back as one smooth arc from the head down to the buttock
 * loses that hump, and without it the whole silhouette collapses into a pawn.
 * This is the single most Thinker-ish thing about the outline.
 *
 * **The void is large.** The gap between the forearm, the chest and the thigh is
 * roughly a third of the torso's area. Drawn small it reads as a hole punched in
 * a blob; drawn full size it is what makes a person leaning on his own hand.
 *
 * **The knee is the front of the figure.** It projects further forward than any
 * other point — further than the face — and both the shin below it and the
 * forearm above it recede from it, so it reads as a spur. Earlier versions had
 * it barely proud of the arm and the lower body became a wedge.
 *
 * **The head is small and bowed.** Twenty-eight units against a hundred and
 * twenty of figure, and tipped far enough forward that its crown points back
 * rather than up. Every version that put an upright head on top of the mass
 * produced the same complaint — a big ball resting on a face.
 *
 * One structural rule holds the whole thing together: **it is a single closed
 * contour.** A head authored as its own shape and butted against a torso leaves
 * a seam wherever they meet, and no blending hides it — each fix just moves the
 * seam. The void is the same path's second subpath, punched out with `evenodd`.
 *
 * It also has to survive being small. An earlier seated version read at 2.4x and
 * fell apart at 126px, which is the size the app actually renders; the figure is
 * bigger here for exactly that reason.
 *
 * Greyscale, because the browsing screen is monochrome and the colour lives on
 * the map.
 */

/** The figure spans x 10–104, so a 116-wide box centres it with even margins. */
const CENTER_X = 57;
const VIEW_W = 116;
const VIEW_H = 200;

/** Where the water is. He sits on a rock the water has already covered. */
const WATER_Y = 125;
/** A reflection foreshortens; 0.55 is the amount that still reads as the same figure. */
const SQUASH = 0.55;

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
      height={(size * VIEW_H) / VIEW_W}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="A seated figure in profile, chin on hand, thinking"
    >
      <defs>
        <filter id="thinker-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id="thinker-softer" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>

        {/* User space, not bounding box: the figure and its reflection are two
            separate elements, and per-element units would give each its own
            private ramp instead of one light falling across both. Runs from the
            lit knee and face at the front to the back, which stays in shadow. */}
        <linearGradient
          id="thinker-tone"
          gradientUnits="userSpaceOnUse"
          x1="14"
          y1="8"
          x2="105"
          y2="123"
        >
          <stop offset="0" stopColor="#F2F2F8" />
          <stop offset="0.45" stopColor="#A6A6B4" />
          <stop offset="1" stopColor="#43434F" />
        </linearGradient>

        <radialGradient id="thinker-air">
          <stop offset="0" stopColor="#C9C9D4" stopOpacity="0.12" />
          <stop offset="1" stopColor="#C9C9D4" stopOpacity="0" />
        </radialGradient>

        {/*
          Authored once and drawn twice through <use>, so the figure and its
          reflection cannot drift apart. Fill is inherited from the wrapping
          group, because a <use> clone lives in a shadow tree that an outside
          CSS selector never reaches.

          Outer contour, clockwise from the crown:

            crown → back of skull → nape (concave) → shoulder hump (rises above
            the nape) → back → buttock → into the water → along the rock → ankle
            → shin → knee (the front of the figure) → up the outside of the
            forearm → fist → chin → lip → nose → brow → forehead → crown

          Second subpath: the void between forearm, chest and thigh.
        */}
        <g id="thinker-figure">
          <path
            fillRule="evenodd"
            d="M58 7
               Q72 10 74 21
               Q73 30 68 35
               Q76 28 84 33
               Q95 45 100 67
               Q105 89 103 105
               Q101 119 95 124
               L95 130
               L22 130
               Q14 129 14 122
               Q18 107 16 92
               Q11 84 10 76
               Q11 72 17 70
               Q22 56 33 43
               Q37 41 35 37
               Q30 35 28 31
               Q25 30 24 26
               Q26 22 28 18
               Q30 12 37 10
               Q47 6 58 7
               Z
               M28 81
               Q35 66 47 52
               Q50 49 54 54
               Q60 63 61 73
               Q62 82 53 82
               Q40 84 28 81
               Z"
          />
        </g>
      </defs>

      {/* Air. Does most of the atmospheric work. */}
      <ellipse cx={CENTER_X} cy="70" rx="64" ry="64" fill="url(#thinker-air)" />

      <g className="thinker__body">
        <g className="thinker__shape" filter="url(#thinker-soft)">
          <use href="#thinker-figure" />
        </g>

        {/*
          Mirrored about the waterline and foreshortened. It fades via a CSS mask
          on the group: an SVG <mask> zeroed it outright, and a page-coloured
          veil left a visible black rectangle wherever the backdrop was not
          exactly that colour.

          The mask gradient is authored upside down on purpose — see the note on
          `.thinker__reflection` in theme.css.
        */}
        <g
          className="thinker__shape thinker__reflection"
          filter="url(#thinker-softer)"
          transform={`matrix(1 0 0 ${-SQUASH} 0 ${WATER_Y * (1 + SQUASH)})`}
        >
          <use href="#thinker-figure" />
        </g>
      </g>

      {/* The waterline — a single soft band, no horizon rule. */}
      <ellipse
        className="thinker__water"
        cx={CENTER_X}
        cy={WATER_Y}
        rx="58"
        ry="3"
        filter="url(#thinker-soft)"
      />
    </svg>
  );
}
