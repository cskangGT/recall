# Recall — Phase 1

A personal AI memory agent. Paste in a note, a link, or a screenshot; Recall breaks it into
atomic memories, files them into a self-organizing map, and answers questions with citations.

**Phase 1 is the complete 60-second YC demo running on committed seed data with zero backend.**
No server, no database, no AI calls. Every restructuring decision is real geometry over real
vectors — Phase 4 swaps the data source and the gate code does not change.

## Run it

There are two things you might mean by that, and they are different commands.

### Your own instance

```bash
npm install
npm start            # http://127.0.0.1:5170 — desktop only, 1280px minimum
```

Empty on first run. Paste something and it reads it, files it, and a star
appears. Needs `OPENAI_API_KEY` in `.env.local` — extraction costs roughly a
cent a capture, embeddings a rounding error beside it.

**Your memories live in `~/.recall/recall.db`.** Not in this checkout, which is
a directory you might delete or re-clone. Nothing backs that file up: copying it
somewhere is how you keep it, deleting it is how you erase everything, and it is
the one file worth knowing the location of.

It binds `127.0.0.1` and refuses to bind anything else unless `RECALL_INVITE` is
set. A tool holding your notes should take a deliberate act to become reachable.

A page you are merely *visiting* cannot write to it: writes are gated on the
`Origin` header, which a browser attaches to every non-GET and a page cannot
forge, and reads are gated on `Host`, which is what stops DNS rebinding. Neither
is theoretical — before those checks a tab you had open could have run
`fetch('http://127.0.0.1:5170/…/reset', {mode:'no-cors'})` and deleted
everything. See `originAllowed` in `server/http/routes.ts`.

### Always on

`npm start` dies with its terminal. That is fine for something you open on
purpose and fatal for something you reach for with a keystroke — a capture that
fails because the server happened not to be running is worse than no shortcut at
all, because you find out later.

```bash
npm run agent:install     # starts at login, restarts if it dies
npm run agent:restart     # after `npm run build`
npm run agent:uninstall   # your memories are untouched
npm run agent:plist       # print the plist without installing anything
```

Your keys are copied to `~/.recall/env` (mode 0600), not into the plist — a
plist value comes back out of `launchctl print`, and that file is the first
thing you read when something is wrong. `.env.local` keeps working for
`npm start`.

**The checkout cannot live in Desktop, Documents, Downloads, or iCloud Drive.**
macOS gates those with privacy controls, and a background agent has no way to
ask for consent — so it does not fail, it *hangs*: `launchctl print` says
`state = running`, the logs are empty, and nothing is listening. The installer
refuses and tells you where to move to. (Granting Full Disk Access to `node`
would also "work", and would hand that access to every script you ever run with
it.)

If the agent is installed but nothing answers, check **System Settings →
General → Login Items → Allow in the Background**. Turned off there, a
LaunchAgent silently never runs. Then `launchctl print gui/$(id -u)/com.recall.server`
and `~/.recall/logs/server.err.log`.

### Saving from the browser

```
chrome://extensions → Developer mode → Load unpacked → extension/
```

`⌘⇧K` saves the page you are reading — or just the part you selected. A
notification tells you where it landed: *"Saved 3 things → to Software Rewrite
Decisions."* The toolbar button does the same thing.

Chrome silently declines a shortcut that conflicts with something else, so if
nothing happens, check `chrome://extensions/shortcuts`.

The extension is what makes links work. `type: 'link'` is stored and never
fetched — there is no `fetch(` anywhere in the pipeline — and putting the fetch
in the browser is better than putting it in the server on every axis: no
bot-blocking, no paywall, no interstitial, because it saves the page you can
actually see, signed in as you. It also keeps a URL-fetching proxy out of a
service that now runs all day on localhost.

It sends at most 20,000 characters — a long-form article in full — and refuses
below 200, because an empty source that extracts nothing looks like it worked.

**Safari** needs more than a copy. `xcrun safari-web-extension-converter extension/`
produces an Xcode project, and running it needs Xcode plus either a signing
identity or Develop → "Allow Unsigned Extensions", which resets every time
Safari launches. Two things also need changing after the conversion:
`chrome.notifications` is unsupported, and the shortcut has to be assigned by
hand. That is the honest state of it, not "coming soon".

### The demo

```bash
npm run dev          # http://localhost:5173 — the seeded 47, no backend, no keys
npm run demo         # the same corpus, but through the real server
```

The seed is fictional and committed, which is what makes the demo reproducible
and what makes it the wrong thing to open your own instance with.

## The demo

| Key | What happens |
|---|---|
| — | The app opens on a hilltop under a starfield, someone sitting on the crest, the chat box docked at the bottom. Ask a real question, or press `⏎` to look around. |
| — | Looking around fans **6 category stones** into the sky above the figure — 47 memories from 22 sources. No screen changes; the categories arrive where you already are. |
| drop | Drag a screenshot anywhere on the window. Recall reads it and tells you what it saw, what was new, what echoes something you already saved, and where it filed it. |
| `G` | The same corpus as a map, and the colour comes back. Beat 2 needs this — the split animation only plays here. |
| `⌘K` | Capture bar — also the `+` at the head of the chat box. Type anything and press `⏎`. |
| — | Ghost node → `Reading… → Extracting… → Finding connections… → Reorganizing…` → **AI Tooling splits into Agent Frameworks and Evals & Observability** |
| `⌘/` | One bar, two modes. A keyword searches as you type; a question is answered. The chip tells you which, and `⏎` does what the chip says. |
| `⌘Z` | Undo the reorganization. |
| `T` / `G` / `S` | Browse / Map / Sources. Selection carries across, and the map centres on it. |
| `,` | Settings — three switches, not a screen. |

## Three surfaces, one corpus

**Ask** (`⌘/`) is the product: a question, an answer, and every claim pointing back at
something you actually saved. The other two are how you read what it pulled.

**Browse** (`T`, and the landing view) is the manual mode — categories fanned in an arc
above the seated figure, with the open category's memories in a reading
list below. Each stone is sized by how much is in it, and its outline is derived from the
category's id, so you learn a category by its silhouette. Click one to descend into its
subcategories; `←`, `Backspace` or `Esc` climbs back out. An answer arrives as a folder of
its own, the prose on top and the memories it cited below, draggable like anything else.
**Drag a memory onto any stone to re-file it** — a hand-moved memory locks, and no
reorganization pass will ever reclaim it. A subcategory can be dragged onto the
**Move this group under** panel to re-parent it; dropping it on a sibling is refused with
a shake, because the taxonomy is exactly two levels.

It is the same hilltop as the welcome screen, an hour later — the sky runs the width of
the window, the crest lands on the arc's focus, and the categories fan out into the sky
above the figure. Everything you operate is still **monochrome**: colour is a mode signal,
grey while you are looking something up, amber the moment you press `G`.

**Map** (`G`) is the big-picture mode — the shape of what you know rather than the list,
and the only surface where a reorganization is animated.

## Verify

```bash
npm test             # 487 unit and server tests
npm run test:e2e     # 95 Playwright tests, including the full spec 15.3 click path
npm run seed         # regenerate seed/, re-checking every gate condition
npm run rehearse     # 20 consecutive demo runs with per-beat timing (spec 15.4)
```

`npm run test:e2e` fails if any request touches an `/api/` path — "zero backend" is a
checked condition, not a promise. `npm run rehearse` is stricter still: it fails the run
if *any* request leaves the page.

### What no test can check

Six things that need a machine, a browser, and you. Re-run this after any
reinstall — most of it is one-time setup that fails silently when it regresses.

1. **It survives a logout.** Log out and back in, then
   `launchctl print gui/$(id -u)/com.recall.server`. `~/.recall/logs/server.log`
   must show `ai provider: openai` — if it says `fixture`, the agent started
   without your keys and every capture since has been scripted demo output that
   looks entirely plausible.
2. **It survives a crash.** `kill -9 $(pgrep -f 'server/http/main.ts')`, then
   reload `http://127.0.0.1:5170`. Back within ten seconds.
3. **Chrome actually took the shortcut.** `chrome://extensions/shortcuts` should
   list `⌘⇧K` against Recall. Chrome declines a conflicting one without saying so.
4. **A long article.** `⌘⇧K` on something real. The notification should name a
   category, and Sources should show the page's title — not the first sixty
   characters of its body.
5. **A selection.** Highlight one paragraph and `⌘⇧K`. Only that paragraph is
   stored. Then `⌘⇧K` on `chrome://extensions` — it should decline politely and
   write nothing.
6. **The hole is closed.** From the console of any https page:
   ```js
   fetch('http://127.0.0.1:5170/api/workspaces/ws_demo/reset', {method:'POST', mode:'no-cors'})
   ```
   Your corpus must still be there. This is the one that matters — before the
   `Origin` check that request deleted everything and the page could not even
   read the response to know it had worked.

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

## Running on real models

Both providers are implemented. The server picks them up when **both** keys are
present, and stays on the fixture otherwise — half-live (real embeddings, scripted
names) fails in ways that are very hard to read from outside.

```bash
export ANTHROPIC_API_KEY=...      # extract / name / answer  (claude-opus-5)
export VOYAGE_API_KEY=...         # embeddings               (voyage-4, 1024-dim)

RECALL_DB=recall.db npm run reembed   # 8-dim seed vectors -> 1024-dim, atomically
RECALL_DB=recall.db npm run dev:api
```

`RECALL_AI=fixture` forces the fixture back on even with keys set — that is what
the demo and the E2E suite run against, and what keeps them free and deterministic.

**Re-embedding is not optional before going live.** The seed ships 8-dimensional
hand-authored vectors; Voyage returns 1024. Skipping it leaves stored memories in
one space and every query in another, which does not fail loudly — retrieval just
quietly stops working. `replaceMemoryVectors` is all-or-nothing for the same reason.

What is *not* verified: the live calls themselves. Everything that can fail without
a network — malformed output, hallucinated citations, illegal category names,
mis-ordered embedding batches — is covered by `tests/server/prompts.test.ts` (29
cases). The request round-trip needs a key.

### The threshold, measured against a real model

`0.62` was fitted to the seed's hand-generated 8-dimensional vectors, and cosine distributions
differ enormously between embedding models. Measured on `openai/text-embedding-3-small` (1536-dim):

```
AI Tooling   seed        n=9   cohesion=0.2620   clusters 7/2
             after demo  n=11  cohesion=0.2467   clusters 7/4
Suggested MAX_MEAN_COHESION: 0.2544   (must sit in 0.2467-0.2620, margin 0.0153)
PASS
```

So the number does not transfer — 0.25 rather than 0.62 — but the **mechanism** does, and that is
the part worth checking. It did not, at first: the original seed made cohesion *rise* by 0.0139
when the demo item landed, and no threshold fixes a direction. The cause was content, not code —
the minority theme shared vocabulary with the majority, and one demo memory nearly restated a
seeded one. The two themes are re-authored, and the harness is what proved it.

```bash
pip install openai && export OPENAI_API_KEY=...      # or voyageai + VOYAGE_API_KEY
npm run thresholds -- --provider openai --model text-embedding-3-small
npm run thresholds:selfcheck    # no API key: replays the seed vectors to prove the harness agrees
                                # with src/reorg/vectorMath.ts
```

The harness reports three things, and the third is the one that matters: whether cohesion still
*drops* when the demo item lands, what `MAX_MEAN_COHESION` should become, and whether that value
would also fire on some other category — which would break "at most one structural operation per
ingest" and take the demo with it. It cannot here: `SPLIT_MIN_MEMORIES` is 8 and no other category
holds more than 4.

**Still open:** the app is wired to `voyage-4` (1024-dim) and the measurement above is OpenAI's.
Either add a `server/ai/openai.ts` mirroring `voyage.ts`, or get a Voyage key and re-measure —
`MAX_MEAN_COHESION` must come from whichever model actually runs.

## Deploy

Phase 1 is the whole demo with **no backend and no environment variables**. It is
a static SPA: build it and serve the folder.

```bash
npm ci
npm run build          # -> dist/, self-contained
```

The bundle makes no requests that leave the page — `npm run rehearse` fails the
run if one does, so that is a checked property rather than a hope. The
`example.com` links in `seed/` are source provenance and are never fetched.

Assets are referenced from the site root (`/assets/…`), which is right for
Vercel, Netlify, Cloudflare Pages or any apex deploy. **Serving from a subpath**
— GitHub Pages at `/<repo>/`, say — needs `base: './'` in `vite.config.ts`. The
app has no router, so relative paths are safe here; the reason not to set it
pre-emptively is that it should be a decision made against a host, not a default
nobody remembers choosing.

Three things that will otherwise be rediscovered the hard way:

- **The app requires a viewport ≥1280px** and renders "Recall is desktop-first"
  below it. On a phone a correct deploy looks like a broken one.
- **Keys belong to the host, never the repo.** The optional API server
  (`server/`, `npm run dev:api`) reads `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`
  from the environment. `.gitignore` covers `.env*` except `.env.example`, and
  nothing else should change that.
- **`npm run reembed` before the API server serves anything.** The seed ships
  8-dimensional hand-authored vectors and Voyage returns 1024. Skipping it does
  not fail loudly — retrieval quietly stops working, which is the worst kind of
  broken to debug on a host.

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

## Corrections

Two ways to disagree with Recall, and both are permanent:

- **Drag a memory** onto another category — "not there".
- **Click a category's name** in the Inspector to rename it — "not that".

Renaming locks the category. `gates.ts` drops locked categories before any
scoring, so a category you named stops being a restructuring candidate
altogether — rename `AI Tooling` and the demo's own split no longer fires.
That is spec 4.2's trust loop: the AI does the work, the user keeps authority.

## Settings

Three controls, reached with `,`. Everything there does something; nothing there
is a preference — spec §17 rules out a settings page and is right to.

- **Auto-reorganize.** Off means new items still get filed, the structure just
  stops moving without you. The field had been in the schema and the payload
  since Phase 3 and was read by nobody.
- **Data source**, and a way to force `?offline=1`. Spec §15.4 promises the demo
  survives a venue whose network has failed; offline is not a second
  implementation, it is a refusal to reach for the server, and it beats `?api=1`
  because a flag reached for in a panic must not lose an argument to another flag.
- **Reset the workspace**, back to the 47 seeded memories.

## Not built yet

- **Screenshots.** Pasting an image sets a boolean and sends the path of a demo
  file that is not in this repository. `normalize` implements real vision
  against both providers; what is missing is an upload — the server reads JSON
  only, and `imagePath` is an unchecked `fs.readFile` path taken from the
  request body.
- **Capture outside the browser** — a macOS-wide shortcut for a PDF, a Slack
  message, or a thought. The extension covers what you read; nothing covers the
  rest.
- Proposal mode. See `docs/spec-review-summary.md`.

Two things that are fine now and will not stay fine:

- `getGraphPayload` returns the full `raw_content` of every source, and page
  saves make that articles. Roughly 200 of them is ~4MB on every load.
  `includeGraph: false` only spares the extension.
- `migrate()` is `CREATE TABLE IF NOT EXISTS` only, so it can create tables but
  not alter them. Now that the agent owns `~/.recall/recall.db` all day, that
  file has stopped being disposable — an idempotent `ALTER TABLE … ADD COLUMN`
  guarded by `PRAGMA table_info` is insurance best bought before it is needed.
