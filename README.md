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
| — | The **welcome screen** asks if you want to think something through. Type a real question or just press `⏎`. |
| — | The **arc browser**: 6 category orbs fanned above a seated figure, already populated with 47 memories from 22 sources. The same chat box stays docked at the bottom. |
| drop | Drag a screenshot anywhere on the window. Recall reads it and tells you what it saw, what was new, what echoes something you already saved, and where it filed it. |
| `G` | The same corpus as a map, and the colour comes back. Beat 2 needs this — the split animation only plays here. |
| `⌘K` | Capture bar. Type anything and press `⏎`. |
| — | Ghost node → `Reading… → Extracting… → Finding connections… → Reorganizing…` → **AI Tooling splits into Agent Frameworks and Evals & Observability** |
| `⌘/` | One bar, two modes. A keyword searches as you type; a question is answered. The chip tells you which, and `⏎` does what the chip says. |
| `⌘Z` | Undo the reorganization. |
| `T` / `G` / `S` | Browse / Map / Sources. Selection carries across, and the map centres on it. |

## Three surfaces, one corpus

**Ask** (`⌘/`) is the product: a question, an answer, and every claim pointing back at
something you actually saved. The other two are how you read what it pulled.

**Browse** (`T`, and the landing view) is the manual mode — categories fanned in an arc
above a figure who is thinking about them, with the open category's memories in a reading
list below. Each orb is sized by how much is in it. Click one to descend into its
subcategories; `←`, `Backspace` or `Esc` climbs back out. An answer arrives as an orb of
its own, the prose on top and the memories it cited below, draggable like anything else.
**Drag a memory onto any orb to re-file it** — a hand-moved memory locks, and no
reorganization pass will ever reclaim it. A subcategory can be dragged onto the
**Move this group under** panel to re-parent it; dropping it on a sibling is refused with
a shake, because the taxonomy is exactly two levels.

This screen is deliberately **monochrome**. Colour is a mode signal: grey while you are
looking something up, amber the moment you press `G`.

**Map** (`G`) is the big-picture mode — the shape of what you know rather than the list,
and the only surface where a reorganization is animated.

## Verify

```bash
npm test             # 239 unit and server tests
npm run test:e2e     # 39 Playwright tests, including the full spec 15.3 click path
npm run seed         # regenerate seed/, re-checking every gate condition
npm run rehearse     # 20 consecutive demo runs with per-beat timing (spec 15.4)
```

`npm run test:e2e` fails if any request touches an `/api/` path — "zero backend" is a
checked condition, not a promise. `npm run rehearse` is stricter still: it fails the run
if *any* request leaves the page.

## Demo day

Read `docs/demo-runbook.md`. The headline: **the demo is narration-paced, not machine-paced.**
Measured over 20 clean runs the machine work takes **8.2 seconds** — the 60-second target is
about 47 seconds of talking. The only wait is the ~7.4s processing beat, which is scripted with
four labelled stages so there's something to talk over.

```
first paint        median 0.06s   (budget 1.5s)
submit -> banner   median 7.44s   spread 0.02s across 20 runs
ask -> answer      median 0.01s
whole path         median 8.21s   spread 0.16s
```

Requires a browser window ≥ 1280px. Reset between runs is a page reload — nothing persists.

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

### The threshold is not yet verified against a real model

`0.62` was fitted to the seed's hand-generated 8-dimensional vectors. Cosine distributions
differ enormously between embedding models, so **the number almost certainly does not transfer**.
Before building the Phase 3 backend, measure it:

```bash
pip install voyageai && export VOYAGE_API_KEY=...
npm run thresholds              # embeds the 47 memories, re-runs the gates, suggests a threshold
npm run thresholds:selfcheck    # no API key: replays the seed vectors to prove the harness agrees
                                # with src/reorg/vectorMath.ts
```

The harness reports three things, and the third is the one that matters: whether cohesion still
*drops* when the demo item lands, what `MAX_MEAN_COHESION` should become, and whether that value
would also fire on some other category — which would break "at most one structural operation per
ingest" and take the demo with it.

Anthropic offers no embedding endpoint; its docs recommend Voyage AI (`voyage-4`, 1024-dim by
default). The harness is dimension-agnostic and also supports OpenAI via `--provider openai`.

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

Settings, MERGE/PROMOTE *animations* (both are applied and tested, but the
map does not choreograph them), proposal mode, offline mode, and the real AI providers — the
interfaces are ready, but there are no API keys to verify them against. See
`docs/spec-review-summary.md`.
