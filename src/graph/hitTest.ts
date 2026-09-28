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
  let bestSolid = false;
  for (const n of nodes) {
    const { sx, sy } = worldToScreen(n, camera, viewport);
    // Painted size, not world size — what you see is what you click.
    const painted = screenRadius(n.kind, n.radius, camera.zoom);
    const distance = Math.hypot(screen.sx - sx, screen.sy - sy);
    if (distance > Math.max(MIN_HIT_PX, painted)) continue;
    /*
     * A click on the paint beats a click in the halo. The halo exists so a
     * six-pixel dot is not impossible to hit — but a dot orbiting a small
     * category puts its halo over the category's own disc, and a click that
     * visibly lands on the stone was answering to the dot instead. That is
     * why only the biggest stones seemed to open.
     */
    const solid = distance <= painted;
    if (solid && !bestSolid) {
      best = n;
      bestRadius = n.radius;
      bestSolid = true;
      continue;
    }
    if (solid !== bestSolid) continue;
    // Among equals, the smallest wins, so a memory sitting on its category
    // stays clickable.
    if (n.radius < bestRadius) {
      best = n;
      bestRadius = n.radius;
    }
  }
  return best;
}
