/**
 * The thinking figure: Rodin's Thinker in profile, seated in his own reflection.
 *
 * This shape failed nine times before it worked, always the same way — "a big
 * ball resting on a face" — and the three reasons are worth keeping, because
 * every one of them is easy to walk back into.
 *
 * **One closed contour, not a head plus a body.** Authoring the head as its own
 * shape and butting it against a torso leaves a seam wherever they meet, and no
 * amount of blending hides it; each fix just moved the seam. The whole figure is
 * a single path here — crown, back, seat, shin, knee, forearm, fist, face, crown
 * — so there is no join that can come apart. The void under the arm is the same
 * path's second subpath, punched out with `evenodd`.
 *
 * **The head is small.** Twenty-four units tall against a hundred and thirteen of
 * figure, a bit under a quarter. Every failed version had it near a third, which
 * is what made it read as a ball with a body under it rather than a man.
 *
 * **The crown does not sit above the shoulders.** In the sculpture the head is
 * tucked forward and *down* onto the back of the hand — its crown is barely
 * higher than the top of the back. Drawing the head perched on top of the mass
 * is the single thing that most reliably destroys the pose, and it is also the
 * most natural way to draw it if you are not looking at the reference.
 *
 * The negative space under the forearm is doing more work than any curve. A
 * solid silhouette of this pose is a blob; the triangle of background between
 * the forearm, the chest and the thigh is what makes it legible as a person
 * leaning on his own hand.
 *
 * Greyscale, because the browsing screen is monochrome and the colour lives on
 * the map.
 */

/** The figure spans x 11–93, so a 104-wide box centres it with even margins. */
const CENTER_X = 52;
const VIEW_W = 104;
const VIEW_H = 180;

/** Where the water is. He sits on a rock the water has already covered. */
const WATER_Y = 116;
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
      aria-label="A seated figure in profile, thinking"
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
          x1="18"
          y1="20"
          x2="92"
          y2="114"
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

          Outer contour, clockwise from the crown: back of the skull, nape, the
          long curve of the back, the buttocks, down into the water, along the
          bottom, up the front of the shin, over the knee, up the outside of the
          forearm to the fist, and then the face — chin, mouth, the nose at its
          lowest and furthest forward, brow, forehead, back to the crown.

          Second subpath: the void between forearm, chest and thigh.
        */}
        <g id="thinker-figure">
          <path
            fillRule="evenodd"
            d="M50 18
               Q64 20 68 32
               Q66 40 61 43
               Q71 46 77 54
               Q85 66 87 80
               Q90 94 93 106
               L93 122
               L36 122
               Q30 118 26 108
               Q18 92 13 76
               Q11 71 16 68
               Q26 58 37 45
               Q40 41 37 38
               Q35 35 40 33
               Q37 30 34 28
               Q31 26 30 24
               Q33 22 36 21
               Q40 18 50 18
               Z
               M26 78
               Q34 66 45 52
               Q48 49 53 52
               Q59 60 59 70
               Q59 78 51 79
               Q39 81 26 78
               Z"
          />
        </g>
      </defs>

      {/* Air. Does most of the atmospheric work. */}
      <ellipse cx={CENTER_X} cy="68" rx="56" ry="56" fill="url(#thinker-air)" />

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
        rx="50"
        ry="3"
        filter="url(#thinker-soft)"
      />
    </svg>
  );
}
