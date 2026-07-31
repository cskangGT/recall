/**
 * The figure: someone sitting on a hilltop with their knees drawn up, looking
 * out at the sky.
 *
 * The reference is a photograph, not a sculpture, and that is the whole reason
 * this one works. Fifteen attempts went into Rodin's Thinker and the good ones
 * only read when blown up, because that sculpture is legible through anatomy at
 * a dozen scales at once — elbow on knee, the twist through the torso, a fist
 * against the mouth. None of that survives at a hundred pixels.
 *
 * A person hugging their knees is the opposite kind of shape. It is one compact
 * mass with four events on its outline, and every one of them is large:
 *
 *   - a small round head, high and to the back
 *   - a deep notch between the head and the knees
 *   - the knee, the highest thing on the front and the leftmost
 *   - the long curve of the back falling to the ground
 *
 * Four events, none smaller than a fifth of the figure. That is a silhouette you
 * can shrink.
 *
 * It also says the right thing. The Thinker is closed in on himself; this is
 * someone sitting with their own thoughts looking outward, which is nearer to
 * what the product is for.
 *
 * One closed contour, head through back through leg — a head authored as its
 * own shape and butted against a body leaves a seam wherever they meet, and no
 * blending hides it.
 *
 * The fill comes from `.thinker__shape`, so the same figure is a near-black
 * silhouette against the welcome screen's lit sky and a pale form against the
 * browser's dark ground. Backlit in one place and lit in the other is one
 * figure in two lights, not two figures.
 */

const VIEW_W = 116;
const VIEW_H = 108;
/**
 * Where the ground is.
 *
 * The box stops four units below it — just room for the soft ellipse — so the
 * figure's feet are effectively the bottom of the element. Any more slack and
 * anything positioning it by its bottom edge (the welcome screen sits it on the
 * hill's crest) leaves it visibly hovering.
 */
const GROUND_Y = 104;

export function Thinker({
  size = 116,
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
      aria-label="Someone sitting on a hilltop with their knees drawn up, looking out"
    >
      <defs>
        <filter id="thinker-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.55" />
        </filter>

        {/* User space, not bounding box, so the ramp is one light across the
            whole figure rather than a private one per element. */}
        <linearGradient
          id="thinker-tone"
          gradientUnits="userSpaceOnUse"
          x1="20"
          y1="14"
          x2="100"
          y2="102"
        >
          <stop offset="0" stopColor="#F2F2F8" />
          <stop offset="0.45" stopColor="#A6A6B4" />
          <stop offset="1" stopColor="#43434F" />
        </linearGradient>

        <radialGradient id="thinker-air">
          <stop offset="0" stopColor="#C9C9D4" stopOpacity="0.1" />
          <stop offset="1" stopColor="#C9C9D4" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Air. Only visible on the dark browsing screen; the lit sky drowns it. */}
      <ellipse cx="58" cy="62" rx="56" ry="50" fill="url(#thinker-air)" />

      <g className="thinker__body">
        {/*
          Clockwise from the crown: back of the skull, the nape (concave — it is
          what separates the head from the shoulders), the shoulder, the long
          back, the seat, along the ground, the foot, up the shin, over the knee,
          down into the notch between knee and chest, up the front of the torso,
          then the chin and the face back to the crown.
        */}
        <g className="thinker__shape" filter="url(#thinker-soft)">
          <path
            d={`M64 14
                Q75 16 77 27
                Q78 35 74 40
                Q79 43 83 48
                Q92 68 95 84
                Q97 96 91 ${GROUND_Y}
                L26 ${GROUND_Y}
                Q21 ${GROUND_Y} 20 98
                Q18 86 21 72
                Q23 62 30 55
                Q36 50 43 55
                Q48 60 51 66
                Q57 62 60 47
                Q61 44 58 41
                Q54 37 53 32
                Q53 24 56 19
                Q59 13 64 14
                Z`}
          />
        </g>
      </g>

      {/* What he is sitting on, where there is no hill behind to do the job. */}
      <ellipse
        className="thinker__ground"
        cx="58"
        cy={GROUND_Y}
        rx="46"
        ry="3"
        filter="url(#thinker-soft)"
      />
    </svg>
  );
}
