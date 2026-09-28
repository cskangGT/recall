import { describe, it, expect, beforeEach } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { useUiStore } from '../../src/store/uiStore';
import { SeedDataSource, type DataSource } from '../../src/data/dataSource';
import {
  parseRevealParams,
  stripRevealParams,
  revealOnReturn,
} from '../../src/capture/revealOnReturn';

/**
 * A batch that happened outside the page — `npm run import:instagram` — ends
 * in a link. Opening it plays the declaration for the sources the CLI wrote,
 * read out of the loaded graph; the parameter is spent on arrival so a reload
 * does not declare twice.
 */
const payload = validateSeed(workspaceJson);

describe('parseRevealParams', () => {
  it('reads the ids and the period', () => {
    expect(parseRevealParams('?api=1&reveal=src_a,src_b&from=2026-08-01&to=2026-08-14')).toEqual({
      sourceIds: ['src_a', 'src_b'],
      period: { from: '2026-08-01', to: '2026-08-14' },
    });
  });

  it('trims, drops empties, and keeps each id once, in order', () => {
    expect(parseRevealParams('?reveal=%20src_b%20,,src_a,src_b')!.sourceIds).toEqual([
      'src_b',
      'src_a',
    ]);
  });

  it('a period needs both ends, well-formed and in order', () => {
    expect(parseRevealParams('?reveal=a&from=2026-08-01')!.period).toBeNull();
    expect(parseRevealParams('?reveal=a&from=Aug&to=2026-08-14')!.period).toBeNull();
    expect(parseRevealParams('?reveal=a&from=2026-08-14&to=2026-08-01')!.period).toBeNull();
  });

  it('nothing to reveal, nothing', () => {
    expect(parseRevealParams('')).toBeNull();
    expect(parseRevealParams('?reveal=')).toBeNull();
    expect(parseRevealParams('?reveal=,')).toBeNull();
    expect(parseRevealParams('?from=2026-08-01&to=2026-08-14')).toBeNull();
  });
});

describe('stripRevealParams', () => {
  it('removes only its own parameters', () => {
    expect(stripRevealParams('?api=1&reveal=a,b&from=2026-08-01&to=2026-08-14&lang=ko')).toBe(
      'api=1&lang=ko',
    );
    expect(stripRevealParams('?reveal=a')).toBe('');
    expect(stripRevealParams('')).toBe('');
  });
});

describe('revealOnReturn', () => {
  const apiLike: DataSource = { ...SeedDataSource, mode: 'api' };

  beforeEach(() => {
    useUiStore.setState({ batchReveal: null, welcomeDismissed: false, toasts: [] });
    useWorkspaceStore.setState({ payload, loading: false, source: apiLike });
  });

  it('plays the declaration for the sources in the link, and spends the link', () => {
    window.history.replaceState(null, '', '/?api=1&reveal=src_pitch_review,src_seed_deck_notes');
    revealOnReturn();
    const reveal = useUiStore.getState().batchReveal;
    expect(reveal?.phase).toBe('declare');
    expect(reveal?.summary?.memories).toBe(6);
    expect(reveal?.summary?.sourceIds).toEqual(['src_pitch_review', 'src_seed_deck_notes']);
    expect(useUiStore.getState().welcomeDismissed).toBe(true);
    expect(window.location.search).toBe('?api=1');
  });

  it('says so when the link names sources this workspace does not hold', () => {
    window.history.replaceState(null, '', '/?api=1&reveal=src_nope');
    revealOnReturn();
    expect(useUiStore.getState().batchReveal).toBeNull();
    expect(useUiStore.getState().toasts).toHaveLength(1);
    expect(window.location.search).toBe('?api=1');
  });

  it('in seed mode the link is spent and nothing plays', () => {
    useWorkspaceStore.setState({ source: SeedDataSource });
    window.history.replaceState(null, '', '/?reveal=src_pitch_review');
    revealOnReturn();
    expect(useUiStore.getState().batchReveal).toBeNull();
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(window.location.search).toBe('');
  });

  it('without the parameter it does nothing at all', () => {
    window.history.replaceState(null, '', '/?api=1');
    revealOnReturn();
    expect(useUiStore.getState().batchReveal).toBeNull();
    expect(useUiStore.getState().welcomeDismissed).toBe(false);
  });
});
