import type { GraphPayload, GraphNode, GraphEdge, NodeKind } from '../core/types';
import { radiusFor } from './nodeStyles';
import { effectivePlan, freeCutoff, isArchivedByPlan } from '../core/plan';

/**
 * `contains` and `mentions` edges are derived from foreign keys rather than
 * stored, because storing them would create a second source of truth.
 * `derived_from` (memory -> source) is never rendered: it would double the
 * edge count for no insight, and lives in the Inspector instead. (spec 8.1)
 */
export function buildGraph(payload: GraphPayload): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // The free plan's sleep line, decided here so every view that draws stars
  // agrees with the reading list about which memories are dim.
  const cutoff = freeCutoff(payload.memories, effectivePlan(undefined, payload.workspace));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const directCount = new Map<string, number>();
  for (const m of payload.memories) {
    directCount.set(m.category_id, (directCount.get(m.category_id) ?? 0) + 1);
  }

  const descendantCount = (categoryId: string): number => {
    const own = directCount.get(categoryId) ?? 0;
    const fromChildren = payload.categories
      .filter((c) => c.parent_id === categoryId)
      .reduce((n, c) => n + (directCount.get(c.id) ?? 0), 0);
    return own + fromChildren;
  };

  for (const c of payload.categories) {
    const kind: NodeKind = c.parent_id === null ? 'parent_category' : 'child_category';
    const count = descendantCount(c.id);
    nodes.push({
      id: c.id,
      kind,
      label: c.name,
      x: c.x ?? 0,
      y: c.y ?? 0,
      radius: radiusFor(kind, count),
      pinned: c.pinned,
      parentId: c.parent_id,
      count,
    });
    if (c.parent_id !== null) {
      edges.push({
        id: `e_${c.parent_id}_${c.id}`,
        kind: 'contains',
        source: c.parent_id,
        target: c.id,
      });
    }
  }

  for (const m of payload.memories) {
    nodes.push({
      id: m.id,
      kind: 'memory',
      label: m.text,
      x: m.x ?? 0,
      y: m.y ?? 0,
      // A thought that keeps arriving grows — times_seen is the importance
      // signal the charter promises to make visible.
      radius: radiusFor('memory', 0) + Math.min(4, ((m.times_seen ?? 1) - 1) * 1.4),
      pinned: m.pinned,
      parentId: m.category_id,
      sleeping: isArchivedByPlan(m.created_at, cutoff) || undefined,
    });
    edges.push({
      id: `e_${m.category_id}_${m.id}`,
      kind: 'contains',
      source: m.category_id,
      target: m.id,
    });
    for (const entityId of m.entity_ids) {
      edges.push({
        id: `e_${m.id}_${entityId}`,
        kind: 'mentions',
        source: m.id,
        target: entityId,
      });
    }
  }

  for (const e of payload.entities) {
    nodes.push({
      id: e.id,
      kind: 'entity',
      label: e.name,
      x: e.x ?? 0,
      y: e.y ?? 0,
      radius: radiusFor('entity', 0),
      pinned: e.pinned,
      parentId: null,
    });
  }

  for (const e of payload.edges) {
    edges.push({
      id: e.id,
      kind: 'relates_to',
      source: e.source_memory_id,
      target: e.target_memory_id,
    });
  }

  return { nodes, edges };
}
