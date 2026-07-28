import { describe, it, expect, beforeEach } from 'vitest';
import { isOffline, selectDataSource } from '../../src/data/dataSource';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { useUiStore } from '../../src/store/uiStore';
import { evaluateReorg } from '../../src/core/gates';
import demoItem from '../../seed/demo-item.json';
import type { GraphPayload, Memory, Source } from '../../src/core/types';

/**
 * `auto_reorganize` sat in the schema and the payload from Phase 3 onward and
 * was read by nobody. These cover it actually meaning something, and the
 * offline flag actually keeping the demo off the network.
 */

describe('offline flag', () => {
  it('forces seeded data even when API mode was asked for', () => {
    // Reached for in a panic when the venue's network has failed, so it must
    // win the argument rather than lose it to another flag in the URL.
    expect(selectDataSource('?api=1&offline=1').mode).toBe(
      selectDataSource('').mode,
    );
    expect(isOffline('?api=1&offline=1')).toBe(true);
  });

  it('leaves API mode alone otherwise', () => {
    expect(selectDataSource('?api=1').mode).not.toBe(selectDataSource('').mode);
    expect(isOffline('?api=1')).toBe(false);
  });

  it('is off by default', () => {
    expect(isOffline('')).toBe(false);
  });
});

describe('auto-reorganize', () => {
  beforeEach(async () => {
    await useWorkspaceStore.getState().load();
  });

  it('is on for the seeded workspace', () => {
    expect(useWorkspaceStore.getState().payload!.workspace.auto_reorganize).toBe(true);
  });

  it('toggles and survives in the payload', () => {
    useWorkspaceStore.getState().setAutoReorganize(false);
    expect(useWorkspaceStore.getState().payload!.workspace.auto_reorganize).toBe(false);
    useWorkspaceStore.getState().setAutoReorganize(true);
    expect(useWorkspaceStore.getState().payload!.workspace.auto_reorganize).toBe(true);
  });

  /**
   * The reason the switch exists. With it off, the capture that normally splits
   * AI Tooling must still file its memories and leave the structure alone.
   */
  it('decides whether the demo capture restructures anything', () => {
    const base = useWorkspaceStore.getState().payload!;
    const withDemo = (p: GraphPayload): GraphPayload => ({
      ...p,
      sources: [...p.sources, demoItem.source as Source],
      memories: [...p.memories, ...(demoItem.memories as unknown as Memory[])],
    });
    const touched = [...new Set((demoItem.memories as unknown as Memory[]).map((m) => m.category_id))];

    // The gate itself is unconditional — it is the caller that consults the flag.
    expect(evaluateReorg(withDemo(base), touched)).not.toBeNull();

    const gated = (payload: GraphPayload) =>
      payload.workspace.auto_reorganize ? evaluateReorg(payload, touched) : null;

    expect(gated(withDemo(base))).not.toBeNull();
    expect(
      gated(withDemo({ ...base, workspace: { ...base.workspace, auto_reorganize: false } })),
    ).toBeNull();
  });
});

describe('settings panel state', () => {
  beforeEach(() =>
    useUiStore.setState({ settingsOpen: false, captureOpen: false, askOpen: false }),
  );

  it('opens and closes', () => {
    useUiStore.getState().setSettingsOpen(true);
    expect(useUiStore.getState().settingsOpen).toBe(true);
    useUiStore.getState().setSettingsOpen(false);
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it('is closed by Escape before anything else — it is a modal (spec 6.1)', () => {
    useUiStore.setState({ settingsOpen: true, selectedId: 'cat_1' });
    useUiStore.getState().escape();
    const s = useUiStore.getState();
    expect(s.settingsOpen).toBe(false);
    expect(s.selectedId).toBe('cat_1');
  });
});
