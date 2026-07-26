export type Phase =
  | 'materialize'
  | 'travel'
  | 'pan'
  | 'desaturate'
  | 'transform'
  | 'settle'
  | 'banner';

export interface TimelineStep {
  at: number;
  phase: Phase;
}

export const TOTAL_WITH_STRUCTURE = 2400;
export const TOTAL_ATTACH_ONLY = 1800;

/** Stagger between successive memory nodes materializing (spec 8.4.5). */
export const MATERIALIZE_STAGGER_MS = 60;

/** Offsets are spec 8.4.5 verbatim. Do not adjust without changing the spec. */
export function buildTimeline(hasStructuralChange: boolean): TimelineStep[] {
  if (!hasStructuralChange) {
    return [
      { at: 0, phase: 'materialize' },
      { at: 200, phase: 'travel' },
      { at: 1000, phase: 'settle' },
    ];
  }
  return [
    { at: 0, phase: 'materialize' },
    { at: 200, phase: 'travel' },
    { at: 1000, phase: 'pan' },
    { at: 1000, phase: 'desaturate' },
    { at: 1400, phase: 'transform' },
    { at: 1900, phase: 'settle' },
    { at: 2400, phase: 'banner' },
  ];
}

/** Which phase is active at time t, for the renderer to key its interpolation off. */
export function phaseAt(timeline: TimelineStep[], t: number): Phase {
  let current: Phase = 'materialize';
  for (const step of timeline) {
    if (t >= step.at) current = step.phase;
  }
  return current;
}
