import type { GraphNode } from '../types/graph';
import { worldToScreen, type Camera, type Viewport } from './camera';

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
    const r = Math.max(MIN_HIT_PX, n.radius * camera.zoom);
    if (Math.hypot(screen.sx - sx, screen.sy - sy) > r) continue;
    // Smallest node wins, so a memory sitting on its category stays clickable.
    if (n.radius < bestRadius) {
      best = n;
      bestRadius = n.radius;
    }
  }
  return best;
}
