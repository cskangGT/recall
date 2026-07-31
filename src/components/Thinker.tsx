/**
 * The thinking figure: two heads in profile, back to back, over their own
 * reflection.
 *
 * Earlier passes drew a seated Rodin and never got it to read — the head always
 * looked like a ball resting on the body, because a head authored as its own
 * shape and butted against a torso leaves a seam wherever they meet. The
 * reference was profiles over water the whole time. A profile is one unbroken
 * contour from crown to throat, so that failure mode simply does not exist.
 *
 * Two of them, facing away from each other and overlapping at the back of the
 * skull, is the reference exactly — and it happens to say what the product is.
 * One head is you and one is Recall; the place they overlap is the memory you
 * share. A single head would have been a picture of thinking alone, which is
 * the one thing this app is not for.
 *
 * Greyscale, because the browsing screen is monochrome and the colour lives on
 * the map. The reference separates its two heads by hue; here they separate by
 * value — one sits back in the dark, one catches the light.
 */

/**
 * The mirror runs down x = 76, so the pair is centred in a 152-wide viewBox.
 * Each head spans 58 units and they overlap by 18 — about a third — which is
 * enough that they read as one mass where they meet, and not so much that the
 * composition becomes a single column with a face stuck on each side. The first
 * attempt overlapped by 20 out of 56 and did exactly that.
 */
const MIRROR_X = 76;
const VIEW_W = 152;
const VIEW_H = 180;

/**
 * Where the water is.
 *
 * The heads stand *in* it, not on it — an earlier pass left 40 units of neck
 * above the line and the two necks merged into a pillar that read louder than
 * either face. Cutting the neck to about a fifth of the head's height puts the
 * attention back where the features are.
 */
const WATER_Y = 118;
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
      aria-label="Two faces in profile, back to back, thinking"
    >
      <defs>
        <filter id="thinker-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id="thinker-softer" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>

        {/* User space, not bounding box: per-element units would give each head
            its own private ramp instead of one light across the pair. Mirroring
            the far head mirrors its gradient too, so each is lit from its own
            side — which is what keeps them reading as two people. */}
        <linearGradient
          id="thinker-tone"
          gradientUnits="userSpaceOnUse"
          x1="32"
          y1="18"
          x2="78"
          y2="116"
        >
          <stop offset="0" stopColor="#C6C6D0" />
          <stop offset="0.45" stopColor="#7C7C88" />
          <stop offset="1" stopColor="#3E3E49" />
        </linearGradient>

        {/* The near head. Lighter throughout, so the pair separates by value
            where the reference separated by hue. */}
        <linearGradient
          id="thinker-tone-near"
          gradientUnits="userSpaceOnUse"
          x1="32"
          y1="18"
          x2="78"
          y2="116"
        >
          <stop offset="0" stopColor="#F6F6FB" />
          <stop offset="0.45" stopColor="#B6B6C3" />
          <stop offset="1" stopColor="#71717E" />
        </linearGradient>

        <radialGradient id="thinker-air">
          <stop offset="0" stopColor="#C9C9D4" stopOpacity="0.12" />
          <stop offset="1" stopColor="#C9C9D4" stopOpacity="0" />
        </radialGradient>

        {/*
          A head in profile, as one closed contour.

          The reference is two of these facing away from each other over water,
          and it took an embarrassing number of attempts at a seated Rodin
          before I looked at it properly: the subject was never a body. A
          profile is also far more tractable — forehead, brow, nose, lip, chin,
          neck is a single unbroken line, so there is no join to come apart
          the way a head attached to a torso kept doing.

          Wound clockwise from the crown: back of the skull, nape, neck, then
          up the throat and along the face. It faces left; the pair's other
          head is this one mirrored.

          The features carry it. A smooth cranium with a small nose reads as a
          balloon however the outline is proportioned — what says "face" is the
          brow stepping out, the nose leaving it, and the notch under the lip
          before the chin.
        */}
        <g id="thinker-head">
          <path
            d="M60 17
               Q80 19 85 42
               Q88 62 83 81
               Q80 91 78 100
               L78 124
               L54 124
               Q53 113 52 104
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

        {/*
          Authored once, used twice — the pair and its reflection cannot be
          allowed to drift apart.

          Both fills are presentation *attributes*, not classes. A <use> clone
          lives in a shadow tree that outside selectors never reach, so a
          `.thinker__shape { fill: … }` rule inside here would paint nothing;
          only attributes survive the clone. That is also why the two heads
          could not simply be given two class names.
        */}
        <g id="thinker-pair">
          {/* Far head, facing left. Drawn first, so the near one overlaps it. */}
          <g fill="url(#thinker-tone)">
            <use href="#thinker-head" />
          </g>
          {/*
            Near head, mirrored to face right — the lit one, on the right, as in
            the reference.

            Fully opaque. A first pass set 0.93 and the far head's contour showed
            straight through the near one's cheek: two translucent sheets, not
            two people. The pair has to separate by value alone, which is why the
            two ramps are a whole step apart.
          */}
          <g
            fill="url(#thinker-tone-near)"
            transform={`matrix(-1 0 0 1 ${MIRROR_X * 2} 0)`}
          >
            <use href="#thinker-head" />
          </g>
        </g>
      </defs>

      {/* Air. Does most of the atmospheric work. */}
      <ellipse cx={MIRROR_X} cy="78" rx="78" ry="44" fill="url(#thinker-air)" />

      <g className="thinker__body">
        <g filter="url(#thinker-soft)">
          <use href="#thinker-pair" />
        </g>

        {/*
          Mirrored about the waterline and foreshortened. It fades via a CSS mask
          on the group: an SVG <mask> zeroed it outright, and a page-coloured
          veil left a visible black rectangle wherever the backdrop was not
          exactly that colour.

          The mask gradient runs *upward* on purpose. A CSS mask on an SVG group
          is resolved in the group's own coordinate space, so this element's
          transform flips the mask along with the geometry — a `to bottom` fade
          therefore arrives on screen as a fade from the bottom up, leaving the
          reflection dimmest at the waterline and brightest far away from it. It
          looked like a separate blob floating below the figure, which is exactly
          what it was.
        */}
        <g
          className="thinker__reflection"
          filter="url(#thinker-softer)"
          transform={`matrix(1 0 0 ${-SQUASH} 0 ${WATER_Y * (1 + SQUASH)})`}
        >
          <use href="#thinker-pair" />
        </g>
      </g>

      {/* The waterline — a single soft band, no horizon rule. */}
      <ellipse
        className="thinker__water"
        cx={MIRROR_X}
        cy={WATER_Y}
        rx="66"
        ry="3"
        filter="url(#thinker-soft)"
      />
    </svg>
  );
}
