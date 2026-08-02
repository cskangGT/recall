import { describe, it, expect } from 'vitest';
import { validateSeed, SeedValidationError } from '../../src/data/validateSeed';
import { cosine, centroid, meanPairwiseCosine, twoMeans } from '../../src/core/vectorMath';
import { buildTimeline, TOTAL_WITH_STRUCTURE, TOTAL_ATTACH_ONLY } from '../../src/core/choreography';
import { detectCaptureType } from '../../src/capture/detectType';
import { buildGraph } from '../../src/graph/buildGraph';
import { runLayout } from '../../src/graph/layout';
import { fitToBounds, worldToScreen, screenToWorld, panToNode, lerpCamera, isOffScreen } from '../../src/graph/camera';
import { hitTest } from '../../src/graph/hitTest';
import { answerQuestion, isQuestion, REFUSAL } from '../../src/ask/scriptedAsk';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import answers from '../../seed/answers.json';
import type { GraphNode, GraphPayload, Memory, Source } from '../../src/core/types';

const payload = validateSeed(workspaceJson);
const graph = buildGraph(payload);

// ---------------------------------------------------------------- validateSeed

const minimal = {
  workspace: { id: 'ws_1', name: 'Demo', auto_reorganize: true },
  sources: [
    {
      id: 'src_1', type: 'text', title: 'T', raw_content: 'c',
      scene_description: null, url: null, image_path: null, created_at: '2026-05-01T00:00:00Z',
    },
  ],
  categories: [
    {
      id: 'cat_1', parent_id: null, name: 'AI Tooling', rationale: null,
      name_locked: false, user_created: false, x: 0, y: 0, pinned: false, created_by: 'ai',
    },
  ],
  memories: [
    {
      id: 'mem_1', source_id: 'src_1', text: 'Decided to drop LangChain for direct SDK calls',
      kind: 'decision', confidence: 0.9, category_id: 'cat_1', category_locked: false,
      entity_ids: [], vector: [1, 0, 0, 0, 0, 0, 0, 0],
      x: 10, y: 10, pinned: false, created_at: '2026-05-01T00:00:00Z',
    },
  ],
  entities: [],
  edges: [],
};

describe('validateSeed', () => {
  it('accepts a well-formed payload', () => {
    expect(validateSeed(minimal).memories[0]!.vector).toHaveLength(8);
  });

  it('rejects a memory pointing at a missing category', () => {
    expect(() =>
      validateSeed({ ...minimal, memories: [{ ...minimal.memories[0], category_id: 'nope' }] }),
    ).toThrow(SeedValidationError);
  });

  it('rejects a memory pointing at a missing source', () => {
    expect(() =>
      validateSeed({ ...minimal, memories: [{ ...minimal.memories[0], source_id: 'nope' }] }),
    ).toThrow(SeedValidationError);
  });

  it('rejects a taxonomy deeper than two levels', () => {
    const bad = {
      ...minimal,
      categories: [
        ...minimal.categories,
        { ...minimal.categories[0], id: 'cat_2', parent_id: 'cat_1' },
        { ...minimal.categories[0], id: 'cat_3', parent_id: 'cat_2' },
      ],
    };
    expect(() => validateSeed(bad)).toThrow(/two levels/);
  });

  /*
   * The invariant is agreement, not a number.
   *
   * This used to assert a fixed width, which made every change of embedder an
   * edit here — and the seed has now been 8 and 1024. What actually has to hold
   * is that no two vectors in one payload disagree: `cosine` walks `a.length`
   * with `?? 0`, so an 8-wide vector against a 1024-wide one returns a
   * plausible wrong number instead of failing, and a half-re-embedded corpus
   * would rank by nonsense while looking perfectly healthy.
   */
  it('rejects a payload whose vectors disagree about their width', () => {
    const [first] = minimal.memories;
    const bad = {
      ...minimal,
      memories: [first, { ...first, id: 'mem_odd', vector: [...first!.vector, 0.1] }],
    };
    expect(() => validateSeed(bad)).toThrow(/dimension/);
  });
});

// ---------------------------------------------------------------- vectorMath

const e = (i: number): number[] => {
  const v = new Array<number>(8).fill(0);
  v[i] = 1;
  return v;
};

describe('vectorMath', () => {
  it('cosine is 1 for identical and 0 for orthogonal vectors', () => {
    expect(cosine(e(0), e(0))).toBeCloseTo(1, 9);
    expect(cosine(e(0), e(1))).toBeCloseTo(0, 9);
  });

  it('centroid averages componentwise', () => {
    expect(centroid([e(0), e(1)])[0]).toBeCloseTo(0.5, 9);
  });

  it('meanPairwiseCosine is 1 for identical and 0 for orthogonal sets', () => {
    expect(meanPairwiseCosine([e(0), e(0), e(0)])).toBeCloseTo(1, 9);
    expect(meanPairwiseCosine([e(0), e(1), e(2)])).toBeCloseTo(0, 9);
  });

  it('twoMeans separates two obvious clusters', () => {
    const items = [
      { id: 'a1', vector: e(0) }, { id: 'a2', vector: e(0) }, { id: 'a3', vector: e(0) },
      { id: 'b1', vector: e(4) }, { id: 'b2', vector: e(4) },
    ];
    const { a, b } = twoMeans(items);
    const groups = [a.map((x) => x.id).sort(), b.map((x) => x.id).sort()].sort();
    expect(groups).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2']]);
  });

  it('twoMeans is deterministic across repeated runs', () => {
    const items = [
      { id: 'a', vector: e(0) }, { id: 'b', vector: e(1) },
      { id: 'c', vector: e(2) }, { id: 'd', vector: e(3) },
    ];
    const first = twoMeans(items).a.map((x) => x.id);
    for (let i = 0; i < 10; i++) {
      expect(twoMeans(items).a.map((x) => x.id)).toEqual(first);
    }
  });
});

// ---------------------------------------------------------------- buildGraph

describe('buildGraph', () => {
  it('creates one node per category, memory and entity', () => {
    expect(graph.nodes).toHaveLength(
      payload.categories.length + payload.memories.length + payload.entities.length,
    );
  });

  it('classifies categories by depth', () => {
    expect(graph.nodes.filter((n) => n.kind === 'parent_category')).toHaveLength(6);
    expect(graph.nodes.filter((n) => n.kind === 'child_category')).toHaveLength(14);
  });

  it('derives a contains edge per memory and per child category', () => {
    expect(graph.edges.filter((e2) => e2.kind === 'contains')).toHaveLength(
      payload.memories.length + 14,
    );
  });

  it('derives a mentions edge per memory-entity pair', () => {
    const expected = payload.memories.reduce((n, m) => n + m.entity_ids.length, 0);
    expect(graph.edges.filter((e2) => e2.kind === 'mentions')).toHaveLength(expected);
  });

  it('carries relates_to edges through unchanged', () => {
    expect(graph.edges.filter((e2) => e2.kind === 'relates_to')).toHaveLength(payload.edges.length);
  });

  it('sizes the largest parent category biggest', () => {
    const parents = graph.nodes
      .filter((n) => n.kind === 'parent_category')
      .sort((a, b) => b.radius - a.radius);
    expect(parents[0]!.label).toBe('Fundraising');
  });

  it('never emits a derived_from edge', () => {
    expect(graph.edges.some((e2) => (e2.kind as string) === 'derived_from')).toBe(false);
  });
});

// ---------------------------------------------------------------- layout

describe('runLayout', () => {
  it('produces identical positions across two runs (AC-13)', () => {
    const a = runLayout(graph.nodes, graph.edges);
    const b = runLayout(graph.nodes, graph.edges);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.x).toBeCloseTo(b[i]!.x, 6);
      expect(a[i]!.y).toBeCloseTo(b[i]!.y, 6);
    }
  });

  it('leaves seeded positions substantially intact', () => {
    const out = runLayout(graph.nodes, graph.edges);
    const drift = out.map((n, i) => Math.hypot(n.x - graph.nodes[i]!.x, n.y - graph.nodes[i]!.y));
    expect(drift.reduce((s, d) => s + d, 0) / drift.length).toBeLessThan(60);
  });

  it('never moves a pinned node', () => {
    const pinned = graph.nodes.map((n, i) => (i === 3 ? { ...n, pinned: true } : n));
    const out = runLayout(pinned, graph.edges);
    expect(out[3]!.x).toBeCloseTo(pinned[3]!.x, 6);
    expect(out[3]!.y).toBeCloseTo(pinned[3]!.y, 6);
  });

  it('does not mutate its input', () => {
    const before = graph.nodes.map((n) => ({ ...n }));
    runLayout(graph.nodes, graph.edges);
    expect(graph.nodes).toEqual(before);
  });

  it('places a node with no seeded position near its parent', () => {
    const parent = graph.nodes.find((n) => n.kind === 'parent_category')!;
    const orphan: GraphNode = {
      id: 'mem_new', kind: 'memory', label: 'x', x: 0, y: 0,
      radius: 6, pinned: false, parentId: parent.id,
    };
    const out = runLayout([...graph.nodes, orphan], graph.edges);
    const placed = out.find((n) => n.id === 'mem_new')!;
    expect(Math.hypot(placed.x - parent.x, placed.y - parent.y)).toBeLessThan(250);
  });
});

// ---------------------------------------------------------------- camera

const viewport = { w: 1000, h: 800 };
const node = (id: string, x: number, y: number): GraphNode => ({
  id, kind: 'memory', label: id, x, y, radius: 6, pinned: false, parentId: null,
});

describe('camera', () => {
  it('fits all nodes within the viewport', () => {
    const nodes = [node('a', -500, -400), node('b', 500, 400)];
    const cam = fitToBounds(nodes, viewport, 0.1);
    for (const n of nodes) {
      const { sx, sy } = worldToScreen(n, cam, viewport);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(viewport.w);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(viewport.h);
    }
  });

  it('centres the bounding box', () => {
    const cam = fitToBounds([node('a', 0, 0), node('b', 200, 200)], viewport, 0.1);
    const { sx, sy } = worldToScreen({ x: 100, y: 100 }, cam, viewport);
    expect(sx).toBeCloseTo(viewport.w / 2, 3);
    expect(sy).toBeCloseTo(viewport.h / 2, 3);
  });

  it('round-trips screen and world coordinates', () => {
    const cam = { x: 40, y: -20, zoom: 1.7 };
    const out = screenToWorld(worldToScreen({ x: 123, y: -45 }, cam, viewport), cam, viewport);
    expect(out.x).toBeCloseTo(123, 6);
    expect(out.y).toBeCloseTo(-45, 6);
  });

  it('pans without changing zoom (AC-20)', () => {
    const cam = { x: 0, y: 0, zoom: 1.3 };
    const out = panToNode(node('far', 3000, 3000), cam);
    expect(out.zoom).toBe(1.3);
    const { sx, sy } = worldToScreen({ x: 3000, y: 3000 }, out, viewport);
    expect(sx).toBeCloseTo(viewport.w / 2, 3);
    expect(sy).toBeCloseTo(viewport.h / 2, 3);
  });

  it('interpolates between cameras', () => {
    expect(lerpCamera({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 200, zoom: 2 }, 0.5)).toEqual({
      x: 50, y: 100, zoom: 1.5,
    });
  });

  it('detects an off-screen point', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    expect(isOffScreen({ x: 0, y: 0 }, cam, viewport)).toBe(false);
    expect(isOffScreen({ x: 5000, y: 0 }, cam, viewport)).toBe(true);
  });
});

// ---------------------------------------------------------------- hitTest

describe('hitTest', () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  const big: GraphNode = {
    id: 'cat', kind: 'parent_category', label: 'C', x: 0, y: 0,
    radius: 30, pinned: false, parentId: null,
  };
  const small: GraphNode = {
    id: 'mem', kind: 'memory', label: 'M', x: 0, y: 0,
    radius: 6, pinned: false, parentId: 'cat',
  };

  it('returns the node under the cursor', () => {
    expect(hitTest([big], camera, viewport, { sx: 500, sy: 400 })?.id).toBe('cat');
  });

  it('returns null on empty canvas', () => {
    expect(hitTest([big], camera, viewport, { sx: 50, sy: 50 })).toBeNull();
  });

  it('prefers the smaller node when two overlap', () => {
    expect(hitTest([big, small], camera, viewport, { sx: 500, sy: 400 })?.id).toBe('mem');
  });

  it('scales the hit radius with zoom', () => {
    expect(hitTest([big], { x: 0, y: 0, zoom: 2 }, viewport, { sx: 550, sy: 400 })?.id).toBe('cat');
    expect(hitTest([big], camera, viewport, { sx: 550, sy: 400 })).toBeNull();
  });
});

// ---------------------------------------------------------------- choreography

describe('buildTimeline', () => {
  it('matches the spec 8.4.5 offsets for a structural change', () => {
    expect(buildTimeline(true).map((s) => [s.phase, s.at])).toEqual([
      ['materialize', 0],
      ['travel', 200],
      ['pan', 1000],
      ['desaturate', 1000],
      ['transform', 1400],
      ['settle', 1900],
      ['banner', 2400],
    ]);
  });

  it('ends at 2400ms with a structural change and 1800ms without', () => {
    expect(TOTAL_WITH_STRUCTURE).toBe(2400);
    expect(TOTAL_ATTACH_ONLY).toBe(1800);
    expect(buildTimeline(false).map((s) => s.phase)).toEqual(['materialize', 'travel', 'settle']);
  });

  it('pans before the structural change renders (AC-20)', () => {
    const t = buildTimeline(true);
    expect(t.find((s) => s.phase === 'pan')!.at).toBeLessThan(
      t.find((s) => s.phase === 'transform')!.at,
    );
  });
});

// ---------------------------------------------------------------- detectType

describe('detectCaptureType', () => {
  it('detects a bare URL as a link (AC-2)', () => {
    expect(detectCaptureType({ text: 'https://example.com/post/1', hasImage: false }).type).toBe('link');
  });

  it('trims whitespace before deciding', () => {
    expect(detectCaptureType({ text: '  https://example.com  ', hasImage: false }).type).toBe('link');
  });

  it('treats text containing a URL as text and records it (AC-3)', () => {
    const r = detectCaptureType({
      text: 'Great thread on evals https://x.com/a/1 worth rereading',
      hasImage: false,
    });
    expect(r.type).toBe('text');
    expect(r.referencedUrls).toEqual(['https://x.com/a/1']);
  });

  it('detects an image as a screenshot (AC-4)', () => {
    expect(detectCaptureType({ text: '', hasImage: true }).type).toBe('screenshot');
    expect(detectCaptureType({ text: 'caption', hasImage: true }).type).toBe('screenshot');
  });

  it('defaults to text', () => {
    expect(detectCaptureType({ text: 'Decided to use Braintrust', hasImage: false }).type).toBe('text');
  });
});

// ---------------------------------------------------------------- scriptedAsk

const withDemo: GraphPayload = {
  ...payload,
  sources: [...payload.sources, demoItem.source as Source],
  memories: [...payload.memories, ...(demoItem.memories as unknown as Memory[])],
};

describe('isQuestion', () => {
  it('detects question words and question marks', () => {
    expect(isQuestion('What did we decide about our eval stack?')).toBe(true);
    expect(isQuestion('how are we pricing this')).toBe(true);
  });

  it('treats a short keyword as not a question', () => {
    expect(isQuestion('langchain')).toBe(false);
  });
});

describe('answerQuestion', () => {
  it('answers the demo question with citations (AC-33)', () => {
    const r = answerQuestion('What did we decide about our eval stack?', withDemo);
    expect(r.refused).toBe(false);
    expect(r.citations.length).toBeGreaterThanOrEqual(2);
    for (const sentence of r.answer.split(/(?<=\.)\s+/)) {
      expect(sentence).toMatch(/\[\d+\]/);
    }
  });

  it('resolves every citation to a real memory and source (AC-34)', () => {
    const memoryIds = new Set(withDemo.memories.map((m) => m.id));
    const sourceIds = new Set(withDemo.sources.map((s) => s.id));
    for (const entry of answers) {
      for (const c of entry.citations) {
        expect(memoryIds.has(c.memory_id), `missing memory ${c.memory_id}`).toBe(true);
        expect(sourceIds.has(c.source_id), `missing source ${c.source_id}`).toBe(true);
      }
    }
  });

  it('cites the just-added demo memory', () => {
    const r = answerQuestion('What did we decide about our eval stack?', withDemo);
    expect(r.citations.some((c) => c.memory_id === 'mem_demo_1')).toBe(true);
  });

  it('refuses when nothing matches, verbatim (AC-35, AC-37)', () => {
    const r = answerQuestion('What is the capital of France?', withDemo);
    expect(r.answer).toBe("I don't have anything saved about that yet.");
    expect(r.answer).toBe(REFUSAL);
    expect(r.citations).toHaveLength(0);
    expect(r.highlighted_node_ids).toHaveLength(0);
  });

  it('highlights cited memories and their categories (AC-36)', () => {
    const r = answerQuestion('What did we decide about our eval stack?', withDemo);
    for (const c of r.citations) expect(r.highlighted_node_ids).toContain(c.memory_id);
    const cat = withDemo.memories.find((m) => m.id === r.citations[0]!.memory_id)!.category_id;
    expect(r.highlighted_node_ids).toContain(cat);
  });
});

/**
 * An empty workspace is a legitimate state, not a malformed payload.
 *
 * The width check used to fail when there was no memory to take a width from,
 * which was safe while every payload came from the seed — and stopped being
 * safe the moment a personal instance could start with nothing in it. The API
 * returned a perfectly good empty graph and the app refused to boot on it.
 */
describe('validateSeed on an empty workspace', () => {
  const empty = {
    workspace: { id: 'ws_mine', name: 'Recall', auto_reorganize: true },
    sources: [],
    memories: [],
    categories: [],
    entities: [],
    edges: [],
  };

  it('accepts it', () => {
    expect(() => validateSeed(empty)).not.toThrow();
  });

  it('still refuses vectors that disagree once there are some', () => {
    const [first] = minimal.memories;
    expect(() =>
      validateSeed({
        ...minimal,
        memories: [first, { ...first, id: 'mem_odd', vector: [...first!.vector, 0.1] }],
      }),
    ).toThrow(/dimension/);
  });
});
