import { describe, it, expect } from 'vitest';
import { buildTree, visibleRows, validateDrop, type TreeRow } from '../../src/tree/buildTree';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';

const payload = validateSeed(workspaceJson);
const rows = buildTree(payload);

const byName = (name: string): TreeRow => rows.find((r) => r.label === name)!;

describe('buildTree', () => {
  it('emits a row per category and per memory', () => {
    expect(rows).toHaveLength(payload.categories.length + payload.memories.length);
  });

  it('lists parent categories in payload order', () => {
    expect(rows.filter((r) => r.depth === 0).map((r) => r.label)).toEqual([
      'Fundraising',
      'AI Tooling',
      'Hiring',
      'Product',
      'Go-to-Market',
      'Personal Systems',
    ]);
  });

  it('counts descendants on a parent and own memories on a child', () => {
    expect(byName('Fundraising').count).toBe(11);
    expect(byName('Investor Notes').count).toBe(4);
    expect(byName('Pitch Feedback').count).toBe(4);
    expect(byName('Seed Benchmarks').count).toBe(3);
  });

  it('puts memories attached directly to a parent at depth 1', () => {
    const aiMemories = rows.filter((r) => r.kind === 'memory' && r.parentId === byName('AI Tooling').id);
    expect(aiMemories).toHaveLength(9);
    for (const m of aiMemories) expect(m.depth).toBe(1);
  });

  it('puts memories under a child category at depth 2', () => {
    const notes = rows.filter((r) => r.kind === 'memory' && r.parentId === byName('Investor Notes').id);
    expect(notes).toHaveLength(4);
    for (const m of notes) expect(m.depth).toBe(2);
  });

  it('orders child categories before a parent own memories', () => {
    const start = rows.findIndex((r) => r.id === byName('Fundraising').id);
    expect(rows[start + 1]!.label).toBe('Investor Notes');
  });

  it('carries the source type onto memory rows for the icon', () => {
    const memories = rows.filter((r) => r.kind === 'memory');
    expect(memories.every((m) => m.sourceType !== null)).toBe(true);
    expect(new Set(memories.map((m) => m.sourceType))).toEqual(
      new Set(['text', 'link', 'screenshot']),
    );
  });

  it('never emits a row deeper than two levels of category', () => {
    for (const r of rows) {
      if (r.kind !== 'memory') expect(r.depth).toBeLessThanOrEqual(1);
      expect(r.depth).toBeLessThanOrEqual(2);
    }
  });
});

describe('visibleRows', () => {
  it('shows only parents when nothing is expanded', () => {
    const visible = visibleRows(rows, new Set());
    expect(visible).toHaveLength(6);
    expect(visible.every((r) => r.depth === 0)).toBe(true);
  });

  it('reveals a parent children when it is expanded', () => {
    const visible = visibleRows(rows, new Set([byName('Fundraising').id]));
    expect(visible.map((r) => r.label)).toContain('Investor Notes');
    // The grandchild memories stay hidden until the child is expanded too.
    expect(visible.some((r) => r.parentId === byName('Investor Notes').id)).toBe(false);
  });

  it('reveals memories only when the whole ancestor chain is expanded', () => {
    const expanded = new Set([byName('Fundraising').id, byName('Investor Notes').id]);
    const visible = visibleRows(rows, expanded);
    expect(visible.filter((r) => r.parentId === byName('Investor Notes').id)).toHaveLength(4);
  });

  it('shows a parent own memories as soon as the parent is expanded', () => {
    const visible = visibleRows(rows, new Set([byName('AI Tooling').id]));
    expect(visible.filter((r) => r.kind === 'memory')).toHaveLength(9);
  });
});

describe('validateDrop', () => {
  const parent = byName('Fundraising');
  const otherParent = byName('Hiring');
  const child = byName('Investor Notes');
  const otherChild = byName('Pitch Feedback');
  const memory = rows.find((r) => r.kind === 'memory' && r.parentId === child.id)!;

  it('accepts a memory onto a different category', () => {
    expect(validateDrop(memory, otherChild)).toBeNull();
    expect(validateDrop(memory, parent)).toBeNull();
  });

  it('rejects a memory onto the category it already sits in', () => {
    expect(validateDrop(memory, child)).toBe('invalid');
  });

  it('accepts a child category onto a different parent', () => {
    expect(validateDrop(child, otherParent)).toBeNull();
  });

  it('rejects a child category onto its current parent', () => {
    expect(validateDrop(child, parent)).toBe('invalid');
  });

  it('rejects a child onto another child — that would nest three deep', () => {
    expect(validateDrop(child, otherChild)).toBe('depth');
  });

  it('rejects any drop onto a memory', () => {
    expect(validateDrop(memory, memory)).toBe('invalid');
    expect(validateDrop(child, memory)).toBe('invalid');
  });

  it('refuses to drag a parent category anywhere', () => {
    expect(validateDrop(parent, otherParent)).toBe('invalid');
    expect(validateDrop(parent, child)).toBe('invalid');
  });
});
