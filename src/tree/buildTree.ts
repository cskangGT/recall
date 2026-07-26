import type { GraphPayload, SourceType } from '../types/graph';

export type TreeRowKind = 'parent_category' | 'child_category' | 'memory';

export interface TreeRow {
  id: string;
  kind: TreeRowKind;
  label: string;
  depth: 0 | 1 | 2;
  /** Descendant memory count for parents, own count for children. Null for memories. */
  count: number | null;
  parentId: string | null;
  hasChildren: boolean;
  /** Memory rows only — drives the source-type icon. */
  sourceType: SourceType | null;
  /** True when a user edit protects this row from the AI. */
  locked: boolean;
}

/**
 * Flattens the two-level taxonomy into an ordered row list.
 *
 * A flat list rather than a nested structure because every consumer wants it
 * flat: rendering, arrow-key navigation, and the visible-row filter all walk it
 * in display order.
 *
 * Order within a parent is child categories first, then memories attached
 * directly to the parent. A parent normally holds no direct memories, but it
 * does before a split — which is exactly the state the demo starts in.
 */
export function buildTree(payload: GraphPayload): TreeRow[] {
  const rows: TreeRow[] = [];
  const sourceTypeOf = new Map(payload.sources.map((s) => [s.id, s.type]));

  const memoriesIn = (categoryId: string) =>
    payload.memories.filter((m) => m.category_id === categoryId);

  const memoryRow = (
    m: GraphPayload['memories'][number],
    depth: 1 | 2,
    parentId: string,
  ): TreeRow => ({
    id: m.id,
    kind: 'memory',
    label: m.text,
    depth,
    count: null,
    parentId,
    hasChildren: false,
    sourceType: sourceTypeOf.get(m.source_id) ?? null,
    locked: m.category_locked,
  });

  for (const parent of payload.categories.filter((c) => c.parent_id === null)) {
    const children = payload.categories.filter((c) => c.parent_id === parent.id);
    const ownMemories = memoriesIn(parent.id);
    const descendantCount =
      ownMemories.length + children.reduce((n, c) => n + memoriesIn(c.id).length, 0);

    rows.push({
      id: parent.id,
      kind: 'parent_category',
      label: parent.name,
      depth: 0,
      count: descendantCount,
      parentId: null,
      hasChildren: children.length > 0 || ownMemories.length > 0,
      sourceType: null,
      locked: parent.name_locked || parent.user_created,
    });

    for (const child of children) {
      const childMemories = memoriesIn(child.id);
      rows.push({
        id: child.id,
        kind: 'child_category',
        label: child.name,
        depth: 1,
        count: childMemories.length,
        parentId: parent.id,
        hasChildren: childMemories.length > 0,
        sourceType: null,
        locked: child.name_locked || child.user_created,
      });
      for (const m of childMemories) rows.push(memoryRow(m, 2, child.id));
    }

    for (const m of ownMemories) rows.push(memoryRow(m, 1, parent.id));
  }

  return rows;
}

/** Rows whose every ancestor is expanded. */
export function visibleRows(rows: TreeRow[], expanded: ReadonlySet<string>): TreeRow[] {
  return rows.filter((row) => {
    let ancestor = row.parentId;
    while (ancestor !== null) {
      if (!expanded.has(ancestor)) return false;
      ancestor = rows.find((r) => r.id === ancestor)?.parentId ?? null;
    }
    return true;
  });
}

export type DropRejection = 'depth' | 'invalid' | null;

/**
 * Whether `dragged` may be dropped onto `target`, and why not.
 *
 * The taxonomy is exactly two levels, so a child category dropped onto another
 * child would nest three deep and is refused. Parent categories are not
 * draggable at all — there is nowhere for one to go.
 */
export function validateDrop(dragged: TreeRow, target: TreeRow): DropRejection {
  if (dragged.id === target.id) return 'invalid';
  if (target.kind === 'memory') return 'invalid';

  if (dragged.kind === 'memory') {
    return dragged.parentId === target.id ? 'invalid' : null;
  }

  if (dragged.kind === 'child_category') {
    if (target.kind === 'child_category') return 'depth';
    return dragged.parentId === target.id ? 'invalid' : null;
  }

  return 'invalid';
}
