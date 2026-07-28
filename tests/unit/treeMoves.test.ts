import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import { useUiStore } from '../../src/store/uiStore';
import { buildTree } from '../../src/tree/buildTree';
import { evaluateReorg } from '../../src/core/gates';
import type { GraphPayload, Memory, Source } from '../../src/core/types';
import demoItem from '../../seed/demo-item.json';

const load = async () => {
  await useWorkspaceStore.getState().load();
  return useWorkspaceStore.getState().payload!;
};

const cat = (payload: GraphPayload, name: string) =>
  payload.categories.find((c) => c.name === name)!;

describe('moveMemory', () => {
  beforeEach(load);

  it('re-files the memory and updates both categories counts', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const from = cat(before, 'AI Tooling');
    const to = cat(before, 'Interview Loops');
    const memory = before.memories.find((m) => m.category_id === from.id)!;

    useWorkspaceStore.getState().moveMemory(memory.id, to.id);

    const after = useWorkspaceStore.getState().payload!;
    expect(after.memories.find((m) => m.id === memory.id)!.category_id).toBe(to.id);
    const rows = buildTree(after);
    expect(rows.find((r) => r.label === 'AI Tooling')!.count).toBe(8);
    expect(rows.find((r) => r.label === 'Interview Loops')!.count).toBe(4);
  });

  it('locks the assignment so the AI can never reclaim it (AC-28, AC-24)', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const aiTooling = cat(before, 'AI Tooling');
    const memory = before.memories.find((m) => m.category_id === aiTooling.id)!;

    useWorkspaceStore.getState().moveMemory(memory.id, cat(before, 'Interview Loops').id);
    const moved = useWorkspaceStore.getState().payload!.memories.find((m) => m.id === memory.id)!;
    expect(moved.category_locked).toBe(true);
  });

  it('drops the hand-placed position so the node regroups on the map', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const memory = before.memories.find((m) => m.category_id === cat(before, 'AI Tooling').id)!;
    expect(memory.x).not.toBeNull();

    useWorkspaceStore.getState().moveMemory(memory.id, cat(before, 'Pricing').id);
    expect(useWorkspaceStore.getState().payload!.memories.find((m) => m.id === memory.id)!.x)
      .toBeNull();
  });

  it('survives a reorganization pass — a user assignment is a fact', async () => {
    const base = useWorkspaceStore.getState().payload!;
    const aiTooling = cat(base, 'AI Tooling');
    const pinned = base.memories.find((m) => m.category_id === aiTooling.id)!;

    // Move it out by hand, then add the demo item and let the gates run.
    useWorkspaceStore.getState().moveMemory(pinned.id, cat(base, 'Pricing').id);
    const moved = useWorkspaceStore.getState().payload!;
    const withDemo: GraphPayload = {
      ...moved,
      sources: [...moved.sources, demoItem.source as Source],
      memories: [...moved.memories, ...(demoItem.memories as unknown as Memory[])],
    };

    const candidate = evaluateReorg(withDemo, [aiTooling.id]);
    const clustered = candidate
      ? [...candidate.clusters!.a, ...candidate.clusters!.b]
      : [];
    expect(clustered).not.toContain(pinned.id);
  });
});

describe('moveCategory', () => {
  beforeEach(load);

  it('re-parents a child onto a different parent', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const child = cat(before, 'Investor Notes');
    const target = cat(before, 'Hiring');

    useWorkspaceStore.getState().moveCategory(child.id, target.id);

    const after = useWorkspaceStore.getState().payload!;
    expect(after.categories.find((c) => c.id === child.id)!.parent_id).toBe(target.id);
    const rows = buildTree(after);
    expect(rows.find((r) => r.label === 'Fundraising')!.count).toBe(7);
    expect(rows.find((r) => r.label === 'Hiring')!.count).toBe(11);
  });

  it('refuses a target that is itself a child — two levels only', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const child = cat(before, 'Investor Notes');
    const otherChild = cat(before, 'Interview Loops');

    useWorkspaceStore.getState().moveCategory(child.id, otherChild.id);

    const after = useWorkspaceStore.getState().payload!;
    expect(after.categories.find((c) => c.id === child.id)!.parent_id).toBe(
      cat(before, 'Fundraising').id,
    );
  });

  it('keeps the taxonomy exactly two levels deep after any move', async () => {
    const before = useWorkspaceStore.getState().payload!;
    useWorkspaceStore.getState().moveCategory(cat(before, 'Pricing').id, cat(before, 'Hiring').id);
    const after = useWorkspaceStore.getState().payload!;
    for (const c of after.categories) {
      if (!c.parent_id) continue;
      expect(after.categories.find((p) => p.id === c.parent_id)!.parent_id).toBeNull();
    }
  });
});

describe('view switching', () => {
  beforeEach(() => useUiStore.setState({ view: 'map', selectedId: null, centerOnId: null }));

  it('carries the selection to the map and asks it to centre', () => {
    const ui = useUiStore.getState();
    ui.setView('browse');
    ui.select('mem_11');
    useUiStore.getState().setView('map');

    const s = useUiStore.getState();
    expect(s.view).toBe('map');
    expect(s.selectedId).toBe('mem_11');
    expect(s.centerOnId).toBe('mem_11');
    expect(useUiStore.getState().consumeCenterOn()).toBe('mem_11');
    // Consumed exactly once, so the canvas does not re-pan every frame.
    expect(useUiStore.getState().consumeCenterOn()).toBeNull();
  });

  it('does not ask the map to centre when moving into the tree', () => {
    const ui = useUiStore.getState();
    ui.select('mem_11');
    ui.setView('browse');
    expect(useUiStore.getState().centerOnId).toBeNull();
  });
});

describe('renameCategory', () => {
  beforeEach(load);

  it('renames and locks, so the AI can never rename it back', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const target = cat(before, 'AI Tooling');
    expect(target.name_locked).toBe(false);

    useWorkspaceStore.getState().renameCategory(target.id, 'Agent Stack');

    const after = useWorkspaceStore.getState().payload!.categories.find((c) => c.id === target.id)!;
    expect(after.name).toBe('Agent Stack');
    expect(after.name_locked).toBe(true);
  });

  /**
   * The reason renaming locks at all. `gates.ts` drops locked categories before
   * scoring, so a category you named stops being a restructuring candidate —
   * the correction is permanent, not merely applied.
   */
  it('takes the category out of reorganization entirely', async () => {
    const base = useWorkspaceStore.getState().payload!;
    const aiTooling = cat(base, 'AI Tooling');

    // Unrenamed, the demo item splits this category — that is the whole demo.
    const withDemo = (payload: GraphPayload): GraphPayload => ({
      ...payload,
      sources: [...payload.sources, demoItem.source as Source],
      memories: [...payload.memories, ...(demoItem.memories as unknown as Memory[])],
    });
    expect(evaluateReorg(withDemo(base), [aiTooling.id])).not.toBeNull();

    useWorkspaceStore.getState().renameCategory(aiTooling.id, 'Agent Stack');
    const renamed = useWorkspaceStore.getState().payload!;
    expect(evaluateReorg(withDemo(renamed), [aiTooling.id])).toBeNull();
  });

  it('ignores an empty name rather than blanking the category', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const target = cat(before, 'Hiring');
    useWorkspaceStore.getState().renameCategory(target.id, '   ');
    expect(useWorkspaceStore.getState().payload!.categories.find((c) => c.id === target.id)!.name)
      .toBe('Hiring');
  });

  it('does not lock a category when the name did not actually change', async () => {
    const before = useWorkspaceStore.getState().payload!;
    const target = cat(before, 'Product');
    useWorkspaceStore.getState().renameCategory(target.id, 'Product');
    expect(useWorkspaceStore.getState().payload!.categories.find((c) => c.id === target.id)!
      .name_locked).toBe(false);
  });
});

describe('arc navigation state', () => {
  beforeEach(() => useUiStore.setState({ arcLevelId: null, openCategoryId: null }));

  it('descends into a folder and climbs back to the top level', () => {
    useUiStore.getState().setArcLevel('cat_fundraising');
    expect(useUiStore.getState().arcLevelId).toBe('cat_fundraising');
    useUiStore.getState().setArcLevel(null);
    expect(useUiStore.getState().arcLevelId).toBeNull();
  });

  it('keeps the level you are standing in separate from the folder you are reading', () => {
    // Standing inside Fundraising's arc while reading Investor Notes is one
    // state, not two conflicting ones.
    useUiStore.getState().setArcLevel('cat_fundraising');
    useUiStore.getState().openCategory('cat_investor_notes');
    const s = useUiStore.getState();
    expect(s.arcLevelId).toBe('cat_fundraising');
    expect(s.openCategoryId).toBe('cat_investor_notes');
  });
});
