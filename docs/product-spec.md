# Recall — MVP Product Specification

**Version:** 1.0
**Date:** 2026-07-25
**Status:** Approved for implementation
**Audience:** Engineer implementing the MVP without further product input

---

## 0. How to read this document

This spec is written to be implementable end-to-end without asking product questions. Where the brainstorming session left a decision open, this document **makes the decision and states the reasoning inline** under a `> **Decision:**` callout. Those are settled; do not reopen them mid-build.

Build order is mandated in §16. The frontend prototype ships against seed data before any backend work begins.

---

## 1. Product definition

**Recall is a personal AI memory agent.** You paste in anything worth remembering — a note, a link, a screenshot — and Recall breaks it into atomic memories, files them into a self-organizing map of what you know, and answers questions across everything with the original sources attached.

The one-line pitch:

> Your scattered saves, turned into a map you can ask questions.

**What Recall is not**, stated so scope stays honest:

- **Not a notes app.** You do not author documents in Recall. You feed it things that already exist.
- **Not a bookmark manager.** Bookmarks store a pointer. Recall reads the content and extracts claims from it.
- **Not a chatbot.** The map is the product. Ask is a lens onto the map, not the main surface.
- **Not a second brain framework.** No manual tagging, no folder discipline, no daily notes ritual. If the user has to maintain it, we have failed.

**Product category positioning:** personal intelligence, not productivity software. This has direct visual and interaction consequences — see §17.

---

## 2. Target user

**Primary:** founders and knowledge workers who save 5–30 pieces of information per week across at least three different apps and have no retrieval ritual.

Concrete profile used for all seed data and demo content:

| Attribute | Value |
|---|---|
| Role | Technical co-founder, seed-stage AI product company, ~8 people |
| Save behavior | Instagram saves (design + founder content), screenshots of dashboards and threads, pasted links, meeting notes in a scratch file |
| Volume | ~15 saves/week, ~600 accumulated items |
| Current retrieval | Ctrl-F across four apps, usually gives up |
| Device | MacBook, browser open all day, two monitors |
| Tolerance | High. Will accept a dense information display. Does not need hand-holding. |

**Explicitly not the MVP user:** students, casual consumers, teams, mobile-first users, anyone who needs an onboarding tutorial.

**Design consequence:** the interface can be dense, keyboard-driven, and dark. It should read as an instrument, not a starter app.

---

## 3. Primary problem

**Capture is solved. Retrieval is not.**

Every app the user already has makes saving one tap. None of them make the saved thing findable at the moment of need, because saving preserves the *container* (a post, a file, an image) and not the *claim inside it*. Six months later the user remembers the claim and not the container, so search fails.

The three compounding failures:

1. **No structure at capture time.** Items land in a flat, undifferentiated pile per app.
2. **Structure requires labor.** Folders and tags work, and nobody sustains them past week three.
3. **Retrieval is container-shaped.** The user thinks "we decided to drop LangChain"; the tool wants a filename.

**The sentence Recall is built to eliminate:** *"I know I saved something about this."*

**Why now / why AI:** extracting atomic claims from mixed media and maintaining a taxonomy that reorganizes itself was not economically possible before cheap multimodal models. The organizing labor moves from the user to the model. That transfer is the entire product.

---

## 4. Core user journey

The journey is designed so **core value is visible within 30 seconds of opening the product, before the user inputs anything.**

> **Decision:** the app opens onto a populated workspace, never onto an empty state. A first-run user gets a seeded demo workspace they can explore or clear. Rationale: the value proposition of Recall is legible only when there is accumulated memory. An empty workspace communicates nothing and kills both first-run activation and the YC demo. The empty state (§7.1) exists only for the "clear workspace" path.
>
> **Amended (Phase 1, post-implementation):** the landing surface is the **folder browser**, not the map. The original decision assumed the map was the fastest read of "already organised". It is not — a graph asks the viewer to infer structure from position, while a folder tree states it. The map remains the surface for §8.4's reorganization choreography and for big-picture work; it is one keystroke away (`G`), and §15.2 Beat 1 now spends ~4 seconds moving there. The 30-second promise is unchanged; only which surface delivers it in the first three seconds.

### 4.1 The 30-second path (no input required)

| Time | What happens |
|---|---|
| 0–5s | The welcome screen asks whether you want to think something through. It is a chat box, not a splash: whatever you type is answered for real, against your own corpus. `?skipWelcome=1` bypasses it for automation. |
| 5–12s | The arc browser: 6 category stones fanned above the seated figure, each sized by how much is in it. |
| 12–22s | User opens a category. Its subcategories fan out and its memories fill the reading list below. |
| 22–30s | User presses `G`. The same corpus as a map, and the colour returns. The structure is now understood two ways. |

By second 30 the user has understood: *this is my knowledge, organized by something other than me.*

### 4.2 The full loop (the reason they come back)

1. **Capture** — `⌘K`, paste a link / text / screenshot, Enter.
2. **Watch** — the item is read, atomic memories are extracted, and the map visibly reorganizes around them (§8.4). This is the product's signature moment.
3. **Ask** — `⌘/`, ask a natural-language question, get an answer with numbered citations that resolve to original sources.
4. **Correct** — drag a memory to a different category, or rename a category. The correction is permanent and the AI never overwrites it.

Steps 2 and 4 together are the trust loop: the AI does the work, the user retains authority.

---

## 5. Screen-by-screen requirements

### 5.0 App shell

Single-page application. Persistent three-region layout at all routes.

```
┌────┬──────────────────────────────────────────┬─────────────────┐
│    │                                          │                 │
│ L  │            CENTER CANVAS                 │   INSPECTOR     │
│ E  │                                          │                 │
│ F  │       Map (default) or Tree              │   Contextual    │
│ T  │                                          │   detail panel  │
│    │                                          │                 │
│ R  │                                          │   360px fixed   │
│ A  │                                          │   collapsible   │
│ I  │                                          │                 │
│ L  │                                          │                 │
│    │                                          │                 │
│56px│                                          │                 │
└────┴──────────────────────────────────────────┴─────────────────┘
```

**Left rail** (56px, icon-only, tooltip on hover):
- Recall mark (top)
- Map view — active by default
- Tree view
- Sources
- Search/Ask (opens command bar)
- Settings (bottom)

**Center canvas**: fills remaining width. No page chrome, no breadcrumbs, no page title. The canvas is the product.

**Inspector**: 360px, right-docked, collapsible via `⌘]` or a chevron. Collapsed by default on viewports under 1280px.

**Minimum supported viewport:** 1280×720. Below that, render a single line: *"Recall is desktop-first. Please open on a larger screen."* No responsive reflow, no mobile layout.

**Global capture affordance:** a circular `+` button, 48px, floating bottom-center of the canvas at 32px from the bottom edge. Always visible in Map and Tree views.

---

### 5.1 S1 — Map view (default route `/`)

The hero screen. Everything else is support.

**Content:** a force-directed graph of the user's memory.

**Node types:**

| Type | Shape | Size | Color role | Label |
|---|---|---|---|---|
| Parent category | Circle | 28–44px, scaled by descendant memory count | Primary accent | Always visible, 13px |
| Child category | Circle | 18–28px, scaled by memory count | Primary accent at 70% | Visible above zoom 0.6 |
| Memory | Small circle | 6px fixed | Neutral light | Visible above zoom 1.4, or on hover |
| Entity | Diamond | 10px fixed | Secondary accent, hue by entity kind | Visible above zoom 1.0 |

**Edge types:**

| Type | Style | Meaning |
|---|---|---|
| `contains` | Solid, 1px, low opacity | Category → child category, or category → memory |
| `mentions` | Dashed, 1px | Memory → entity |
| `relates_to` | Solid, 1.5px, accent | Memory → memory, semantic similarity above threshold |
| `derived_from` | Not rendered | Memory → source. Available in inspector only; rendering it would double the graph's edge count for no insight. |

**Level of detail** — the graph must stay readable at 600+ memories:

| Zoom | Visible |
|---|---|
| < 0.6 | Parent categories only. Child categories collapse into parents. |
| 0.6 – 1.0 | Parent + child categories. Memory nodes hidden. |
| 1.0 – 1.4 | + entity nodes |
| > 1.4 | + memory nodes, all labels |

**Default camera:** fit-to-bounds with 10% padding on load, animated over 800ms from 15% zoomed out. This produces the "settling into place" first impression.

**Layout engine:** force-directed with these constraints:
- Categories repel each other strongly; memories are attracted tightly to their category.
- Simulation runs to a fixed alpha target then **freezes**. It must not jitter perpetually — ambient motion reads as instability, not life.
- Node positions persist per workspace so the map looks the same on every open. Spatial memory is a feature; a map that reshuffles on reload is unusable.

**Interactions:** see §6.

---

### 5.2 S2 — Capture (overlay, not a route)

> **Decision:** capture is a modal overlay on top of the map, never a separate page. Rationale: the user must never lose sight of the map, because the map is where the payoff renders. Navigating away and back would break the causal link between "I added this" and "the map changed."

**Trigger:** `⌘K`, the floating `+` button, or paste (`⌘V`) anywhere on the canvas with nothing focused.

**Presentation:** centered modal, 640px wide, backdrop blurs and dims the map to 30% opacity. The map remains visible behind it.

**Composition:** a single input area that accepts all three input types without the user choosing a type first.

```
┌──────────────────────────────────────────────────┐
│  Add to Recall                              esc  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │                                            │  │
│  │  Paste text, a link, or an image…          │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Text · Link · Screenshot            ⏎ to add    │
└──────────────────────────────────────────────────┘
```

**Accepted inputs — exactly three. No file picker, no PDF, no audio.**

| Input | Detection | Handling |
|---|---|---|
| **Text** | Default | Stored verbatim as `raw_text`. Covers pasted notes, meeting notes, Instagram captions, Slack excerpts. |
| **URL** | Input trimmed and matches a URL regex, and is the entire content | Server fetches the page, extracts Open Graph tags + readable body text (Readability-style). Stores title, description, canonical URL, hero image URL, and extracted body. |
| **Screenshot** | Image pasted from clipboard, or dragged onto the modal or canvas | Uploaded to object storage. A vision model produces OCR text plus a scene description. Both are stored and both feed extraction. |

**Type detection is automatic and shown, not chosen.** As soon as content is detected the mode indicator at the bottom-left highlights the matched type. If the user pastes a URL and wants it treated as plain text, they can click the "Text" chip to override before submitting.

**Mixed content rule:** if pasted text contains a URL alongside other prose, treat it as **text** and record the URL as a referenced link on the source. Do not fetch it. Only a bare URL triggers link fetching. This avoids a paste of meeting notes silently turning into a webpage scrape.

**Multiple items:** one item per capture. No batch paste, no multi-file drop. If multiple images are dropped, accept the first and show a toast: *"Recall adds one item at a time."*

**Submit:** `⏎`. `⇧⏎` inserts a newline in text mode. The modal closes immediately on submit — processing is shown on the map, not in the modal.

---

### 5.3 S3 — Processing (inline on the map)

There is no processing screen. When the modal closes, a **ghost node** appears at the canvas edge nearest the last camera center, pulsing softly, with a status ticker beneath it.

**Status ticker copy, in order:**

1. `Reading…` — source normalization (fetch / OCR)
2. `Extracting memories…` — atomic memory extraction
3. `Finding connections…` — embedding + entity linking + category matching
4. `Reorganizing…` — structural evaluation (only shown if a structural change will occur)

Each stage is driven by a real server event, not a timer. If a stage completes in under 400ms, hold its label for 400ms anyway so the sequence stays readable.

**Latency budget:** p50 under 6s, p95 under 12s, from submit to map settled. If processing exceeds 20s, transition to the timeout error state (§7.4).

**Concurrency:** if the user captures again while an item is processing, queue it. A second ghost node appears with a queue badge. Process serially — parallel reorganization of the same taxonomy produces conflicting structural decisions.

---

### 5.4 S4 — Inspector panel

Right-docked, 360px, contextual to selection. Three modes:

**Mode A — Category selected**
- Category name (inline-editable on click)
- Path breadcrumb: `AI & Agents › Agent Frameworks`
- Memory count, entity count, date range of contained memories
- List of contained memories, newest first, each showing: memory text (2-line clamp), source type icon, relative date
- Footer actions: `Rename`, `Merge into…`, `Delete` (deleting a category re-parents its memories to its parent, never deletes memories)
- **Lock indicator:** if user-edited, shows a small lock chip reading *"Pinned by you — AI won't reorganize this"*

**Mode B — Memory selected**
- Full memory text
- Confidence bar (0–1, from extraction)
- `Category` — clickable chip, drag target for re-categorization
- `Entities` — chips grouped by kind (people, projects, decisions, questions)
- `Source` — card with type icon, title, thumbnail if available, captured date, and a `View original` action
- `Related memories` — up to 5, by embedding similarity, each clickable to jump the map
- Footer actions: `Move to…`, `Delete`

**Mode C — Source selected**
- Source type, title, captured timestamp
- Full raw content, scrollable (raw text / fetched article body / OCR text + scene description)
- Original image preview if screenshot; `Open link ↗` if URL
- `Memories extracted from this` — full list, each clickable
- Footer action: `Delete source` — with a confirm dialog stating exactly how many memories will be removed

**Empty selection:** on the very first frame the panel is **blank** — the greeting already states the scale in a sentence, and the counts at display size were the loudest thing on a screen whose job is a hilltop and one question. Once you have looked around it shows the workspace counts as a single caption line, plus the last 3 reorganization events. The panel keeps its width throughout: a column that appears on selection shoves the scene sideways, which is worse than one that is briefly empty.

> The counts were three lines of 25px display type until the two screens merged. That size was right while this state could only be reached from inside the browser, after deselecting something — the app opened on a welcome screen that had no inspector at all. Nothing about the panel changed; where it appears did.

---

### 5.5 S5 — Tree view

> **Decision:** Tree ships in the MVP but as a secondary view, not a co-equal one. Rationale: the user named Map as the hero screen. Tree exists because a hierarchy is easier to *audit and correct* than a graph, and correction is a required trust behavior. It is not a second hero.

**Content:** the category hierarchy as a nested, expandable list. Two levels of category (parent → child) plus memories as leaves.

```
▾ AI & Agents                                    23
  ▾ Agent Frameworks                             11
      Decided to drop LangChain for direct…      🔗
      Anthropic's tool-use loop is simpler…      📝
      …
  ▸ Evals & Observability                        12
▾ Fundraising                                    18
  ▸ Investor Notes                                9
  ▸ Pitch Feedback                                9
```

**Behavior:**
- Expand/collapse with click or `→` / `←`
- Row shows: name, memory count (right-aligned), and source-type icon for memory rows
- **Drag to re-parent.** A memory can be dragged to any category. A child category can be dragged to a different parent. Parent categories cannot be nested deeper — the taxonomy is exactly two levels (§8.5).
- Selecting any row updates the Inspector identically to Map selection
- Toggling back to Map keeps the selection and centers the camera on it

**Depth limit is enforced in the UI**: dropping a child category onto another child category is rejected with a shake animation and a toast: *"Recall keeps categories two levels deep."*

---

### 5.6 S6 — Ask (command bar mode)

**Trigger:** `⌘/`, or the search icon in the left rail, or typing `?` at the start of the `⌘K` bar.

**Presentation:** the same command bar as capture, in a distinct mode — accent color shifts, placeholder reads *"Ask across everything you've saved…"*.

**Two behaviors in one bar**, distinguished automatically:

| Input shape | Mode | Behavior |
|---|---|---|
| Short, no question structure (`langchain`, `pricing`) | **Search** | Instant hybrid results as you type, in a dropdown |
| Question structure (starts with what/why/how/when/who/did/should, or ends with `?`, or exceeds 6 words) | **Ask** | On `⏎`, runs retrieval-augmented answer |

The detected mode is shown as a chip in the bar (`Search` / `Ask`) and is click-toggleable.

**Ask output** renders in the Inspector, not in the modal:
- The answer, 2–5 sentences, with inline numbered citations `[1] [2]`
- A `Sources` list beneath: each numbered entry shows the memory text and its originating source card
- Hovering a citation highlights the corresponding node on the map
- Clicking a citation selects that memory and centers the camera

**Simultaneously, on the map:** all cited memory nodes and their categories enter a highlight state — everything else drops to 15% opacity. This is the visual proof that the answer came from the user's own map. `Esc` clears the highlight.

**Refusal behavior:** if retrieval returns nothing above the relevance floor, the answer is exactly: *"I don't have anything saved about that yet."* Never answer from model world-knowledge. Recall's credibility rests entirely on every answer being traceable to a source.

---

### 5.7 S7 — Sources

A reverse-chronological list of every captured item. This is the provenance ledger and the "did my capture work" surface.

**Row:** type icon · title or first 80 chars · memory count extracted · relative timestamp · thumbnail (screenshots and links only).

**Filters:** All / Text / Link / Screenshot. No date filter, no search — the Ask bar covers that.

**Row click** selects the source and opens Inspector Mode C.

---

### 5.8 S8 — Settings

Deliberately minimal. Four items:

1. **Workspace** — `Reset to demo data` and `Clear all data` (each with a typed confirmation)
2. **Model** — API key field, and a model selector with two options (fast / thorough). Defaults to fast.
3. **Reorganization** — a single toggle: `Let Recall reorganize automatically` (default ON). When OFF, structural changes become proposals the user accepts (§8.4.4).
4. **About** — version string.

No account, no billing, no profile, no theme picker.

---

## 6. Interaction details

### 6.1 Keyboard map

| Key | Action |
|---|---|
| `⌘K` | Open capture bar |
| `⌘/` | Open ask/search bar |
| `⌘Z` | Undo the most recent reorganization (session-scoped, up to 10 deep) |
| `⌘]` | Toggle Inspector |
| `G` | Go to Map view |
| `T` | Go to Tree view |
| `S` | Go to Sources |
| `Esc` | Close modal → clear highlight → clear selection, in that order |
| `⌫` | Delete selected node (with confirm) |
| `Space` | Fit map to bounds |
| `↑ ↓` | Move selection through Inspector list / Tree rows |
| `→ ←` | Expand / collapse tree row |
| `⌘V` | Capture from clipboard directly (opens bar pre-filled) |

Single-letter shortcuts are suppressed while any text input has focus.

### 6.2 Map pointer interactions

| Gesture | Result |
|---|---|
| Hover node | Node scales 1.15×, label appears, connected edges brighten, unconnected elements drop to 40% opacity |
| Click node | Select. Inspector opens to matching mode. Camera does not move. |
| Double-click category | Focus mode: camera zooms to that category's subgraph, all other nodes fade to 8% |
| Drag node | Reposition. Position is persisted. Dragging a node **pins** it — the force simulation will not move it again. A pin dot appears on the node. |
| Right-click node | Context menu: `Rename` (categories), `Move to…`, `Pin/Unpin`, `Delete` |
| Drag memory onto category | Re-categorize. Edge animates to the new parent. Marks the assignment as user-locked. |
| Scroll | Zoom, cursor-anchored. Range 0.25× – 3×. |
| Drag canvas | Pan |
| Click empty canvas | Clear selection |
| Drop image onto canvas | Opens capture bar with the image attached |

### 6.3 Correction behavior (trust-critical)

Any user action that contradicts the AI sets a lock, and locks are permanent until the user removes them.

| User action | Lock created | Effect on future AI behavior |
|---|---|---|
| Renames a category | `category.name_locked = true` | AI may still add memories to it, but never renames it and never merges it away |
| Drags a memory to a different category | `memory_category.locked = true` | That memory is never re-assigned by any future reorganization |
| Creates a category manually | `category.user_created = true` and `name_locked = true` | Never split, never merged, never deleted by AI |
| Deletes an AI-created category | Category is tombstoned | Not recreated. The same clustering signal will not resurrect it. |
| Pins a node position | `node.pinned = true` | Layout only. No effect on taxonomy. |

**The rule stated plainly:** the AI proposes structure; the user's edits are facts. A reorganization pass may never modify a locked entity. Any candidate structural operation that would touch a locked entity is discarded before scoring.

Locked categories display a small lock chip in the Inspector so the user can see and undo the lock.

---

## 7. States

Every screen must implement all four. Copy below is final — implement it verbatim.

### 7.1 Empty

| Surface | Condition | Treatment |
|---|---|---|
| **Map** | Zero memories (only reachable via `Clear all data`) | Centered: *"Nothing saved yet."* / *"Add a note, a link, or a screenshot and Recall will start building your map."* / `Add your first item` button (opens `⌘K`). Behind it, a static ghost graph at 6% opacity suggesting what will appear. |
| **Tree** | Zero categories | Same message, no ghost. |
| **Sources** | Zero sources | *"No sources yet."* |
| **Inspector** | Nothing selected, first frame | Blank — the greeting carries the scale (§5.4) |
| **Inspector** | Nothing selected, after looking around | Workspace counts as one caption line + last 3 reorganization events (§5.4) |
| **Ask results** | Retrieval below relevance floor | *"I don't have anything saved about that yet."* |
| **Category with no memories** | AI-created category emptied by user corrections | Auto-deleted after the reorganization pass completes. Never render an empty category. |

### 7.2 Loading

| Surface | Treatment |
|---|---|
| **Initial app load** | Recall mark, centered, with a slow pulse. No spinner, no skeleton grid. Under 1.5s to first paint of the map. |
| **Map data loading** | Nodes fade in over 400ms as data resolves, layout runs, camera animates to fit. Never show a blank canvas with a spinner over it. |
| **Item processing** | Ghost node + status ticker (§5.3). The rest of the map stays fully interactive throughout. |
| **Ask** | Inspector shows the question at top and a 3-line shimmer below. Answer streams in token by token. |
| **Search** | Results dropdown shows previous results at 50% opacity until new ones resolve. No layout jump. |
| **URL fetch** | Inside the ticker's `Reading…` stage. No separate indicator. |

### 7.3 Success

| Event | Treatment |
|---|---|
| **Item captured, no structural change** | New memory nodes travel from the ghost position to their category and settle. Toast, bottom-center, 4s: *"Added 3 memories to Agent Frameworks."* Clicking the toast selects the new memories. |
| **Item captured, with structural change** | Full reorganization sequence (§8.4) + change banner. |
| **Correction applied** | The moved node animates to its new parent over 300ms. Toast: *"Moved. Recall won't change this again."* This copy is deliberate — it tells the user the correction is durable. |
| **Ask answered** | Answer renders, cited nodes highlight on the map. |
| **Undo** | Reverse animation of the reorganization. Toast: *"Reverted."* |

Success states never require dismissal. No confirmation modals for additive actions.

### 7.4 Error

Every error state names what failed, what Recall did about it, and what the user can do. No error codes in the UI.

| Failure | Treatment |
|---|---|
| **URL fetch failed** (404, timeout, paywall, bot block) | The source is still created with the URL and any Open Graph data obtained. Banner in the Inspector: *"Couldn't read this page — saved the link only."* with a `Paste the text instead` action that reopens capture pre-filled with the URL as a note. **Never discard the capture.** |
| **Image OCR returned nothing** | Source saved, memory extraction runs on the scene description alone. Inspector note: *"Couldn't read text in this image."* |
| **Extraction returned zero memories** | Source saved and listed in Sources. Toast: *"Saved, but Recall couldn't find anything to remember in this. It's in your Sources."* The source is never silently dropped. |
| **Extraction API error / rate limit** | Source saved with `status = 'failed'`. Sources row shows a `Retry` action. Toast: *"Couldn't process that — it's saved and you can retry."* |
| **Processing timeout (>20s)** | Ghost node converts to a failed node with a retry affordance. Same message as above. |
| **Reorganization failed after successful extraction** | Memories are attached with the best-matching existing category, no structural change. Silent — the user still got their memories; a structural op is a bonus, not a promise. Logged server-side. |
| **Ask failed** | Inspector: *"Something went wrong answering that."* + `Try again`. The question text is preserved. |
| **Embedding service down** | Capture is accepted and queued. Sources row shows `Pending`. Banner across the top of the map: *"Recall is behind on processing — new items will appear shortly."* |
| **Network offline** | Top banner: *"You're offline. Recall will save your next item when you're back."* The map remains fully browsable from cache. |
| **Viewport under 1280px** | Full-screen message: *"Recall is desktop-first. Please open on a larger screen."* |

**Governing principle:** a capture is never lost. Extraction, categorization, and reorganization may each fail independently and degrade gracefully, but the raw source is persisted before any AI call is made.

---

## 8. Graph and tree behavior

### 8.1 Graph construction

Nodes come from three tables (`categories`, `memories`, `entities`); edges from `edges` plus the foreign keys on `memory_category`. The client receives a single graph payload and does not query per-node.

**Edge generation rules:**

| Edge | Created when |
|---|---|
| `contains` (category→category) | `category.parent_id` is set |
| `contains` (category→memory) | Row exists in `memory_category` |
| `mentions` (memory→entity) | Row exists in `memory_entity` |
| `relates_to` (memory→memory) | Cosine similarity ≥ **0.82**, capped at the top 3 per memory, deduplicated bidirectionally |

The `relates_to` cap is load-bearing. Without it the graph becomes a hairball at ~200 memories.

### 8.2 Layout

- Force-directed: link force, charge (repulsion), center force, collision.
- Categories: high charge (strong mutual repulsion) → distinct territories.
- Memories: short link distance to their category → tight clusters.
- Entities: medium link distance, attracted to every memory that mentions them → they naturally land between the categories they bridge. This is what makes cross-category connections visible.
- Simulation runs to `alpha < 0.005` then stops. Positions are written back to the database.
- On subsequent loads, saved positions seed the simulation and it runs only 30 ticks to accommodate new nodes. **The map must look substantially the same every time it opens.**

### 8.3 Category assignment (every ingest)

For each newly extracted memory:

1. Embed the memory text.
2. Score every category by its **nearest member** — the highest cosine similarity between the new memory and any single memory already filed there.
3. **If best match ≥ 0.55** → assign to that category.
4. **If best match is 0.40 – 0.55** → create a new child category under the best-matching *parent* category. The AI names it (§10.4).
5. **If best match < 0.40** → create a new parent category with one child. The AI names both.

> **Scored by nearest member, not by centroid — and this correction is load-bearing.**
>
> Earlier drafts compared the new memory against each category's *centroid*. That fails in exactly the situation this product is built around. A centroid stops representing its category the moment the category has become two things, and detecting that moment is the entire purpose of the SPLIT gate in §8.4.
>
> Measured on the seed corpus: `AI Tooling` holds 7 memories about agent frameworks and 2 about evals. Its centroid sits near the frameworks cluster (0.88) and away from the evals one (0.77). A new evals memory scores **0.41** against that centroid — inside the "create a new category" band — while scoring **0.72** against an evals memory already filed there.
>
> Centroid scoring therefore siphons off precisely the memories that would have made a category incoherent enough to split. §8.3 and §8.4 fight, §8.3 wins, and SPLIT can essentially never fire in production. On the demo corpus it breaks the demo outright: the two demo memories land in two different categories and `AI Tooling` never reaches the gate.
>
> Nearest-member scoring is robust to bimodal categories by construction, and asks the question the product actually asks — *is this like something I already saved?* rather than *is this like the average of everything I saved?* Centroids remain correct for MERGE and PROMOTE, which compare two whole categories rather than a memory against a category.
>
> Verified by `tests/server/pipeline.test.ts` → *"files an evals memory into AI Tooling despite the bimodal centroid"*.

Thresholds are configuration constants, tuned once against the seed corpus, and must be exposed as environment variables.

### 8.4 Reorganization — the signature moment

> **Decision:** Recall performs **local re-clustering with a visible, undoable diff**, at most **one structural operation per ingest**. It does not re-cluster the entire corpus, and it does not gate the change behind an Accept button in the default configuration.
>
> **Rationale.** Full re-clustering was rejected on three grounds: it is slow (tens of seconds), non-deterministic between runs, and it silently reverts user corrections — which destroys the trust loop that §6.3 exists to build. Accept/reject gating was rejected because it inserts a click between the input and the payoff, which is precisely where the demo's impact lives; it survives as the opt-in behavior for users who turn off auto-reorganization (§5.8). Attach-only was rejected because it eliminates the moment the product is built around.
>
> The one-operation-per-ingest cap is what makes the moment legible: the user sees a single, nameable change ("this category split in two") rather than a blob rearranging. A demo audience can only absorb one structural idea per beat.

#### 8.4.1 Scope of evaluation

Only the **affected neighborhood** is evaluated: every category that received a new memory, plus its parent, plus its direct siblings. Nothing else in the taxonomy is considered. Locked entities (§6.3) are removed from the candidate set before scoring.

#### 8.4.2 The three operations, with deterministic gates

The AI does not decide *whether* to restructure. Deterministic geometry decides; the AI only *names* the result. This makes the behavior reproducible and testable.

**SPLIT** — a category has grown incoherent.

Fires when all hold:
- `memory_count ≥ 8`
- mean pairwise cosine similarity within the category `< 0.62`
- 2-means over the member embeddings yields two clusters each with `≥ 3` members
- inter-centroid distance between the two clusters `> 0.15`

Result depends on the category's level. The two cases are structurally and visually different, and both must be implemented:

- **Splitting a parent category** — the parent **keeps its name, its ID, and its position**. Two new child categories are created beneath it and its directly-attached memories redistribute into them. Afterward the parent holds zero directly-attached memories. *(This is the demo case.)*
- **Splitting a child category** — the child is replaced by two new siblings under the same parent, its memories redistribute into them, and the original child is tombstoned.

The AI names both new groups (§10.4). In the parent case it names only the two children; the parent's existing name is never changed by a split.

> **All three operations are applied, not just SPLIT.** Phase 1 implemented the three gates but only ever applied a split, which was worse than omitting the other two: §8.4.3 returns the *single highest-scoring* candidate, so a merge or promote that outscored a split meant the split was discarded and nothing happened at all — a silent no-op where the user expected a reorganization. Closed in Phase 3; `applyReorg` now has a branch per operation.

**MERGE** — two siblings say the same thing.

Fires when all hold:
- two sibling categories have centroid cosine similarity `> 0.86`
- combined `memory_count ≤ 12`
- neither is locked

Result: memories consolidate into one category. The AI names the result, preferring the existing name of the larger category if it still fits.

**PROMOTE** — a child has outgrown its parent.

Fires when all hold:
- a child category's `memory_count ≥ 12`
- its centroid similarity to its parent's centroid `< 0.50`

Result: the child is promoted to a parent category at the root.

#### 8.4.3 Selecting the operation

All firing candidates are scored by margin over threshold, normalized per operation type. **The highest-scoring single operation executes. All others are discarded for this ingest** — they will re-evaluate naturally on the next capture if still valid.

If nothing fires, the ingest completes with attach-only. This is the common case and is not a failure.

#### 8.4.4 Proposal mode

When `Let Recall reorganize automatically` is OFF, the selected operation is written to `reorg_events` with `status = 'proposed'` instead of executing. The map shows a subtle badge on the affected category; clicking it opens a preview in the Inspector with `Apply` / `Dismiss`.

#### 8.4.5 The animation sequence

Total duration after the server responds: **2.4s**. Timings are exact.

| t (ms) | Event |
|---|---|
| 0 | Ghost node stops pulsing. New memory nodes materialize at its position, scaling 0 → 1 over 200ms, staggered 60ms apart. |
| 200–1000 | Memory nodes travel along eased bezier curves to their assigned category. `contains` edges draw in behind them. |
| 1000 | If no structural change: force simulation reheats to `alpha = 0.3`, settles over 800ms. Sequence ends at 1800ms with the success toast. |
| 1000–1400 | **Structural change only.** The affected category node scales to 0.7 and its color desaturates — a visible "something is changing here." |
| 1400–1900 | The operation renders. **SPLIT of a parent:** the parent node holds position and re-saturates while two child nodes emerge from it and push apart, memories following into them. **SPLIT of a child:** the node divides into two siblings that push apart, and the original fades out. **MERGE:** two nodes converge and fuse. **PROMOTE:** the node scales up and migrates outward to the root ring. In all cases member memory nodes follow their new parents. |
| 1900–2400 | Simulation settles at `alpha = 0.4` with high velocity decay so the neighborhood eases rather than springs. |
| 2400 | Change banner slides down from the top of the canvas. |

**Change banner** — top-center, 480px, elevated over the canvas:

> **Recall reorganized your map**
> Split **AI Tooling** into **Agent Frameworks** and **Evals & Observability**
> `Undo`   `Got it`

Auto-dismisses after 12s. `Undo` (or `⌘Z`) reverses the operation and restores the prior structure exactly, using the `before_state` snapshot in `reorg_events`. Undo is available for the last 10 reorganizations in the session.

Banner copy templates, exactly:
- SPLIT — `Split **{original}** into **{a}** and **{b}**` *(same copy for both the parent and child cases — in the parent case `{original}` survives as their new parent, and the sentence still describes what happened to its contents)*
- MERGE — `Merged **{a}** and **{b}** into **{result}**`
- PROMOTE — `**{name}** grew into its own category`
- New category — `Started a new category: **{name}**`

**Camera behavior:** if the affected category is outside the current viewport, the camera pans (does not zoom) to bring it into frame during t=1000–1400, before the change renders. The user must never miss the moment because it happened off-screen. This is essential for the demo.

### 8.5 Taxonomy constraints

- **Exactly two levels.** Parent categories and child categories. Memories attach to either. Deeper nesting is rejected in both the UI and the reorganization engine. Rationale: three levels is where automatic taxonomies become unreadable and where users start disagreeing with the machine.
- **Target counts:** 5–9 parent categories, 2–6 children each. If parent count exceeds 12, the next reorganization pass prefers MERGE operations. These are soft targets that bias scoring, not hard limits.
- **Every memory has exactly one category.** No multi-category assignment. Cross-cutting relationships are expressed through entities and `relates_to` edges, which is what the graph view is for.

### 8.6 Tree ↔ Map consistency

Both views read the same graph payload. A change in either is immediately reflected in the other. Selection is shared state. Switching views preserves selection and, in Map, centers the camera on the selected node.

---

## 9. Search and Ask behavior

### 9.1 Search (instant)

- **Trigger:** input in the command bar that does not parse as a question (§5.6).
- **Method:** hybrid. Full-text search over `memories.text` and `sources.title` (Postgres `tsvector`), combined with vector similarity over memory embeddings. Fuse with reciprocal rank fusion, `k = 60`.
- **Latency:** results must appear within 150ms of the last keystroke. Debounce 120ms.
- **Results:** up to 8, grouped by category. Each row: memory text with matched terms bolded, category chip, source type icon.
- **On hover:** the corresponding node pulses on the map.
- **On select:** map centers on the memory, Inspector opens Mode B, bar closes.

### 9.2 Ask (retrieval-augmented)

**Pipeline:**

1. Embed the question.
2. Retrieve top 20 memories by hybrid search (same fusion as §9.1).
3. Drop any memory below a relevance floor of **0.35** cosine.
4. **If fewer than 2 memories survive → refuse.** Return exactly: *"I don't have anything saved about that yet."*
5. Expand context: for each surviving memory, include its category name and its source title/type.
6. Take the top 8 by fused rank.

> **The LLM rerank pass is deliberately not built.** At a corpus this size, retrieval returns 20 candidates from 47 memories and the fused top 8 is already the whole plausible answer set — a model call to reorder them buys accuracy that cannot be measured against latency and cost that can. `docs/spec-review-summary.md` flagged it as over-engineering and that judgment held. Revisit when the corpus is large enough that the top 20 and the top 8 genuinely differ in quality.
7. Generate the answer with the citation contract below.

**Citation contract — non-negotiable:**

- Every factual claim in the answer carries at least one citation `[n]`.
- `n` indexes into the ordered list of retrieved memories included in the response payload.
- A sentence with no supporting memory must not be written. The model is instructed to omit rather than infer.
- The model must never use world knowledge. If the retrieved memories are insufficient to answer fully, it says what it can support and states the gap: *"You haven't saved anything about the pricing side of this."*

**Answer shape:** 2–5 sentences. No bullet lists, no headings. Recall answers like a colleague who read your notes, not like a report generator.

**Output payload:**

```json
{
  "answer": "You decided to drop LangChain in favor of direct SDK calls [1], mainly because the abstraction was making tool-call debugging harder [2]. Braintrust is the current front-runner for evals [3].",
  "citations": [
    { "n": 1, "memory_id": "mem_8f2", "source_id": "src_44b" },
    { "n": 2, "memory_id": "mem_9a1", "source_id": "src_44b" },
    { "n": 3, "memory_id": "mem_c07", "source_id": "src_91e" }
  ],
  "highlighted_node_ids": ["mem_8f2", "mem_9a1", "mem_c07", "cat_agents", "cat_evals"]
}
```

**Ask history:** the last 10 questions are stored per workspace and shown as suggestions when the ask bar opens empty. No multi-turn conversation — each question is independent. Follow-up chat is out of scope (§14).

---

## 10. AI extraction schema

Four model calls per ingest. Calls 1–3 run per source; call 4 runs only when a structural operation fires.

### 10.1 Call 1 — Normalize (screenshots only)

Vision model. Input: the image. Output:

```json
{
  "ocr_text": "string — all legible text, reading order preserved, empty string if none",
  "scene_description": "string — 1-2 sentences describing what the image shows",
  "detected_context": "instagram_post | slack | article | dashboard | chart | document | photo | other",
  "has_meaningful_text": true
}
```

Text and URL sources skip this call.

### 10.2 Call 2 — Extract memories and entities

The core call. Input: normalized source content plus source metadata.

```json
{
  "memories": [
    {
      "text": "string — one atomic claim, 8-30 words, third person, self-contained",
      "kind": "fact | decision | opinion | question | task | reference",
      "confidence": 0.0,
      "entities": [
        { "name": "string", "kind": "person | project | organization | tool | concept | decision | question" }
      ]
    }
  ],
  "summary": "string — one sentence describing the source as a whole",
  "suggested_title": "string — max 60 chars, used as the source title when none exists"
}
```

**Extraction rules given to the model:**

- **Atomic.** One claim per memory. "We chose Braintrust and dropped LangChain" is two memories.
- **Self-contained.** A memory must be understandable six months later with no surrounding context. Resolve pronouns. Never write "this" or "they" without a named referent.
- **Third person, present or past tense.** Not "I decided" — "Decided to…" or "The team decided…".
- **Only what the source supports.** No inference, no elaboration, no filling gaps.
- **Skip noise.** Navigation text, ads, timestamps, UI chrome, boilerplate. A screenshot of a dashboard yields memories about the numbers, not about the buttons.
- **Volume:** 1–10 memories per source. If a source genuinely contains nothing memorable, return an empty array — this is a valid, expected outcome and is handled by §7.4.
- **Confidence** reflects extraction certainty, not truth of the claim. Ambiguous or partially legible content scores below 0.6.

**Entity rules:**

- `person` — named individuals only, never roles
- `project` — named initiatives, products, or codenames
- `organization` — companies, funds, teams
- `tool` — named software, services, libraries
- `concept` — recurring domain ideas ("agentic evals", "PLG motion")
- `decision` — a choice that was made, phrased as the choice
- `question` — an open question the source raises

Entities are deduplicated case-insensitively against existing entities per workspace, with an alias table for near-matches (`Anthropic` / `anthropic`).

### 10.3 Call 3 — Embed

Not an LLM call. Every memory's `text` is embedded at the chosen model's dimensionality (§18). Category centroids are recomputed as the mean of member embeddings after every assignment change. Entity embeddings are not computed — entity matching is lexical.

### 10.4 Call 4 — Name a structural change

Runs only when §8.4 fires. The model receives the operation type and the member memories of each resulting cluster (up to 12 sampled per cluster). It receives **no** discretion over whether to restructure.

```json
{
  "operation": "split | merge | promote",
  "names": [
    { "cluster_id": "a", "name": "string — 1-3 words, title case", "rationale": "string — one clause, shown in the change banner tooltip" }
  ]
}
```

**Naming rules:**

- 1–3 words, title case, noun phrases
- Specific enough to distinguish siblings — "Agent Frameworks" not "Tools", "Investor Notes" not "Notes"
- No generic containers: reject "Miscellaneous", "Other", "General", "Various", "Stuff"
- Must not duplicate an existing sibling name
- Must not reuse the name of a tombstoned category the user deleted

If naming fails validation, retry once. On second failure, fall back to the two highest-TF-IDF terms from the cluster's memories, joined. The structural operation still executes — a badly named category is recoverable by the user; a failed reorganization is not.

### 10.5 Model configuration

| Call | Model tier | Temperature | Structured output |
|---|---|---|---|
| Normalize (vision) | Fast multimodal | 0 | Required |
| Extract | Thorough | 0.2 | Required |
| Name | Fast | 0.4 | Required |
| Ask — rerank | Fast | 0 | Required |
| Ask — answer | Thorough | 0.3 | Required (with citations) |

All calls use structured output / tool-call enforcement. No free-text parsing anywhere in the pipeline.

---

## 11. Database entities

Postgres with `pgvector`. Types shown as TypeScript for clarity; column names are the contract.

### 11.1 `sources`

```ts
{
  id: string;                    // src_<nanoid>
  workspace_id: string;
  type: 'text' | 'link' | 'screenshot';
  title: string;                 // AI-suggested, OG title, or first 60 chars
  raw_content: string;           // pasted text | fetched article body | OCR text
  scene_description: string | null;   // screenshots only
  url: string | null;                 // links only
  image_path: string | null;          // screenshots only, object storage key
  referenced_urls: string[];          // URLs found inside text sources, not fetched
  detected_context: string | null;    // from Call 1
  summary: string | null;             // from Call 2
  status: 'pending' | 'processing' | 'complete' | 'failed' | 'no_memories';
  error_message: string | null;
  created_at: timestamptz;
  processed_at: timestamptz | null;
}
```

### 11.2 `memories`

```ts
{
  id: string;                    // mem_<nanoid>
  workspace_id: string;
  source_id: string;             // FK sources, ON DELETE CASCADE
  text: string;
  kind: 'fact' | 'decision' | 'opinion' | 'question' | 'task' | 'reference';
  confidence: number;            // 0-1
  embedding: vector(N);        // N = the embedding model's dimensionality (§18)
  x: number | null;              // persisted layout position
  y: number | null;
  pinned: boolean;               // user dragged this node
  created_at: timestamptz;
}
```

Index: HNSW on `embedding` (cosine); GIN on `to_tsvector('english', text)`.

### 11.3 `categories`

```ts
{
  id: string;                    // cat_<nanoid>
  workspace_id: string;
  parent_id: string | null;      // null = parent category. Max depth 2, enforced by trigger.
  name: string;
  rationale: string | null;      // why the AI created it
  centroid: vector(N) | null;  // mean of member memory embeddings
  memory_count: number;          // denormalized, maintained by trigger
  name_locked: boolean;          // user renamed it
  user_created: boolean;         // user created it manually
  x: number | null;
  y: number | null;
  pinned: boolean;
  created_at: timestamptz;
  created_by: 'ai' | 'user';
}
```

### 11.4 `category_tombstones`

```ts
{
  id: string;
  workspace_id: string;
  name: string;                  // normalized lowercase
  deleted_at: timestamptz;
}
```

Checked before any AI category creation. Prevents the system from recreating a category the user deliberately removed.

### 11.5 `memory_category`

```ts
{
  memory_id: string;             // FK memories, PK part 1
  category_id: string;           // FK categories, PK part 2
  confidence: number;            // similarity score at assignment
  locked: boolean;               // user moved it here — AI must never reassign
  assigned_at: timestamptz;
  assigned_by: 'ai' | 'user';
}
```

Unique constraint on `memory_id` — one category per memory (§8.5).

### 11.6 `entities`

```ts
{
  id: string;                    // ent_<nanoid>
  workspace_id: string;
  name: string;                  // canonical form
  normalized_name: string;       // lowercase, trimmed — unique per workspace
  kind: 'person' | 'project' | 'organization' | 'tool' | 'concept' | 'decision' | 'question';
  mention_count: number;         // denormalized
  x: number | null;
  y: number | null;
  pinned: boolean;
  created_at: timestamptz;
}
```

### 11.7 `entity_aliases`

```ts
{
  entity_id: string;
  alias_normalized: string;      // unique per workspace
}
```

### 11.8 `memory_entity`

```ts
{
  memory_id: string;             // PK part 1
  entity_id: string;             // PK part 2
}
```

### 11.9 `edges`

Only `relates_to` edges are materialized. `contains` and `mentions` are derived from foreign keys at query time — storing them would create a second source of truth.

```ts
{
  id: string;
  workspace_id: string;
  source_memory_id: string;
  target_memory_id: string;
  similarity: number;            // >= 0.82
  created_at: timestamptz;
}
```

Constraint: `source_memory_id < target_memory_id` lexically, to prevent duplicate bidirectional pairs.

### 11.10 `reorg_events`

The undo log and the "what has Recall been doing" feed.

```ts
{
  id: string;
  workspace_id: string;
  trigger_source_id: string;     // the capture that caused it
  operation: 'split' | 'merge' | 'promote' | 'new_category' | 'attach_only';
  status: 'applied' | 'proposed' | 'undone' | 'dismissed';
  affected_category_ids: string[];
  created_category_ids: string[];
  banner_text: string;           // rendered template, stored so history is stable
  before_state: jsonb;           // full snapshot of affected categories + memory_category rows
  after_state: jsonb;
  created_at: timestamptz;
}
```

`before_state` must be complete enough that undo is a pure restore with no recomputation.

### 11.11 `ask_history`

```ts
{
  id: string;
  workspace_id: string;
  question: string;
  answer: string | null;
  citations: jsonb;              // [{ n, memory_id, source_id }]
  refused: boolean;
  created_at: timestamptz;
}
```

### 11.12 `workspaces`

```ts
{
  id: string;
  name: string;
  auto_reorganize: boolean;      // default true
  model_tier: 'fast' | 'thorough';  // default 'fast'
  is_demo: boolean;
  created_at: timestamptz;
}
```

Single-user, single-workspace in the MVP. No `users` table, no auth. The workspace is created on first load and stored in localStorage.

---

## 12. Seed data requirements

Seed data is a **first-class deliverable**, not test fixtures. The frontend is built and demoed against it before any backend exists, and the YC demo runs on it.

### 12.1 Format and delivery

- A single committed JSON file: `seed/workspace.json`, generated by `scripts/generate_seed.py` and never hand-edited
- Shape matches the graph payload the API will return, exactly. Swapping seed for live data must be a one-line change of data source.
- Includes precomputed `x`/`y` positions for every node, so the seeded map opens in a known, hand-tuned composition rather than a random force layout. **The demo's opening frame must be art-directed.**
- Each memory carries an **8-dimensional unit vector** on `memory.vector`, generated deterministically from its theme. This replaces the precomputed similarity matrix originally specified here: a matrix cannot support 2-means clustering or centroid computation, so the SPLIT gate would have to be faked in Phase 1 and rewritten in Phase 3. With real vectors the gate code is final, and Phase 4 only swaps the seed's 8 dimensions for the real model's. Ask uses `seed/answers.json` (§12.5).

### 12.2 Volume

| Entity | Count |
|---|---|
| Sources | 22 |
| Memories | 47 |
| Parent categories | 6 |
| Child categories | 14 |
| Entities | 31 |
| `relates_to` edges | ~38 |
| `reorg_events` (historical) | 4 |

Rationale: 47 memories is enough that the map looks like accumulated knowledge and not a toy, and few enough that every label is readable at fit-to-bounds on a 1440px canvas.

### 12.3 Taxonomy

Content is the founder persona from §2.

| Parent | Children | Memories |
|---|---|---|
| **Fundraising** | Investor Notes · Pitch Feedback · Seed Benchmarks | 11 |
| **AI Tooling** | *(none — deliberately flat, see §12.4)* | 9 |
| **Hiring** | Engineering Hiring · Interview Loops | 7 |
| **Product** | Onboarding · Pricing · Design Systems | 8 |
| **Go-to-Market** | Content · Community | 6 |
| **Personal Systems** | Reading · Focus | 6 |

Source type distribution: 9 text, 8 link, 5 screenshot. **Every parent category** must draw on at least two different source types, so the map visibly represents mixed media. This is enforced at parent level rather than per leaf category: fifteen leaf categories each needing two distinct types is not satisfiable with 22 sources, and parent clusters are what the audience sees at the demo's default zoom.

### 12.4 The demo-critical seed condition

**`AI Tooling` is seeded to sit just above the SPLIT cohesion threshold.**

- 9 memories (threshold is ≥ 8 — satisfied)
- Mean pairwise cosine similarity **0.633** (threshold is < 0.62 — *not yet* satisfied, so nothing fires)
- The 9 memories divide into two latent themes of **unequal size**: 7 about agent frameworks and orchestration, 2 about evaluation and observability
- Inter-centroid distance 0.27 (threshold > 0.15 — satisfied)

Adding the demo item (§15) contributes 2 memories, both landing in the evaluation theme. `AI Tooling` reaches 11 memories, mean pairwise similarity drops to **0.591** — crossing below 0.62 — and SPLIT fires deterministically. The resulting clusters are 7 (agent frameworks) and 4 (evaluation), both above the minimum of 3.

> **The 7/2 imbalance is load-bearing, not incidental.** Cohesion only falls when the receiving theme is *small*. With a balanced 5/4 seed, adding two memories to the smaller theme raises the within-theme share of pairs from 16/36 to 25/55 and cohesion goes **up**, not down — the split would never fire. With a 7/2 seed the within-theme share falls from 22/36 to 27/55, because two new memories against seven framework memories create far more cross-theme pairs than within-theme ones. Any future reseeding must preserve an imbalanced minority theme. This is verified numerically by `scripts/generate_seed.py`, which refuses to emit a seed that does not satisfy it.

Because `AI Tooling` is a **parent** category, the parent-split branch of §8.4.2 applies: `AI Tooling` survives and gains two children, `Agent Frameworks` and `Evals & Observability`. This is deliberate — the audience keeps the node they were just looking at, and the change reads as refinement rather than the map erasing itself.

This condition must be verified by an automated test (`AC-27`, §13). **The demo cannot be allowed to depend on model luck.**

### 12.5 Scripted demo assets

Committed alongside the seed:

- `seed/demo-item.json` — the exact capture used in the demo (§15), with its pre-extracted memories and entities
- `seed/answers.json` — scripted answers with citations for 5 questions, including the two used on stage
- `seed/reorg-preview.json` — the exact `reorg_events` row the demo produces, so the animation can be replayed offline

> **Decision:** the demo runs against real logic with seeded inputs, not a hardcoded animation. The deterministic gates in §8.4.2 mean the same input always produces the same structural output — that is what makes a live demo safe. The scripted assets exist so the demo also survives a network failure, via a `?offline=1` flag that swaps the AI calls for the recorded responses at the same latencies.

---

## 13. Acceptance criteria

Each criterion is independently verifiable. The MVP is not done until all pass.

### Capture

- **AC-1** Pasting plain text and pressing `⏎` creates a source of type `text` with `raw_content` matching the input byte-for-byte.
- **AC-2** Pasting a bare URL creates a source of type `link` with title, description, and hero image populated from Open Graph tags when present.
- **AC-3** Pasting text that *contains* a URL creates a `text` source, records the URL in `referenced_urls`, and does not fetch it.
- **AC-4** Pasting an image from the clipboard creates a `screenshot` source with a stored image, OCR text, and a scene description.
- **AC-5** Dragging an image onto the map canvas opens the capture bar with the image attached.
- **AC-6** The capture modal closes immediately on submit; the map is interactive during the entire processing window.
- **AC-7** Capturing while another item is processing queues the second item and shows a queue badge; items process serially.

### Extraction

- **AC-8** Every extracted memory is 8–30 words, third person, and contains no unresolved pronoun.
- **AC-9** A source producing zero memories is still persisted, appears in Sources with status `no_memories`, and surfaces the §7.4 toast.
- **AC-10** Every memory is linked to exactly one category and to its originating source.
- **AC-11** Entities matching an existing entity by normalized name or alias reuse the existing entity row rather than creating a duplicate.

### Map

- **AC-12** The map opens in under 1.5s to first painted node with the seed workspace.
- **AC-13** Node positions are identical across two consecutive page loads with no intervening changes.
- **AC-14** Level-of-detail thresholds (§5.1) render correctly at zoom 0.5, 0.8, 1.2, and 2.0.
- **AC-15** Hovering a node dims unconnected elements to 40% and brightens connected edges.
- **AC-16** Dragging a node pins it; the pin survives a page reload and subsequent simulation runs.
- **AC-17** The map remains above 30fps while panning and zooming with 600 memory nodes.

### Reorganization

- **AC-18** Capturing an item that crosses a SPLIT gate produces exactly one structural operation, never two.
- **AC-19** The animation sequence completes in 2.4s ±200ms measured from server response to banner appearance.
- **AC-20** If the affected category is off-screen, the camera pans it into view before the structural change renders.
- **AC-21** The change banner text matches the §8.4.5 template for the operation performed.
- **AC-22** `Undo` restores the exact prior structure — same category IDs, names, and memory assignments — verified by comparing against `before_state`.
- **AC-23** A category with `name_locked` or `user_created` is never split, merged, promoted, or renamed by a reorganization pass.
- **AC-24** A `memory_category` row with `locked = true` is never reassigned by a reorganization pass.
- **AC-25** A category name matching a `category_tombstones` entry is never created by the AI.
- **AC-26** With `auto_reorganize = false`, the operation is written as `proposed` and nothing on the map changes until the user applies it.
- **AC-27** *(Demo-critical)* Ingesting `seed/demo-item.json` into the seed workspace deterministically triggers exactly one SPLIT on `AI Tooling`, producing two child categories with 7 and 4 memories and leaving `AI Tooling` itself intact with zero directly-attached memories. Verified by an automated test that runs on every commit.

### Correction

- **AC-28** Dragging a memory to another category in either Map or Tree sets `locked = true` and `assigned_by = 'user'`.
- **AC-29** Renaming a category sets `name_locked = true` and shows the lock chip in the Inspector.
- **AC-30** Deleting a category re-parents its memories to the category's parent and deletes zero memories.
- **AC-31** Attempting to nest a child category under another child is rejected with the §5.5 message.

### Search and Ask

- **AC-32** Search results render within 150ms of the last keystroke.
- **AC-33** Every sentence in an Ask answer carries at least one citation.
- **AC-34** Every citation resolves to a memory that exists and to its originating source.
- **AC-35** A question with no relevant saved content returns exactly *"I don't have anything saved about that yet."* and cites nothing.
- **AC-36** Cited nodes highlight on the map and all other nodes drop to 15% opacity.
- **AC-37** Asking a question that could be answered from world knowledge but is absent from the corpus triggers the refusal in AC-35. *(Verification: ask "What is the capital of France?" against the seed workspace.)*

### States

- **AC-38** All four state categories (§7) are implemented for Map, Tree, Sources, Inspector, and Ask.
- **AC-39** A failed URL fetch still persists the source and shows the recovery affordance.
- **AC-40** With the network disabled, the map remains browsable and the offline banner appears.
- **AC-41** At a viewport below 1280px, the desktop-only message renders.

### Sequencing

- **AC-42** The frontend renders the complete seed workspace, supports all Map/Tree/Inspector/Search interactions, and plays the full reorganization animation from `seed/reorg-preview.json` — **with no backend running.**

---

## 14. Out of scope

Not built in the MVP. Listed so nobody relitigates them mid-build.

**Platforms and surfaces**
- Mobile app (iOS/Android) and any responsive mobile layout
- Browser extension
- Desktop/Electron app and any filesystem watcher
- Email forwarding, share-sheet targets, webhooks, public API

**Integrations**
- Instagram API or saved-posts import. Instagram content enters by pasting the caption, the link, or a screenshot. This is what the demo shows.
- Notion, Obsidian, Slack, Google Drive, Readwise, Pocket, or any other sync
- Calendar integration
- Automatic meeting recording, transcription, or diarization. Meeting notes enter as pasted text.

**Input types**
- PDF, DOCX, CSV, or any file upload other than images
- Audio or video ingest
- Batch import, multi-file drop, or bulk paste
- Web crawling beyond the single pasted URL

**Collaboration and accounts**
- Multi-user, sharing, permissions, comments, team workspaces
- Authentication, sign-up, billing, plans
- Multiple workspaces per user

**AI surface area**
- Multi-turn conversation or follow-up questions in Ask
- Proactive surfacing, digests, notifications, spaced repetition, "on this day"
- AI-generated summaries of categories or of the whole workspace
- Automatic memory deduplication or contradiction detection
- Custom extraction prompts or user-configurable taxonomy rules
- Learning a per-user extraction style from corrections beyond the lock mechanism in §6.3

**Graph and taxonomy**
- Taxonomy deeper than two levels
- Multiple categories per memory
- Manual edge creation between memories
- Timeline, calendar, map-of-place, or matrix views
- Graph filtering by date, source type, or entity kind
- Full-corpus re-clustering, on demand or scheduled

**Operational**
- Export (JSON, Markdown, or otherwise)
- Undo beyond reorganization events, and beyond the current session
- Version history for memories or categories
- Analytics, telemetry dashboards, admin tooling
- Onboarding tour, tooltips-on-first-run, help center

---

## 15. YC demo — script and click path

**Duration:** 60 seconds. **Setup:** seed workspace loaded, browser at 1512×982, Inspector collapsed, camera at fit-to-bounds. Second monitor is disconnected. `?offline=1` is *not* set unless the venue's network has failed.

### 15.1 The narrative arc

Three beats: **recognition** → **the magic** → **the payoff**. One idea per beat.

### 15.2 Script

**Beat 1 — Recognition (0:00–0:15)**

> *"This is everything I've saved in the last three months. Instagram posts, screenshots, links, meeting notes. Recall read all of it and filed it — I never tagged anything."*

`[0:00]` The app opens on the **welcome screen** — one line, one text box. Press Enter to go in (or type a real question, which is answered before the arc appears).
`[0:03]` The **arc browser**: six category stones fanned above the figure, sized by how much each holds.
`[0:06]` Click **Fundraising** → its three subcategories fan out and 11 memories fill the reading list.

> *"None of these categories are mine."*

`[0:10]` Press `G` → the same corpus as the map, and the colour comes back.

> *"And the same thing as a map, for when I want the shape of it rather than the list."*

`[0:11]` Hover **Fundraising** → the cluster brightens, 11 memories visible.
`[0:14]` `Esc`. Camera returns to fit.

Beat 2 must run on the map: the reorganization choreography (§8.4.5) is a canvas animation and has no folder-browser equivalent in Phase 1.

---

**Beat 2 — The magic (0:15–0:38)**

> *"Here's a screenshot I took this morning of a thread about eval tooling."*

`[0:17]` `⌘V` — the screenshot is already on the clipboard. Capture bar opens with the image attached, type chip reads **Screenshot**.
`[0:19]` `⏎`. Modal closes. Ghost node appears at the canvas edge.
`[0:20–0:26]` Status ticker runs: `Reading…` → `Extracting memories…` → `Finding connections…` → `Reorganizing…`

> *"It's reading the image, pulling out what's worth remembering, and figuring out where it belongs."*

`[0:26]` Two memory nodes travel to **AI Tooling**.
`[0:27]` Camera pans slightly — **AI Tooling** is now centered.
`[0:28]` **AI Tooling** desaturates, then two child nodes emerge from it and push apart. Memories redistribute into them. **AI Tooling** itself stays put.
`[0:30]` Banner: **Split AI Tooling into Agent Frameworks and Evals & Observability.**

> *"And that's the part I care about. It didn't just file it — it noticed that what I've been saving about AI tooling is actually two different things, and it reorganized around that. I never told it those categories existed."*

`[0:36]` Pause. Let the new structure sit on screen.

---

**Beat 3 — The payoff (0:38–0:58)**

`[0:38]` `⌘/`

> *"And now I can ask it things."*

`[0:40]` Type: **"What did we decide about our eval stack?"** `⏎`
`[0:43]` Answer streams into the Inspector. Three cited memories highlight on the map; everything else dims.

> *"Two sentences, and every claim points back to the thing I actually saved — including the screenshot from thirty seconds ago."*

`[0:50]` Click citation `[3]` → camera flies to the memory → Inspector shows the original screenshot.

> *"That's Recall. Everything you save, organized by itself, answerable in one question."*

`[0:58]` End on the map with the new structure visible.

### 15.3 Exact click path

```
1.  Load app                              → map at fit-to-bounds
2.  Hover node "Fundraising"              → cluster highlight
3.  Click node "Investor Notes"           → Inspector Mode A
4.  Esc                                   → clear selection, camera to fit
5.  ⌘V (screenshot on clipboard)          → capture bar, image attached
6.  ⏎                                     → modal closes, ghost node, ticker
7.  (wait ~6s)                            → memories travel, SPLIT animation, banner
8.  ⌘/                                    → ask bar
9.  Type "What did we decide about our eval stack?" + ⏎
10. (wait ~3s)                            → answer streams, nodes highlight
11. Click citation [3]                    → camera flies, Inspector Mode B → source
12. Esc                                   → clear highlight, end frame
```

### 15.4 Demo risk controls

| Risk | Control |
|---|---|
| Model produces a different structural change | Gates are deterministic (§8.4.2); seed is tuned to a single firing operation (§12.4); verified by AC-27 on every commit |
| Network failure at the venue | `?offline=1` replays `seed/demo-item.json` and `seed/answers.json` at recorded latencies. Rehearse both paths. |
| Processing exceeds the narration | p95 budget is 12s; the ticker gives the presenter four labeled beats to talk over |
| Reorganization happens off-screen | Camera pan is mandatory (AC-20) |
| Map opens in an ugly layout | Seed positions are hand-tuned and committed (§12.1) |
| Presenter clicks something unrecoverable | `⌘Z` undoes the reorganization; a full workspace reset is one item in Settings |
| Answer cites nothing / refuses | AC-33/34 enforced; demo question is fixed and rehearsed against the seed |

**Rehearsal requirement:** the full click path must be run end-to-end at least 20 consecutive times without deviation before demo day, **on the demo machine**. Automated as `npm run rehearse` — see `docs/demo-runbook.md` for the operational procedure, failure recovery, and measured timings.

> **On the offline path.** The `?offline=1` control above is a Phase 4 item, not a Phase 1 one. Phase 1 makes zero network requests — the rehearsal harness fails a run if any request leaves the page — so an offline flag would be a no-op flag today. It becomes a real risk control when a live backend is introduced.
>
> **Measured over 20 clean runs** (development machine): first paint 0.06s median against a 1.5s budget; submit-to-banner 7.44s median with 0.02s spread; whole path 8.21s median with 0.16s spread. The demo is therefore **narration-paced, not machine-paced** — the 60-second target is roughly 47 seconds of speaking, and the only enforced wait is the processing beat, which exists to be talked over.

---

## 16. Build sequencing

Mandatory order. Each phase ends with a demoable artifact.

**Phase 1 — Seed data.** Author `seed/workspace.json` with all 47 memories, hand-tuned positions, and the §12.4 split condition. Author the demo assets. Nothing else starts until this file exists, because it is the shared contract between frontend and backend.

**Phase 2 — Frontend against seed only.** Full app shell, Map, Tree, Inspector, Capture bar, Search, Ask, all four state categories, and the complete reorganization animation played from `seed/reorg-preview.json`. **No backend, no API calls.** Exit criterion: AC-42, plus the entire §15 click path runs against seed. This is a fully demoable product.

**Phase 3 — Backend pipeline.** Schema, ingest endpoints, the four AI calls, embedding, category assignment, the reorganization engine with its deterministic gates. Validated by tests against seed inputs, headless.

**Phase 4 — Integration.** Swap the frontend's data source from seed to API. AC-27 must pass live.

**Phase 5 — Hardening.** Error paths, offline mode, latency tuning, rehearsal.

> **Decision:** the frontend-first constraint is not a preference, it is a risk control. The riskiest part of this product is whether the reorganization moment *feels* magical, and that is answerable in Phase 2 with zero AI infrastructure. If the animation does not land against seed data, it will not land against real data either, and it is far cheaper to discover that in week one.

---

## 17. Visual design direction

The constraint is: **personal intelligence, not SaaS admin dashboard.** Concretely.

**What this rules out:** a top nav bar with a logo and avatar; a left sidebar of labeled nav items; cards in a grid; a data table anywhere; blue-and-white; empty states with cartoon illustrations; a settings page with twelve sections; anything that looks like it has a Pricing page.

**Direction:**

- **Dark, spatial ground.** Near-black canvas (`#0A0A0B`–`#0E0E10`). The map is a field you look into, not a document you look at. Light mode is out of scope.
- **One accent, used sparingly.** A single warm accent for categories and active state. Entities get one secondary hue. Everything else is neutral. A rainbow taxonomy reads as a chart; a restrained one reads as an instrument.
- **Typography carries the interface.** One family, tight tracking, real hierarchy through weight and size rather than boxes and borders. Memory text is the largest text in the Inspector — the content is the interface.
- **No borders, no cards.** Separation comes from spacing and from subtle elevation on the two floating surfaces (command bar, change banner). Everything else sits directly on the ground.
- **Motion is physical and rare.** Only three things animate: the map settling, the reorganization sequence, and camera movement. Nothing pulses, bounces, or shimmers for decoration. When something moves, it means something happened.
- **Density is respected.** This user reads dashboards for a living. Do not pad, do not center single-column layouts in an ocean of whitespace, do not hide information behind progressive disclosure.
- **The product name appears once,** in the left rail. There is no header.

**Reference feeling:** an observatory instrument or a synth panel — dark, dense, purposeful, everything on screen because it is being used. Not Linear, not Notion, and specifically not a dashboard template.

> **Amended (Phase 1, post-implementation) — the browsing screen is not an instrument.**
>
> The direction above still governs the **map**, the capture bar, the change banner, Sources, and the Inspector. It no longer governs the **arc browser**, which was rebuilt against a different reference: a photograph of someone sitting on a hilltop under a violet night sky. There is **one screen**, not a welcome and then a browser. The app opens on the hilltop with the chat box already docked at the bottom and nothing on the arc; "look around" fans the categories into the sky above the figure. Nothing navigates and nothing is replaced — §4.1's welcome-then-enter sequence is withdrawn, and with it the rule that the first frame carries no rail and no inspector. A screen you arrive at implies a screen you left, and the product is one place you stay in. The sky spans the whole window rather than the middle column, because confined to the column it read as a violet panel bolted between the rail and the inspector; both are transparent. The gradient's stops are placed against the hill's crest at 72% so the pale band at the horizon is visible above it. The accent tokens are still grey, so `G` still means colour arriving. Earlier versions — a head in profile, a pair of heads back to back, and five attempts at Rodin's *Thinker* — are in the git history. The lesson from the Thinker is recorded in `Thinker.tsx`: that sculpture is legible through anatomy at a dozen scales at once, and none of it survives at a hundred pixels.
>
> Concretely, four rules above are deliberately broken there, and only there:
>
> - *"A rainbow taxonomy reads as a chart."* The browsing screen is **monochrome** — the accent tokens are re-pointed to grey on `.shell--mono`. Colour is now a mode signal: calm and grey when you are looking things up, warm and amber the moment you press `G` into the map. Categories are stone **forms**, not hues — each outline derived from its id, so a category is recognisable before you have read its label — and the single-accent rule is intact everywhere it still applies.
> - *"No cartoon illustrations."* A faceless, human-proportioned figure — someone sitting with their knees drawn up, looking out — sits at the arc's focus. Faceless is load-bearing: an expression tells you what to feel, a silhouette lets you project.
> - *"Motion is physical and rare."* The figure breathes and the arc fans out on every descent. Both sit behind `prefers-reduced-motion`.
> - *"Do not hide information behind progressive disclosure."* A radial menu is progressive disclosure by construction: it shows 6 categories where the list showed all 20. This is the real cost of the change and it is accepted knowingly — the reading list below the arc still carries full density, and search reaches everything from anywhere.
>
> The reason for the trade: this is a personal memory, and browsing one should feel like wandering rather than working an inbox. §17's original register is right for the surface where reorganization happens and wrong for the surface where you go looking.

---

## 18. Open items deliberately left to implementation

These are engineering choices, not product choices. The implementer decides.

- Frontend framework, graph rendering library (Canvas or WebGL required for the 600-node performance target in AC-17 — SVG will not hold 30fps)
- Backend language and framework
- Hosting, object storage provider
- Specific model vendor and model IDs per tier (§10.5 specifies tier and temperature only)
- Embedding model and its dimensionality, provided it is consistent across the corpus. *(Earlier drafts of this spec required 1536 dimensions. That number came from OpenAI; Anthropic offers no embedding endpoint and its docs recommend Voyage AI, whose `voyage-4` family defaults to 1024 with options of 256/512/2048 — there is no 1536. Dimensionality is now free, and `VECTOR_DIM` in `src/data/validateSeed.ts` is the single place it is declared.)*
- Test framework

Any decision in this list that turns out to have a product-visible consequence — particularly rendering performance and processing latency — escalates back to this spec rather than being absorbed silently.
