import { describe, it, expect } from 'vitest';
import { resolveInvite } from '../../src/data/dataSource';

/**
 * The invite's client half: a tester clicks one link with ?invite= once, the
 * token is remembered, and every later visit still writes. The server half
 * (routes.ts writesAllowed) has demanded the header all along — this is the
 * hand that presents it.
 */
describe('resolveInvite', () => {
  it('a link token wins and is remembered', () => {
    let saved: string | null = null;
    const token = resolveInvite('?invite=abc123', null, (t) => (saved = t));
    expect(token).toBe('abc123');
    expect(saved).toBe('abc123');
  });

  it('a later visit without the parameter falls back to what was remembered', () => {
    expect(resolveInvite('', 'abc123')).toBe('abc123');
    expect(resolveInvite('?lang=ko', 'abc123')).toBe('abc123');
  });

  it('a fresh link replaces the stored token', () => {
    let saved: string | null = null;
    expect(resolveInvite('?invite=next', 'old', (t) => (saved = t))).toBe('next');
    expect(saved).toBe('next');
  });

  it('no link, nothing stored — no header at all', () => {
    expect(resolveInvite('', null)).toBeNull();
    expect(resolveInvite('?invite=', null)).toBeNull();
  });
});
