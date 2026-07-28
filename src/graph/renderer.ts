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
  /**
   * A category being restructured, with 0→1 progress. Drives the bloom that
   * makes the split read as an event rather than two circles sliding apart.
   */
  bloom?: { x: number; y: number; progress: number } | null;
  /**
   * Categories mid-absorption. They are gone from `nodes` by the time this
   * runs, so a merge has nothing to show unless it is drawn separately.
   */
  dissolving?: { x: number; y: number; radius: number; alpha: number }[];
}

const withAlpha = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** Pulls a colour toward white, for the lit side of a node. */
const lighten = (hex: string, amount: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => mix(c).toString(16).padStart(2, '0'))
    .join('')}`;
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
  //
  // Drawn as a gradient along their own length rather than a flat grey line.
  // The relationships are the whole point of a graph, and a uniform hairline
  // reads as noise: fading from the category end toward the memory end gives
  // each edge a direction, so the structure reads as "these belong to that"
  // instead of "these are near that".
  for (const e of s.edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b || !visible(a) || !visible(b)) continue;
    const active = s.hoveredId === a.id || s.hoveredId === b.id;
    const alpha = Math.min(alphaFor(a.id), alphaFor(b.id)) * (active ? 1 : 0.5);
    const p1 = worldToScreen(a, camera, viewport);
    const p2 = worldToScreen(b, camera, viewport);

    const base = active ? COLORS.edgeActive : COLORS.edge;
    if (e.kind === 'contains') {
      // `contains` runs category -> member, so the bright end is the source.
      const gradient = ctx.createLinearGradient(p1.sx, p1.sy, p2.sx, p2.sy);
      gradient.addColorStop(0, withAlpha(active ? base : COLORS.edgeBright, alpha));
      gradient.addColorStop(1, withAlpha(base, alpha * 0.15));
      ctx.strokeStyle = gradient;
    } else {
      ctx.strokeStyle = withAlpha(base, alpha * (e.kind === 'mentions' ? 0.7 : 1));
    }

    ctx.lineWidth = e.kind === 'relates_to' ? 1.5 : 1;
    ctx.setLineDash(e.kind === 'mentions' ? [3, 3] : []);
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(p2.sx, p2.sy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Glow, behind everything. Categories are light sources, not discs — that is
  // the difference between a field you look *into* and a scatter plot you look
  // *at*. Drawn as its own pass so a glow never washes out a neighbouring node.
  ctx.globalCompositeOperation = 'lighter';
  for (const n of s.nodes) {
    if (n.kind === 'memory' || n.kind === 'entity') continue;
    if (!visible(n) || desaturated.has(n.id)) continue;
    const { sx, sy } = worldToScreen(n, camera, viewport);
    const scale = s.scaleOverrides?.get(n.id) ?? 1;
    const r = n.radius * camera.zoom * scale;
    if (r <= 0) continue;

    const reach = r * (s.hoveredId === n.id ? 4.2 : 3.2);
    const glow = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, reach);
    glow.addColorStop(0, withAlpha(colorFor(n.kind), 0.16 * alphaFor(n.id)));
    glow.addColorStop(1, withAlpha(colorFor(n.kind), 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, reach, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Nodes.
  for (const n of s.nodes) {
    if (!visible(n)) continue;
    const { sx, sy } = worldToScreen(n, camera, viewport);
    const hovered = s.hoveredId === n.id;
    const scale = (s.scaleOverrides?.get(n.id) ?? 1) * (hovered ? 1.15 : 1);
    const r = n.radius * camera.zoom * scale;
    if (r <= 0) continue;

    const base = colorFor(n.kind);
    if (desaturated.has(n.id)) {
      ctx.fillStyle = desaturate(base);
    } else if (r > 4) {
      // Lit from the upper left, so a node reads as a sphere rather than a
      // sticker. Below ~4px the gradient is invisible and costs a paint, so
      // memory dots stay flat.
      const lit = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r);
      lit.addColorStop(0, withAlpha(lighten(base, 0.3), alphaFor(n.id)));
      lit.addColorStop(1, withAlpha(base, alphaFor(n.id)));
      ctx.fillStyle = lit;
    } else {
      ctx.fillStyle = withAlpha(base, alphaFor(n.id));
    }

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

  // A merge, as its opposite: mass collapsing inward instead of pushing apart.
  // Drawn after the nodes so it passes in front of the category taking it.
  for (const d of s.dissolving ?? []) {
    const { sx, sy } = worldToScreen(d, camera, viewport);
    const r = d.radius * camera.zoom;
    if (r <= 0.5) continue;
    ctx.fillStyle = withAlpha(COLORS.parentCategory, 0.55 * d.alpha);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // The split, as a light event.
  //
  // This is the product's signature moment and it was two circles sliding
  // apart. An expanding ring costs nothing and gives the reorganization a
  // physical cause. Timing is untouched — the choreography in spec 8.4.5 still
  // owns when this runs, so the rehearsal numbers do not move.
  if (s.bloom && s.bloom.progress > 0 && s.bloom.progress < 1) {
    const { sx, sy } = worldToScreen(s.bloom, camera, viewport);
    const t = s.bloom.progress;
    const eased = 1 - Math.pow(1 - t, 3);
    const radius = 30 * camera.zoom + eased * 260 * camera.zoom;
    const fade = (1 - t) ** 2;

    ctx.globalCompositeOperation = 'lighter';
    const ring = ctx.createRadialGradient(sx, sy, radius * 0.72, sx, sy, radius);
    ring.addColorStop(0, withAlpha(COLORS.parentCategory, 0));
    ring.addColorStop(0.7, withAlpha(COLORS.parentCategory, 0.22 * fade));
    ring.addColorStop(1, withAlpha(COLORS.parentCategory, 0));
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Vignette, so the canvas reads as a space with edges rather than a plane
  // that happens to stop at the viewport.
  const vignette = ctx.createRadialGradient(
    viewport.w / 2, viewport.h / 2, Math.min(viewport.w, viewport.h) * 0.42,
    viewport.w / 2, viewport.h / 2, Math.max(viewport.w, viewport.h) * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  // Labels last — above the vignette, so they never dim at the edges.
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
