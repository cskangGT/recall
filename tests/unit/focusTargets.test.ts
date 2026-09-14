import { describe, it, expect } from 'vitest';
import { focusTargetsFor } from '../../src/graph/focus';
import type { GraphNode } from '../../src/core/types';

/**
 * Clicking a category on the map pulls the camera into it: the category and
 * everything it holds — its memories and its child categories — become the
 * frame. Clicking a memory or an entity only selects, as before.
 */
const node = (id: string, kind: GraphNode['kind'], parentId: string | null): GraphNode => ({
  id, kind, label: id, x: 0, y: 0, radius: 10, pinned: false, parentId,
});
const nodes: GraphNode[] = [
  node('cat_a', 'parent_category', null),
  node('cat_a1', 'child_category', 'cat_a'),
  node('mem_1', 'memory', 'cat_a'),
  node('mem_2', 'memory', 'cat_a1'),
  node('cat_b', 'parent_category', null),
  node('mem_3', 'memory', 'cat_b'),
  node('ent_1', 'entity', null),
];

describe('focusTargetsFor', () => {
  it('a parent category frames itself, its children, and every memory under them', () => {
    expect(focusTargetsFor(nodes, 'cat_a')).toEqual(['cat_a', 'cat_a1', 'mem_1', 'mem_2']);
  });

  it('a child category frames itself and its own memories', () => {
    expect(focusTargetsFor(nodes, 'cat_a1')).toEqual(['cat_a1', 'mem_2']);
  });

  it('a memory or an entity is not a place to enter', () => {
    expect(focusTargetsFor(nodes, 'mem_1')).toEqual([]);
    expect(focusTargetsFor(nodes, 'ent_1')).toEqual([]);
    expect(focusTargetsFor(nodes, 'nope')).toEqual([]);
  });
});
