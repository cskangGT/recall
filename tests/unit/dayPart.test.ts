import { describe, it, expect } from 'vitest';
import { dayPartOf, briefingOrder } from '../../src/core/dayPart';

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

describe('briefingOrder', () => {
  it('opens the morning on the day, the afternoon on sorting, the evening on what came in', () => {
    expect(briefingOrder('morning')[0]).toBe('today');
    expect(briefingOrder('day').slice(0, 2)).toEqual(['today', 'organizing']);
    expect(briefingOrder('evening')[0]).toBe('todayMemories');
  });

  it('names every block exactly once in each order, and only the evening has the day’s memories', () => {
    for (const part of ['morning', 'day', 'evening'] as const) {
      const order = briefingOrder(part);
      expect(new Set(order).size).toBe(order.length);
      expect(order.includes('todayMemories')).toBe(part === 'evening');
      for (const block of ['today', 'lately', 'concerns', 'growing', 'organizing']) {
        expect(order).toContain(block);
      }
    }
  });
});
