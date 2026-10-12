import { describe, it, expect } from 'vitest';
import { dayPartOf, leadRow } from '../../src/core/dayPart';

/**
 * Home leads with a different block by the hour: the day ahead in the
 * morning, what there is to sort in the afternoon, what came in today at
 * night. The boundaries are local hours, so a Date built from local parts
 * pins them regardless of the machine's zone.
 */
const at = (h: number, m = 0) => new Date(2026, 8, 16, h, m);

describe('dayPartOf', () => {
  it('splits the day at five, eleven and six', () => {
    expect(dayPartOf(at(4, 59))).toBe('evening');
    expect(dayPartOf(at(5))).toBe('morning');
    expect(dayPartOf(at(10, 59))).toBe('morning');
    expect(dayPartOf(at(11))).toBe('day');
    expect(dayPartOf(at(17, 59))).toBe('day');
    expect(dayPartOf(at(18))).toBe('evening');
    expect(dayPartOf(at(23, 30))).toBe('evening');
    expect(dayPartOf(at(0))).toBe('evening');
  });
});

describe('leadRow', () => {
  it('opens the day in the morning, the pile in the afternoon, the mind at night', () => {
    expect(leadRow('morning', true)).toBe('schedule');
    expect(leadRow('day', true)).toBe('info');
    expect(leadRow('evening', true)).toBe('mind');
  });

  it('without a calendar door the morning opens on the mind', () => {
    expect(leadRow('morning', false)).toBe('mind');
  });
});
