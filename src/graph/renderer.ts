import type { GraphNode, GraphEdge } from '../core/types';
import {
  COLORS,
  MEMORY_ZOOM_CUTOFF,
  ENTITY_ZOOM_CUTOFF,
  CHILD_LABEL_ZOOM_CUTOFF,
  ENTITY_LABEL_ZOOM_CUTOFF,
  ENTITY_DIM_ZOOM,
  colorFor,
  screenRadius,
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

  // Entities are context, not content. Zoomed out they recede to a whisper so
  // the big picture stays amber-on-dark; zoomed in they come back.
  const entityFade =
    camera.zoom >= ENTITY_DIM_ZOOM ? 1 : 0.25 + 0.75 * (camera.zoom / ENTITY_DIM_ZOOM) ** 2;

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
      const mentionAlpha = e.kind === 'mentions' ? 0.7 * entityFade : 1;
      ctx.strokeStyle = withAlpha(base, alpha * mentionAlpha);
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
    const r = screenRadius(n.kind, n.radius, camera.zoom) * scale;
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
    const scale = (s.scaleOverrides?.get(n.id) ?? 1) * (hovered ? 1.15 : 1) * (n.sleeping ? 0.75 : 1);
    const r = screenRadius(n.kind, n.radius, camera.zoom) * scale;
    if (r <= 0) continue;

    // A sleeping memory is present but dim — visibly kept, visibly not shining.
    const sleepFade = n.sleeping ? 0.3 : 1;
    const nodeAlpha = alphaFor(n.id) * (n.kind === 'entity' && !hovered ? entityFade : 1) * sleepFade;
    const base = colorFor(n.kind);
    if (desaturated.has(n.id)) {
      ctx.fillStyle = desaturate(base);
    } else if (r > 4) {
      // Lit from the upper left, so a node reads as a sphere rather than a
      // sticker. Below ~4px the gradient is invisible and costs a paint, so
      // memory dots stay flat.
      const lit = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r);
      lit.addColorStop(0, withAlpha(lighten(base, 0.3), nodeAlpha));
      lit.addColorStop(1, withAlpha(base, nodeAlpha));
      ctx.fillStyle = lit;
    } else {
      ctx.fillStyle = withAlpha(base, nodeAlpha);
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
    const r = screenRadius('parent_category', d.radius, camera.zoom);
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

    // Parent names are the big picture — they read at a glance or the map has
    // failed. The count rides along so size never has to carry it alone.
    const isParent = n.kind === 'parent_category';
    ctx.font = isParent
      ? '600 15px Inter, system-ui, -apple-system, sans-serif'
      : '11px Inter, system-ui, -apple-system, sans-serif';
    const text =
      n.kind === 'parent_category' || n.kind === 'child_category'
        ? `${n.label}${n.count ? ` · ${n.count}` : ''}`
        : n.label;
    const y = sy + screenRadius(n.kind, n.radius, camera.zoom) * scale + (isParent ? 16 : 13);

    /*
     * A halo, drawn before the glyphs.
     *
     * A label sits 14px under its own node, which keeps it clear of *that* one
     * — but this is a force layout, so it lands wherever the memory dots of
     * three other categories happen to be. "AI Tooling" was running through a
     * node and "Personal Systems" through two.
     *
     * Stroking the text in the ground colour first is what cartographic labels
     * have always done: nothing moves, nothing is hidden, the name simply stops
     * competing with whatever is behind it. `round` joins so the outline does
     * not grow spikes at the corners of letters.
     */
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = isParent ? 5 : 3;
    ctx.strokeStyle = withAlpha('#07070a', alphaFor(n.id) * 0.92);
    ctx.strokeText(text, sx, y);
    ctx.restore();

    // Parents always at full brightness — they are the map's headings.
    ctx.fillStyle = withAlpha(
      isParent || s.hoveredId === n.id || s.selectedId === n.id ? COLORS.label : COLORS.labelDim,
      alphaFor(n.id) * (n.kind === 'entity' ? entityFade : 1),
    );
    ctx.fillText(text, sx, y);
  }
}
