import { forceSimulation, forceLink, forceCollide, forceX, forceY } from 'd3-force';
import type { GraphNode, GraphEdge } from '../core/types';

/**
 * Short re-settle only, and deliberately anchored.
 *
 * The seed positions are art-directed: the demo's opening frame is composed by
 * hand, and a map that reshuffles on every load is unusable because spatial
 * memory is the whole point. So the simulation is not here to lay the graph out
 * — it is here to resolve overlaps and to place nodes that arrived without a
 * position. Every node is pulled back toward its target position; a repulsion
 * force strong enough to actually arrange the graph would destroy the
 * composition. (AC-13)
 */
const DEFAULT_TICKS = 30;

/** How hard a node is held to its seeded position vs. its category's pull. */
const ANCHOR_SEEDED = 0.55;
const ANCHOR_NEW = 0.12;

interface SimNode extends GraphNode {
  fx?: number;
  fy?: number;
  vx?: number;
  vy?: number;
  targetX: number;
  targetY: number;
  seeded: boolean;
}

interface SimEdge {
  kind: GraphEdge['kind'];
  source: string | SimNode;
  target: string | SimNode;
}

const linkDistanceFor = (kind: GraphEdge['kind']): number =>
  kind === 'contains' ? 62 : kind === 'mentions' ? 150 : 100;

const linkStrengthFor = (kind: GraphEdge['kind']): number =>
  kind === 'contains' ? 0.35 : 0.02;

/** Stable per-id value in [0,1). Replaces Math.random so layout is reproducible. */
function hashToUnit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6;

export function runLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: { ticks?: number } = {},
): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isSeeded = (n: GraphNode): boolean => !(n.x === 0 && n.y === 0);

  /*
   * Territories before residents.
   *
   * A bulk import arrives with no positions at all, so every root category —
   * and every entity — lands on (0,0). Thirty ticks of a deliberately weak
   * simulation cannot un-stack four categories and their swarms, which is how
   * the map became one amber pile. So unseeded roots are dealt onto a ring
   * around (and clear of) whatever is already composed, and only then does the
   * simulation resolve the details. Deterministic: same input, same ring.
   */
  const seededBound = nodes.filter(isSeeded).reduce(
    (r, n) => Math.max(r, Math.hypot(n.x, n.y)),
    0,
  );
  const looseRoots = nodes.filter((n) => !isSeeded(n) && !n.parentId && n.kind !== 'entity');
  const ringRadius = seededBound > 0 ? seededBound + 220 : 240;
  const phase = looseRoots.length > 0 ? hashToUnit(looseRoots[0]!.id) * Math.PI * 2 : 0;
  const placedRoots = new Map<string, { x: number; y: number }>();
  looseRoots.forEach((n, i) => {
    const angle = phase + (i / looseRoots.length) * Math.PI * 2;
    placedRoots.set(n.id, {
      x: Math.cos(angle) * ringRadius,
      y: Math.sin(angle) * ringRadius,
    });
  });

  const sim: SimNode[] = nodes.map((n) => {
    const seeded = isSeeded(n);
    let x = n.x;
    let y = n.y;

    const placed = placedRoots.get(n.id);
    if (placed) {
      x = placed.x;
      y = placed.y;
    } else if (!seeded && n.parentId) {
      // A node that arrived without a position starts beside its parent,
      // deterministically, and is only loosely held there.
      const parent = byId.get(n.parentId);
      if (parent) {
        const at = placedRoots.get(parent.id) ?? parent;
        const angle = hashToUnit(n.id) * Math.PI * 2;
        x = at.x + Math.cos(angle) * 72;
        y = at.y + Math.sin(angle) * 72;
      }
    }

    const copy: SimNode = {
      ...n, x, y, vx: 0, vy: 0, targetX: x, targetY: y, seeded,
    };
    if (n.pinned) {
      copy.fx = x;
      copy.fy = y;
    }
    return copy;
  });

  /*
   * Entities have no parent, so the pass above leaves an unseeded one at the
   * origin — and its `mentions` links (strength 0.02) will never carry it to
   * its memories. Start it at the centroid of the memories that mention it,
   * nudged apart by a per-id angle so co-mentioned entities do not stack.
   */
  const simById0 = new Map(sim.map((n) => [n.id, n]));
  for (const n of sim) {
    if (n.kind !== 'entity' || n.seeded) continue;
    const anchors = edges
      .filter((e) => e.kind === 'mentions' && e.target === n.id)
      .map((e) => simById0.get(e.source))
      .filter((m): m is SimNode => !!m);
    if (anchors.length === 0) continue;
    const cx = anchors.reduce((s, m) => s + m.x, 0) / anchors.length;
    const cy = anchors.reduce((s, m) => s + m.y, 0) / anchors.length;
    const angle = hashToUnit(n.id) * Math.PI * 2;
    n.x = n.targetX = cx + Math.cos(angle) * 36;
    n.y = n.targetY = cy + Math.sin(angle) * 36;
  }

  const simById = new Map(sim.map((n) => [n.id, n]));
  const simEdges: SimEdge[] = edges
    .filter((e) => simById.has(e.source) && simById.has(e.target))
    .map((e) => ({ kind: e.kind, source: e.source, target: e.target }));

  const anchor = (d: SimNode): number => (d.seeded ? ANCHOR_SEEDED : ANCHOR_NEW);

  forceSimulation(sim)
    .force(
      'link',
      forceLink<SimNode, SimEdge>(simEdges)
        .id((d) => d.id)
        .distance((d) => linkDistanceFor(d.kind))
        .strength((d) => linkStrengthFor(d.kind)),
    )
    .force('anchorX', forceX<SimNode>((d) => d.targetX).strength(anchor))
    .force('anchorY', forceY<SimNode>((d) => d.targetY).strength(anchor))
    .force(
      'collide',
      forceCollide<SimNode>()
        // Categories carry a swarm of members; the extra padding is their yard.
        .radius((d) => (d.kind === 'memory' || d.kind === 'entity' ? d.radius + 3 : d.radius + 14))
        .strength(0.7),
    )
    .velocityDecay(0.5)
    .stop()
    .tick(opts.ticks ?? DEFAULT_TICKS);

  return sim.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    x: round(n.x),
    y: round(n.y),
    radius: n.radius,
    pinned: n.pinned,
    parentId: n.parentId,
    count: n.count,
  }));
}
