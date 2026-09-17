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

export type OnboardingStep = 'thought' | 'calendar' | 'pile' | 'done';

export const STEP_KEY = 'mado.ob.step';
/** The day the first hour ended — the morning card's "first day" reads it. */
export const FIRST_DAY_KEY = 'mado.ob.firstDay';

const STEPS: OnboardingStep[] = ['thought', 'calendar', 'pile', 'done'];

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
}
