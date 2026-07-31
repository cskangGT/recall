/**
 * The figure: someone sitting on a hilltop with their knees drawn up, looking out.
 *
 * **This path is a trace, not a drawing.** Fifteen attempts were hand-authored
 * from the idea of the pose and every one read as a blob with a bump on it; the
 * one that worked came from thresholding the reference photograph and marching
 * the contour. If this ever needs redoing, redo it the same way — the outline
 * has a dozen small events in it (the bill of the cap, the wrist, the shoe) that
 * nobody invents from memory and that are exactly what makes it read as a
 * person rather than a shape.
 *
 * What the trace needed to get right, in case it is run again:
 *
 *   - **Threshold locally.** At the top of the photograph the sky is darker than
 *     this silhouette is down here, so no global cutoff separates them. A band
 *     around the figure has pale sky and near-black subject and nothing between.
 *   - **The hillside is a curve.** It has to be removed or the figure comes out
 *     welded to a strip of ground. Fitting it as a line, and then as a parabola
 *     over all columns, both cut below the real crest, because the figure's own
 *     columns drag the fit upward — fit, drop the low residuals, refit.
 *   - **Do not flatten the base.** An earlier pass filled every column down to
 *     the lowest row for a tidy flat bottom and swallowed the notch between the
 *     near shin and the seat, which is one of the two holes that make the mass
 *     read as legs.
 *   - **Open the shape.** There is a bag on the ground beside the figure joined
 *     to it by a thin bridge. Erode, keep the largest piece, dilate back: that
 *     severs the bridge and leaves the body, which is thick everywhere.
 *
 * The two holes are punched from the same path with `evenodd` — sky through the
 * gap between forearm, torso and thigh, and again between the near shin and the
 * seat. They do more for legibility at this size than any curve does.
 *
 * The fill comes from `.thinker__shape`, so the same figure is a near-black
 * silhouette against the welcome screen's lit sky and a pale form against the
 * browser's darker one. Backlit in one place and lit in the other is one figure
 * in two lights, not two figures.
 */

const VIEW_W = 116;
const VIEW_H = 120;
/**
 * Where the ground is — the row the trace was cut at, and the bottom of the
 * figure. The box stops four units below it so that anything positioning the
 * figure by its bottom edge (both screens sit it on the hill's crest) seats it
 * rather than leaving it hovering a hair above.
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
            d={`M72.8 14.8 L84.9 16.9 L87.5 19.3 L89.8 23.5 L90.3 29.1 L89.4 33.9 L87 38.6 L87 39.8 L90.3 47.5 L94.5 52.1 L101.7 64.5 L104.3 71.7 L105.9 80.6 L108 87.1 L107.5 90.6 L105.7 95 L105.9 100.4 L105.4 102 L102.2 104.6 L100.8 107.8 L98.7 109.2 L65.1 109.7 L64.2 109.5 L54.2 98.8 L53 99.4 L49 104.8 L44.1 108.8 L42.5 111.3 L22 113.9 L10.3 116 L8.2 114.8 L8.2 113 L12.4 109.5 L14.8 106.7 L15.9 106.4 L18.7 103.9 L19.7 101.1 L19 98.1 L19.4 95.3 L20.6 94.1 L21.3 90.8 L25.7 83.6 L22.7 80.6 L22.9 78 L19.2 73.6 L19.2 71 L21.3 69.6 L22.2 69.8 L24.6 72.2 L25.7 71.2 L25.9 67.7 L26.9 65.4 L27.1 60.8 L30.4 55.9 L35 51.2 L39.9 50.5 L43.7 47.2 L47.9 45.8 L50.7 45.6 L58.1 41.2 L59.7 32.8 L59.3 29.3 L63.2 26.5 L65.1 16.7 L67.4 15.3 L72.6 15.1 Z
                M55.3 60.5 L56.7 60.8 L58.1 65.9 L62.1 71 L62.1 71.7 L58.6 68.4 L54.4 66.1 L50.9 63.1 L51.1 62.4 L55.1 60.8 Z`}
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
