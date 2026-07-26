import type { GraphNode } from '../core/types';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function worldToScreen(p: Point, c: Camera, v: Viewport): { sx: number; sy: number } {
  return { sx: (p.x - c.x) * c.zoom + v.w / 2, sy: (p.y - c.y) * c.zoom + v.h / 2 };
}

export function screenToWorld(p: { sx: number; sy: number }, c: Camera, v: Viewport): Point {
  return { x: (p.sx - v.w / 2) / c.zoom + c.x, y: (p.sy - v.h / 2) / c.zoom + c.y };
}

export function fitToBounds(nodes: GraphNode[], v: Viewport, padding = 0.1): Camera {
  if (nodes.length === 0) return { x: 0, y: 0, zoom: 1 };
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const zoom = clampZoom(
    Math.min(v.w / (w * (1 + padding * 2)), v.h / (h * (1 + padding * 2))),
  );
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom };
}

/**
 * Pans without touching zoom. The reorganization must never be missed because
 * it happened off-screen, and a zoom change mid-animation reads as a jump. (AC-20)
 */
export function panToNode(node: Point, c: Camera): Camera {
  return { x: node.x, y: node.y, zoom: c.zoom };
}

export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    zoom: from.zoom + (to.zoom - from.zoom) * t,
  };
}

/** True when the point sits outside the viewport, with a margin. */
export function isOffScreen(p: Point, c: Camera, v: Viewport, margin = 80): boolean {
  const { sx, sy } = worldToScreen(p, c, v);
  return sx < margin || sx > v.w - margin || sy < margin || sy > v.h - margin;
}
