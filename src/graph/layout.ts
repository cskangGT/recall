import { forceSimulation, forceLink, forceCollide, forceX, forceY } from 'd3-force';
import type { GraphNode, GraphEdge } from '../types/graph';

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

  const sim: SimNode[] = nodes.map((n) => {
    const seeded = !(n.x === 0 && n.y === 0);
    let x = n.x;
    let y = n.y;

    // A node that arrived without a position starts beside its parent,
    // deterministically, and is only loosely held there.
    if (!seeded && n.parentId) {
      const parent = byId.get(n.parentId);
      if (parent) {
        const angle = hashToUnit(n.id) * Math.PI * 2;
        x = parent.x + Math.cos(angle) * 72;
        y = parent.y + Math.sin(angle) * 72;
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
        .radius((d) => d.radius + 3)
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
  }));
}
