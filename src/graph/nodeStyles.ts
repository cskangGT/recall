import type { NodeKind } from '../core/types';

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
  /** The lit end of a `contains` edge, where it leaves its category. */
  edgeBright: '#5A4A32',
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
export const ENTITY_LABEL_ZOOM_CUTOFF = 1.5;
/** Below this zoom, entity dots and their `mentions` edges recede to a whisper. */
export const ENTITY_DIM_ZOOM = 1.0;

export function radiusFor(kind: NodeKind, memberCount: number): number {
  switch (kind) {
    case 'parent_category':
      // sqrt, not linear: an 18-memory category should look bigger than a
      // 2-memory one, not eighteen times more important.
      return Math.min(40, 17 + Math.sqrt(memberCount) * 5.2);
    case 'child_category':
      return Math.min(24, 11 + Math.sqrt(memberCount) * 3.6);
    case 'memory':
      return 6;
    case 'entity':
      return 7;
  }
}

/**
 * Screen-space radius. Categories and entities are landmarks, not content:
 * their painted size follows √zoom, so a tightly clustered import (whose fit
 * zoom lands near the 3× cap) does not fill the frame with amber, and zooming
 * out does not erase the structure. Memories are content and scale linearly.
 * hitTest uses this too, so what you see is what you click.
 */
export function screenRadius(kind: NodeKind, radius: number, zoom: number): number {
  return kind === 'memory' ? radius * zoom : radius * Math.sqrt(zoom);
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
