# Recall MVP — Spec Review Summary

Condensed from `docs/product-spec.md` (1302 lines). Read this to decide; read the spec to build.

---

## Core user promise

> **Your scattered saves, turned into a map you can ask questions.**

The user pastes text, a link, or a screenshot. Recall breaks it into atomic memories, files them into a self-organizing two-level map, and answers questions across everything with citations back to the original source.

**The sentence the product eliminates:** *"I know I saved something about this."*

**Target user:** founders and knowledge workers who save 5–30 items/week across three-plus apps and have no retrieval ritual. Desktop-only, dense UI, no tutorial.

**The bet:** capture is solved, retrieval is not, because saving preserves the *container* and not the *claim*. The organizing labor moves from the user to the model. That transfer is the entire product.

**Value must be visible in 30 seconds with zero input** — so the app opens onto a populated map, never an empty state.

---

## 60-second YC demo path

Three beats, one idea each.

| Time | Beat | On screen |
|---|---|---|
| 0:00–0:15 | **Recognition** | Map already populated — 47 memories, 6 parent categories. Hover `Fundraising`, click `Investor Notes`, Inspector shows memories with mixed source icons. *"I never tagged or filed any of this."* |
| 0:15–0:38 | **The magic** | `⌘V` a screenshot → ghost node + status ticker (`Reading… → Extracting… → Connecting… → Reorganizing…`) → 2 memories fly into `AI Tooling` → camera pans it into frame → it desaturates and **two children emerge and push apart** → banner: **"Split AI Tooling into Agent Frameworks and Evals & Observability — Undo"** |
| 0:38–0:58 | **The payoff** | `⌘/` → *"What did we decide about our eval stack?"* → answer streams into Inspector with 3 citations, cited nodes highlight, everything else dims to 15% → click citation `[3]` → camera flies to the memory → the screenshot from 30 seconds ago |

**12-step click path** is specified verbatim in spec §15.3. Rehearsal requirement: 20 consecutive clean runs on the demo machine, both online and `?offline=1`.

---

## Five most important product behaviors

1. **Opens populated.** Never an empty state. The map is the first thing painted, in under 1.5s, in a hand-tuned layout that is identical on every load. Spatial memory is a feature.
2. **One capture box, three input types, auto-detected.** Text / URL / screenshot. The user never picks a type. Everything normalizes to one internal shape before the AI sees it, so the pipeline is source-agnostic.
3. **The map restructures itself, visibly and reversibly.** At most one structural change per ingest, animated over 2.4s, announced in plain language, undoable with `⌘Z`.
4. **Every answer cites its source.** Ask never uses world knowledge. If retrieval returns fewer than 2 relevant memories it refuses with a fixed string. Credibility rests entirely on traceability.
5. **User corrections are permanent.** Rename, drag, or create anything and it locks. No reorganization pass may ever touch a locked entity. The AI proposes structure; the user's edits are facts.

---

## Data model

Postgres + pgvector. 12 tables. The load-bearing ones:

| Table | Role |
|---|---|
| `sources` | The raw captured thing. `type`, `raw_content`, `status`. **Persisted before any AI call** — a capture is never lost even if extraction fails. |
| `memories` | One atomic claim, 8–30 words, self-contained. FK to source. Carries the embedding and its persisted `x`/`y`. |
| `categories` | Two-level taxonomy via `parent_id`. Carries `centroid`, `name_locked`, `user_created`. |
| `memory_category` | Assignment join, **unique on `memory_id`** — one category per memory. Carries `locked` and `assigned_by`. |
| `entities` + `memory_entity` | People / projects / tools / concepts / decisions / questions. Entities float between the categories they bridge — this is what makes cross-category connection visible on the map. |
| `edges` | Only `relates_to` (memory↔memory, cosine ≥ 0.82, top-3 cap). `contains` and `mentions` are derived from FKs — storing them would create a second source of truth. |
| `reorg_events` | The undo log and the "what has Recall been doing" feed. `before_state` jsonb must be complete enough that undo is a pure restore. |
| `category_tombstones` | Deleted category names, checked before any AI creation. Stops the system resurrecting what the user removed. |

No `users` table, no auth. Single workspace in localStorage.

---

## Deterministic restructuring rules

**The central design decision: geometry decides *whether* to restructure; the model only *names* the result.** This is what makes a live demo safe.

Evaluation scope is the **affected neighborhood only** — categories that received a new memory, plus parent and siblings. Locked entities are removed from the candidate set before scoring.

| Operation | Fires when (all must hold) |
|---|---|
| **SPLIT** | `memory_count ≥ 8` · mean pairwise cosine `< 0.62` · 2-means yields two clusters each `≥ 3` · inter-centroid distance `> 0.15` |
| **MERGE** | two siblings' centroid cosine `> 0.86` · combined count `≤ 12` · neither locked |
| **PROMOTE** | child `memory_count ≥ 12` · similarity to parent centroid `< 0.50` |

**All firing candidates are scored by normalized margin over threshold. The single highest scorer executes; the rest are discarded** and will re-evaluate on the next capture. One structural idea per beat is all an audience can absorb.

**SPLIT has two branches.** Splitting a *parent* keeps the parent (name, ID, position) and grows two children beneath it — this is the demo case, and it reads as refinement rather than the map erasing itself. Splitting a *child* replaces it with two siblings and tombstones the original.

Assignment thresholds: `≥ 0.55` → existing category · `0.40–0.55` → new child under best parent · `< 0.40` → new parent.

---

## 10 highest-priority acceptance criteria

Ranked by what breaks the demo or the product thesis.

| # | Criterion | Why it's top-10 |
|---|---|---|
| **AC-27** | Ingesting `seed/demo-item.json` deterministically triggers exactly one SPLIT on `AI Tooling` → two children of 5 and 6, parent intact | The demo. Runs on every commit. |
| **AC-42** | Frontend renders the full seed workspace and plays the entire reorganization animation **with no backend running** | Proves the frontend-first sequencing actually held |
| **AC-19** | Animation completes in 2.4s ±200ms from server response to banner | The magic moment has a budget |
| **AC-20** | Camera pans an off-screen affected category into view *before* the change renders | The audience cannot miss the moment |
| **AC-13** | Node positions identical across two consecutive loads with no changes | A map that reshuffles is unusable and un-demoable |
| **AC-18** | A SPLIT-crossing capture produces exactly one structural operation, never two | Legibility of the moment |
| **AC-33 / 34** | Every answer sentence carries a citation; every citation resolves | The product thesis |
| **AC-35 / 37** | Absent content returns the fixed refusal, verified with *"What is the capital of France?"* | One hallucinated answer kills the pitch |
| **AC-23 / 24** | Locked categories and locked assignments are never touched by reorganization | The trust loop |
| **AC-12** | Map paints first node in under 1.5s on the seed workspace | The 30-second promise starts here |

---

## Biggest implementation risks

| Risk | Severity | Mitigation |
|---|---|---|
| **The reorganization reads as a blob shuffling, not as a legible change** | Critical — it's the whole product | Unfalsifiable until built. This is precisely why Phase 1 exists: answer it in week one with zero AI infrastructure. If it doesn't land on seed data it won't land on real data. |
| **The cosine values in §12.4 (0.635 → 0.598) are asserted, not computed** | High | No embedding model existed when the spec was written. In Phase 1 they're fabricated anyway; in **Phase 3 they must be re-measured against the real model and the seed re-tuned.** The gate thresholds are env vars for exactly this reason. Do not treat these numbers as verified. |
| **Layout stability** | High | Naive force simulation does not produce identical positions across loads. Requires persisted positions seeded into a short 30-tick re-settle, not a fresh run. AC-13. |
| **Camera choreography mid-animation** | Medium | Panning to the affected category *while* the structural transition plays is fiddly timing work (t=1000–1400). Budget real time for it. |
| **Seed data quality is a writing job on the critical path** | Medium | 47 memories must read as one real person's accumulated knowledge. Generic filler makes the whole demo feel fake. Nothing is blocked behind it, so it slips silently. |
| **Rendering at scale** | Low for the demo | AC-17's 600-node/30fps target is a Phase 5 concern; seed is 47 memories. But the library choice (Canvas/WebGL, not SVG) must be made in Phase 1 because migrating later is expensive. |
| **Latency vs. narration fit** | Low | p95 12s budget; the four-stage ticker gives the presenter labeled beats to talk over. Only real from Phase 4. |

---

## Features unnecessary for the YC demo

Present in the spec, never touched during the 60 seconds. **Not "cut" — deprioritized below the demo path.**

- **Tree view (§5.5)** — the demo never leaves the Map
- **Sources screen (§5.7)** and **Settings (§5.8)** — never opened
- **Search mode** — only Ask is used; instant search is a separate code path
- **MERGE and PROMOTE** — the demo only fires SPLIT
- **Proposal mode** (`auto_reorganize = false`) — an opt-out nobody sees
- **The entire correction/locking mechanism** — nothing is corrected on stage. It is the answer to a Q&A question, not a demo beat.
- **`category_tombstones`, `entity_aliases`, ask history and suggestions**
- **Undo** — a presenter safety net, not a shown feature. Keep it; it's cheap and it de-risks a misclick.
- **Offline mode** — same: risk control, not content. Keep.

---

## Over-engineered for a seeded frontend MVP

Honest self-assessment. The spec was written as a complete product spec, and several parts are Phase 3+ machinery that **must not be built in Phase 1.**

| Over-built | What a seeded frontend actually needs |
|---|---|
| pgvector, HNSW indexes, real embeddings, centroid recomputation | Nothing. Seed ships hand-generated 8-dim unit vectors, so the gate math is real. |
| The full four-call AI schema (§10) | Nothing. `demo-item.json` ships pre-extracted memories. |
| `reorg_events.before_state` / `after_state` full jsonb snapshots | One recorded event in `reorg-preview.json` to replay |
| Denormalized `memory_count` with maintenance triggers | An array length |
| Entity dedup via `normalized_name` + alias table | Seed entities are authored unique by hand |
| Reciprocal rank fusion (`k=60`) over 47 memories | Substring match, plus scripted answers for the 5 demo questions |
| The LLM rerank pass in Ask | Nothing — seeded Ask is scripted |
| Serial queue for concurrent captures | The demo captures once |
| Two model tiers, temperature table | Phase 3 |
| Four-tier level-of-detail thresholds | 47 nodes render fine at every zoom; implement LOD when it's needed, i.e. Phase 5 |
| Confidence bars in the Inspector | Visual noise at demo scale; the number is meaningless on hand-authored seed data |

**The one thing that looks over-engineered but is not:** the deterministic gate thresholds in §8.4.2. They exist so a live demo cannot produce a surprise, and they must be implemented exactly as specified even where the inputs are fake — because Phase 4 swaps the inputs for real ones and the behavior must not change.

---

*Summary of `docs/product-spec.md` @ `cb0642d`.*
