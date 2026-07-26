import type { GraphNode, GraphEdge } from '../core/types';
import {
  COLORS,
  MEMORY_ZOOM_CUTOFF,
  ENTITY_ZOOM_CUTOFF,
  CHILD_LABEL_ZOOM_CUTOFF,
  ENTITY_LABEL_ZOOM_CUTOFF,
  colorFor,
} from './nodeStyles';
import { worldToScreen, type Camera, type Viewport } from './camera';

export interface FrameState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  camera: Camera;
  viewport: Viewport;
  hoveredId: string | null;
  selectedId: string | null;
  /** When non-empty these render at full opacity and everything else dims. */
  highlightedIds: string[];
  /** Opacity applied to non-highlighted elements (spec 5.6 uses 0.15). */
  dimOpacity: number;
  /** Per-node scale multiplier, used by the reorganization choreography. */
  scaleOverrides?: Map<string, number>;
  /** Nodes rendered desaturated during the reorganization sequence. */
  desaturatedIds?: string[];
  /** Ghost node position while an item is processing. */
  ghost?: { x: number; y: number; pulse: number } | null;
}

const withAlpha = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const desaturate = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const grey = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return `rgb(${Math.round((r + grey * 2) / 3)}, ${Math.round((g + grey * 2) / 3)}, ${Math.round(
    (b + grey * 2) / 3,
  )})`;
};

export function drawFrame(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const { camera, viewport } = s;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const highlighting = s.highlightedIds.length > 0;
  const highlighted = new Set(s.highlightedIds);
  const desaturated = new Set(s.desaturatedIds ?? []);

  const visible = (n: GraphNode): boolean => {
    if (highlighting && highlighted.has(n.id)) return true;
    if (n.kind === 'memory') return camera.zoom >= MEMORY_ZOOM_CUTOFF;
    if (n.kind === 'entity') return camera.zoom >= ENTITY_ZOOM_CUTOFF;
    return true;
  };

  const alphaFor = (id: string): number => (!highlighting || highlighted.has(id) ? 1 : s.dimOpacity);

  // Edges first so labels are never occluded.
  for (const e of s.edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b || !visible(a) || !visible(b)) continue;
    const active = s.hoveredId === a.id || s.hoveredId === b.id;
    const alpha = Math.min(alphaFor(a.id), alphaFor(b.id)) * (active ? 1 : 0.45);
    ctx.strokeStyle = withAlpha(active ? COLORS.edgeActive : COLORS.edge, alpha);
    ctx.lineWidth = e.kind === 'relates_to' ? 1.5 : 1;
    ctx.setLineDash(e.kind === 'mentions' ? [3, 3] : []);
    const p1 = worldToScreen(a, camera, viewport);
    const p2 = worldToScreen(b, camera, viewport);
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(p2.sx, p2.sy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Nodes.
  for (const n of s.nodes) {
    if (!visible(n)) continue;
    const { sx, sy } = worldToScreen(n, camera, viewport);
    const hovered = s.hoveredId === n.id;
    const scale = (s.scaleOverrides?.get(n.id) ?? 1) * (hovered ? 1.15 : 1);
    const r = n.radius * camera.zoom * scale;
    if (r <= 0) continue;

    const base = colorFor(n.kind);
    ctx.fillStyle = withAlpha(
      desaturated.has(n.id) ? '#000000' : base,
      alphaFor(n.id),
    );
    if (desaturated.has(n.id)) ctx.fillStyle = desaturate(base);

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();

    if (s.selectedId === n.id) {
      ctx.strokeStyle = COLORS.label;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (n.pinned) {
      ctx.fillStyle = withAlpha(COLORS.label, 0.8);
      ctx.beginPath();
      ctx.arc(sx + r * 0.7, sy - r * 0.7, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Ghost node for an item being processed.
  if (s.ghost) {
    const { sx, sy } = worldToScreen(s.ghost, camera, viewport);
    const r = 10 + Math.sin(s.ghost.pulse) * 3;
    ctx.fillStyle = withAlpha(COLORS.ghost, 0.35);
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(COLORS.ghost, 0.9);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Labels last.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of s.nodes) {
    if (n.kind === 'memory') continue;
    if (n.kind === 'entity' && camera.zoom < ENTITY_LABEL_ZOOM_CUTOFF) continue;
    if (n.kind === 'child_category' && camera.zoom < CHILD_LABEL_ZOOM_CUTOFF) continue;
    const { sx, sy } = worldToScreen(n, camera, viewport);
    const scale = s.scaleOverrides?.get(n.id) ?? 1;
    if (scale <= 0.01) continue;

    ctx.font =
      n.kind === 'parent_category'
        ? '600 13px Inter, system-ui, -apple-system, sans-serif'
        : '11px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillStyle = withAlpha(
      s.hoveredId === n.id || s.selectedId === n.id ? COLORS.label : COLORS.labelDim,
      alphaFor(n.id),
    );
    ctx.fillText(n.label, sx, sy + n.radius * camera.zoom * scale + 14);
  }
}
