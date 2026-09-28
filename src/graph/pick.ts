import type { GraphEdge, GraphNode } from '../core/types';

/**
 * What a press means while thinking with picked memories.
 *
 * A memory is itself. A category is everything it holds, two levels down.
 * An entity — a person, a company — is every memory that mentions it. The
 * unit of a pick is always memories: that is what Mado can think with, and
 * what a bundle is made of.
 */
export function memoriesUnder(nodes: readonly GraphNode[], edges: readonly GraphEdge[], id: string): string[] {
  const hit = nodes.find((n) => n.id === id);
  if (!hit) return [];
  if (hit.kind === 'memory') return [id];
  if (hit.kind === 'entity') {
    return edges.filter((e) => e.kind === 'mentions' && e.target === id).map((e) => e.source);
  }
  const inside = new Set<string>([id]);
  for (let pass = 0; pass < 2; pass++) {
    for (const n of nodes) if (n.parentId && inside.has(n.parentId)) inside.add(n.id);
  }
  return nodes.filter((n) => n.kind === 'memory' && inside.has(n.id)).map((n) => n.id);
}

/** A press adds what is not yet picked; pressing something wholly picked takes it out. */
export function togglePicked(picked: readonly string[], ids: readonly string[]): string[] {
  if (ids.length === 0) return [...picked];
  const have = new Set(picked);
  const allIn = ids.every((id) => have.has(id));
  if (allIn) return picked.filter((id) => !ids.includes(id));
  for (const id of ids) have.add(id);
  return [...have];
}
