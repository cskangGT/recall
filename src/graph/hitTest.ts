import type { GraphNode } from '../core/types';
import { worldToScreen, type Camera, type Viewport } from './camera';
import { screenRadius } from './nodeStyles';

/** Minimum clickable radius in screen pixels — 6px memory dots need a forgiving target. */
const MIN_HIT_PX = 8;

export function hitTest(
  nodes: GraphNode[],
  camera: Camera,
  viewport: Viewport,
  screen: { sx: number; sy: number },
): GraphNode | null {
  let best: GraphNode | null = null;
  let bestRadius = Infinity;
  for (const n of nodes) {
    const { sx, sy } = worldToScreen(n, camera, viewport);
    // Painted size, not world size — what you see is what you click.
    const r = Math.max(MIN_HIT_PX, screenRadius(n.kind, n.radius, camera.zoom));
    if (Math.hypot(screen.sx - sx, screen.sy - sy) > r) continue;
    // Smallest node wins, so a memory sitting on its category stays clickable.
    if (n.radius < bestRadius) {
      best = n;
      bestRadius = n.radius;
    }
  }
  return best;
}
