import { describe, it, expect } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import { currentPlan, freeCutoff, isArchivedByPlan, FREE_WINDOW_DAYS } from '../../src/core/plan';

const base = validateSeed(workspaceJson);

describe('currentPlan', () => {
  it('defaults to pro — the demo and the suite see the full corpus', () => {
    expect(currentPlan('')).toBe('pro');
    expect(currentPlan('?api=1')).toBe('pro');
  });

  it('?plan=free opts into the free window', () => {
    expect(currentPlan('?plan=free')).toBe('free');
    expect(currentPlan('?skipWelcome=1&plan=free')).toBe('free');
  });

  it('the workspace plan applies when the URL says nothing', () => {
    expect(currentPlan('', 'free')).toBe('free');
    expect(currentPlan('', 'pro')).toBe('pro');
  });

  it('the URL flag outranks the workspace plan in both directions', () => {
    expect(currentPlan('?plan=free', 'pro')).toBe('free');
    expect(currentPlan('?plan=pro', 'free')).toBe('pro');
  });
});

describe('freeCutoff', () => {
  it('is null on pro — nothing is ever archived', () => {
    expect(freeCutoff(base.memories, 'pro')).toBeNull();
  });

  it('is null for an empty corpus', () => {
    expect(freeCutoff([], 'free')).toBeNull();
  });

  it('anchors to the newest memory, not the wall clock', () => {
    const cutoff = freeCutoff(base.memories, 'free')!;
    const newest = base.memories.map((m) => m.created_at).sort().at(-1)!;
    const expected = new Date(
      new Date(newest).getTime() - FREE_WINDOW_DAYS * 864e5,
    ).toISOString();
    expect(cutoff).toBe(expected);
  });

  it('keeps the newest memory inside the window and archives the oldest', () => {
    const cutoff = freeCutoff(base.memories, 'free');
    const sorted = base.memories.map((m) => m.created_at).sort();
    expect(isArchivedByPlan(sorted.at(-1)!, cutoff)).toBe(false);
    expect(isArchivedByPlan(sorted[0]!, cutoff)).toBe(true);
  });

  it('archives nothing when the cutoff is null', () => {
    expect(isArchivedByPlan('2020-01-01T00:00:00Z', null)).toBe(false);
  });
});

/* ---- the trial and the sleeping count (paywall UX round) ---- */
import { effectivePlan, trialDaysLeft, sleepingCountOf } from '../../src/core/plan';

describe('trialDaysLeft', () => {
  const now = new Date('2026-08-21T09:00:00Z');
  it('counts whole days while the trial lives', () => {
    expect(trialDaysLeft({ plan: 'free', trial_until: '2026-08-24T09:00:01Z' }, now)).toBe(4);
  });
  it('is null once the trial has passed, or absent, or off-plan', () => {
    expect(trialDaysLeft({ plan: 'free', trial_until: '2026-08-20T09:00:00Z' }, now)).toBeNull();
    expect(trialDaysLeft({ plan: 'free', trial_until: null }, now)).toBeNull();
    expect(trialDaysLeft({ plan: 'pro', trial_until: '2026-08-24T09:00:00Z' }, now)).toBeNull();
    expect(trialDaysLeft(undefined, now)).toBeNull();
  });
});

describe('effectivePlan', () => {
  const now = new Date('2026-08-21T09:00:00Z');
  it('presents a live trial as pro', () => {
    expect(effectivePlan('', { plan: 'free', trial_until: '2026-08-24T00:00:00Z' }, now)).toBe('pro');
  });
  it('falls back to the plan when the trial is over', () => {
    expect(effectivePlan('', { plan: 'free', trial_until: '2026-08-01T00:00:00Z' }, now)).toBe('free');
  });
  it('lets ?plan= force either way, trial or not', () => {
    expect(effectivePlan('?plan=free', { plan: 'free', trial_until: '2026-08-24T00:00:00Z' }, now)).toBe('free');
    expect(effectivePlan('?plan=pro', { plan: 'free', trial_until: null }, now)).toBe('pro');
  });
});

describe('sleepingCountOf', () => {
  const mem = (created: string) => ({ created_at: created }) as never;
  it('counts memories past the cutoff, and nothing without one', () => {
    const memories = [mem('2026-08-01'), mem('2026-08-10'), mem('2026-08-20')];
    expect(sleepingCountOf(memories, '2026-08-15')).toBe(2);
    expect(sleepingCountOf(memories, null)).toBe(0);
  });
});
