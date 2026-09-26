/**
 * Where the first hour stands.
 *
 * The welcome is three steps — a first thought, the calendar, what has piled
 * up — and any of them can send the person away from the page (Google's
 * consent screen does, a file picker might). The step survives that trip
 * here, so coming back lands on the same beat and not on the greeting again.
 * `done` is the landing; after it the welcomed flag (see uiStore) is what
 * decides between the greeting and home.
 */

/**
 * The first hour is a first conversation, in beats: a thing they cannot
 * decide (thought), Mado asking back and them saying why (why), Mado tying
 * those together on the map and the first line kept (think), what just
 * happened said in three lines with the four places and the doors (learn).
 */
export type OnboardingStep = 'thought' | 'why' | 'think' | 'learn' | 'done';

export const STEP_KEY = 'mado.ob.step';
/** The day the first hour ended — the morning card's "first day" reads it. */
export const FIRST_DAY_KEY = 'mado.ob.firstDay';
/** The memories the first conversation made — carried across the map and back. */
export const FIRST_PICKS_KEY = 'mado.ob.firstPicks';
/** The name of the first bundle — the next morning asks after it. */
export const FIRST_BUNDLE_KEY = 'mado.ob.firstBundle';

export function readFirstPicks(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(FIRST_PICKS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeFirstPicks(ids: string[]): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(FIRST_PICKS_KEY, JSON.stringify(ids));
}

const STEPS: OnboardingStep[] = ['thought', 'why', 'think', 'learn', 'done'];

export function readStep(): OnboardingStep {
  if (typeof localStorage === 'undefined') return 'thought';
  const raw = localStorage.getItem(STEP_KEY);
  return STEPS.includes(raw as OnboardingStep) ? (raw as OnboardingStep) : 'thought';
}

export function writeStep(step: OnboardingStep): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STEP_KEY, step);
}

export function forgetStep(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STEP_KEY);
  localStorage.removeItem(FIRST_PICKS_KEY);
}
