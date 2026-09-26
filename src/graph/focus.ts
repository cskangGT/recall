import type { GraphNode } from '../core/types';

/**
 * What a click on a category frames.
 *
 * The map used to answer a click with a selection and nothing else — the
 * camera stayed where it stood, and the big stones you would most want to
 * look into were exactly the ones too far away to read. Now a category is a
 * place: clicking it gathers the category, its child categories, and every
 * memory under any of them, and the canvas fits that set (capped, with ←
 * to walk back — the same request a search hit uses). A memory or an entity
 * is a thing, not a place, and still only selects.
 */
export function focusTargetsFor(nodes: readonly GraphNode[], id: string): string[] {
  const hit = nodes.find((n) => n.id === id);
  if (!hit || (hit.kind !== 'parent_category' && hit.kind !== 'child_category')) return [];
  const inside = new Set<string>([id]);
  // Two passes are enough: the taxonomy is at most parent → child → memory.
  for (let pass = 0; pass < 2; pass++) {
    for (const n of nodes) if (n.parentId && inside.has(n.parentId)) inside.add(n.id);
  }
  return nodes.filter((n) => inside.has(n.id)).map((n) => n.id);
}
