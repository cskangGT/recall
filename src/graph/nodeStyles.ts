import type { NodeKind } from '../types/graph';

/**
 * Dark, spatial ground with one warm accent. The map is a field you look into,
 * not a document you look at. A rainbow taxonomy reads as a chart; a restrained
 * one reads as an instrument. (spec 17)
 */
export const COLORS = {
  background: '#0A0A0B',
  parentCategory: '#E8A33D',
  childCategory: '#B0782E',
  memory: '#C9C9CE',
  entity: '#5B8FB0',
  edge: '#26262A',
  edgeActive: '#E8A33D',
  label: '#E8E8EC',
  labelDim: '#7A7A82',
  ghost: '#E8A33D',
} as const;

/**
 * Level of detail.
 *
 * Spec 5.1 hides memory nodes below zoom 1.4 and entity nodes below 1.0, which
 * is the right call at 600 memories. At the seed's 47 it empties the opening
 * frame: the audience sees twenty dots and the map stops reading as accumulated
 * knowledge, which is the whole of the 30-second promise. So in Phase 1 every
 * node draws at every zoom and only *labels* are staged. Reinstate node-level
 * LOD when the corpus actually gets large.
 */
export const MEMORY_ZOOM_CUTOFF = 0;
export const ENTITY_ZOOM_CUTOFF = 0;
/** Labels are still staged — 31 entity labels at fit zoom is unreadable. */
export const CHILD_LABEL_ZOOM_CUTOFF = 0.42;
export const ENTITY_LABEL_ZOOM_CUTOFF = 1.0;

export function radiusFor(kind: NodeKind, memberCount: number): number {
  switch (kind) {
    case 'parent_category':
      return Math.min(44, 28 + memberCount * 1.2);
    case 'child_category':
      return Math.min(28, 18 + memberCount * 0.9);
    case 'memory':
      return 6;
    case 'entity':
      return 10;
  }
}

export function colorFor(kind: NodeKind): string {
  switch (kind) {
    case 'parent_category':
      return COLORS.parentCategory;
    case 'child_category':
      return COLORS.childCategory;
    case 'memory':
      return COLORS.memory;
    case 'entity':
      return COLORS.entity;
  }
}
