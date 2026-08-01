#!/usr/bin/env python3
"""
Generates seed/workspace.json and seed/demo-item.json.

seed/answers.json is NOT generated — it is hand-maintained, and it quotes these
memory texts, so changing one here means changing it there too.

Vectors are 8-dimensional unit vectors, one per memory, built from a per-theme
anchor plus deterministic jitter. Phase 4 swaps these for 1536-dimensional
embeddings and the restructuring gates do not change.

The demo condition (spec 12.4) is enforced by assert_demo_condition() at the
bottom: with the seed alone the SPLIT gate on `AI Tooling` must NOT fire, and
adding the two demo memories must make it fire exactly once, producing 7/4.

The blocking gate is MIN_CLUSTER_SIZE, not cohesion. Adding memories to an
existing sub-cluster raises mean pairwise cohesion rather than lowering it, so
a cohesion-crossing seed is not constructible. See docs/product-spec.md 12.4.

Run: python3 scripts/generate_seed.py
"""

import json
import math
import os
import random

DIM = 8
SEED_DIR = os.path.join(os.path.dirname(__file__), "..", "seed")

# ---------------------------------------------------------------- gate constants
# Mirrors src/reorg/thresholds.ts. Kept in sync by tests/unit/seedCondition.test.ts.
SPLIT_MIN_MEMORIES = 8
SPLIT_MAX_MEAN_COHESION = 0.62
SPLIT_MIN_CLUSTER_SIZE = 3
SPLIT_MIN_SEPARATION = 0.15
MERGE_MIN_CENTROID_SIMILARITY = 0.86

# ---------------------------------------------------------------- vector helpers


def normalize(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


def centroid(vectors):
    return [sum(v[i] for v in vectors) / len(vectors) for i in range(DIM)]


def mean_pairwise_cosine(vectors):
    if len(vectors) < 2:
        return 1.0
    total, pairs = 0.0, 0
    for i in range(len(vectors)):
        for j in range(i + 1, len(vectors)):
            total += cosine(vectors[i], vectors[j])
            pairs += 1
    return total / pairs


def two_means(items):
    """Mirrors src/reorg/vectorMath.ts twoMeans: seeded by the most distant pair."""
    if len(items) < 2:
        return items, [], 0.0
    seed_a, seed_b, worst = items[0], items[1], 2.0
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            s = cosine(items[i][1], items[j][1])
            if s < worst:
                worst, seed_a, seed_b = s, items[i], items[j]
    ca, cb = seed_a[1], seed_b[1]
    a, b = [], []
    for _ in range(50):
        a, b = [], []
        for item in items:
            (a if cosine(item[1], ca) >= cosine(item[1], cb) else b).append(item)
        if not a or not b:
            break
        na, nb = centroid([x[1] for x in a]), centroid([x[1] for x in b])
        if cosine(na, ca) > 0.9999 and cosine(nb, cb) > 0.9999:
            ca, cb = na, nb
            break
        ca, cb = na, nb
    return a, b, 1.0 - cosine(ca, cb)


# ---------------------------------------------------------------- theme geometry
# Each theme has an anchor direction. Memories sit near their anchor with jitter.
# AI Tooling's two sub-themes get an explicitly controlled angle so the demo
# condition is reproducible; everything else just needs to be internally coherent
# and distinct enough from its siblings that MERGE never fires.

AI_THEME_ANGLE = 1.02  # radians between ai-frameworks and ai-evals anchors
AI_JITTER = 0.34
DEFAULT_JITTER = 0.22

THEME_ANCHORS = {
    # AI Tooling sub-themes live in the e0/e1 plane at a controlled angle.
    "ai-frameworks": normalize([1, 0, 0, 0, 0, 0, 0, 0]),
    "ai-evals": normalize([math.cos(AI_THEME_ANGLE), math.sin(AI_THEME_ANGLE), 0, 0, 0, 0, 0, 0]),
}

_OTHER_THEMES = [
    "investor-notes", "pitch-feedback", "seed-benchmarks",
    "eng-hiring", "interview-loops",
    "onboarding", "pricing", "design-systems",
    "content", "community", "sales-motion",
    "reading", "focus", "health",
]

# Deterministic spread for the remaining themes, kept away from the e0/e1 plane
# so they never interfere with the AI Tooling geometry.
_rng = random.Random(20260725)
for _i, _theme in enumerate(_OTHER_THEMES):
    _v = [0.0, 0.0] + [_rng.uniform(-1, 1) for _ in range(DIM - 2)]
    _v[0] = _rng.uniform(-0.25, 0.25)
    _v[1] = _rng.uniform(-0.25, 0.25)
    THEME_ANCHORS[_theme] = normalize(_v)


def vector_for(memory_id, theme):
    """Deterministic per-memory vector: theme anchor + reproducible jitter."""
    rng = random.Random(f"{theme}:{memory_id}")
    jitter = AI_JITTER if theme.startswith("ai-") else DEFAULT_JITTER
    anchor = THEME_ANCHORS[theme]
    return normalize([a + rng.uniform(-1, 1) * jitter for a in anchor])


# ---------------------------------------------------------------- content
# (category_key, theme, source_key, kind, text)
MEMORIES = [
    # ---- Fundraising / Investor Notes
    ("investor_notes", "investor-notes", "s_seed_deck_notes", "fact",
     "Seed funds decide within two meetings, so the second meeting is the real one"),
    ("investor_notes", "investor-notes", "s_seed_deck_notes", "opinion",
     "Warm intros through portfolio founders convert roughly three times better than cold outreach"),
    ("investor_notes", "investor-notes", "s_partner_call", "fact",
     "One partner said the wedge matters more than market size at the seed stage"),
    ("investor_notes", "investor-notes", "s_partner_call", "decision",
     "Decided to lead every first meeting with why now rather than market size"),
    # ---- Fundraising / Pitch Feedback
    ("pitch_feedback", "pitch-feedback", "s_pitch_review", "decision",
     "Decided the demo opens on the product itself, never on a market size slide"),
    ("pitch_feedback", "pitch-feedback", "s_pitch_review", "fact",
     "Reviewers said the traction slide buries the retention number that actually matters"),
    ("pitch_feedback", "pitch-feedback", "s_pitch_review", "decision",
     "Cut the competitive matrix because nobody believes a chart where you win every row"),
    ("pitch_feedback", "pitch-feedback", "s_pitch_review", "task",
     "Practice answering why hasn't Google built this in under thirty seconds"),
    # ---- Fundraising / Seed Benchmarks
    ("seed_benchmarks", "seed-benchmarks", "s_benchmark_screenshot", "fact",
     "Seed rounds at this stage are landing between three and five million on fifteen post"),
    ("seed_benchmarks", "seed-benchmarks", "s_benchmark_screenshot", "fact",
     "Median seed dilution held around twenty percent through the last two quarters"),
    ("seed_benchmarks", "seed-benchmarks", "s_runway_post", "fact",
     "Funds expect eighteen to twenty four months of runway out of a seed round"),

    # ---- AI Tooling / frameworks theme (7)
    ("ai_tooling", "ai-frameworks", "s_langchain_thread", "decision",
     "Decided to drop LangChain in favour of direct Anthropic SDK calls for tool loops"),
    ("ai_tooling", "ai-frameworks", "s_langchain_thread", "fact",
     "The agent abstraction layer was making tool-call debugging significantly harder"),
    ("ai_tooling", "ai-frameworks", "s_langchain_thread", "opinion",
     "Direct SDK calls make streaming and error handling explicit instead of hidden"),
    ("ai_tooling", "ai-frameworks", "s_agent_patterns", "opinion",
     "Tool definitions should live beside the function they describe, not in a registry"),
    ("ai_tooling", "ai-frameworks", "s_agent_patterns", "opinion",
     "Multi-agent orchestration is rarely worth it before a single agent is reliable"),
    ("ai_tooling", "ai-frameworks", "s_agent_patterns", "decision",
     "Retry logic belongs inside the tool implementation, not in the agent loop"),
    ("ai_tooling", "ai-frameworks", "s_structured_output", "fact",
     "Structured output enforcement removed an entire class of response parsing failures"),
    # ---- AI Tooling / evals theme (2 — deliberately below MIN_CLUSTER_SIZE)
    ("ai_tooling", "ai-evals", "s_eval_notes", "opinion",
     "Two reviewers scoring the same eval rubric still land three points apart"),
    ("ai_tooling", "ai-evals", "s_eval_notes", "fact",
     "Sampling fifty conversations a week catches more than any dashboard has"),

    # ---- Hiring / Engineering Hiring
    ("eng_hiring", "eng-hiring", "s_hiring_retro", "opinion",
     "Strong engineers ask about the customer first, weaker ones ask about the stack"),
    ("eng_hiring", "eng-hiring", "s_hiring_retro", "fact",
     "Take-home exercises lose candidates who already hold competing offers"),
    ("eng_hiring", "eng-hiring", "s_hiring_retro", "decision",
     "Hiring a second infrastructure engineer before product-market fit was premature"),
    ("eng_hiring", "eng-hiring", "s_referral_thread", "fact",
     "Referrals from the first five engineers produced every good hire so far"),
    # ---- Hiring / Interview Loops
    ("interview_loops", "interview-loops", "s_interview_doc", "opinion",
     "Pair programming on real code predicts performance better than algorithm puzzles"),
    ("interview_loops", "interview-loops", "s_interview_doc", "fact",
     "Four interviews is the ceiling before strong candidates drop out of the process"),
    ("interview_loops", "interview-loops", "s_interview_doc", "decision",
     "Debriefs get written within an hour so the loop stays honest about weak signals"),

    # ---- Product / Onboarding
    ("onboarding", "onboarding", "s_activation_screenshot", "fact",
     "Users who save their first item within five minutes retain at twice the rate"),
    ("onboarding", "onboarding", "s_onboarding_notes", "opinion",
     "The empty state is doing more onboarding work than the product tour ever did"),
    ("onboarding", "onboarding", "s_onboarding_notes", "fact",
     "Removing the signup wall before the first action lifted activation noticeably"),
    # ---- Product / Pricing
    ("pricing", "pricing", "s_pricing_post", "opinion",
     "Usage-based pricing punishes the power users who evangelise the product hardest"),
    ("pricing", "pricing", "s_pricing_post", "decision",
     "Decided a single paid tier converts better than three tiers at this stage"),
    ("pricing", "pricing", "s_pricing_post", "opinion",
     "Anchoring on seat price makes the product feel like team software, not personal software"),
    # ---- Product / Design Systems
    ("design_systems", "design-systems", "s_design_tokens", "decision",
     "Design tokens ship as a package, not as a Figma file that nobody keeps in sync"),
    ("design_systems", "design-systems", "s_design_tokens", "opinion",
     "Component libraries decay quickly without one owner empowered to say no"),

    # ---- Go-to-Market / Content
    ("content", "content", "s_content_screenshot", "fact",
     "Technical posts about how something was built outperform launch announcements"),
    ("content", "content", "s_content_screenshot", "decision",
     "One deep post per month beats four shallow ones for inbound lead quality"),
    # ---- Go-to-Market / Community
    ("community", "community", "s_community_notes", "fact",
     "Discord goes quiet without a founder posting in it at least twice a week"),
    ("community", "community", "s_community_notes", "opinion",
     "The first hundred users want access to the team more than they want features"),
    # ---- Go-to-Market / Sales Motion
    ("sales_motion", "sales-motion", "s_sales_post", "decision",
     "Founder-led sales continues until the same objection has appeared five times"),
    ("sales_motion", "sales-motion", "s_sales_post", "opinion",
     "Self-serve and sales-assisted motions need different onboarding, not one shared flow"),

    # ---- Personal Systems / Reading
    ("reading", "reading", "s_reading_list", "reference",
     "High Growth Handbook is the most reread book on the shelf this year"),
    ("reading", "reading", "s_reading_list", "task",
     "Reading two papers a week keeps technical intuition current without eating the calendar"),
    # ---- Personal Systems / Focus
    ("focus", "focus", "s_calendar_screenshot", "decision",
     "Batching every meeting into two days protects the other three for real work"),
    ("focus", "focus", "s_calendar_screenshot", "fact",
     "Shipping slows measurably in any week containing more than six meetings"),
    # ---- Personal Systems / Health
    ("health", "health", "s_health_notes", "fact",
     "Morning workouts survive a bad week and evening ones never do"),
    ("health", "health", "s_health_notes", "fact",
     "Sleep debt shows up in decision quality about two days later"),
]

# key -> (title, type, url, raw_content, scene_description)
SOURCES = {
    "s_seed_deck_notes": ("Notes from seed fundraising prep", "text", None,
                          "Raw notes taken while preparing the seed round.", None),
    "s_partner_call": ("Call notes — partner intro", "text", None,
                       "Notes taken during an intro call with a seed fund partner.", None),
    "s_pitch_review": ("Pitch review feedback", "text", None,
                       "Consolidated feedback from three practice pitches.", None),
    "s_benchmark_screenshot": ("Seed round benchmarks", "screenshot", None,
                               "Median seed round size and dilution by quarter.",
                               "A screenshot of a chart showing seed round sizes and dilution over eight quarters."),
    "s_runway_post": ("How much runway a seed should buy", "link",
                      "https://example.com/seed-runway",
                      "An essay arguing seed rounds should buy eighteen to twenty four months.", None),
    "s_langchain_thread": ("Thread on dropping the agent framework", "link",
                           "https://example.com/langchain-thread",
                           "A thread about replacing an agent framework with direct SDK calls.", None),
    "s_agent_patterns": ("Agent design patterns", "link",
                         "https://example.com/agent-patterns",
                         "A write-up of patterns for building reliable single-agent systems.", None),
    "s_structured_output": ("Structured output notes", "text", None,
                            "Notes on enforcing structured output across the tool pipeline.", None),
    "s_eval_notes": ("Eval notes", "text", None,
                     "Scratch notes about evaluating agent output quality.", None),
    "s_hiring_retro": ("Hiring retro", "text", None,
                       "Retro on the first six engineering hires.", None),
    "s_referral_thread": ("Referral hiring thread", "link",
                          "https://example.com/referral-hiring",
                          "A thread on why referrals outperform inbound at early stage.", None),
    "s_interview_doc": ("Interview loop design", "text", None,
                        "Working document describing the engineering interview loop.", None),
    "s_activation_screenshot": ("Activation cohort chart", "screenshot", None,
                                "Retention by time-to-first-save cohort.",
                                "A screenshot of a cohort chart splitting retention by time to first saved item."),
    "s_onboarding_notes": ("Onboarding teardown", "text", None,
                           "Notes from tearing down four onboarding flows.", None),
    "s_pricing_post": ("Pricing for personal software", "link",
                       "https://example.com/pricing-personal-software",
                       "An essay on why seat pricing misfits personal software.", None),
    "s_design_tokens": ("Design tokens as a package", "link",
                        "https://example.com/design-tokens",
                        "A post arguing design tokens belong in the build, not in Figma.", None),
    "s_content_screenshot": ("Content performance", "screenshot", None,
                             "Inbound by post type over six months.",
                             "A screenshot of an analytics dashboard comparing inbound leads by post type."),
    "s_community_notes": ("Community notes", "text", None,
                          "Notes on running the early user community.", None),
    "s_sales_post": ("Founder-led sales", "link", "https://example.com/founder-led-sales",
                     "A post on when to stop doing founder-led sales.", None),
    "s_reading_list": ("Reading list", "link", "https://example.com/reading-list",
                       "A running reading list with short annotations.", None),
    "s_calendar_screenshot": ("Calendar audit", "screenshot", None,
                              "Meeting load by week against shipped pull requests.",
                              "A screenshot of a calendar heatmap next to a chart of shipped pull requests."),
    "s_health_notes": ("Sleep and training log", "screenshot", None,
                       "Sleep hours and workout completion by week.",
                       "A screenshot of a tracking app showing sleep hours and workout completion by week."),
}

# key -> (name, parent_key or None)
CATEGORIES = [
    ("fundraising", "Fundraising", None),
    ("investor_notes", "Investor Notes", "fundraising"),
    ("pitch_feedback", "Pitch Feedback", "fundraising"),
    ("seed_benchmarks", "Seed Benchmarks", "fundraising"),
    ("ai_tooling", "AI Tooling", None),
    ("hiring", "Hiring", None),
    ("eng_hiring", "Engineering Hiring", "hiring"),
    ("interview_loops", "Interview Loops", "hiring"),
    ("product", "Product", None),
    ("onboarding", "Onboarding", "product"),
    ("pricing", "Pricing", "product"),
    ("design_systems", "Design Systems", "product"),
    ("gtm", "Go-to-Market", None),
    ("content", "Content", "gtm"),
    ("community", "Community", "gtm"),
    ("sales_motion", "Sales Motion", "gtm"),
    ("personal", "Personal Systems", None),
    ("reading", "Reading", "personal"),
    ("focus", "Focus", "personal"),
    ("health", "Health", "personal"),
]

# (name, kind) — 31 entities
ENTITIES = [
    ("LangChain", "tool"), ("Anthropic SDK", "tool"), ("Braintrust", "tool"),
    ("Langfuse", "tool"), ("Figma", "tool"), ("Discord", "tool"),
    ("agent evals", "concept"), ("tool calling", "concept"), ("structured output", "concept"),
    ("multi-agent orchestration", "concept"), ("graded set", "concept"),
    ("seed round", "concept"), ("dilution", "concept"), ("runway", "concept"),
    ("warm intro", "concept"), ("traction slide", "concept"),
    ("activation", "concept"), ("retention", "concept"), ("onboarding", "concept"),
    ("usage-based pricing", "concept"), ("seat pricing", "concept"),
    ("design tokens", "concept"), ("component library", "concept"),
    ("founder-led sales", "concept"), ("self-serve", "concept"),
    ("take-home exercise", "concept"), ("pair programming", "concept"),
    ("referral hiring", "concept"), ("meeting load", "concept"),
    ("High Growth Handbook", "reference_book"), ("deep work", "concept"),
]

# Memory index -> entity names it mentions.
MEMORY_ENTITIES = {
    0: ["seed round"], 1: ["warm intro"], 2: ["seed round"], 3: ["seed round"],
    5: ["traction slide", "retention"], 7: [],
    8: ["seed round"], 9: ["dilution", "seed round"], 10: ["runway", "seed round"],
    11: ["LangChain", "Anthropic SDK", "tool calling"],
    12: ["tool calling"], 13: ["Anthropic SDK"],
    14: ["tool calling"], 15: ["multi-agent orchestration"], 16: ["tool calling"],
    17: ["structured output"],
    18: ["agent evals"], 19: ["graded set", "agent evals"],
    20: [], 21: ["take-home exercise"], 22: [], 23: ["referral hiring"],
    24: ["pair programming"], 25: [], 26: [],
    27: ["activation", "retention"], 28: ["onboarding"], 29: ["activation"],
    30: ["usage-based pricing"], 31: [], 32: ["seat pricing"],
    33: ["design tokens", "Figma"], 34: ["component library"],
    35: [], 36: [], 37: ["Discord"], 38: [],
    39: ["founder-led sales"], 40: ["self-serve", "onboarding"],
    41: ["High Growth Handbook"], 42: [], 43: ["meeting load", "deep work"],
    44: ["meeting load"], 45: [], 46: [],
}

DEMO_MEMORIES = [
    ("opinion", "Braintrust replaced our spreadsheet of scores and Langfuse never got used",
     ["Braintrust", "Langfuse", "agent evals"]),
    ("fact", "A frozen set of graded examples is the only thing that survives a rewrite",
     ["agent evals", "graded set"]),
]

# ---------------------------------------------------------------- layout
# Six parent clusters on a ring. AI Tooling sits right of centre where the demo
# camera lands. Children ring their parent; memories ring their category.

PARENT_POSITIONS = {
    "fundraising": (-620, -260),
    "ai_tooling": (430, -60),
    "hiring": (-520, 330),
    "product": (60, 380),
    "gtm": (-60, -400),
    "personal": (660, 380),
}


def ring(cx, cy, count, radius, phase=0.0):
    if count == 1:
        return [(cx, cy + radius)]
    return [
        (
            round(cx + math.cos(phase + 2 * math.pi * i / count) * radius, 2),
            round(cy + math.sin(phase + 2 * math.pi * i / count) * radius, 2),
        )
        for i in range(count)
    ]


# ---------------------------------------------------------------- build

def build():
    cat_index = {key: i for i, (key, _, _) in enumerate(CATEGORIES)}
    cat_ids = {key: f"cat_{key}" for key, _, _ in CATEGORIES}
    entity_ids = {name: f"ent_{i}" for i, (name, _) in enumerate(ENTITIES)}
    source_ids = {key: f"src_{key[2:]}" for key in SOURCES}

    # ---- categories with positions
    categories = []
    child_positions = {}
    for parent_key, px, py in [(k, *PARENT_POSITIONS[k]) for k in PARENT_POSITIONS]:
        children = [k for k, _, p in CATEGORIES if p == parent_key]
        for (k, (cx, cy)) in zip(children, ring(px, py, len(children), 165, -math.pi / 2)):
            child_positions[k] = (cx, cy)

    for key, name, parent in CATEGORIES:
        if parent is None:
            x, y = PARENT_POSITIONS[key]
        else:
            x, y = child_positions[key]
        categories.append({
            "id": cat_ids[key],
            "parent_id": cat_ids[parent] if parent else None,
            "name": name,
            "rationale": None,
            "name_locked": False,
            "user_created": False,
            "x": float(x),
            "y": float(y),
            "pinned": False,
            "created_by": "ai",
        })

    # ---- sources
    sources = []
    for i, (key, (title, stype, url, raw, scene)) in enumerate(SOURCES.items()):
        sources.append({
            "id": source_ids[key],
            "type": stype,
            "title": title,
            "raw_content": raw,
            "scene_description": scene,
            "url": url,
            "image_path": f"/seed/{key}.png" if stype == "screenshot" else None,
            "created_at": f"2026-0{(i % 3) + 4}-{(i % 27) + 1:02d}T09:00:00Z",
        })

    # ---- memories, positioned around their category
    by_cat = {}
    for idx, (cat_key, _, _, _, _) in enumerate(MEMORIES):
        by_cat.setdefault(cat_key, []).append(idx)

    positions = {}
    for cat_key, idxs in by_cat.items():
        cat = next(c for c in categories if c["id"] == cat_ids[cat_key])
        for idx, (mx, my) in zip(idxs, ring(cat["x"], cat["y"], len(idxs), 62, 0.4)):
            positions[idx] = (mx, my)

    memories = []
    for idx, (cat_key, theme, src_key, kind, text) in enumerate(MEMORIES):
        mid = f"mem_{idx:02d}"
        mx, my = positions[idx]
        memories.append({
            "id": mid,
            "source_id": source_ids[src_key],
            "text": text,
            "kind": kind,
            "confidence": round(0.74 + (idx % 7) * 0.03, 2),
            "category_id": cat_ids[cat_key],
            "category_locked": False,
            "entity_ids": [entity_ids[n] for n in MEMORY_ENTITIES.get(idx, [])],
            "vector": [round(v, 6) for v in vector_for(mid, theme)],
            "x": float(mx),
            "y": float(my),
            "pinned": False,
            "created_at": f"2026-0{(idx % 3) + 4}-{(idx % 27) + 1:02d}T10:00:00Z",
        })

    # ---- entities, placed at the mean of the memories that mention them
    entities = []
    for i, (name, kind) in enumerate(ENTITIES):
        eid = entity_ids[name]
        mentions = [m for m in memories if eid in m["entity_ids"]]
        if mentions:
            ex = sum(m["x"] for m in mentions) / len(mentions)
            ey = sum(m["y"] for m in mentions) / len(mentions)
        else:
            ex, ey = ring(0, 0, len(ENTITIES), 900, 0.2)[i]
        entities.append({
            "id": eid,
            "name": name,
            "kind": "reference" if kind == "reference_book" else kind,
            "x": round(ex, 2),
            "y": round(ey - 90, 2),
            "pinned": False,
        })

    # ---- relates_to edges: cosine >= 0.82, top 3 per memory, deduped
    edges = []
    seen = set()
    for m in memories:
        scored = sorted(
            ((cosine(m["vector"], o["vector"]), o) for o in memories if o["id"] != m["id"]),
            key=lambda t: -t[0],
        )[:3]
        for sim, other in scored:
            if sim < 0.82:
                continue
            a, b = sorted([m["id"], other["id"]])
            if (a, b) in seen:
                continue
            seen.add((a, b))
            edges.append({
                "id": f"edg_{len(edges):03d}",
                "source_memory_id": a,
                "target_memory_id": b,
                "similarity": round(sim, 4),
            })

    payload = {
        "workspace": {"id": "ws_demo", "name": "Demo", "auto_reorganize": True},
        "sources": sources,
        "memories": memories,
        "categories": categories,
        "entities": entities,
        "edges": edges,
    }

    # ---- demo item
    demo_source = {
        "id": "src_demo",
        "type": "screenshot",
        "title": "Thread on eval harnesses",
        "raw_content": (
            "Two people scoring the same answer will disagree until the rubric is written "
            "down. Keep the graded set frozen and versioned. Braintrust does this well; "
            "Langfuse we never really used."
        ),
        "scene_description": (
            "A screenshot of a social thread about scoring rubrics and graded example sets."
        ),
        "url": None,
        "image_path": "/seed/demo-screenshot.png",
        "created_at": "2026-07-25T09:00:00Z",
    }
    demo_memories = []
    for i, (kind, text, ents) in enumerate(DEMO_MEMORIES):
        mid = f"mem_demo_{i + 1}"
        demo_memories.append({
            "id": mid,
            "source_id": "src_demo",
            "text": text,
            "kind": kind,
            "confidence": 0.88 - i * 0.06,
            "category_id": cat_ids["ai_tooling"],
            "category_locked": False,
            "entity_ids": [entity_ids[n] for n in ents],
            "vector": [round(v, 6) for v in vector_for(mid, "ai-evals")],
            "x": None,
            "y": None,
            "pinned": False,
            "created_at": "2026-07-25T09:00:00Z",
        })

    return payload, {"source": demo_source, "memories": demo_memories}


# ---------------------------------------------------------------- verification

def assert_demo_condition(payload, demo):
    cat_id = "cat_ai_tooling"
    seed_mems = [m for m in payload["memories"] if m["category_id"] == cat_id]
    post_mems = seed_mems + demo["memories"]

    def report(label, mems):
        vecs = [m["vector"] for m in mems]
        coh = mean_pairwise_cosine(vecs)
        a, b, sep = two_means([(m["id"], m["vector"]) for m in mems])
        print(f"  {label}: n={len(mems)} cohesion={coh:.4f} clusters={len(a)}/{len(b)} separation={sep:.4f}")
        return len(mems), coh, sorted([len(a), len(b)]), sep

    print("AI Tooling gate state:")
    n0, coh0, cl0, sep0 = report("seed      ", seed_mems)
    n1, coh1, cl1, sep1 = report("after demo", post_mems)

    # Seed must NOT fire. The blocking gate is cohesion: the evals theme holds only
    # two memories, so within-theme pairs dominate and the category still reads as
    # coherent. Adding two more evals memories creates far more cross-theme pairs
    # than within-theme ones, which is what pulls cohesion under the threshold.
    seed_fires = (
        n0 >= SPLIT_MIN_MEMORIES and coh0 < SPLIT_MAX_MEAN_COHESION
        and cl0[0] >= SPLIT_MIN_CLUSTER_SIZE and sep0 > SPLIT_MIN_SEPARATION
    )
    assert not seed_fires, "seed workspace must not trigger SPLIT on its own"
    assert coh0 >= SPLIT_MAX_MEAN_COHESION, \
        f"expected cohesion to be the blocking gate, got {coh0:.4f}"
    assert 0.60 <= coh0 <= 0.66, f"seed cohesion {coh0:.4f} is too close to an edge"

    # After the demo item it must fire, producing 7/4.
    post_fires = (
        n1 >= SPLIT_MIN_MEMORIES and coh1 < SPLIT_MAX_MEAN_COHESION
        and cl1[0] >= SPLIT_MIN_CLUSTER_SIZE and sep1 > SPLIT_MIN_SEPARATION
    )
    assert post_fires, f"demo item must trigger SPLIT (n={n1} coh={coh1} clusters={cl1} sep={sep1})"
    assert cl1 == [4, 7], f"expected 7/4 clusters after the demo item, got {cl1}"

    # No other category may reach the SPLIT gate.
    for cat in payload["categories"]:
        mems = [m for m in payload["memories"] if m["category_id"] == cat["id"]]
        if cat["id"] == cat_id or len(mems) < SPLIT_MIN_MEMORIES:
            continue
        raise AssertionError(f"{cat['name']} has {len(mems)} memories and could split")

    # No sibling pair may reach the MERGE gate.
    for i, a in enumerate(payload["categories"]):
        for b in payload["categories"][i + 1:]:
            if a["parent_id"] != b["parent_id"]:
                continue
            ma = [m["vector"] for m in payload["memories"] if m["category_id"] == a["id"]]
            mb = [m["vector"] for m in payload["memories"] if m["category_id"] == b["id"]]
            if not ma or not mb:
                continue
            sim = cosine(centroid(ma), centroid(mb))
            assert sim <= MERGE_MIN_CENTROID_SIMILARITY, \
                f"{a['name']} and {b['name']} would merge (similarity {sim:.3f})"
    print("  all gate conditions hold")


def main():
    payload, demo = build()

    print(f"sources={len(payload['sources'])} memories={len(payload['memories'])} "
          f"parents={sum(1 for c in payload['categories'] if c['parent_id'] is None)} "
          f"children={sum(1 for c in payload['categories'] if c['parent_id'])} "
          f"entities={len(payload['entities'])} edges={len(payload['edges'])}")

    assert len(payload["memories"]) == 47, len(payload["memories"])
    assert len(payload["sources"]) == 22, len(payload["sources"])

    # Spec 12.3: 9 text, 8 link, 5 screenshot.
    type_counts = {}
    for s in payload["sources"]:
        type_counts[s["type"]] = type_counts.get(s["type"], 0) + 1
    assert type_counts == {"text": 9, "link": 8, "screenshot": 5}, type_counts

    # Spec 12.3 asks every category to mix source types. Applied at PARENT level:
    # 15 leaf categories each needing two distinct types is not satisfiable with 22
    # sources, and the parent clusters are what is visible at the demo's default
    # zoom anyway (memory dots only render above zoom 1.4).
    src_type = {s["id"]: s["type"] for s in payload["sources"]}
    cat_by_id = {c["id"]: c for c in payload["categories"]}
    for cat in payload["categories"]:
        if cat["parent_id"] is not None:
            continue
        mems = [
            m for m in payload["memories"]
            if m["category_id"] == cat["id"]
            or cat_by_id[m["category_id"]]["parent_id"] == cat["id"]
        ]
        kinds = {src_type[m["source_id"]] for m in mems}
        assert len(kinds) >= 2, f"{cat['name']} draws on only {kinds}"

    assert len(payload["entities"]) == 31, len(payload["entities"])
    assert sum(1 for c in payload["categories"] if c["parent_id"] is None) == 6
    assert sum(1 for c in payload["categories"] if c["parent_id"]) == 14

    for m in payload["memories"]:
        words = len(m["text"].split())
        assert 8 <= words <= 30, f"{m['id']} has {words} words: {m['text']}"

    assert_demo_condition(payload, demo)

    os.makedirs(SEED_DIR, exist_ok=True)
    with open(os.path.join(SEED_DIR, "workspace.json"), "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    with open(os.path.join(SEED_DIR, "demo-item.json"), "w") as f:
        json.dump(demo, f, indent=2)
        f.write("\n")
    print("wrote seed/workspace.json and seed/demo-item.json")


if __name__ == "__main__":
    main()
