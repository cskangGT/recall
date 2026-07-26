# Recall — demo runbook

The operational companion to spec §15. That section says what the demo *is*; this says how to
run it, what to do when something goes wrong, and what has actually been measured.

---

## The one thing to internalise

**The demo is narration-paced, not machine-paced.** Measured across 20 clean runs, the machine
work takes about **8.2 seconds**. The 60-second target is roughly **47 seconds of you talking**.

You are not racing the app. The only place it makes you wait is the ~7.4-second processing beat
in the middle, and that beat is scripted with four labelled stages precisely so you have
something to talk over. If you feel rushed, you are talking too fast, not clicking too slow.

---

## Before you start

```bash
cd recall-mvp
npm install
npm run dev            # http://localhost:5173
```

| Check | Why |
|---|---|
| Browser window ≥ 1280px wide | Below that the app renders "Recall is desktop-first" (AC-41) — correct behaviour, terrible on stage |
| Second monitor disconnected, or mirroring set deliberately | Window width changes the map's fit-to-bounds framing |
| Inspector visible (it is by default) | Beats 1 and 3 both read from it |
| Browser zoom at 100% | Zoom changes the effective viewport and can trip the 1280px gate |
| Notifications silenced | A banner over the map during the split is the one interruption you cannot talk through |
| Page freshly reloaded | Reload is a full reset — see below |

**Reset between runs is just a page reload.** Nothing persists: no localStorage, no backend, no
database. Every run starts from the identical 47-memory seed with the identical hand-tuned layout.

> **Unless you are running API mode** (`?api=1`, with `npm run dev:api`). Then the corpus lives in
> a database and a reload no longer resets anything — captures and corrections accumulate across
> runs. Reset explicitly:
>
> ```bash
> curl -X POST http://localhost:5173/api/workspaces/ws_demo/reset
> ```
>
> **Demo on the default seed mode.** API mode exists to prove the backend works, not to present
> from. It has one more moving part, no rehearsal history, and a reset you have to remember.

---

## The path

Twelve steps, per spec §15.3. Timings are median across 20 measured runs.

### Beat 1 — recognition (~0:00–0:15)

| Do | Say |
|---|---|
| Load the page. Map paints in **0.07s**. | *"This is everything I've saved in the last three months. Instagram posts, screenshots, links, meeting notes. Recall read all of it and built this."* |
| Hover **Fundraising** — the cluster brightens, everything unconnected dims. | |
| Click **Investor Notes**. Inspector shows the path, 4 memories, mixed source icons. | *"I never tagged or filed any of this."* |
| `Esc` | |

Optional, if the room is technical: press `T` for the tree, then `G` to come back. Selection
carries across and the map re-centres on it. Adds ~8 seconds.

### Beat 2 — the magic (~0:15–0:38)

| Do | Say |
|---|---|
| `⌘K`. Bar opens over a dimmed map. | *"Here's a screenshot I took this morning of a thread about eval tooling."* |
| Paste or type anything. `⏎`. | |
| Ghost node appears; ticker runs four stages over **~7.4s**: `Reading…` → `Extracting memories…` → `Finding connections…` → `Reorganizing…` | *"It's reading the image, pulling out what's worth remembering, and figuring out where it belongs."* |
| Two memories fly into **AI Tooling**; the camera pans it into frame; it desaturates; two children emerge and push apart. | |
| Banner: **Split AI Tooling into Agent Frameworks and Evals & Observability** | *"And that's the part I care about. It didn't just file it — it noticed that what I've been saving about AI tooling is actually two different things, and it reorganised around that. I never told it those categories existed."* |
| **Pause.** Let the new structure sit. | |

### Beat 3 — the payoff (~0:38–0:58)

| Do | Say |
|---|---|
| `⌘/` | *"And now I can ask it things."* |
| Type **What did we decide about our eval stack?** `⏎`. Answer appears in **~0.01s**. | |
| Three citations light up on the map; everything else drops to 15%. | *"Two sentences, and every claim points back to the thing I actually saved — including the screenshot from thirty seconds ago."* |
| Click citation **[3]** → camera flies to the memory → source card reads *Thread on eval harnesses*. | *"That's Recall. Everything you save, organised by itself, answerable in one question."* |

End on the map with the new structure visible.

---

## Two things about Phase 1 you must know before you improvise

**1. Any capture produces the same result.** Phase 1 has no AI. `⌘K` with any text, any link, or
any image ingests `seed/demo-item.json` and fires the same split. This is a feature for rehearsal
— you can practise without a clipboard set up — and a trap for improvising. If someone in the
audience says *"try adding something about hiring"*, you will still get the eval-tooling split.
Don't take audience input on the capture step.

**2. Capturing twice does nothing.** The second capture detects the item is already present and
shows *"Already saved — this is the demo item."* No error, no second split. Safe, but it means you
cannot demo two consecutive reorganizations. Reload for a second run.

---

## When it goes wrong

| Symptom | Do this |
|---|---|
| You split by accident, before you meant to | `⌘Z`, or **Undo** on the banner. Restores the pre-split taxonomy (20 categories). The captured memories stay — undo reverses the *reorganization*, not the capture. Reload for a truly clean slate. |
| Banner auto-dismissed before you finished talking | It lasts 12 seconds. The change is still on the map, and the Inspector's **Recent changes** shows it with nothing selected. Keep going. |
| You clicked a node you didn't mean to | `Esc` clears selection. Order is: close modal → clear highlight and answer → clear selection. |
| Ask returns *"I don't have anything saved about that yet."* | You asked something outside the six seeded answers. Not a bug — it's the refusal working. Say so; it's a strength. Then ask a seeded question: eval / langchain / seed / hiring / pricing / onboarding. |
| Map looks wrong or crowded | `Space` refits to bounds. |
| "Recall is desktop-first" | Window is under 1280px. Widen it or reset browser zoom to 100%. |
| Everything is broken | Reload. It's a full reset and takes 0.07s. |

**There is no network dependency.** The venue's wifi can be dead and the demo runs unchanged — the
rehearsal harness fails the run if any request leaves the page. Do not spend demo-day anxiety on
connectivity.

---

## Verifying you're ready

Spec §15.4 requires 20 consecutive clean runs on the demo machine. Automated:

```bash
npm run dev                # in one terminal
npm run rehearse           # in another — 20 runs
npm run rehearse -- 3      # quick check
```

Each run asserts: opening counts of 47/22/20, all four ticker stages in order, the exact banner
string, post-split counts of 49/23/22, three citations with every sentence cited, citation [3]
resolving to the captured screenshot, undo restoring 20 categories, and the refusal string
verbatim — plus zero console errors and zero network egress. Any deviation fails the run.

It also reports per-beat timing distribution, so you can see drift rather than guess at it.

**Run this on the actual demo machine.** A laptop under thermal load or on battery paints and
animates differently from a development machine, and the point of §15.4 is to find that out before
an audience does.

---

## Not built yet (and why it doesn't matter today)

Spec §15.4 lists an offline mode (`?offline=1`) that replays recorded AI responses if the venue
network fails. **In Phase 1 that flag would do nothing** — the app already makes zero network
requests, which the rehearsal harness enforces on every run. It becomes a real risk control in
Phase 4, when a live backend is introduced. Build it then.
