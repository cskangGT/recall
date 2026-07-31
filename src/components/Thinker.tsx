/**
 * The figure: someone sitting on a hilltop with their knees drawn up, looking out.
 *
 * Traced off the reference photograph rather than drawn from the idea of it, and
 * the difference between those two is most of what took fifteen earlier attempts.
 * Landmarks were read off the image at 4.4x and mapped into this box, which is
 * why the numbers below are not round.
 *
 * Three things the photograph has that no version invented from memory did:
 *
 * **A cap with a bill.** It is the single most identifying thing on the outline
 * — a small wedge stepping forward at brow height. Without it the head is an
 * egg, and an egg on a body is the "big ball resting on a face" that nine
 * earlier attempts produced.
 *
 * **Two voids, not one.** Sky shows through between the forearm, the torso and
 * the thigh, and again between the near shin and the seat down at the ground.
 * They are what make a solid black mass read as limbs. A silhouette this size
 * has no interior modelling to spare, so the holes do all the work.
 *
 * **The knee is far out in front and low.** Not a bump on the front of the mass
 * — it is the leftmost thing in the figure apart from the foot, and it sits at
 * a bit over half height.
 *
 * Everything else is one closed contour: cap, back of the head, the neck, the
 * shoulder, the long fall of the back, the seat, the ground, the foot, up the
 * shin, over the knee, then back along the top of the forearm to the throat and
 * up the face. A head authored as its own shape and butted against a body leaves
 * a seam wherever they meet, and no blending hides it.
 *
 * The fill comes from `.thinker__shape`, so the same figure is a near-black
 * silhouette against the welcome screen's lit sky and a pale form against the
 * browser's darker one. Backlit in one place and lit in the other is one figure
 * in two lights, not two figures.
 */

const VIEW_W = 116;
const VIEW_H = 120;
/**
 * Where the ground is.
 *
 * The box stops four units below it — just room for the soft ellipse — so the
 * figure's feet are effectively the bottom of the element. Any more slack and
 * anything positioning it by its bottom edge (both screens sit it on the hill's
 * crest) leaves it visibly hovering.
 */
const GROUND_Y = 116;

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
          <feGaussianBlur stdDeviation="0.5" />
        </filter>

        {/* User space, not bounding box, so the ramp is one light across the
            whole figure rather than a private one per element. */}
        <linearGradient
          id="thinker-tone"
          gradientUnits="userSpaceOnUse"
          x1="10"
          y1="10"
          x2="108"
          y2="114"
        >
          <stop offset="0" stopColor="#F2F2F8" />
          <stop offset="0.45" stopColor="#A6A6B4" />
          <stop offset="1" stopColor="#43434F" />
        </linearGradient>
      </defs>

      <g className="thinker__body">
        {/*
          Outer contour clockwise from the crown of the cap, then the two voids
          as further subpaths — `evenodd` punches them out of the same path, so
          the whole figure stays one shape with no seam anywhere.
        */}
        <g className="thinker__shape" filter="url(#thinker-soft)">
          <path
            fillRule="evenodd"
            d={`M69 10
                Q80 12 87 20
                Q91 27 90 34
                Q97 40 101 50
                Q107 62 107 74
                Q107 92 104 105
                Q102 113 98 ${GROUND_Y}
                L38 ${GROUND_Y}
                Q28 ${GROUND_Y} 20 112
                Q10 108 8 104
                Q14 92 18 78
                Q20 66 23 58
                Q26 49 34 46
                Q42 44 48 44
                Q57 42 67 37
                Q65 35 64 33
                Q61 30 59 28
                Q56 26 54 25
                Q58 20 64 14
                Q66 11 69 10
                Z
                M47 61
                Q56 58 67 62
                Q60 72 54 79
                Q48 71 47 61
                Z
                M40 ${GROUND_Y}
                Q45 104 58 99
                Q69 106 73 ${GROUND_Y}
                Z`}
          />
        </g>
      </g>

      {/* What he is sitting on, where there is no hill behind to do the job. */}
      <ellipse
        className="thinker__ground"
        cx="57"
        cy={GROUND_Y}
        rx="50"
        ry="3"
        filter="url(#thinker-soft)"
      />
    </svg>
  );
}
