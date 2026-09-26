import { describe, it, expect } from 'vitest';
import { resolveInvite, resolveWorkspaceFromLink, returnLinkFor } from '../../src/data/dataSource';

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

/**
 * Before there is an account the link is the account: a workspace named in
 * it becomes this browser's, and the link handed out carries the workspace
 * and the invite so opening it anywhere is enough.
 */
describe('the way back', () => {
  it('a link that names a workspace is followed and remembered', () => {
    let saved: string | null = null;
    expect(resolveWorkspaceFromLink('?ws=ws_ab12&invite=t', (id) => (saved = id))).toBe('ws_ab12');
    expect(saved).toBe('ws_ab12');
  });

  it('ignores a missing or malformed id', () => {
    expect(resolveWorkspaceFromLink('?api=1', () => {})).toBeNull();
    expect(resolveWorkspaceFromLink('?ws=../etc', () => {})).toBeNull();
    expect(resolveWorkspaceFromLink('?ws=', () => {})).toBeNull();
  });

  it('the link out carries the workspace and, where there is one, the invite', () => {
    expect(returnLinkFor('http://43.202.24.252', 'ws_ab12', 'tok')).toBe('http://43.202.24.252/?ws=ws_ab12&invite=tok');
    expect(returnLinkFor('https://mado.example', 'ws_ab12', null)).toBe('https://mado.example/?ws=ws_ab12');
  });
});
