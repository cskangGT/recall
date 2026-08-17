import { describe, it, expect } from 'vitest';
import { seedFor, namespaceSeed, importSeed } from '../../server/seed/import';
import { SqliteRepository } from '../../server/db/sqlite';
import { validateSeed } from '../../src/data/validateSeed';
import { handle, type Deps } from '../../server/http/routes';

/**
 * The demo corpus in the visitor's language. The Korean seed was earned the
 * same way the English one was — real content through the real pipeline,
 * frozen — so it must clear the same validator, import cleanly under a
 * namespace, and arrive when the client says ko.
 */

describe('seedFor', () => {
  it('gives Korean visitors the Korean corpus, everyone else the original', () => {
    const ko = seedFor('ko');
    expect(ko.categories.length).toBeGreaterThan(5);
    // Korean names throughout — this is authored content, not a translation.
    expect(ko.categories.some((c) => /[가-힣]/.test(c.name))).toBe(true);
    expect(ko.memories.every((m) => m.text.length > 0)).toBe(true);

    expect(seedFor('en').categories.some((c) => c.name === 'Hiring')).toBe(true);
    expect(seedFor(undefined)).toBe(seedFor('en'));
  });

  it('the Korean seed clears the same validator the English one does', () => {
    expect(() => validateSeed(seedFor('ko'))).not.toThrow();
  });

  it('imports cleanly under a namespace — twice, without id collisions', () => {
    const repo = new SqliteRepository(':memory:');
    repo.migrate();
    importSeed(repo, 'ws_a', namespaceSeed(seedFor('ko'), 'ws_a'));
    importSeed(repo, 'ws_b', namespaceSeed(seedFor('ko'), 'ws_b'));
    expect(repo.listMemories('ws_a').length).toBe(seedFor('ko').memories.length);
    expect(repo.listMemories('ws_b').length).toBe(seedFor('ko').memories.length);
    repo.close();
  });
});

describe('POST /workspaces carries the locale', () => {
  it('hands the body locale to createWorkspace, and nothing invalid', async () => {
    const seen: (string | undefined)[] = [];
    const deps = {
      repo: { getWorkspace: () => null },
      createWorkspace: (locale?: 'en' | 'ko') => {
        seen.push(locale);
        return 'ws_x';
      },
    } as unknown as Deps;

    await handle({ method: 'POST', path: '/api/workspaces', body: { locale: 'ko' } }, deps);
    await handle({ method: 'POST', path: '/api/workspaces', body: { locale: 'xx' } }, deps);
    await handle({ method: 'POST', path: '/api/workspaces', body: null }, deps);
    expect(seen).toEqual(['ko', undefined, undefined]);
  });
});
