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
 *   - **Then look at it — and then look at the photograph again.** An opening
 *     only removes what is *loosely* attached, so a second object at the shin
 *     came through. Its signature in the path data is an out-and-back, where the
 *     contour reverses instead of advancing, and on that evidence it was cut:
 *     everything else on this outline is a body part and that one was not.
 *
 *     It was the **flashlight**. At 18x the reference shows a lamp head and a
 *     barrel propped against the shin — the one thing in the picture that says
 *     the person walked up there at night on purpose. The detection was right
 *     and the conclusion was wrong, because *not anatomy* is not the same as
 *     *not intended*. It is drawn back in, redrawn rather than restored: the six
 *     traced points were a blob at nine pixels, and a torch only reads as one if
 *     the head is visibly wider than the barrel.
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

import { OUTER, PARTS, VOID, pathD, partPoints, spanPolygon } from './thinkerPath';

const VIEW_W = 116;
const VIEW_H = 120;
/**
 * Where the ground is — the row the trace was cut at, and the bottom of the
 * figure. The box stops four units below it so that anything positioning the
 * figure by its bottom edge (both screens sit it on the hill's crest) seats it
 * rather than leaving it hovering a hair above.
 */
const GROUND_Y = 116;

/**
 * `?figure=debug` paints each named stretch of the outline its own colour, with
 * a dot on every point. It exists because tuning this shape is a conversation,
 * and a conversation about "the bump above the knee" goes nowhere until both
 * people can see which points that is. Read the same way `?skipWelcome=1` is.
 */
export const FIGURE_DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('figure') === 'debug';

/**
 * How much bigger the figure is drawn while debugging. At its real 124px the
 * overlay is unreadable — a tool you cannot read is not a tool — and the crest
 * anchors the figure by its bottom edge, so growing it just makes it taller
 * without moving where it sits.
 */
export const DEBUG_SCALE = 3.4;

/**
 * `&span=41-49` fills that stretch of the outline as a closed area, with the
 * chord that closes it dashed so it is obvious which edge is really there.
 *
 * An outline shows boundaries; most questions about this shape are about areas —
 * "what *is* that part" — and the two are not the same picture. Comma-separated
 * for several at once, which is how two areas get compared.
 *
 * Malformed input is dropped rather than thrown: this is a thing you type into
 * the address bar, and a blank overlay beats a blank screen.
 */
const SPAN_COLOURS = ['#ffe14d', '#4fa8ff', '#3fd6a0', '#ff6bd6'];

const SPANS: readonly (readonly [number, number])[] = FIGURE_DEBUG
  ? (new URLSearchParams(window.location.search).get('span') ?? '')
      .split(',')
      .map((s) => s.trim().match(/^(\d+)-(\d+)$/))
      .flatMap((m) => {
        if (!m) return [];
        const a = Number(m[1]);
        const b = Number(m[2]);
        return a < OUTER.length && b < OUTER.length
          ? [[a, b] as readonly [number, number]]
          : [];
      })
  : [];

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
          <path fillRule="evenodd" d={pathD()} />
        </g>
      </g>

      {FIGURE_DEBUG && (
        <g className="thinker__debug">
          {SPANS.map(([from, to], i) => {
            const pts = spanPolygon(from, to);
            const colour = SPAN_COLOURS[i % SPAN_COLOURS.length]!;
            const [ax, ay] = pts[0]!;
            const [bx, by] = pts[pts.length - 1]!;
            return (
              <g key={`${from}-${to}`}>
                <polygon
                  points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={colour}
                  /* Not 0.18. The spans lie on top of a near-black silhouette,
                     where a light tint is simply not there. */
                  fillOpacity="0.4"
                />
                {/* The closing chord — construction, not contour. */}
                <line
                  x1={bx}
                  y1={by}
                  x2={ax}
                  y2={ay}
                  stroke={colour}
                  strokeWidth="0.6"
                  strokeDasharray="2 1.6"
                />
                <text x={(ax + bx) / 2} y={(ay + by) / 2 - 1} fontSize="3" fill={colour}>
                  {from}–{to}
                </text>
              </g>
            );
          })}
          {PARTS.map((part) => (
            <polyline
              key={part.name}
              points={partPoints(part)
                .map(([x, y]) => `${x},${y}`)
                .join(' ')}
              fill="none"
              stroke={part.colour}
              strokeWidth="1"
              strokeLinejoin="round"
            />
          ))}
          {OUTER.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="0.7" fill="#fff" />
              {/* The index, because an instruction is given as a number. */}
              <text x={x + 1.3} y={y - 1} fontSize="2.2" fill="#fff" opacity="0.7">
                {i}
              </text>
            </g>
          ))}
          {VOID.map(([x, y], i) => (
            <circle key={`v${i}`} cx={x} cy={y} r="0.7" fill="#ff2f2f" />
          ))}
          <polyline
            points={VOID.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke="#ff2f2f"
            strokeWidth="0.8"
          />
        </g>
      )}

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
