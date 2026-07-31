/**
 * The thinking figure: one head in profile, standing in its own reflection.
 *
 * Two things were learned the expensive way and are worth keeping written down.
 *
 * **It is a head, not a body.** Earlier passes drew a seated Rodin and never got
 * it to read — the head always looked like a ball resting on the torso, because
 * a head authored as its own shape and butted against a body leaves a seam
 * wherever they meet. A profile is one unbroken contour from crown to throat, so
 * that failure mode cannot occur here.
 *
 * **Crown to chin is 59 units against 58 of width, and that ratio is the whole
 * drawing.** Three versions ran 65–79 tall on the same width and read as long,
 * drawn faces. The tell was in the picture the whole time: the reflection is the
 * same head squashed to 55%, and it looked better proportioned than the head
 * casting it. A head in profile is close to square; past about 1.2 it is a
 * portrait stretched vertically, and the eye names that before it can say why.
 *
 * A pair of these back to back was tried, because that is what the reference
 * literally shows and it said something nice about the product — one head you,
 * one head Recall, the overlap the memory you share. It did not survive contact
 * with the screen. At the size this actually renders, two heads are a lot of
 * silhouette for one focal point, and the second one takes width the arc wants
 * for its categories. One figure with one reflection is the version that reads.
 *
 * Greyscale, because the browsing screen is monochrome and the colour lives on
 * the map.
 */

/** The head spans x 27–85, so a 112-wide box centres it with even margins. */
const CENTER_X = 56;
const VIEW_W = 112;
const VIEW_H = 142;

/**
 * Where the water is.
 *
 * The head stands *in* it, not on it — an early pass left 40 units of neck above
 * the line and it read as a head on a stalk. Thirteen units is enough to say
 * "neck" and not enough to compete with the face.
 */
const WATER_Y = 88;
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
      aria-label="A face in profile, thinking"
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
            lit face at the upper left down to the back of the skull. */}
        <linearGradient
          id="thinker-tone"
          gradientUnits="userSpaceOnUse"
          x1="32"
          y1="16"
          x2="78"
          y2="88"
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
          The head, as one closed contour, wound clockwise from the crown: back
          of the skull, nape, neck, then up the throat and along the face.

          The features carry it. A smooth cranium with a small nose reads as a
          balloon however the outline is proportioned — what says "face" is the
          brow stepping out, the nose leaving it, and the notch under the lip
          before the chin. Below the brow the face is compressed harder than the
          cranium, so the skull dominates the way a real one does, and none of
          that compression touched the horizontal excursion: the nose still
          reaches x=27 and the lip still tucks back to x=41. Features pack
          closer together on a shorter face, which is what real faces do.

          Authored once and drawn twice through <use>, so the figure and its
          reflection cannot drift apart. Fill is inherited from the wrapping
          group, because a <use> clone lives in a shadow tree that an outside
          CSS selector never reaches.
        */}
        <g id="thinker-head">
          <path
            d="M50 14
               Q70 15 81 36
               Q85 50 81 62
               Q78 68 76 74
               L76 96
               L54 96
               Q53 88 52 80
               Q49 77 41 72
               Q35 71 34 67
               Q31 65 32 62
               Q34 60 32 57
               Q33 56 33 55
               Q30 54 27 51
               Q28 47 34 44
               Q33 42 32 39
               Q32 34 35 28
               Q42 15 50 14
               Z"
          />
        </g>
      </defs>

      {/* Air. Does most of the atmospheric work. */}
      <ellipse cx={CENTER_X} cy="54" rx="58" ry="36" fill="url(#thinker-air)" />

      <g className="thinker__body">
        <g className="thinker__shape" filter="url(#thinker-soft)">
          <use href="#thinker-head" />
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
          <use href="#thinker-head" />
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
