# Recall — Phase 1

A personal AI memory agent. Paste in a note, a link, or a screenshot; Recall breaks it into
atomic memories, files them into a self-organizing map, and answers questions with citations.

**Phase 1 is the complete 60-second YC demo running on committed seed data with zero backend.**
No server, no database, no AI calls. Every restructuring decision is real geometry over real
vectors — Phase 4 swaps the data source and the gate code does not change.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — desktop only, 1280px minimum
```

## The demo

| Key | What happens |
|---|---|
| — | The map opens already populated: 47 memories, 22 sources, 6 parent categories |
| `⌘K` | Capture bar. Type anything and press `⏎`. |
| — | Ghost node → `Reading… → Extracting… → Finding connections… → Reorganizing…` → **AI Tooling splits into Agent Frameworks and Evals & Observability** |
| `⌘/` | Ask. Try *"What did we decide about our eval stack?"* — the answer cites three memories and the map dims everything else. |
| `⌘Z` | Undo the reorganization. |
| `T` / `G` | Tree view / Map view. Selection carries across, and the map centres on it. |

## Tree view

The map shows you the shape of your knowledge; the tree is where you correct it.
Expand with `▸` or `→`, walk rows with `↑` `↓`, and **drag a memory onto any category
to re-file it**. A hand-moved memory locks: no reorganization pass will ever reclaim it.
A child category can be dragged onto a different parent, but not onto another child —
the taxonomy is exactly two levels, and the attempt is refused with a shake.

## Verify

```bash
npm test             # 72 unit tests
npm run test:e2e     # 4 Playwright tests, including the full spec 15.3 click path
npm run seed         # regenerate seed/, re-checking every gate condition
```

`npm run test:e2e` fails if any request touches an `/api/` path — "zero backend" is a
checked condition, not a promise.

## How the magic works

The product's central decision: **geometry decides whether to restructure; the model only
names the result.** That is what makes a live demo safe — the same input always produces the
same map.

`AI Tooling` is seeded with 9 memories at mean pairwise cosine **0.633**, just above the
0.62 split threshold, so nothing fires. Its memories divide 7 (agent frameworks) / 2 (evals).
The demo item adds 2 evals memories; cohesion falls to **0.591**, the gate opens, and the
category splits 7/4.

The 7/2 imbalance is load-bearing. With a balanced seed, adding memories to the smaller theme
*raises* cohesion and the split never fires. `scripts/generate_seed.py` refuses to emit a seed
that does not satisfy the condition, and `tests/unit/seedCondition.test.ts` re-checks it on
every commit.

## Layout

| Path | What |
|---|---|
| `seed/` | The entire dataset. Generated — never hand-edit. |
| `scripts/generate_seed.py` | Authors the 47 memories, generates vectors, verifies every gate |
| `src/types/graph.ts` | The contract between every other module |
| `src/data/dataSource.ts` | **The Phase 4 swap point** |
| `src/reorg/` | Thresholds, vector math, gates, apply/undo, the 2.4s timeline |
| `src/graph/` | Build, layout, camera, renderer, hit test |
| `src/tree/` | Flatten the taxonomy into rows; drop validation |
| `src/components/` | React surfaces |
| `docs/` | Product spec, review summary, Phase 1 plan |

## Not built yet

Sources screen, Settings, instant Search, MERGE/PROMOTE animations (their gates are built and
tested), proposal mode, category renaming, offline mode. See `docs/spec-review-summary.md`.
