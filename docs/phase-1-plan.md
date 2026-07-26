# Recall Phase 1 — Seeded Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete 60-second YC demo — populated map, capture, deterministic SPLIT with full animation, and cited Ask — running entirely on committed seed data with zero backend code.

**Architecture:** A Vite + React + TypeScript SPA. All data comes from JSON files in `seed/` loaded through a single `DataSource` interface, so Phase 4 swaps the implementation and nothing else changes. The map is drawn on a 2D canvas with a `d3-force` layout that seeds from persisted positions and re-settles for only 30 ticks, guaranteeing identical layout across loads. The restructuring gates are **real geometry over real vectors** — the seed ships 8-dimensional hand-generated unit vectors instead of a similarity matrix, so `meanPairwiseCosine`, `twoMeans`, and `centroid` are genuine computations that Phase 4 will run unchanged on real embeddings.

**Tech Stack:** Vite · React 18 · TypeScript (strict) · Zustand · d3-force · Canvas 2D · Vitest + Testing Library · Playwright

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `docs/product-spec.md`.

- **Zero backend.** No server, no API calls, no database, no AI calls anywhere in Phase 1. All data is imported from `seed/*.json`.
- **Desktop-only.** Minimum viewport 1280×720. Below that render exactly: *"Recall is desktop-first. Please open on a larger screen."* No responsive reflow.
- **Canvas or WebGL for the map. Never SVG.** (spec §18 — SVG will not hold the eventual 30fps target.)
- **Dark ground only.** Canvas background `#0A0A0B`. No light mode.
- **Taxonomy is exactly two levels.** Parent categories and child categories. Memories attach to either. Deeper nesting is rejected.
- **Every memory has exactly one category.** No multi-assignment.
- **At most one structural operation per ingest.** (spec §8.4.3)
- **Animation total is 2.4s** from reorg trigger to banner appearance, with the exact per-step offsets in spec §8.4.5.
- **Gate thresholds are configuration constants**, exported from one module and overridable — never inlined at a call site. (spec §8.3, §8.4.2)
- **Banner copy templates are verbatim** from spec §8.4.5. SPLIT: `Split **{original}** into **{a}** and **{b}**`
- **Ask refusal string is verbatim and exact:** `I don't have anything saved about that yet.` (spec §9.2)
- **TypeScript strict mode.** No `any` in committed code.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`).

### Deviation from spec, applied throughout

Spec §12.1 specifies `seed/similarity.json` (a precomputed pairwise similarity matrix). **This plan replaces it with `seed/vectors.json`** — 8-dimensional unit vectors per memory. Rationale: a similarity matrix cannot support 2-means clustering or centroid computation, so the SPLIT gate would have to be faked in Phase 1 and rewritten in Phase 3. Low-dimensional vectors make the gate code real and final. Update spec §12.1 when this plan is executed.

### Phase 1 scope boundary

**Built:** app shell, left rail, Map canvas, Inspector (category + memory modes), capture bar, ghost node + ticker, all three reorg gates, SPLIT choreography, change banner, undo, Ask with scripted answers and citation highlighting.

**Not built in Phase 1** (deferred to Phase 2+, per `docs/spec-review-summary.md`): Tree view, Sources screen, Settings screen, instant Search mode, MERGE/PROMOTE *animations* (their gates are built and tested), proposal mode, drag-to-recategorize, offline flag, level-of-detail thresholds beyond a single memory-node cutoff, confidence bars.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/graph.ts` | Every shared type. The contract between all other modules. |
| `src/data/dataSource.ts` | `DataSource` interface + `SeedDataSource`. **The Phase 4 swap point.** |
| `src/data/validateSeed.ts` | Runtime validation of seed JSON against the type contract |
| `src/graph/buildGraph.ts` | `GraphPayload` → renderable nodes and edges |
| `src/graph/layout.ts` | d3-force wrapper with position seeding and fixed tick count |
| `src/graph/camera.ts` | Camera state, world↔screen transforms, fit/pan/fly |
| `src/graph/nodeStyles.ts` | Radii, colors, visibility rules. Single source of visual truth. |
| `src/graph/renderer.ts` | The canvas draw loop |
| `src/graph/hitTest.ts` | Screen point → node |
| `src/reorg/vectorMath.ts` | `cosine`, `centroid`, `meanPairwiseCosine`, `twoMeans` |
| `src/reorg/thresholds.ts` | Every gate constant |
| `src/reorg/gates.ts` | SPLIT / MERGE / PROMOTE evaluation and candidate scoring |
| `src/reorg/applyReorg.ts` | Mutates the payload, produces the `ReorgEvent` with before-state |
| `src/reorg/choreography.ts` | The 2.4s timeline as data |
| `src/ask/scriptedAsk.ts` | Question → seeded answer with citations |
| `src/store/workspaceStore.ts` | Graph data + mutations |
| `src/store/uiStore.ts` | Selection, highlight, camera target, capture state machine |
| `src/components/*` | React surfaces. One component per file. |
| `seed/*.json` | The demo's entire dataset |

Files that change together live together — `graph/` owns everything about drawing, `reorg/` owns everything about restructuring, and they communicate only through types in `types/graph.ts`.

---

## Task 1: Scaffold, type contract, and seed loading

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`
- Create: `src/types/graph.ts`
- Create: `src/data/validateSeed.ts`
- Create: `src/data/dataSource.ts`
- Create: `seed/workspace.json` (3-memory fixture — the full 47 arrive in Task 2)
- Test: `tests/unit/validateSeed.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: all types below, plus `validateSeed(raw: unknown): GraphPayload` (throws `SeedValidationError`) and `SeedDataSource.load(): Promise<GraphPayload>`

- [ ] **Step 1: Scaffold the project**

```bash
cd recall-mvp
npm create vite@latest . -- --template react-ts
npm install zustand d3-force
npm install -D vitest @testing-library/react @testing-library/user-event jsdom @vitest/coverage-v8
```

Replace `vite.config.ts` with:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
```

Add to `tsconfig.json` `compilerOptions`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"resolveJsonModule": true`.

Add `.gitignore`:

```
node_modules
dist
.DS_Store
```

- [ ] **Step 2: Write the type contract**

Create `src/types/graph.ts`:

```ts
export type SourceType = 'text' | 'link' | 'screenshot';
export type MemoryKind = 'fact' | 'decision' | 'opinion' | 'question' | 'task' | 'reference';
export type EntityKind =
  | 'person' | 'project' | 'organization' | 'tool' | 'concept' | 'decision' | 'question';
export type ReorgOperation = 'split' | 'merge' | 'promote' | 'new_category' | 'attach_only';

export interface Source {
  id: string;
  type: SourceType;
  title: string;
  raw_content: string;
  scene_description: string | null;
  url: string | null;
  image_path: string | null;
  created_at: string;
}

/**
 * The DB has a `memory_category` join table. The graph payload denormalizes it
 * onto the memory, because the frontend never needs the many-to-one shape.
 * `category_locked` mirrors `memory_category.locked`.
 */
export interface Memory {
  id: string;
  source_id: string;
  text: string;
  kind: MemoryKind;
  confidence: number;
  category_id: string;
  category_locked: boolean;
  entity_ids: string[];
  vector: number[];
  x: number | null;
  y: number | null;
  pinned: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  rationale: string | null;
  name_locked: boolean;
  user_created: boolean;
  x: number | null;
  y: number | null;
  pinned: boolean;
  created_by: 'ai' | 'user';
}

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  x: number | null;
  y: number | null;
  pinned: boolean;
}

export interface RelatesToEdge {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  similarity: number;
}

export interface GraphPayload {
  workspace: { id: string; name: string; auto_reorganize: boolean };
  sources: Source[];
  memories: Memory[];
  categories: Category[];
  entities: Entity[];
  edges: RelatesToEdge[];
}

export type NodeKind = 'parent_category' | 'child_category' | 'memory' | 'entity';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  radius: number;
  pinned: boolean;
  /** Parent category id for memories and child categories; null for roots and entities. */
  parentId: string | null;
}

export type EdgeKind = 'contains' | 'mentions' | 'relates_to';

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
}
```

Note: `Memory.vector` replaces the spec's separate `similarity.json` — see Global Constraints.

- [ ] **Step 3: Write the failing validation test**

Create `tests/unit/validateSeed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSeed, SeedValidationError } from '../../src/data/validateSeed';

const minimal = {
  workspace: { id: 'ws_1', name: 'Demo', auto_reorganize: true },
  sources: [{
    id: 'src_1', type: 'text', title: 'T', raw_content: 'c',
    scene_description: null, url: null, image_path: null, created_at: '2026-05-01T00:00:00Z',
  }],
  categories: [{
    id: 'cat_1', parent_id: null, name: 'AI Tooling', rationale: null,
    name_locked: false, user_created: false, x: 0, y: 0, pinned: false, created_by: 'ai',
  }],
  memories: [{
    id: 'mem_1', source_id: 'src_1', text: 'Decided to drop LangChain for direct SDK calls',
    kind: 'decision', confidence: 0.9, category_id: 'cat_1', category_locked: false,
    entity_ids: [], vector: [1, 0, 0, 0, 0, 0, 0, 0],
    x: 10, y: 10, pinned: false, created_at: '2026-05-01T00:00:00Z',
  }],
  entities: [],
  edges: [],
};

describe('validateSeed', () => {
  it('accepts a well-formed payload', () => {
    const payload = validateSeed(minimal);
    expect(payload.memories).toHaveLength(1);
    expect(payload.memories[0]!.vector).toHaveLength(8);
  });

  it('rejects a memory pointing at a missing category', () => {
    const bad = { ...minimal, memories: [{ ...minimal.memories[0], category_id: 'cat_nope' }] };
    expect(() => validateSeed(bad)).toThrow(SeedValidationError);
  });

  it('rejects a memory pointing at a missing source', () => {
    const bad = { ...minimal, memories: [{ ...minimal.memories[0], source_id: 'src_nope' }] };
    expect(() => validateSeed(bad)).toThrow(SeedValidationError);
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

  it('rejects a vector of the wrong dimension', () => {
    const bad = { ...minimal, memories: [{ ...minimal.memories[0], vector: [1, 0, 0] }] };
    expect(() => validateSeed(bad)).toThrow(/dimension/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/unit/validateSeed.test.ts`
Expected: FAIL — `Cannot find module '../../src/data/validateSeed'`

- [ ] **Step 5: Implement the validator**

Create `src/data/validateSeed.ts`:

```ts
import type { GraphPayload } from '../types/graph';

export const VECTOR_DIM = 8;

export class SeedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedValidationError';
  }
}

function fail(message: string): never {
  throw new SeedValidationError(message);
}

export function validateSeed(raw: unknown): GraphPayload {
  const p = raw as GraphPayload;
  if (!p || typeof p !== 'object') fail('seed is not an object');
  for (const key of ['sources', 'memories', 'categories', 'entities', 'edges'] as const) {
    if (!Array.isArray(p[key])) fail(`seed.${key} must be an array`);
  }

  const categoryIds = new Set(p.categories.map((c) => c.id));
  const sourceIds = new Set(p.sources.map((s) => s.id));
  const entityIds = new Set(p.entities.map((e) => e.id));

  for (const c of p.categories) {
    if (c.parent_id === null) continue;
    if (!categoryIds.has(c.parent_id)) fail(`category ${c.id} has unknown parent ${c.parent_id}`);
    const parent = p.categories.find((x) => x.id === c.parent_id)!;
    if (parent.parent_id !== null) fail(`category ${c.id} nests three deep — Recall keeps categories two levels deep`);
  }

  for (const m of p.memories) {
    if (!categoryIds.has(m.category_id)) fail(`memory ${m.id} has unknown category ${m.category_id}`);
    if (!sourceIds.has(m.source_id)) fail(`memory ${m.id} has unknown source ${m.source_id}`);
    if (m.vector.length !== VECTOR_DIM) {
      fail(`memory ${m.id} has vector dimension ${m.vector.length}, expected ${VECTOR_DIM}`);
    }
    for (const id of m.entity_ids) {
      if (!entityIds.has(id)) fail(`memory ${m.id} references unknown entity ${id}`);
    }
  }

  const memoryIds = new Set(p.memories.map((m) => m.id));
  for (const e of p.edges) {
    if (!memoryIds.has(e.source_memory_id) || !memoryIds.has(e.target_memory_id)) {
      fail(`edge ${e.id} references an unknown memory`);
    }
  }

  return p;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/validateSeed.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 7: Create the data source and a fixture seed**

Create `src/data/dataSource.ts`:

```ts
import type { GraphPayload } from '../types/graph';
import { validateSeed } from './validateSeed';
import workspaceJson from '../../seed/workspace.json';

/** Phase 4 replaces SeedDataSource with an ApiDataSource. Nothing else changes. */
export interface DataSource {
  load(): Promise<GraphPayload>;
}

export const SeedDataSource: DataSource = {
  async load() {
    return validateSeed(workspaceJson);
  },
};
```

Create `seed/workspace.json` containing exactly the `minimal` object from the Step 3 test. Task 2 replaces it wholesale.

- [ ] **Step 8: Commit**

```bash
git add package.json vite.config.ts tsconfig.json index.html .gitignore src seed tests
git commit -m "feat: scaffold project with type contract and seed validation"
```

---

## Task 2: Author the full seed workspace

This is a **content** task as much as an engineering one. The 47 memories must read as one real founder's accumulated knowledge — generic filler makes the entire demo feel fake, and this is on the critical path with nothing blocked behind it.

**Files:**
- Create: `scripts/generateVectors.ts`
- Modify: `seed/workspace.json` (full replacement)
- Test: `tests/unit/seedCondition.test.ts`

**Interfaces:**
- Consumes: `validateSeed`, `VECTOR_DIM` from Task 1
- Produces: the canonical `seed/workspace.json` — 47 memories, 22 sources, 6 parent + 14 child categories, 31 entities

- [ ] **Step 1: Author the content**

Write 22 sources and 47 memories following spec §12.3's distribution exactly:

| Parent | Children | Memories |
|---|---|---|
| Fundraising | Investor Notes · Pitch Feedback · Seed Benchmarks | 11 |
| **AI Tooling** | **(none — flat by design)** | **9** |
| Hiring | Engineering Hiring · Interview Loops | 7 |
| Product | Onboarding · Pricing · Design Systems | 8 |
| Go-to-Market | Content · Community | 6 |
| Personal Systems | Reading · Focus | 6 |

Source types: 9 `text`, 8 `link`, 5 `screenshot`. Every category must contain memories from at least two different source types.

Memory text rules from spec §10.2 — enforce while writing: 8–30 words, third person, self-contained, no unresolved pronouns. Examples of the required voice:

```
"Decided to drop LangChain in favor of direct Anthropic SDK calls for tool loops"
"Seed rounds at this stage are landing between $3M and $5M on $15M post"
"Braintrust is the current front-runner for eval tooling over Langfuse"
```

**Not** acceptable: `"They said it was better"` (unresolved pronoun), `"LangChain"` (not a claim), `"I think we should probably consider maybe using evals"` (first person, hedged, over-long).

The 9 `AI Tooling` memories must divide into two latent themes: **5 about agent frameworks and orchestration**, **4 about evaluation and observability**. Record which theme each belongs to in a comment block in `scripts/generateVectors.ts` — the vector generator needs it.

- [ ] **Step 2: Write the failing seed-condition test**

This test encodes spec §12.4 and is the guard on the entire demo. Create `tests/unit/seedCondition.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSeed } from '../../src/data/validateSeed';
import { meanPairwiseCosine, twoMeans } from '../../src/reorg/vectorMath';
import { SPLIT } from '../../src/reorg/thresholds';
import workspaceJson from '../../seed/workspace.json';

const payload = validateSeed(workspaceJson);
const aiTooling = payload.categories.find((c) => c.name === 'AI Tooling')!;
const aiMemories = payload.memories.filter((m) => m.category_id === aiTooling.id);

describe('seed workspace', () => {
  it('has the volumes specified in spec 12.2', () => {
    expect(payload.memories).toHaveLength(47);
    expect(payload.sources).toHaveLength(22);
    expect(payload.categories.filter((c) => c.parent_id === null)).toHaveLength(6);
    expect(payload.categories.filter((c) => c.parent_id !== null)).toHaveLength(14);
    expect(payload.entities).toHaveLength(31);
  });

  it('gives every node a hand-tuned position', () => {
    for (const m of payload.memories) expect(m.x).not.toBeNull();
    for (const c of payload.categories) expect(c.x).not.toBeNull();
  });

  it('holds AI Tooling one memory below the split threshold', () => {
    expect(aiMemories).toHaveLength(9);
    const cohesion = meanPairwiseCosine(aiMemories.map((m) => m.vector));
    // Above the gate: must NOT fire before the demo capture.
    expect(cohesion).toBeGreaterThan(SPLIT.MAX_MEAN_COHESION);
    expect(cohesion).toBeCloseTo(0.635, 2);
  });

  it('splits cleanly into a 5/4 latent structure', () => {
    const { a, b } = twoMeans(aiMemories.map((m) => ({ id: m.id, vector: m.vector })));
    expect([a.length, b.length].sort()).toEqual([4, 5]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/seedCondition.test.ts`
Expected: FAIL — `vectorMath` and `thresholds` do not exist yet, and the fixture has 1 memory.

> **Note:** this test depends on Task 9's modules. Implement `src/reorg/vectorMath.ts` and `src/reorg/thresholds.ts` now (they are pure and small — the code is given in Task 9 Step 3 and Step 5; copy it forward), or run this task after Task 9. The dependency is intentional: the seed is only correct relative to the gate math.

- [ ] **Step 4: Write the vector generator**

Create `scripts/generateVectors.ts`. It places memories on the unit sphere in themed clusters with a tunable spread, so the §12.4 cohesion targets are hit by construction rather than by hand-tuning 47 arrays.

```ts
/**
 * Generates deterministic 8-dim unit vectors for seed memories.
 * Each memory belongs to a theme; a theme has an anchor direction. A memory's
 * vector is its anchor plus deterministic jitter, normalized. Spread controls
 * within-theme cohesion, which is what the SPLIT gate measures.
 *
 * AI Tooling themes: 'ai-frameworks' (5 memories), 'ai-evals' (4 memories).
 * Demo item adds 2 more to 'ai-evals', dropping cohesion below the gate.
 */
const DIM = 8;

/** Deterministic PRNG — no Math.random anywhere, so output is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: number[]): number[] {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

function anchor(themeIndex: number): number[] {
  const v = new Array(DIM).fill(0);
  v[themeIndex % DIM] = 1;
  v[(themeIndex + 3) % DIM] = 0.35;
  return normalize(v);
}

export function generate(themeIndex: number, spread: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const base = anchor(themeIndex);
  return normalize(base.map((x) => x + (rand() - 0.5) * 2 * spread));
}
```

Tune two spread values against the tests: a within-theme spread, and the angular distance between the `ai-frameworks` and `ai-evals` anchors, until `meanPairwiseCosine` over the 9 `AI Tooling` memories lands at **0.635 ± 0.005**. Start with themes on adjacent axes and `spread = 0.30`.

- [ ] **Step 5: Generate and commit the seed**

Run the generator, write the vectors into `seed/workspace.json`, and hand-place `x`/`y` for every category and memory so the map opens in an art-directed composition — six parent clusters spread across roughly 1600×900 world units, none overlapping, `AI Tooling` slightly right of center where the demo camera will land.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/seedCondition.test.ts`
Expected: PASS, 4 tests. If cohesion is off target, adjust spread and regenerate — **do not edit vectors by hand.**

- [ ] **Step 7: Commit**

```bash
git add seed/workspace.json scripts/generateVectors.ts tests/unit/seedCondition.test.ts
git commit -m "feat: author full 47-memory seed workspace tuned to the split threshold"
```

---

## Task 3: Graph construction

**Files:**
- Create: `src/graph/buildGraph.ts`
- Create: `src/graph/nodeStyles.ts`
- Test: `tests/unit/buildGraph.test.ts`

**Interfaces:**
- Consumes: `GraphPayload`, `GraphNode`, `GraphEdge` (Task 1)
- Produces: `buildGraph(payload: GraphPayload): { nodes: GraphNode[]; edges: GraphEdge[] }` and `radiusFor(kind: NodeKind, memberCount: number): number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/buildGraph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/buildGraph';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';

const payload = validateSeed(workspaceJson);
const { nodes, edges } = buildGraph(payload);

describe('buildGraph', () => {
  it('creates one node per category, memory, and entity', () => {
    expect(nodes).toHaveLength(
      payload.categories.length + payload.memories.length + payload.entities.length,
    );
  });

  it('classifies categories by depth', () => {
    const parents = nodes.filter((n) => n.kind === 'parent_category');
    const children = nodes.filter((n) => n.kind === 'child_category');
    expect(parents).toHaveLength(6);
    expect(children).toHaveLength(14);
  });

  it('derives a contains edge for every memory and every child category', () => {
    const contains = edges.filter((e) => e.kind === 'contains');
    expect(contains).toHaveLength(payload.memories.length + 14);
  });

  it('derives a mentions edge per memory-entity pair', () => {
    const expected = payload.memories.reduce((n, m) => n + m.entity_ids.length, 0);
    expect(edges.filter((e) => e.kind === 'mentions')).toHaveLength(expected);
  });

  it('carries relates_to edges through unchanged', () => {
    expect(edges.filter((e) => e.kind === 'relates_to')).toHaveLength(payload.edges.length);
  });

  it('sizes parent categories by descendant memory count', () => {
    const byCount = nodes
      .filter((n) => n.kind === 'parent_category')
      .sort((a, b) => b.radius - a.radius);
    expect(byCount[0]!.label).toBe('Fundraising'); // 11 memories, the largest
  });

  it('never emits a derived_from edge', () => {
    expect(edges.some((e) => (e.kind as string) === 'derived_from')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/buildGraph.test.ts`
Expected: FAIL — `Cannot find module '../../src/graph/buildGraph'`

- [ ] **Step 3: Implement node styling**

Create `src/graph/nodeStyles.ts`:

```ts
import type { NodeKind } from '../types/graph';

export const COLORS = {
  background: '#0A0A0B',
  parentCategory: '#E8A33D',
  childCategory: '#B07C2E',
  memory: '#C9C9CE',
  entity: '#5B8FB0',
  edge: '#2A2A2E',
  edgeActive: '#E8A33D',
  label: '#E8E8EC',
  labelDim: '#7A7A82',
} as const;

/** Memory nodes only render above this zoom (spec 5.1 LOD, single cutoff in Phase 1). */
export const MEMORY_ZOOM_CUTOFF = 1.4;

export function radiusFor(kind: NodeKind, memberCount: number): number {
  switch (kind) {
    case 'parent_category':
      return Math.min(44, 28 + memberCount * 1.2);
    case 'child_category':
      return Math.min(28, 18 + memberCount * 0.9);
    case 'memory':
      return 6;
    case 'entity':
      return 10;
  }
}
```

- [ ] **Step 4: Implement graph construction**

Create `src/graph/buildGraph.ts`:

```ts
import type { GraphPayload, GraphNode, GraphEdge, NodeKind } from '../types/graph';
import { radiusFor } from './nodeStyles';

export function buildGraph(payload: GraphPayload): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const directCount = new Map<string, number>();
  for (const m of payload.memories) {
    directCount.set(m.category_id, (directCount.get(m.category_id) ?? 0) + 1);
  }

  const descendantCount = (categoryId: string): number => {
    const own = directCount.get(categoryId) ?? 0;
    const fromChildren = payload.categories
      .filter((c) => c.parent_id === categoryId)
      .reduce((n, c) => n + (directCount.get(c.id) ?? 0), 0);
    return own + fromChildren;
  };

  for (const c of payload.categories) {
    const kind: NodeKind = c.parent_id === null ? 'parent_category' : 'child_category';
    nodes.push({
      id: c.id,
      kind,
      label: c.name,
      x: c.x ?? 0,
      y: c.y ?? 0,
      radius: radiusFor(kind, descendantCount(c.id)),
      pinned: c.pinned,
      parentId: c.parent_id,
    });
    if (c.parent_id !== null) {
      edges.push({ id: `e_${c.parent_id}_${c.id}`, kind: 'contains', source: c.parent_id, target: c.id });
    }
  }

  for (const m of payload.memories) {
    nodes.push({
      id: m.id,
      kind: 'memory',
      label: m.text,
      x: m.x ?? 0,
      y: m.y ?? 0,
      radius: radiusFor('memory', 0),
      pinned: m.pinned,
      parentId: m.category_id,
    });
    edges.push({ id: `e_${m.category_id}_${m.id}`, kind: 'contains', source: m.category_id, target: m.id });
    for (const entityId of m.entity_ids) {
      edges.push({ id: `e_${m.id}_${entityId}`, kind: 'mentions', source: m.id, target: entityId });
    }
  }

  for (const e of payload.entities) {
    nodes.push({
      id: e.id,
      kind: 'entity',
      label: e.name,
      x: e.x ?? 0,
      y: e.y ?? 0,
      radius: radiusFor('entity', 0),
      pinned: e.pinned,
      parentId: null,
    });
  }

  for (const e of payload.edges) {
    edges.push({
      id: e.id, kind: 'relates_to', source: e.source_memory_id, target: e.target_memory_id,
    });
  }

  return { nodes, edges };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/buildGraph.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/graph tests/unit/buildGraph.test.ts
git commit -m "feat: derive renderable graph from seed payload"
```

---

## Task 4: Deterministic layout

The single most demo-critical non-visual behavior: **the map must look the same on every load** (AC-13).

**Files:**
- Create: `src/graph/layout.ts`
- Test: `tests/unit/layout.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge` (Task 1)
- Produces: `runLayout(nodes: GraphNode[], edges: GraphEdge[], opts?: { ticks?: number }): GraphNode[]` — returns new node objects, never mutates the input

- [ ] **Step 1: Write the failing test**

Create `tests/unit/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runLayout } from '../../src/graph/layout';
import { buildGraph } from '../../src/graph/buildGraph';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';

const { nodes, edges } = buildGraph(validateSeed(workspaceJson));

describe('runLayout', () => {
  it('produces identical positions across two runs (AC-13)', () => {
    const a = runLayout(nodes, edges);
    const b = runLayout(nodes, edges);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.x).toBeCloseTo(b[i]!.x, 6);
      expect(a[i]!.y).toBeCloseTo(b[i]!.y, 6);
    }
  });

  it('leaves seeded positions substantially intact', () => {
    const out = runLayout(nodes, edges);
    const drift = out.map((n, i) => Math.hypot(n.x - nodes[i]!.x, n.y - nodes[i]!.y));
    const mean = drift.reduce((s, d) => s + d, 0) / drift.length;
    expect(mean).toBeLessThan(40);
  });

  it('never moves a pinned node', () => {
    const pinned = nodes.map((n, i) => (i === 3 ? { ...n, pinned: true } : n));
    const out = runLayout(pinned, edges);
    expect(out[3]!.x).toBeCloseTo(pinned[3]!.x, 6);
    expect(out[3]!.y).toBeCloseTo(pinned[3]!.y, 6);
  });

  it('does not mutate its input', () => {
    const before = nodes.map((n) => ({ ...n }));
    runLayout(nodes, edges);
    expect(nodes).toEqual(before);
  });

  it('places a node with no seeded position near its parent', () => {
    const parent = nodes.find((n) => n.kind === 'parent_category')!;
    const orphan = { ...nodes[0]!, id: 'mem_new', kind: 'memory' as const, x: 0, y: 0, parentId: parent.id };
    const out = runLayout([...nodes, orphan], edges);
    const placed = out.find((n) => n.id === 'mem_new')!;
    expect(Math.hypot(placed.x - parent.x, placed.y - parent.y)).toBeLessThan(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/layout.test.ts`
Expected: FAIL — `Cannot find module '../../src/graph/layout'`

- [ ] **Step 3: Implement the layout**

Create `src/graph/layout.ts`:

```ts
import { forceSimulation, forceLink, forceManyBody, forceCollide } from 'd3-force';
import type { GraphNode, GraphEdge } from '../types/graph';

/** Short re-settle only. A full run would scramble the art-directed seed positions. */
const DEFAULT_TICKS = 30;

interface SimNode extends GraphNode { fx?: number; fy?: number; vx?: number; vy?: number; }

const chargeFor = (n: GraphNode): number => {
  switch (n.kind) {
    case 'parent_category': return -1400;
    case 'child_category': return -400;
    case 'entity': return -160;
    case 'memory': return -40;
  }
};

const linkDistanceFor = (kind: GraphEdge['kind']): number =>
  kind === 'contains' ? 60 : kind === 'mentions' ? 140 : 90;

export function runLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: { ticks?: number } = {},
): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const sim: SimNode[] = nodes.map((n) => {
    const copy: SimNode = { ...n, vx: 0, vy: 0 };
    if (n.pinned) { copy.fx = n.x; copy.fy = n.y; }
    // A node with no seeded position starts beside its parent, deterministically.
    if (n.x === 0 && n.y === 0 && n.parentId) {
      const parent = byId.get(n.parentId);
      if (parent) {
        const angle = (hashToUnit(n.id) * Math.PI * 2);
        copy.x = parent.x + Math.cos(angle) * 70;
        copy.y = parent.y + Math.sin(angle) * 70;
      }
    }
    return copy;
  });

  const simEdges = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ ...e }));

  const simulation = forceSimulation(sim)
    .force('link', forceLink(simEdges).id((d: SimNode) => d.id)
      .distance((d: GraphEdge) => linkDistanceFor(d.kind)).strength(0.4))
    .force('charge', forceManyBody().strength((d: SimNode) => chargeFor(d)))
    .force('collide', forceCollide<SimNode>().radius((d) => d.radius + 4))
    .velocityDecay(0.55)
    .stop();

  simulation.tick(opts.ticks ?? DEFAULT_TICKS);

  return sim.map((n) => ({
    id: n.id, kind: n.kind, label: n.label,
    x: round(n.x), y: round(n.y),
    radius: n.radius, pinned: n.pinned, parentId: n.parentId,
  }));
}

/** Stable per-id value in [0,1). Replaces Math.random so layout is reproducible. */
function hashToUnit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/layout.test.ts`
Expected: PASS, 5 tests. If run-to-run determinism fails, the cause is `Math.random` reaching the simulation — d3-force's default `initializeNodes` only randomizes nodes whose `x`/`y` are `NaN`, so ensure every node has a numeric position before the simulation is constructed.

- [ ] **Step 5: Commit**

```bash
git add src/graph/layout.ts tests/unit/layout.test.ts
git commit -m "feat: deterministic force layout seeded from persisted positions"
```

---

## Task 5: Camera and canvas renderer

**Files:**
- Create: `src/graph/camera.ts`
- Create: `src/graph/renderer.ts`
- Create: `src/components/MapCanvas.tsx`
- Test: `tests/unit/camera.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge`, `COLORS`, `MEMORY_ZOOM_CUTOFF`
- Produces:
  - `interface Camera { x: number; y: number; zoom: number }`
  - `fitToBounds(nodes: GraphNode[], viewport: { w: number; h: number }, padding?: number): Camera`
  - `worldToScreen(p, camera, viewport): { sx: number; sy: number }`
  - `screenToWorld(p, camera, viewport): { x: number; y: number }`
  - `lerpCamera(from: Camera, to: Camera, t: number): Camera`
  - `panToNode(node, camera, viewport): Camera` — changes `x`/`y` only, never `zoom`
  - `drawFrame(ctx, { nodes, edges, camera, viewport, hoveredId, selectedId, highlightedIds, dimmed })`

- [ ] **Step 1: Write the failing camera test**

Create `tests/unit/camera.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fitToBounds, worldToScreen, screenToWorld, panToNode, lerpCamera } from '../../src/graph/camera';
import type { GraphNode } from '../../src/types/graph';

const viewport = { w: 1000, h: 800 };
const node = (id: string, x: number, y: number): GraphNode =>
  ({ id, kind: 'memory', label: id, x, y, radius: 6, pinned: false, parentId: null });

describe('camera', () => {
  it('fits all nodes within the viewport with padding', () => {
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
    const out = panToNode(node('far', 3000, 3000), cam, viewport);
    expect(out.zoom).toBe(1.3);
    const { sx, sy } = worldToScreen({ x: 3000, y: 3000 }, out, viewport);
    expect(sx).toBeCloseTo(viewport.w / 2, 3);
    expect(sy).toBeCloseTo(viewport.h / 2, 3);
  });

  it('interpolates between cameras', () => {
    const mid = lerpCamera({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 200, zoom: 2 }, 0.5);
    expect(mid).toEqual({ x: 50, y: 100, zoom: 1.5 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/camera.test.ts`
Expected: FAIL — `Cannot find module '../../src/graph/camera'`

- [ ] **Step 3: Implement the camera**

Create `src/graph/camera.ts`:

```ts
import type { GraphNode } from '../types/graph';

export interface Camera { x: number; y: number; zoom: number }
export interface Viewport { w: number; h: number }
export interface Point { x: number; y: number }

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

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
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  const zoom = clampZoom(Math.min(v.w / (w * (1 + padding * 2)), v.h / (h * (1 + padding * 2))));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom };
}

export function panToNode(node: Point, c: Camera, _v: Viewport): Camera {
  return { x: node.x, y: node.y, zoom: c.zoom };
}

export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    zoom: from.zoom + (to.zoom - from.zoom) * t,
  };
}

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/camera.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Implement the renderer**

Create `src/graph/renderer.ts`. Draw order is edges → nodes → labels, so labels are never occluded.

```ts
import type { GraphNode, GraphEdge } from '../types/graph';
import { COLORS, MEMORY_ZOOM_CUTOFF } from './nodeStyles';
import { worldToScreen, type Camera, type Viewport } from './camera';

export interface FrameState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  camera: Camera;
  viewport: Viewport;
  hoveredId: string | null;
  selectedId: string | null;
  /** When non-empty, these render at full opacity and everything else dims. */
  highlightedIds: string[];
  /** Opacity applied to non-highlighted elements. Spec 5.6 uses 0.15. */
  dimOpacity: number;
}

export function drawFrame(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const { camera, viewport } = s;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const visible = (n: GraphNode): boolean =>
    n.kind !== 'memory' || camera.zoom >= MEMORY_ZOOM_CUTOFF || s.highlightedIds.includes(n.id);

  const highlighting = s.highlightedIds.length > 0;
  const alphaFor = (id: string): number =>
    !highlighting || s.highlightedIds.includes(id) ? 1 : s.dimOpacity;

  for (const e of s.edges) {
    const a = byId.get(e.source), b = byId.get(e.target);
    if (!a || !b || !visible(a) || !visible(b)) continue;
    const active = s.hoveredId === a.id || s.hoveredId === b.id;
    ctx.globalAlpha = Math.min(alphaFor(a.id), alphaFor(b.id)) * (active ? 1 : 0.5);
    ctx.strokeStyle = active ? COLORS.edgeActive : COLORS.edge;
    ctx.lineWidth = e.kind === 'relates_to' ? 1.5 : 1;
    ctx.setLineDash(e.kind === 'mentions' ? [3, 3] : []);
    const p1 = worldToScreen(a, camera, viewport), p2 = worldToScreen(b, camera, viewport);
    ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const n of s.nodes) {
    if (!visible(n)) continue;
    const { sx, sy } = worldToScreen(n, camera, viewport);
    const hovered = s.hoveredId === n.id;
    const r = n.radius * camera.zoom * (hovered ? 1.15 : 1);
    ctx.globalAlpha = alphaFor(n.id);
    ctx.fillStyle = colorFor(n);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    if (s.selectedId === n.id) {
      ctx.strokeStyle = COLORS.label; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.font = '13px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const n of s.nodes) {
    if (n.kind === 'memory' || n.kind === 'entity') continue;
    if (n.kind === 'child_category' && camera.zoom < 0.6) continue;
    const { sx, sy } = worldToScreen(n, camera, viewport);
    ctx.globalAlpha = alphaFor(n.id);
    ctx.fillStyle = s.hoveredId === n.id ? COLORS.label : COLORS.labelDim;
    ctx.fillText(n.label, sx, sy + n.radius * camera.zoom + 16);
  }
  ctx.globalAlpha = 1;
}

function colorFor(n: GraphNode): string {
  switch (n.kind) {
    case 'parent_category': return COLORS.parentCategory;
    case 'child_category': return COLORS.childCategory;
    case 'memory': return COLORS.memory;
    case 'entity': return COLORS.entity;
  }
}
```

- [ ] **Step 6: Mount the canvas**

Create `src/components/MapCanvas.tsx`. It owns the canvas element, device-pixel-ratio scaling, and a `requestAnimationFrame` loop that calls `drawFrame`. Wire it to render the seed workspace with `fitToBounds`, animated over 800ms from 15% zoomed out (spec §5.1 default camera).

```tsx
import { useEffect, useRef } from 'react';
import { drawFrame } from '../graph/renderer';
import { fitToBounds, lerpCamera, easeInOutCubic, type Camera } from '../graph/camera';
import type { GraphNode, GraphEdge } from '../types/graph';

export function MapCanvas({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const start = performance.now();

    const loop = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const viewport = { w: canvas.clientWidth, h: canvas.clientHeight };
      canvas.width = viewport.w * dpr;
      canvas.height = viewport.h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = fitToBounds(nodes, viewport, 0.1);
      if (!cameraRef.current) {
        const t = Math.min(1, (now - start) / 800);
        cameraRef.current = lerpCamera({ ...target, zoom: target.zoom * 0.85 }, target, easeInOutCubic(t));
        if (t >= 1) cameraRef.current = target;
      }
      drawFrame(ctx, {
        nodes, edges, camera: cameraRef.current, viewport,
        hoveredId: null, selectedId: null, highlightedIds: [], dimOpacity: 0.15,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
```

- [ ] **Step 7: Verify visually**

Run: `npm run dev` and open the app.
Expected: 47 memories in 6 labelled clusters on a near-black ground, settling into a fit view. Memory dots hidden at the default zoom; labels legible; nothing overlapping.

- [ ] **Step 8: Commit**

```bash
git add src/graph/camera.ts src/graph/renderer.ts src/components/MapCanvas.tsx tests/unit/camera.test.ts
git commit -m "feat: canvas renderer and camera with fit-to-bounds entry animation"
```

---

## Task 6: Pointer interaction and selection

**Files:**
- Create: `src/graph/hitTest.ts`
- Create: `src/store/uiStore.ts`
- Modify: `src/components/MapCanvas.tsx`
- Test: `tests/unit/hitTest.test.ts`

**Interfaces:**
- Consumes: `Camera`, `Viewport`, `worldToScreen`, `GraphNode`
- Produces:
  - `hitTest(nodes: GraphNode[], camera: Camera, viewport: Viewport, screen: { sx: number; sy: number }): GraphNode | null`
  - `useUiStore` with `{ hoveredId, selectedId, highlightedIds, camera, setHovered, select, clearSelection, setHighlight, setCamera }`

- [ ] **Step 1: Write the failing hit-test test**

Create `tests/unit/hitTest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hitTest } from '../../src/graph/hitTest';
import type { GraphNode } from '../../src/types/graph';

const viewport = { w: 1000, h: 800 };
const camera = { x: 0, y: 0, zoom: 1 };
const big: GraphNode = { id: 'cat', kind: 'parent_category', label: 'C', x: 0, y: 0, radius: 30, pinned: false, parentId: null };
const small: GraphNode = { id: 'mem', kind: 'memory', label: 'M', x: 0, y: 0, radius: 6, pinned: false, parentId: 'cat' };

describe('hitTest', () => {
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
    const zoomed = { x: 0, y: 0, zoom: 2 };
    expect(hitTest([big], zoomed, viewport, { sx: 500 + 50, sy: 400 })?.id).toBe('cat');
    expect(hitTest([big], camera, viewport, { sx: 500 + 50, sy: 400 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/hitTest.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement hit testing**

Create `src/graph/hitTest.ts`:

```ts
import type { GraphNode } from '../types/graph';
import { worldToScreen, type Camera, type Viewport } from './camera';

/** Minimum clickable radius in screen pixels — small memory dots need a forgiving target. */
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
    // Smallest node wins, so a memory sitting on its category is still clickable.
    if (n.radius < bestRadius) { best = n; bestRadius = n.radius; }
  }
  return best;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/hitTest.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Implement the UI store**

Create `src/store/uiStore.ts`:

```ts
import { create } from 'zustand';
import type { Camera } from '../graph/camera';

export type CaptureStage = 'idle' | 'reading' | 'extracting' | 'connecting' | 'reorganizing';

interface UiState {
  hoveredId: string | null;
  selectedId: string | null;
  highlightedIds: string[];
  camera: Camera | null;
  captureOpen: boolean;
  askOpen: boolean;
  captureStage: CaptureStage;
  setHovered: (id: string | null) => void;
  select: (id: string | null) => void;
  clearSelection: () => void;
  setHighlight: (ids: string[]) => void;
  setCamera: (c: Camera) => void;
  setCaptureOpen: (open: boolean) => void;
  setAskOpen: (open: boolean) => void;
  setCaptureStage: (s: CaptureStage) => void;
}

export const useUiStore = create<UiState>((set) => ({
  hoveredId: null,
  selectedId: null,
  highlightedIds: [],
  camera: null,
  captureOpen: false,
  askOpen: false,
  captureStage: 'idle',
  setHovered: (hoveredId) => set({ hoveredId }),
  select: (selectedId) => set({ selectedId }),
  clearSelection: () => set({ selectedId: null, highlightedIds: [] }),
  setHighlight: (highlightedIds) => set({ highlightedIds }),
  setCamera: (camera) => set({ camera }),
  setCaptureOpen: (captureOpen) => set({ captureOpen }),
  setAskOpen: (askOpen) => set({ askOpen }),
  setCaptureStage: (captureStage) => set({ captureStage }),
}));
```

- [ ] **Step 6: Wire pointer events into `MapCanvas`**

Add to `MapCanvas.tsx`: `onPointerMove` → `hitTest` → `setHovered`; `onClick` → `hitTest` → `select` or `clearSelection` on empty canvas; `onWheel` → cursor-anchored zoom clamped to `[0.25, 3]`; `onPointerDown`/`Move`/`Up` → pan. Read `hoveredId`, `selectedId`, `highlightedIds` from `useUiStore` and pass them into `drawFrame`.

Cursor-anchored zoom: convert the cursor to world coordinates before applying the new zoom, then set `camera.x`/`y` so the same world point stays under the cursor.

- [ ] **Step 7: Verify visually**

Run: `npm run dev`
Expected: hovering a category dims unconnected elements and brightens its edges; clicking selects with a ring; scrolling zooms toward the cursor; memory dots appear past zoom 1.4; dragging pans.

- [ ] **Step 8: Commit**

```bash
git add src/graph/hitTest.ts src/store/uiStore.ts src/components/MapCanvas.tsx tests/unit/hitTest.test.ts
git commit -m "feat: hover, select, pan, and cursor-anchored zoom on the map"
```

---

## Task 7: App shell, left rail, and Inspector

**Files:**
- Create: `src/components/AppShell.tsx`, `src/components/LeftRail.tsx`
- Create: `src/components/Inspector/Inspector.tsx`, `CategoryDetail.tsx`, `MemoryDetail.tsx`, `EmptyDetail.tsx`
- Create: `src/store/workspaceStore.ts`
- Create: `src/styles/theme.css`
- Modify: `src/App.tsx`
- Test: `tests/unit/Inspector.test.tsx`

**Interfaces:**
- Consumes: `useUiStore`, `GraphPayload`, `SeedDataSource`
- Produces: `useWorkspaceStore` with `{ payload, nodes, edges, load, applyPayload }`

- [ ] **Step 1: Write the failing Inspector test**

Create `tests/unit/Inspector.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Inspector } from '../../src/components/Inspector/Inspector';
import { useUiStore } from '../../src/store/uiStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';

beforeEach(async () => {
  await useWorkspaceStore.getState().load();
  useUiStore.setState({ selectedId: null, highlightedIds: [] });
});

describe('Inspector', () => {
  it('shows workspace stats when nothing is selected', () => {
    render(<Inspector />);
    expect(screen.getByText('47 memories')).toBeInTheDocument();
    expect(screen.getByText('22 sources')).toBeInTheDocument();
  });

  it('shows a category with its memory list when selected', () => {
    const cat = useWorkspaceStore.getState().payload!.categories.find((c) => c.name === 'AI Tooling')!;
    useUiStore.setState({ selectedId: cat.id });
    render(<Inspector />);
    expect(screen.getByRole('heading', { name: 'AI Tooling' })).toBeInTheDocument();
    expect(screen.getByText('9 memories')).toBeInTheDocument();
  });

  it('shows a memory with its source when selected', () => {
    const mem = useWorkspaceStore.getState().payload!.memories[0]!;
    useUiStore.setState({ selectedId: mem.id });
    render(<Inspector />);
    expect(screen.getByText(mem.text)).toBeInTheDocument();
    expect(screen.getByTestId('source-card')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/Inspector.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the workspace store**

Create `src/store/workspaceStore.ts`:

```ts
import { create } from 'zustand';
import type { GraphPayload, GraphNode, GraphEdge } from '../types/graph';
import { SeedDataSource } from '../data/dataSource';
import { buildGraph } from '../graph/buildGraph';
import { runLayout } from '../graph/layout';

interface WorkspaceState {
  payload: GraphPayload | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  load: () => Promise<void>;
  applyPayload: (payload: GraphPayload) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  payload: null,
  nodes: [],
  edges: [],
  load: async () => {
    const payload = await SeedDataSource.load();
    const { nodes, edges } = buildGraph(payload);
    set({ payload, nodes: runLayout(nodes, edges), edges });
  },
  applyPayload: (payload) => {
    const { nodes, edges } = buildGraph(payload);
    set({ payload, nodes: runLayout(nodes, edges), edges });
  },
}));
```

- [ ] **Step 4: Implement the shell, rail, and Inspector**

`AppShell.tsx` renders the three regions from spec §5.0: 56px left rail, flexible canvas, 360px Inspector. Below 1280px viewport width it renders only the text `Recall is desktop-first. Please open on a larger screen.`

`LeftRail.tsx`: Recall mark, Map icon (active), Ask icon, Settings icon at the bottom. Tree, Sources, and Settings icons render disabled with a tooltip reading `Coming in Phase 2` — they are outside Phase 1 scope but their absence would look broken.

`Inspector.tsx` switches on `selectedId`: a category id renders `CategoryDetail`, a memory id renders `MemoryDetail`, `null` renders `EmptyDetail` (workspace stats: `{n} memories`, `{n} sources`, `{n} categories`).

`CategoryDetail.tsx`: heading with the name, breadcrumb path, `{n} memories`, and the memory list newest-first with source-type icon and 2-line clamp.

`MemoryDetail.tsx`: full memory text as the largest text in the panel, entity chips grouped by kind, and a source card with `data-testid="source-card"`.

`theme.css`: `--bg: #0A0A0B`, `--accent: #E8A33D`, `--text: #E8E8EC`, `--text-dim: #7A7A82`. No borders, no cards — separation from spacing only. One font family.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/Inspector.test.tsx`
Expected: PASS, 3 tests

- [ ] **Step 6: Verify the 30-second path**

Run: `npm run dev`
Expected: the app opens onto the populated map in under 1.5s; hovering `Fundraising` highlights it; clicking `Investor Notes` opens the Inspector with mixed source-type icons. **This is demo beat 1, complete.**

- [ ] **Step 7: Commit**

```bash
git add src/components src/store/workspaceStore.ts src/styles src/App.tsx tests/unit/Inspector.test.tsx
git commit -m "feat: app shell, left rail, and contextual inspector"
```

---

## Task 8: Capture bar

**Files:**
- Create: `src/components/CommandBar/CommandBar.tsx`, `CaptureMode.tsx`
- Create: `src/capture/detectType.ts`
- Create: `src/hooks/useKeyboard.ts`
- Test: `tests/unit/detectType.test.ts`

**Interfaces:**
- Consumes: `useUiStore`
- Produces: `detectCaptureType(input: { text: string; hasImage: boolean }): { type: SourceType; referencedUrls: string[] }`

- [ ] **Step 1: Write the failing type-detection test**

Create `tests/unit/detectType.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectCaptureType } from '../../src/capture/detectType';

describe('detectCaptureType', () => {
  it('detects a bare URL as a link (AC-2)', () => {
    const r = detectCaptureType({ text: 'https://example.com/post/1', hasImage: false });
    expect(r.type).toBe('link');
  });

  it('trims whitespace before deciding', () => {
    expect(detectCaptureType({ text: '  https://example.com  ', hasImage: false }).type).toBe('link');
  });

  it('treats text containing a URL as text and records it (AC-3)', () => {
    const r = detectCaptureType({ text: 'Great thread on evals https://x.com/a/1 worth rereading', hasImage: false });
    expect(r.type).toBe('text');
    expect(r.referencedUrls).toEqual(['https://x.com/a/1']);
  });

  it('detects an image as a screenshot (AC-4)', () => {
    expect(detectCaptureType({ text: '', hasImage: true }).type).toBe('screenshot');
  });

  it('prefers screenshot when an image accompanies text', () => {
    expect(detectCaptureType({ text: 'some caption', hasImage: true }).type).toBe('screenshot');
  });

  it('defaults to text', () => {
    expect(detectCaptureType({ text: 'Decided to use Braintrust', hasImage: false }).type).toBe('text');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/detectType.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement detection**

Create `src/capture/detectType.ts`:

```ts
import type { SourceType } from '../types/graph';

const URL_RE = /https?:\/\/[^\s]+/g;

export function detectCaptureType(
  input: { text: string; hasImage: boolean },
): { type: SourceType; referencedUrls: string[] } {
  if (input.hasImage) return { type: 'screenshot', referencedUrls: [] };

  const trimmed = input.text.trim();
  const matches = trimmed.match(URL_RE) ?? [];

  // A bare URL — the entire content is one link — is the only thing we fetch.
  if (matches.length === 1 && matches[0] === trimmed) {
    return { type: 'link', referencedUrls: [] };
  }
  return { type: 'text', referencedUrls: matches };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/detectType.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Implement the capture bar and keyboard hook**

`CommandBar.tsx`: a centered 640px modal with a backdrop that blurs and dims the map to 30% opacity. `CaptureMode.tsx` renders the textarea, the auto-detected type chip (`Text` / `Link` / `Screenshot`), and the `⏎ to add` hint. `⏎` submits; `⇧⏎` inserts a newline; `Esc` closes.

`useKeyboard.ts` binds the Phase 1 subset of spec §6.1: `⌘K` capture, `⌘/` ask, `⌘Z` undo, `Esc` close→clear-highlight→clear-selection in that order, `Space` fit-to-bounds. Single-letter shortcuts are suppressed while a text input has focus. Bind `⌘V` on the document to open the capture bar pre-filled from the clipboard, including image items.

The modal closes immediately on submit — processing renders on the map (Task 11), never in the modal.

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, press `⌘K`, paste a URL.
Expected: the modal opens over a dimmed map, the chip flips to `Link` as the URL is pasted, and `⏎` closes it.

- [ ] **Step 7: Commit**

```bash
git add src/components/CommandBar src/capture src/hooks/useKeyboard.ts tests/unit/detectType.test.ts
git commit -m "feat: capture bar with automatic input type detection"
```

---

## Task 9: Restructuring gates

The product's central mechanism. **Geometry decides whether to restructure; the model only names the result.** All three gates are built here even though only SPLIT animates in Phase 1 — AC-18 ("exactly one operation, never two") is untestable with a single operation type.

**Files:**
- Create: `src/reorg/vectorMath.ts`, `src/reorg/thresholds.ts`, `src/reorg/gates.ts`
- Test: `tests/unit/vectorMath.test.ts`, `tests/unit/gates.test.ts`

**Interfaces:**
- Consumes: `GraphPayload`, `Category`, `Memory`
- Produces:
  - `cosine(a: number[], b: number[]): number`
  - `centroid(vectors: number[][]): number[]`
  - `meanPairwiseCosine(vectors: number[][]): number`
  - `twoMeans<T extends { id: string; vector: number[] }>(items: T[]): { a: T[]; b: T[]; separation: number }`
  - `SPLIT`, `MERGE`, `PROMOTE`, `ASSIGN` threshold objects
  - `evaluateReorg(payload: GraphPayload, touchedCategoryIds: string[]): ReorgCandidate | null`
  - `interface ReorgCandidate { operation: 'split' | 'merge' | 'promote'; categoryIds: string[]; clusters?: { a: string[]; b: string[] }; score: number }`

- [ ] **Step 1: Write the failing vector-math test**

Create `tests/unit/vectorMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cosine, centroid, meanPairwiseCosine, twoMeans } from '../../src/reorg/vectorMath';

const e = (i: number): number[] => { const v = new Array(8).fill(0); v[i] = 1; return v; };

describe('vectorMath', () => {
  it('cosine is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosine(e(0), e(0))).toBeCloseTo(1, 9);
    expect(cosine(e(0), e(1))).toBeCloseTo(0, 9);
  });

  it('centroid averages componentwise', () => {
    expect(centroid([e(0), e(1)])[0]).toBeCloseTo(0.5, 9);
  });

  it('meanPairwiseCosine of identical vectors is 1', () => {
    expect(meanPairwiseCosine([e(0), e(0), e(0)])).toBeCloseTo(1, 9);
  });

  it('meanPairwiseCosine of orthogonal vectors is 0', () => {
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

  it('twoMeans is deterministic across runs', () => {
    const items = [
      { id: 'a', vector: e(0) }, { id: 'b', vector: e(1) },
      { id: 'c', vector: e(2) }, { id: 'd', vector: e(3) },
    ];
    const first = twoMeans(items).a.map((x) => x.id);
    for (let i = 0; i < 10; i++) expect(twoMeans(items).a.map((x) => x.id)).toEqual(first);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/vectorMath.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement vector math**

Create `src/reorg/vectorMath.ts`. Initialization uses the two mutually most-distant items, not random seeding — reproducibility is a hard requirement.

```ts
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function centroid(vectors: number[][]): number[] {
  const dim = vectors[0]?.length ?? 0;
  const out = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += (v[i] ?? 0) / vectors.length;
  return out;
}

export function meanPairwiseCosine(vectors: number[][]): number {
  if (vectors.length < 2) return 1;
  let total = 0, pairs = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      total += cosine(vectors[i]!, vectors[j]!); pairs++;
    }
  }
  return total / pairs;
}

export interface Clusterable { id: string; vector: number[] }

/** 2-means with deterministic seeding: the two most mutually distant items. */
export function twoMeans<T extends Clusterable>(items: T[]): { a: T[]; b: T[]; separation: number } {
  if (items.length < 2) return { a: items, b: [], separation: 0 };

  let seedA = items[0]!, seedB = items[1]!, worst = Infinity;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const s = cosine(items[i]!.vector, items[j]!.vector);
      if (s < worst) { worst = s; seedA = items[i]!; seedB = items[j]!; }
    }
  }

  let ca = seedA.vector, cb = seedB.vector;
  let a: T[] = [], b: T[] = [];
  for (let iter = 0; iter < 50; iter++) {
    a = []; b = [];
    for (const item of items) {
      (cosine(item.vector, ca) >= cosine(item.vector, cb) ? a : b).push(item);
    }
    if (a.length === 0 || b.length === 0) break;
    const na = centroid(a.map((x) => x.vector));
    const nb = centroid(b.map((x) => x.vector));
    if (cosine(na, ca) > 0.9999 && cosine(nb, cb) > 0.9999) { ca = na; cb = nb; break; }
    ca = na; cb = nb;
  }

  return { a, b, separation: 1 - cosine(ca, cb) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/vectorMath.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Define thresholds**

Create `src/reorg/thresholds.ts`. Every value is spec §8.3 / §8.4.2 verbatim, in one place, overridable by env.

```ts
const num = (key: string, fallback: number): number => {
  const raw = import.meta.env?.[key];
  return raw === undefined ? fallback : Number(raw);
};

export const SPLIT = {
  MIN_MEMORIES: num('VITE_SPLIT_MIN_MEMORIES', 8),
  MAX_MEAN_COHESION: num('VITE_SPLIT_MAX_COHESION', 0.62),
  MIN_CLUSTER_SIZE: num('VITE_SPLIT_MIN_CLUSTER', 3),
  MIN_SEPARATION: num('VITE_SPLIT_MIN_SEPARATION', 0.15),
} as const;

export const MERGE = {
  MIN_CENTROID_SIMILARITY: num('VITE_MERGE_MIN_SIM', 0.86),
  MAX_COMBINED_MEMORIES: num('VITE_MERGE_MAX_COMBINED', 12),
} as const;

export const PROMOTE = {
  MIN_MEMORIES: num('VITE_PROMOTE_MIN_MEMORIES', 12),
  MAX_PARENT_SIMILARITY: num('VITE_PROMOTE_MAX_PARENT_SIM', 0.5),
} as const;

export const ASSIGN = {
  EXISTING_CATEGORY: num('VITE_ASSIGN_EXISTING', 0.55),
  NEW_CHILD: num('VITE_ASSIGN_NEW_CHILD', 0.4),
} as const;
```

- [ ] **Step 6: Write the failing gates test**

Create `tests/unit/gates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateReorg } from '../../src/reorg/gates';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import type { GraphPayload, Memory } from '../../src/types/graph';

const base = validateSeed(workspaceJson);
const aiTooling = base.categories.find((c) => c.name === 'AI Tooling')!;

const withDemoItem = (): GraphPayload => ({
  ...base,
  sources: [...base.sources, demoItem.source as never],
  memories: [...base.memories, ...(demoItem.memories as unknown as Memory[])],
});

describe('evaluateReorg', () => {
  it('does not fire on the untouched seed workspace', () => {
    expect(evaluateReorg(base, [aiTooling.id])).toBeNull();
  });

  it('fires exactly one SPLIT on AI Tooling after the demo item (AC-18, AC-27)', () => {
    const candidate = evaluateReorg(withDemoItem(), [aiTooling.id]);
    expect(candidate).not.toBeNull();
    expect(candidate!.operation).toBe('split');
    expect(candidate!.categoryIds).toEqual([aiTooling.id]);
    expect([candidate!.clusters!.a.length, candidate!.clusters!.b.length].sort()).toEqual([5, 6]);
  });

  it('never returns more than one candidate', () => {
    const candidate = evaluateReorg(withDemoItem(), base.categories.map((c) => c.id));
    expect(Array.isArray(candidate)).toBe(false);
  });

  it('skips a name-locked category (AC-23)', () => {
    const payload = withDemoItem();
    const locked: GraphPayload = {
      ...payload,
      categories: payload.categories.map((c) => c.id === aiTooling.id ? { ...c, name_locked: true } : c),
    };
    expect(evaluateReorg(locked, [aiTooling.id])).toBeNull();
  });

  it('skips a user-created category (AC-23)', () => {
    const payload = withDemoItem();
    const locked: GraphPayload = {
      ...payload,
      categories: payload.categories.map((c) => c.id === aiTooling.id ? { ...c, user_created: true } : c),
    };
    expect(evaluateReorg(locked, [aiTooling.id])).toBeNull();
  });

  it('evaluates only the affected neighbourhood', () => {
    const unrelated = base.categories.find((c) => c.name === 'Hiring')!;
    expect(evaluateReorg(withDemoItem(), [unrelated.id])).toBeNull();
  });
});
```

Also author `seed/demo-item.json` now — the screenshot source plus its 2 pre-extracted memories, both with vectors in the `ai-evals` theme (regenerate with `scripts/generateVectors.ts`):

```json
{
  "source": {
    "id": "src_demo", "type": "screenshot",
    "title": "Thread on eval harnesses",
    "raw_content": "…OCR text of the thread…",
    "scene_description": "A screenshot of a social thread comparing eval tooling for agent products.",
    "url": null, "image_path": "/seed/demo-screenshot.png",
    "created_at": "2026-07-25T09:00:00Z"
  },
  "memories": [
    {
      "id": "mem_demo_1", "source_id": "src_demo",
      "text": "Braintrust is the current front-runner for eval tooling over Langfuse",
      "kind": "opinion", "confidence": 0.88, "category_id": "cat_ai_tooling",
      "category_locked": false, "entity_ids": ["ent_braintrust", "ent_langfuse"],
      "vector": [], "x": null, "y": null, "pinned": false, "created_at": "2026-07-25T09:00:00Z"
    },
    {
      "id": "mem_demo_2", "source_id": "src_demo",
      "text": "Offline eval suites catch agent regressions that production tracing misses entirely",
      "kind": "fact", "confidence": 0.82, "category_id": "cat_ai_tooling",
      "category_locked": false, "entity_ids": ["ent_evals"],
      "vector": [], "x": null, "y": null, "pinned": false, "created_at": "2026-07-25T09:00:00Z"
    }
  ]
}
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/unit/gates.test.ts`
Expected: FAIL — `Cannot find module '../../src/reorg/gates'`

- [ ] **Step 8: Implement the gates**

Create `src/reorg/gates.ts`:

```ts
import type { GraphPayload, Category, Memory } from '../types/graph';
import { cosine, centroid, meanPairwiseCosine, twoMeans } from './vectorMath';
import { SPLIT, MERGE, PROMOTE } from './thresholds';

export interface ReorgCandidate {
  operation: 'split' | 'merge' | 'promote';
  categoryIds: string[];
  clusters?: { a: string[]; b: string[] };
  /** Normalized margin over threshold. Highest scorer wins. */
  score: number;
}

const isLocked = (c: Category): boolean => c.name_locked || c.user_created;

export function evaluateReorg(
  payload: GraphPayload,
  touchedCategoryIds: string[],
): ReorgCandidate | null {
  const byId = new Map(payload.categories.map((c) => [c.id, c]));
  const membersOf = (id: string): Memory[] => payload.memories.filter((m) => m.category_id === id);

  // Affected neighbourhood: touched categories, their parents, and their siblings.
  const scope = new Set<string>();
  for (const id of touchedCategoryIds) {
    const cat = byId.get(id);
    if (!cat) continue;
    scope.add(id);
    if (cat.parent_id) {
      scope.add(cat.parent_id);
      for (const sib of payload.categories.filter((c) => c.parent_id === cat.parent_id)) scope.add(sib.id);
    }
  }

  const candidates: ReorgCandidate[] = [];

  for (const id of scope) {
    const cat = byId.get(id);
    if (!cat || isLocked(cat)) continue;
    const members = membersOf(id);

    // SPLIT
    if (members.length >= SPLIT.MIN_MEMORIES) {
      const cohesion = meanPairwiseCosine(members.map((m) => m.vector));
      if (cohesion < SPLIT.MAX_MEAN_COHESION) {
        const { a, b, separation } = twoMeans(members.map((m) => ({ id: m.id, vector: m.vector })));
        if (
          a.length >= SPLIT.MIN_CLUSTER_SIZE &&
          b.length >= SPLIT.MIN_CLUSTER_SIZE &&
          separation > SPLIT.MIN_SEPARATION
        ) {
          candidates.push({
            operation: 'split',
            categoryIds: [id],
            clusters: { a: a.map((x) => x.id), b: b.map((x) => x.id) },
            score: (SPLIT.MAX_MEAN_COHESION - cohesion) / SPLIT.MAX_MEAN_COHESION,
          });
        }
      }
    }

    // PROMOTE
    if (cat.parent_id && members.length >= PROMOTE.MIN_MEMORIES) {
      const parentMembers = membersOf(cat.parent_id);
      if (parentMembers.length > 0) {
        const sim = cosine(
          centroid(members.map((m) => m.vector)),
          centroid(parentMembers.map((m) => m.vector)),
        );
        if (sim < PROMOTE.MAX_PARENT_SIMILARITY) {
          candidates.push({
            operation: 'promote',
            categoryIds: [id],
            score: (PROMOTE.MAX_PARENT_SIMILARITY - sim) / PROMOTE.MAX_PARENT_SIMILARITY,
          });
        }
      }
    }
  }

  // MERGE — sibling pairs within scope
  const scoped = [...scope].map((id) => byId.get(id)!).filter((c) => c && !isLocked(c));
  for (let i = 0; i < scoped.length; i++) {
    for (let j = i + 1; j < scoped.length; j++) {
      const a = scoped[i]!, b = scoped[j]!;
      if (a.parent_id !== b.parent_id) continue;
      const ma = membersOf(a.id), mb = membersOf(b.id);
      if (ma.length === 0 || mb.length === 0) continue;
      if (ma.length + mb.length > MERGE.MAX_COMBINED_MEMORIES) continue;
      const sim = cosine(centroid(ma.map((m) => m.vector)), centroid(mb.map((m) => m.vector)));
      if (sim > MERGE.MIN_CENTROID_SIMILARITY) {
        candidates.push({
          operation: 'merge',
          categoryIds: [a.id, b.id],
          score: (sim - MERGE.MIN_CENTROID_SIMILARITY) / (1 - MERGE.MIN_CENTROID_SIMILARITY),
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  // At most one structural operation per ingest (spec 8.4.3).
  candidates.sort((x, y) => y.score - x.score);
  return candidates[0]!;
}
```

- [ ] **Step 9: Run all reorg tests to verify they pass**

Run: `npx vitest run tests/unit/gates.test.ts tests/unit/vectorMath.test.ts tests/unit/seedCondition.test.ts`
Expected: PASS. If the SPLIT does not fire, the seed vectors are mistuned — return to Task 2 Step 4 and adjust spread. **Never loosen the thresholds to make the demo work.**

- [ ] **Step 10: Commit**

```bash
git add src/reorg tests/unit/vectorMath.test.ts tests/unit/gates.test.ts seed/demo-item.json
git commit -m "feat: deterministic split, merge, and promote gates with lock exclusion"
```

---

## Task 10: Applying a restructure

**Files:**
- Create: `src/reorg/applyReorg.ts`
- Test: `tests/unit/applyReorg.test.ts`

**Interfaces:**
- Consumes: `ReorgCandidate` (Task 9), `GraphPayload`
- Produces:
  - `interface ReorgEvent { id: string; operation: ReorgOperation; affected_category_ids: string[]; created_category_ids: string[]; banner_text: string; before_state: GraphPayload; created_at: string }`
  - `applyReorg(payload: GraphPayload, candidate: ReorgCandidate, names: string[]): { payload: GraphPayload; event: ReorgEvent }`
  - `undoReorg(event: ReorgEvent): GraphPayload`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/applyReorg.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyReorg, undoReorg } from '../../src/reorg/applyReorg';
import { evaluateReorg } from '../../src/reorg/gates';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import type { GraphPayload, Memory } from '../../src/types/graph';

const base = validateSeed(workspaceJson);
const aiTooling = base.categories.find((c) => c.name === 'AI Tooling')!;
const withDemo: GraphPayload = {
  ...base,
  sources: [...base.sources, demoItem.source as never],
  memories: [...base.memories, ...(demoItem.memories as unknown as Memory[])],
};
const candidate = evaluateReorg(withDemo, [aiTooling.id])!;
const names = ['Agent Frameworks', 'Evals & Observability'];

describe('applyReorg — parent split', () => {
  const { payload, event } = applyReorg(withDemo, candidate, names);

  it('keeps the parent category with its id and name', () => {
    const parent = payload.categories.find((c) => c.id === aiTooling.id)!;
    expect(parent).toBeDefined();
    expect(parent.name).toBe('AI Tooling');
    expect(parent.parent_id).toBeNull();
  });

  it('creates exactly two children under it', () => {
    const children = payload.categories.filter((c) => c.parent_id === aiTooling.id);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.name).sort()).toEqual(names.slice().sort());
  });

  it('leaves the parent with zero directly-attached memories (AC-27)', () => {
    expect(payload.memories.filter((m) => m.category_id === aiTooling.id)).toHaveLength(0);
  });

  it('distributes 11 memories into the two children as 5 and 6', () => {
    const children = payload.categories.filter((c) => c.parent_id === aiTooling.id);
    const counts = children
      .map((c) => payload.memories.filter((m) => m.category_id === c.id).length)
      .sort();
    expect(counts).toEqual([5, 6]);
  });

  it('never nests three levels deep', () => {
    for (const c of payload.categories) {
      if (!c.parent_id) continue;
      expect(payload.categories.find((p) => p.id === c.parent_id)!.parent_id).toBeNull();
    }
  });

  it('writes the verbatim banner template (AC-21)', () => {
    expect(event.banner_text).toBe(
      'Split **AI Tooling** into **Agent Frameworks** and **Evals & Observability**',
    );
  });

  it('restores the exact prior structure on undo (AC-22)', () => {
    expect(undoReorg(event)).toEqual(withDemo);
  });

  it('never reassigns a locked memory (AC-24)', () => {
    const lockedId = candidate.clusters!.a[0]!;
    const locked: GraphPayload = {
      ...withDemo,
      memories: withDemo.memories.map((m) => m.id === lockedId ? { ...m, category_locked: true } : m),
    };
    const out = applyReorg(locked, candidate, names).payload;
    expect(out.memories.find((m) => m.id === lockedId)!.category_id).toBe(aiTooling.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/applyReorg.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement apply and undo**

Create `src/reorg/applyReorg.ts`:

```ts
import type { GraphPayload, Category, ReorgOperation } from '../types/graph';
import type { ReorgCandidate } from './gates';

export interface ReorgEvent {
  id: string;
  operation: ReorgOperation;
  affected_category_ids: string[];
  created_category_ids: string[];
  banner_text: string;
  before_state: GraphPayload;
  created_at: string;
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_${(++counter).toString(36)}`;

export function applyReorg(
  payload: GraphPayload,
  candidate: ReorgCandidate,
  names: string[],
): { payload: GraphPayload; event: ReorgEvent } {
  const before: GraphPayload = structuredClone(payload);

  if (candidate.operation !== 'split') {
    throw new Error(`Phase 1 applies split only; got ${candidate.operation}`);
  }

  const targetId = candidate.categoryIds[0]!;
  const target = payload.categories.find((c) => c.id === targetId)!;
  const [nameA, nameB] = [names[0]!, names[1]!];

  const mkChild = (name: string): Category => ({
    id: nextId('cat'),
    parent_id: target.parent_id === null ? target.id : target.parent_id,
    name,
    rationale: null,
    name_locked: false,
    user_created: false,
    // Children are born beside the parent; layout settles them apart.
    x: (target.x ?? 0) + (name === nameA ? -70 : 70),
    y: (target.y ?? 0) + 60,
    pinned: false,
    created_by: 'ai',
  });

  const childA = mkChild(nameA);
  const childB = mkChild(nameB);
  const inA = new Set(candidate.clusters!.a);

  const memories = payload.memories.map((m) => {
    if (m.category_id !== targetId) return m;
    if (m.category_locked) return m; // AC-24 — user assignments are facts
    return { ...m, category_id: inA.has(m.id) ? childA.id : childB.id };
  });

  // Splitting a CHILD replaces it; splitting a PARENT keeps it (spec 8.4.2).
  const splittingChild = target.parent_id !== null;
  const categories = splittingChild
    ? [...payload.categories.filter((c) => c.id !== targetId), childA, childB]
    : [...payload.categories, childA, childB];

  const event: ReorgEvent = {
    id: nextId('reorg'),
    operation: 'split',
    affected_category_ids: [targetId],
    created_category_ids: [childA.id, childB.id],
    banner_text: `Split **${target.name}** into **${nameA}** and **${nameB}**`,
    before_state: before,
    created_at: new Date().toISOString(),
  };

  return { payload: { ...payload, categories, memories }, event };
}

/** Pure restore — no recomputation, so undo can never drift (AC-22). */
export function undoReorg(event: ReorgEvent): GraphPayload {
  return structuredClone(event.before_state);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/applyReorg.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/reorg/applyReorg.ts tests/unit/applyReorg.test.ts
git commit -m "feat: apply and undo a parent-preserving category split"
```

---

## Task 11: The magic moment — ghost node, ticker, and choreography

The demo's centre. Every timing here is spec §8.4.5 verbatim.

**Files:**
- Create: `src/reorg/choreography.ts`
- Create: `src/components/GhostNode.tsx`, `src/components/StatusTicker.tsx`
- Create: `src/capture/ingest.ts`
- Modify: `src/components/MapCanvas.tsx`
- Test: `tests/unit/choreography.test.ts`

**Interfaces:**
- Consumes: `ReorgEvent` (Task 10), `useUiStore`, `useWorkspaceStore`, `panToNode`
- Produces:
  - `interface TimelineStep { at: number; phase: 'materialize' | 'travel' | 'pan' | 'desaturate' | 'transform' | 'settle' | 'banner' }`
  - `buildTimeline(hasStructuralChange: boolean): TimelineStep[]`
  - `ingestDemoItem(): Promise<void>` — the full pipeline, wired to the stores

- [ ] **Step 1: Write the failing timeline test**

Create `tests/unit/choreography.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTimeline, TOTAL_WITH_STRUCTURE, TOTAL_ATTACH_ONLY } from '../../src/reorg/choreography';

describe('buildTimeline', () => {
  it('matches the spec 8.4.5 offsets for a structural change', () => {
    const t = buildTimeline(true);
    expect(t.map((s) => [s.phase, s.at])).toEqual([
      ['materialize', 0],
      ['travel', 200],
      ['pan', 1000],
      ['desaturate', 1000],
      ['transform', 1400],
      ['settle', 1900],
      ['banner', 2400],
    ]);
  });

  it('ends at 2400ms with a structural change', () => {
    expect(TOTAL_WITH_STRUCTURE).toBe(2400);
  });

  it('ends at 1800ms when attaching only', () => {
    const t = buildTimeline(false);
    expect(t.map((s) => s.phase)).toEqual(['materialize', 'travel', 'settle']);
    expect(TOTAL_ATTACH_ONLY).toBe(1800);
  });

  it('pans before the structural change renders (AC-20)', () => {
    const t = buildTimeline(true);
    const pan = t.find((s) => s.phase === 'pan')!;
    const transform = t.find((s) => s.phase === 'transform')!;
    expect(pan.at).toBeLessThan(transform.at);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/choreography.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the timeline**

Create `src/reorg/choreography.ts`:

```ts
export type Phase =
  | 'materialize' | 'travel' | 'pan' | 'desaturate' | 'transform' | 'settle' | 'banner';

export interface TimelineStep { at: number; phase: Phase }

export const TOTAL_WITH_STRUCTURE = 2400;
export const TOTAL_ATTACH_ONLY = 1800;

/** Offsets are spec 8.4.5 verbatim. Do not adjust without changing the spec. */
export function buildTimeline(hasStructuralChange: boolean): TimelineStep[] {
  if (!hasStructuralChange) {
    return [
      { at: 0, phase: 'materialize' },
      { at: 200, phase: 'travel' },
      { at: 1000, phase: 'settle' },
    ];
  }
  return [
    { at: 0, phase: 'materialize' },
    { at: 200, phase: 'travel' },
    { at: 1000, phase: 'pan' },
    { at: 1000, phase: 'desaturate' },
    { at: 1400, phase: 'transform' },
    { at: 1900, phase: 'settle' },
    { at: 2400, phase: 'banner' },
  ];
}

/** Stagger between successive memory nodes materializing (spec 8.4.5). */
export const MATERIALIZE_STAGGER_MS = 60;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/choreography.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Implement the ingest pipeline**

Create `src/capture/ingest.ts`. In Phase 1 the "AI" is a lookup into `seed/demo-item.json` with the stage delays that the real pipeline will have.

```ts
import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore, type CaptureStage } from '../store/uiStore';
import { evaluateReorg } from '../reorg/gates';
import { applyReorg, type ReorgEvent } from '../reorg/applyReorg';
import type { GraphPayload, Memory } from '../types/graph';
import demoItem from '../../seed/demo-item.json';

const STAGE_MS: Record<Exclude<CaptureStage, 'idle'>, number> = {
  reading: 1200,
  extracting: 2000,
  connecting: 1400,
  reorganizing: 900,
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Names the model would return in Phase 3. Fixed here so the demo is reproducible. */
const SPLIT_NAMES = ['Agent Frameworks', 'Evals & Observability'];

export async function ingestDemoItem(): Promise<ReorgEvent | null> {
  const ui = useUiStore.getState();
  const ws = useWorkspaceStore.getState();
  if (!ws.payload) return null;

  for (const stage of ['reading', 'extracting', 'connecting'] as const) {
    ui.setCaptureStage(stage);
    await wait(STAGE_MS[stage]);
  }

  const newMemories = demoItem.memories as unknown as Memory[];
  const attached: GraphPayload = {
    ...ws.payload,
    sources: [...ws.payload.sources, demoItem.source as never],
    memories: [...ws.payload.memories, ...newMemories],
  };

  const touched = [...new Set(newMemories.map((m) => m.category_id))];
  const candidate = evaluateReorg(attached, touched);

  if (!candidate) {
    useUiStore.getState().setCaptureStage('idle');
    useWorkspaceStore.getState().applyPayload(attached);
    return null;
  }

  ui.setCaptureStage('reorganizing');
  await wait(STAGE_MS.reorganizing);

  const { payload, event } = applyReorg(attached, candidate, SPLIT_NAMES);
  useWorkspaceStore.getState().applyPayload(payload);
  useUiStore.getState().setCaptureStage('idle');
  return event;
}
```

- [ ] **Step 6: Implement the ghost node and ticker**

`GhostNode.tsx` renders a pulsing circle at the canvas edge nearest the last camera centre. `StatusTicker.tsx` renders the stage label beneath it, reading from `useUiStore().captureStage` and mapping to the spec §5.3 copy: `Reading…`, `Extracting memories…`, `Finding connections…`, `Reorganizing…`. Hold each label a minimum of 400ms even if its stage completes faster.

In `MapCanvas.tsx`, drive the timeline from `buildTimeline` with a `requestAnimationFrame` clock:
- `materialize` — new memory nodes scale 0→1 over 200ms, staggered by `MATERIALIZE_STAGGER_MS`
- `travel` — nodes move along an eased cubic bezier from the ghost position to their category
- `pan` — if the affected category's screen position falls outside the viewport, `panToNode` over 400ms. **Zoom must not change.**
- `desaturate` — the affected category node desaturates and scales to 0.7
- `transform` — the parent re-saturates while two child nodes emerge from it and push apart
- `settle` — `runLayout` with 40 ticks, then hold

- [ ] **Step 7: Verify the moment**

Run: `npm run dev`, press `⌘K`, paste any text, press `⏎`.
Expected: ghost node → four ticker stages → two memories fly into `AI Tooling` → camera pans it into frame → it desaturates → two children emerge and push apart → the map settles. Total from the last ticker stage to settled: ~2.4s.

**This is the product. If it does not read as a single legible change, stop and fix it before continuing — that is the entire purpose of Phase 1.**

- [ ] **Step 8: Commit**

```bash
git add src/reorg/choreography.ts src/capture/ingest.ts src/components tests/unit/choreography.test.ts
git commit -m "feat: ghost node, status ticker, and the 2.4s reorganization choreography"
```

---

## Task 12: Change banner and undo

**Files:**
- Create: `src/components/ChangeBanner.tsx`, `src/components/Toast.tsx`
- Modify: `src/store/uiStore.ts` (add `reorgHistory: ReorgEvent[]`, `pushReorg`, `popReorg`)
- Test: `tests/unit/ChangeBanner.test.tsx`

**Interfaces:**
- Consumes: `ReorgEvent`, `undoReorg`, `useWorkspaceStore`
- Produces: `<ChangeBanner />` reading the newest `reorgHistory` entry; `renderBannerMarkup(text: string): ReactNode` converting `**bold**` to `<strong>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ChangeBanner.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeBanner } from '../../src/components/ChangeBanner';
import { useUiStore } from '../../src/store/uiStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import type { ReorgEvent } from '../../src/reorg/applyReorg';

const event = (): ReorgEvent => ({
  id: 'reorg_1', operation: 'split',
  affected_category_ids: ['cat_ai_tooling'], created_category_ids: ['cat_x', 'cat_y'],
  banner_text: 'Split **AI Tooling** into **Agent Frameworks** and **Evals & Observability**',
  before_state: useWorkspaceStore.getState().payload!,
  created_at: '2026-07-25T09:00:00Z',
});

beforeEach(async () => {
  await useWorkspaceStore.getState().load();
  useUiStore.setState({ reorgHistory: [] });
});

describe('ChangeBanner', () => {
  it('renders nothing with no history', () => {
    const { container } = render(<ChangeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the banner text with bold segments (AC-21)', () => {
    useUiStore.setState({ reorgHistory: [event()] });
    render(<ChangeBanner />);
    expect(screen.getByText('AI Tooling').tagName).toBe('STRONG');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Split AI Tooling into Agent Frameworks and Evals & Observability',
    );
  });

  it('restores the prior payload on undo (AC-22)', async () => {
    const e = event();
    const before = e.before_state;
    useUiStore.setState({ reorgHistory: [e] });
    render(<ChangeBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useWorkspaceStore.getState().payload).toEqual(before);
    expect(useUiStore.getState().reorgHistory).toHaveLength(0);
  });

  it('auto-dismisses after 12 seconds', () => {
    vi.useFakeTimers();
    useUiStore.setState({ reorgHistory: [event()] });
    const { queryByRole } = render(<ChangeBanner />);
    expect(queryByRole('status')).not.toBeNull();
    vi.advanceTimersByTime(12000);
    expect(queryByRole('status')).toBeNull();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ChangeBanner.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Extend the UI store**

Add to `src/store/uiStore.ts`:

```ts
import type { ReorgEvent } from '../reorg/applyReorg';

// add to UiState:
//   reorgHistory: ReorgEvent[];
//   pushReorg: (e: ReorgEvent) => void;
//   popReorg: () => ReorgEvent | null;

  reorgHistory: [] as ReorgEvent[],
  pushReorg: (e: ReorgEvent) =>
    set((s) => ({ reorgHistory: [e, ...s.reorgHistory].slice(0, 10) })), // 10 deep, spec 8.4.5
  popReorg: () => {
    const [head, ...rest] = get().reorgHistory;
    if (!head) return null;
    set({ reorgHistory: rest });
    return head;
  },
```

Change the store factory signature to `create<UiState>((set, get) => ({ … }))` so `get` is available.

- [ ] **Step 4: Implement the banner**

Create `src/components/ChangeBanner.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { undoReorg } from '../reorg/applyReorg';

const AUTO_DISMISS_MS = 12_000;

export function renderBannerMarkup(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  );
}

export function ChangeBanner() {
  const event = useUiStore((s) => s.reorgHistory[0] ?? null);
  const popReorg = useUiStore((s) => s.popReorg);
  const applyPayload = useWorkspaceStore((s) => s.applyPayload);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!event) return;
    setDismissed(false);
    const t = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [event?.id]);

  if (!event || dismissed) return null;

  const undo = () => {
    const popped = popReorg();
    if (popped) applyPayload(undoReorg(popped));
  };

  return (
    <div role="status" className="change-banner">
      <p className="change-banner__title">Recall reorganized your map</p>
      <p className="change-banner__body">{renderBannerMarkup(event.banner_text)}</p>
      <div className="change-banner__actions">
        <button onClick={undo}>Undo</button>
        <button onClick={() => setDismissed(true)}>Got it</button>
      </div>
    </div>
  );
}
```

Style: top-centre, 480px, elevated over the canvas. Bind `⌘Z` in `useKeyboard.ts` to the same `undo` path.

`Toast.tsx`: bottom-centre, 4s, used for `Added 2 memories to Evals & Observability.` and `Reverted.`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/ChangeBanner.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add src/components/ChangeBanner.tsx src/components/Toast.tsx src/store/uiStore.ts tests/unit/ChangeBanner.test.tsx
git commit -m "feat: change banner with undo and auto-dismiss"
```

---

## Task 13: Ask with citations

**Files:**
- Create: `src/ask/scriptedAsk.ts`
- Create: `src/components/CommandBar/AskMode.tsx`, `src/components/Inspector/AnswerDetail.tsx`
- Create: `seed/answers.json`
- Test: `tests/unit/scriptedAsk.test.ts`

**Interfaces:**
- Consumes: `GraphPayload`, `useUiStore.setHighlight`
- Produces:
  - `interface Citation { n: number; memory_id: string; source_id: string }`
  - `interface ScriptedAnswer { answer: string; citations: Citation[]; highlighted_node_ids: string[] }`
  - `answerQuestion(question: string, payload: GraphPayload): ScriptedAnswer`
  - `REFUSAL: 'I don\'t have anything saved about that yet.'`
  - `isQuestion(input: string): boolean`

- [ ] **Step 1: Author the answers**

Create `seed/answers.json` with 5 entries. Each `match` is a lowercase keyword set; a question matches when **every** keyword is present.

```json
[
  {
    "match": ["eval", "stack"],
    "answer": "You decided to drop LangChain in favour of direct Anthropic SDK calls for tool loops [1], mainly because the abstraction was making tool-call debugging harder [2]. Braintrust is the current front-runner for evals over Langfuse [3].",
    "citations": [
      { "n": 1, "memory_id": "mem_ai_1", "source_id": "src_ai_1" },
      { "n": 2, "memory_id": "mem_ai_3", "source_id": "src_ai_2" },
      { "n": 3, "memory_id": "mem_demo_1", "source_id": "src_demo" }
    ]
  }
]
```

Author four more covering fundraising benchmarks, hiring loops, pricing, and onboarding. Every `memory_id` and `source_id` must exist in `seed/workspace.json` or `seed/demo-item.json` — Step 3's test enforces this.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/scriptedAsk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { answerQuestion, isQuestion, REFUSAL } from '../../src/ask/scriptedAsk';
import { validateSeed } from '../../src/data/validateSeed';
import workspaceJson from '../../seed/workspace.json';
import demoItem from '../../seed/demo-item.json';
import answers from '../../seed/answers.json';
import type { GraphPayload, Memory } from '../../src/types/graph';

const base = validateSeed(workspaceJson);
const payload: GraphPayload = {
  ...base,
  sources: [...base.sources, demoItem.source as never],
  memories: [...base.memories, ...(demoItem.memories as unknown as Memory[])],
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
    const r = answerQuestion('What did we decide about our eval stack?', payload);
    expect(r.answer).not.toBe(REFUSAL);
    expect(r.citations.length).toBeGreaterThanOrEqual(2);
    for (const s of r.answer.split(/(?<=\.)\s+/)) {
      expect(s).toMatch(/\[\d+\]/); // every sentence cites
    }
  });

  it('resolves every citation to a real memory and source (AC-34)', () => {
    const memoryIds = new Set(payload.memories.map((m) => m.id));
    const sourceIds = new Set(payload.sources.map((s) => s.id));
    for (const entry of answers) {
      for (const c of entry.citations) {
        expect(memoryIds.has(c.memory_id)).toBe(true);
        expect(sourceIds.has(c.source_id)).toBe(true);
      }
    }
  });

  it('cites the just-added demo memory', () => {
    const r = answerQuestion('What did we decide about our eval stack?', payload);
    expect(r.citations.some((c) => c.memory_id === 'mem_demo_1')).toBe(true);
  });

  it('refuses when nothing matches, verbatim (AC-35, AC-37)', () => {
    const r = answerQuestion('What is the capital of France?', payload);
    expect(r.answer).toBe("I don't have anything saved about that yet.");
    expect(r.citations).toHaveLength(0);
    expect(r.highlighted_node_ids).toHaveLength(0);
  });

  it('highlights cited memories and their categories (AC-36)', () => {
    const r = answerQuestion('What did we decide about our eval stack?', payload);
    for (const c of r.citations) expect(r.highlighted_node_ids).toContain(c.memory_id);
    const cat = payload.memories.find((m) => m.id === r.citations[0]!.memory_id)!.category_id;
    expect(r.highlighted_node_ids).toContain(cat);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/scriptedAsk.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement scripted Ask**

Create `src/ask/scriptedAsk.ts`:

```ts
import type { GraphPayload } from '../types/graph';
import answers from '../../seed/answers.json';

export const REFUSAL = "I don't have anything saved about that yet.";

export interface Citation { n: number; memory_id: string; source_id: string }
export interface ScriptedAnswer {
  answer: string;
  citations: Citation[];
  highlighted_node_ids: string[];
}

const QUESTION_WORDS = /^(what|why|how|when|who|where|did|should|is|are|can|do|does)\b/i;

export function isQuestion(input: string): boolean {
  const t = input.trim();
  return t.endsWith('?') || QUESTION_WORDS.test(t) || t.split(/\s+/).length > 6;
}

export function answerQuestion(question: string, payload: GraphPayload): ScriptedAnswer {
  const q = question.toLowerCase();
  const entry = answers.find((a) => a.match.every((kw) => q.includes(kw)));

  // Never answer from world knowledge (spec 9.2).
  if (!entry) return { answer: REFUSAL, citations: [], highlighted_node_ids: [] };

  const highlighted = new Set<string>();
  for (const c of entry.citations) {
    highlighted.add(c.memory_id);
    const memory = payload.memories.find((m) => m.id === c.memory_id);
    if (memory) highlighted.add(memory.category_id);
  }

  return {
    answer: entry.answer,
    citations: entry.citations,
    highlighted_node_ids: [...highlighted],
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/scriptedAsk.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 6: Implement the Ask surfaces**

`AskMode.tsx`: the same command bar in ask mode — accent shift, placeholder `Ask across everything you've saved…`, and a mode chip driven by `isQuestion`. `⏎` calls `answerQuestion`, writes the result to `useUiStore`, calls `setHighlight(highlighted_node_ids)`, and closes the bar.

`AnswerDetail.tsx` in the Inspector: the answer with `[n]` rendered as buttons, then a numbered `Sources` list with each memory's text and its source card. Hovering `[n]` pulses the node; clicking selects the memory and flies the camera to it.

The map renders highlighted nodes at full opacity and everything else at `dimOpacity: 0.15` — the renderer already supports this. `Esc` clears the highlight.

- [ ] **Step 7: Verify demo beat 3**

Run: `npm run dev`, press `⌘/`, ask *"What did we decide about our eval stack?"*
Expected: the answer appears in the Inspector with 3 citations; three memory nodes and their categories stay lit while the rest of the map drops away; clicking `[3]` flies to the memory added during beat 2.

- [ ] **Step 8: Commit**

```bash
git add src/ask src/components seed/answers.json tests/unit/scriptedAsk.test.ts
git commit -m "feat: scripted Ask with citations, refusal, and map highlighting"
```

---

## Task 14: End-to-end demo path

**Files:**
- Create: `tests/e2e/demo-path.spec.ts`
- Create: `playwright.config.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: the entire application
- Produces: `npm run test:e2e` — the automated proof of AC-42

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { viewport: { width: 1512, height: 982 }, baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:e2e": "playwright test"`.

- [ ] **Step 2: Write the failing E2E test**

Create `tests/e2e/demo-path.spec.ts`. This is spec §15.3's 12-step click path, automated.

```ts
import { test, expect } from '@playwright/test';

test('the 60-second demo path runs end to end with no backend (AC-42)', async ({ page }) => {
  const failures: string[] = [];
  page.on('requestfailed', (r) => failures.push(r.url()));
  page.on('request', (r) => {
    if (r.url().includes('/api/')) failures.push(`unexpected API call: ${r.url()}`);
  });

  // Beat 1 — recognition
  await page.goto('/');
  await expect(page.getByTestId('map-canvas')).toBeVisible({ timeout: 1500 });
  await page.getByTestId('map-canvas').click({ position: { x: 400, y: 300 } });
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.keyboard.press('Escape');

  // Beat 2 — the magic
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('capture-bar')).toBeHidden();
  await expect(page.getByTestId('status-ticker')).toContainText('Reading…');
  await expect(page.getByRole('status')).toContainText(
    'Split AI Tooling into Agent Frameworks and Evals & Observability',
    { timeout: 15000 },
  );

  // Beat 3 — the payoff
  await page.keyboard.press('Meta+/');
  await page.getByTestId('ask-input').fill('What did we decide about our eval stack?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('answer')).toBeVisible();
  await expect(page.getByTestId('citation-3')).toBeVisible();
  await page.getByTestId('citation-3').click();
  await expect(page.getByTestId('source-card')).toBeVisible();

  expect(failures).toEqual([]);
});

test('undo restores the map', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+k');
  await page.getByTestId('capture-input').fill('Braintrust vs Langfuse for agent evals');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toBeHidden();
});

test('below 1280px it refuses to render the app', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Recall is desktop-first. Please open on a larger screen.')).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toBeHidden();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `data-testid` attributes are missing.

- [ ] **Step 4: Add the test ids**

Add `data-testid` to: `map-canvas` (the canvas), `inspector`, `capture-bar`, `capture-input`, `status-ticker`, `ask-input`, `answer`, `citation-{n}`, `source-card`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS, 3 tests, with zero network requests to any `/api/` path.

- [ ] **Step 6: Run the whole suite**

Run: `npm test && npm run test:e2e`
Expected: every unit test and every E2E test green.

- [ ] **Step 7: Rehearse**

Run the §15.3 click path manually 5 times. Time it. It must land between 55 and 65 seconds with narration. Note anything that reads as sluggish or illegible and fix it before declaring Phase 1 done.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e playwright.config.ts package.json src
git commit -m "test: end-to-end coverage of the 60-second demo path"
```

---

## Self-Review

**Spec coverage.** Every Phase 1 surface in spec §5 maps to a task: shell/rail/Inspector → Task 7, Map → Tasks 3–6, Capture → Task 8, Processing → Task 11, Ask → Task 13. Spec §8.4's gates and choreography → Tasks 9–11. Spec §12's seed → Task 2. Spec §7's states are partially covered — **the empty, loading, and error states of §7 are only implemented for the paths the demo touches.** Full state coverage (AC-38) is explicitly Phase 5 and is listed in the scope boundary. Tree (§5.5), Sources (§5.7), and Settings (§5.8) are out of Phase 1 scope by the same boundary.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Two steps intentionally describe UI composition in prose rather than full code — Task 7 Step 4 and Task 11 Step 6 — because they are layout and styling work where the tests and the referenced spec sections define the contract; both name every component file, every required string, and every timing.

**Type consistency.** Verified across tasks: `GraphPayload`, `GraphNode`, `GraphEdge`, `Memory.vector`, `Memory.category_locked`, `ReorgCandidate.clusters`, `ReorgEvent.before_state`, `Citation`, `ScriptedAnswer.highlighted_node_ids`. `runLayout`, `buildGraph`, `evaluateReorg`, `applyReorg`, `undoReorg`, `buildTimeline`, `answerQuestion`, `hitTest`, `panToNode` keep the same names and signatures everywhere they appear.

**Known ordering dependency.** Task 2's `seedCondition.test.ts` imports `src/reorg/vectorMath.ts` and `src/reorg/thresholds.ts`, which are formally created in Task 9. This is called out inline in Task 2 Step 3. Either implement those two pure modules early or run Task 9 before Task 2 — the seed is only meaningful relative to the gate math, so the coupling is real rather than accidental.

**Spec edit required on execution.** §12.1 must change from `seed/similarity.json` to `seed/vectors.json`, and §12.5 drops `reorg-preview.json` — Task 11 produces the reorg live from real gates rather than replaying a recording, which is strictly better. Update the spec in the same PR as Task 2.
