#!/usr/bin/env python3
"""
Measures the SPLIT gate against a real embedding model.

Why this exists
---------------
The thresholds in src/reorg/thresholds.ts were tuned against the 8-dimensional
hand-generated vectors in seed/workspace.json. Those numbers have never been
measured against a real embedding model, and cosine similarity distributions
differ enormously between models — a threshold of 0.62 is meaningful only
relative to the distribution it was fitted to.

This script embeds the 47 seed memories plus the 2 demo memories with a real
model, re-runs the exact gate math from src/reorg/vectorMath.ts, and reports:

  1. whether the demo mechanism still holds (cohesion drops when the demo item
     lands, and the drop crosses a threshold that nothing else crosses),
  2. what MAX_MEAN_COHESION should be set to for this model,
  3. whether that value would misfire on any other category.

Point 3 is the one that actually matters. A threshold that fires on AI Tooling
but also fires on Fundraising breaks "at most one structural operation per
ingest" — the property the whole demo rests on.

Usage
-----
    pip install voyageai            # or: pip install openai
    export VOYAGE_API_KEY=...       # or: OPENAI_API_KEY
    python3 scripts/validate_thresholds.py

    python3 scripts/validate_thresholds.py --provider openai --model text-embedding-3-small
    python3 scripts/validate_thresholds.py --write-vectors   # rewrite seed/ with real vectors

Anthropic does not offer an embedding endpoint; its docs recommend Voyage AI,
whose voyage-4 family defaults to 1024 dimensions. The spec's "1536-dimensional"
requirement (11.2, 18) matches OpenAI, not the recommended provider — this
script is dimension-agnostic and reports whatever the model returns.
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_DIR = os.path.join(HERE, "..", "seed")

# Mirrors src/reorg/thresholds.ts at the time of writing.
SPLIT_MIN_MEMORIES = 8
SPLIT_MAX_MEAN_COHESION = 0.62
SPLIT_MIN_CLUSTER_SIZE = 3
SPLIT_MIN_SEPARATION = 0.15


# ---------------------------------------------------------------- gate math
# Deliberately duplicated from src/reorg/vectorMath.ts rather than imported.
# If these drift apart the test suite catches it; sharing an implementation
# across a TS runtime boundary would cost more than the duplication does.


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


def centroid(vectors):
    dim = len(vectors[0])
    return [sum(v[i] for v in vectors) / len(vectors) for i in range(dim)]


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
    """items: list of (id, vector). Seeded by the most distant pair — no RNG."""
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


# ---------------------------------------------------------------- providers


def embed_voyage(texts, model, dimensions=None):
    try:
        import voyageai
    except ImportError:
        sys.exit("pip install voyageai  (or use --provider openai)")
    if not os.environ.get("VOYAGE_API_KEY"):
        sys.exit("VOYAGE_API_KEY is not set. Get one at voyageai.com.")
    client = voyageai.Client()
    out = []
    # input_type="document" matters: Voyage prepends a retrieval prompt, and
    # omitting it measurably degrades the vectors.
    for i in range(0, len(texts), 128):
        out.extend(client.embed(texts[i:i + 128], model=model, input_type="document").embeddings)
    return out


def embed_openai(texts, model, dimensions=None):
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("pip install openai  (or use --provider voyage)")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY is not set.")
    client = OpenAI()
    out = []
    for i in range(0, len(texts), 128):
        kwargs = {"model": model, "input": texts[i:i + 128]}
        # text-embedding-3-* are Matryoshka: the width is a request parameter,
        # not a property of the model. 1536 floats per memory is 660 KB in a
        # bundle that ships seed/workspace.json as a static import.
        if dimensions:
            kwargs["dimensions"] = dimensions
        resp = client.embeddings.create(**kwargs)
        out.extend(d.embedding for d in resp.data)
    return out


def embed_seed(_texts, _model, _dimensions=None):
    """Not a provider — a self-check. Reuses the vectors already in seed/ so the
    whole report path can be exercised with no API key, and so the gate math
    here can be shown to agree with the TypeScript implementation."""
    raise AssertionError("handled in main()")


PROVIDERS = {
    "voyage": (embed_voyage, "voyage-4"),
    "openai": (embed_openai, "text-embedding-3-small"),
    "seed": (embed_seed, "8-dim hand-generated"),
}


# ---------------------------------------------------------------- report


def percentile(sorted_values, q):
    """Linear-interpolated percentile. No numpy dependency for eleven numbers."""
    if not sorted_values:
        return float("nan")
    k = (len(sorted_values) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_values[int(k)]
    return sorted_values[lo] * (hi - k) + sorted_values[hi] * (k - lo)


def report_distribution(payload, all_memories, vectors):
    """
    The cosine distribution of the whole corpus.

    Eight of the nine similarity thresholds in the app were chosen against
    8-dimensional hand-authored vectors, where a theme anchor put same-topic
    memories at 0.9 and everything else far away. A real model has no such
    geometry — the whole distribution collapses toward the middle — so those
    numbers cannot be carried across, and they cannot be guessed either. They
    have to be read off the space they will run in.

    Printed as percentiles because that is how each one is actually defined:
    "an echo" is the top fraction of a percent of all pairs, "relates to" is the
    top few percent, and a merge candidate has to sit above the closest pair of
    siblings that must NOT merge.
    """
    ids = [m["id"] for m in all_memories]
    parent = {c["id"]: c.get("parent_id") for c in payload["categories"]}
    top_of = {m["id"]: (parent.get(m["category_id"]) or m["category_id"])
              for m in all_memories}

    every, within, across = [], [], []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            c = cosine(vectors[ids[i]], vectors[ids[j]])
            every.append(c)
            (within if top_of[ids[i]] == top_of[ids[j]] else across).append(c)

    for group in (every, within, across):
        group.sort()

    print("Cosine distribution — where each threshold has to sit:\n")
    print(f"  {'':22} {'n':>6} {'p50':>8} {'p90':>8} {'p95':>8} {'p99':>8} {'p99.5':>8} {'max':>8}")
    for label, group in (("all pairs", every),
                         ("same top category", within),
                         ("different category", across)):
        if not group:
            continue
        print(f"  {label:22} {len(group):>6} "
              f"{percentile(group, 0.50):>8.4f} {percentile(group, 0.90):>8.4f} "
              f"{percentile(group, 0.95):>8.4f} {percentile(group, 0.99):>8.4f} "
              f"{percentile(group, 0.995):>8.4f} {group[-1]:>8.4f}")

    # Sibling centroids: the merge gate compares these, and the highest pair
    # that must not merge is the floor MIN_CENTROID_SIMILARITY has to clear.
    kids = {}
    for c in payload["categories"]:
        if c.get("parent_id"):
            kids.setdefault(c["parent_id"], []).append(c)
    pairs = []
    for parent_id, group in kids.items():
        cents = []
        for c in group:
            vs = [vectors[m["id"]] for m in all_memories if m["category_id"] == c["id"]]
            if vs:
                cents.append((c["name"], centroid(vs)))
        for i in range(len(cents)):
            for j in range(i + 1, len(cents)):
                pairs.append((cosine(cents[i][1], cents[j][1]), cents[i][0], cents[j][0]))
    pairs.sort(reverse=True)
    if pairs:
        print("\n  Closest sibling centroids (none of these should merge):")
        for c, a, b in pairs[:4]:
            print(f"    {c:.4f}  {a} / {b}")
    print()


def write_seed(path, obj):
    """
    Pretty-printed, except the vectors.

    `json.dump(indent=2)` puts every array element on its own line, which for a
    1024-wide vector means 1024 lines of one float each — roughly twenty bytes
    per number instead of ten, and a 909 KB file where 480 KB says exactly the
    same thing. seed/workspace.json is a *static import* in the client bundle,
    so that difference is shipped to every browser.

    The vectors are swapped for placeholders, the rest is formatted normally,
    and then each vector goes back as one compact line — readable diffs for
    everything a human reads, one dense line for the part nobody does.
    """
    holders = {}

    def stash(container):
        for m in container.get("memories", []):
            key = f"__VEC_{m['id']}__"
            holders[key] = json.dumps(m["vector"], separators=(",", ":"))
            m["vector"] = key

    stash(obj)
    text = json.dumps(obj, indent=2)
    for key, compact in holders.items():
        text = text.replace(f'"{key}"', compact)
    with open(path, "w") as fh:
        fh.write(text + "\n")


def propose_thresholds(payload, demo, all_memories, vectors):
    """
    A recommended value for each similarity threshold, with what it was read off.

    Eight of the nine were tuned against 8-dimensional authored vectors, where a
    theme anchor put same-topic memories near 0.9 and pushed everything else out
    of the plane. A real model has no such geometry — the whole distribution
    lands in a band around 0.23 — so carrying the numbers across would silence
    every gate at once: no relates_to edge, no merge, no echo, and an ask that
    refuses everything.

    Each is derived from the thing it actually has to separate, not from a
    percentile chosen to look principled.
    """
    parent = {c["id"]: c.get("parent_id") for c in payload["categories"]}
    by_name = {c["name"]: c for c in payload["categories"]}
    mems_of = lambda cid: [m for m in all_memories if m["category_id"] == cid]
    vec = lambda m: vectors[m["id"]]

    print("Proposed thresholds, and what each was read off:\n")

    # ---- ECHO_SIMILARITY: the demo's own pair is the floor.
    #
    # The capture story's best line — "You already saved something close to
    # this" — depends on one specific pair firing. Any threshold above it turns
    # the moment the product is proudest of into silence, so the demo sets the
    # ceiling and the rest of the corpus sets the floor.
    demo_pairs = []
    for d in demo["memories"]:
        for prior in payload["memories"]:
            demo_pairs.append((cosine(vectors[d["id"]], vectors[prior["id"]]),
                               d["text"], prior["text"]))
    demo_pairs.sort(reverse=True)
    best_echo = demo_pairs[0]
    non_demo = sorted(
        cosine(vectors[a["id"]], vectors[b["id"]])
        for i, a in enumerate(payload["memories"])
        for b in payload["memories"][i + 1:]
    )
    print(f"  ECHO_SIMILARITY")
    print(f"    demo's closest echo      {best_echo[0]:.4f}")
    print(f"      new   {best_echo[1][:64]}")
    print(f"      prior {best_echo[2][:64]}")
    print(f"    corpus p99 / p99.5       {percentile(non_demo, 0.99):.4f} / "
          f"{percentile(non_demo, 0.995):.4f}")
    echo = round((percentile(non_demo, 0.99) + best_echo[0]) / 2, 2)
    print(f"    -> {echo}   (below the demo pair, above 99% of everything else)\n")

    # ---- RELATES_TO_MIN_SIMILARITY: keep the edge count the map was drawn for.
    pairs = sorted(
        (cosine(vectors[a["id"]], vectors[b["id"]]))
        for i, a in enumerate(payload["memories"])
        for b in payload["memories"][i + 1:]
    )
    target_edges = len(payload.get("edges", []))
    print(f"  RELATES_TO_MIN_SIMILARITY")
    for t in (0.35, 0.38, 0.40, 0.42, 0.45):
        n = sum(1 for c in pairs if c >= t)
        print(f"    at {t:.2f}: {n:>4} pairs clear it")
    print(f"    the map currently draws {target_edges} edges (top-3 per memory, capped)\n")

    # ---- MERGE.MIN_CENTROID_SIMILARITY: above the closest pair that must not merge.
    sib = []
    kids = {}
    for c in payload["categories"]:
        if c.get("parent_id"):
            kids.setdefault(c["parent_id"], []).append(c)
    for group in kids.values():
        cents = [(c["name"], centroid([vec(m) for m in mems_of(c["id"])]))
                 for c in group if mems_of(c["id"])]
        for i in range(len(cents)):
            for j in range(i + 1, len(cents)):
                sib.append(cosine(cents[i][1], cents[j][1]))
    hardest = max(sib) if sib else 0.0
    print(f"  MERGE.MIN_CENTROID_SIMILARITY")
    print(f"    closest siblings that must NOT merge   {hardest:.4f}")
    print(f"    -> {round(hardest + 0.05, 2)}   (clears it by 0.05)\n")

    # ---- PROMOTE.MAX_PARENT_SIMILARITY: below every child that must stay put.
    child_parent = []
    for c in payload["categories"]:
        pid = c.get("parent_id")
        if not pid:
            continue
        cm, pm = mems_of(c["id"]), mems_of(pid)
        siblings = [m for k in kids.get(pid, []) for m in mems_of(k["id"])]
        pool = pm + siblings
        if cm and pool:
            child_parent.append((cosine(centroid([vec(m) for m in cm]),
                                        centroid([vec(m) for m in pool])), c["name"]))
    child_parent.sort()
    print(f"  PROMOTE.MAX_PARENT_SIMILARITY")
    for v, n in child_parent[:3]:
        print(f"    {v:.4f}  {n}  (least like its parent)")
    floor = child_parent[0][0] if child_parent else 0.0
    print(f"    -> {round(floor - 0.05, 2)}   (below every child that must stay put)\n")

    # ---- ASSIGN: nearest member, because that is what assignMemory compares.
    #
    # Measured against the centroid first, which was wrong and quietly so: the
    # proposal came out at 0.47, the demo memories scored 0.42 and 0.36 against
    # AI Tooling's centroid, and the capture stopped attaching to the category
    # the whole demo splits. `assignMemory` (src/core/assign.ts) ranks by
    # `bestMemberSimilarity` — one memory against one memory — and a broad
    # category's centroid is nothing like its closest member.
    profiles = [(c["name"], c["id"],
                 [vec(m) for m in payload["memories"] if m["category_id"] == c["id"]])
                for c in payload["categories"]]
    profiles = [p for p in profiles if p[2]]
    right, wrong = [], []
    for m in payload["memories"]:
        for _n, cid, vs in profiles:
            others = [v for v in vs if v is not vec(m)]
            if not others:
                continue
            best = max(cosine(vec(m), v) for v in others)
            (right if cid == m["category_id"] else wrong).append(best)
    right.sort(); wrong.sort()
    demo_best = []
    for d in demo["memories"]:
        ranked = sorted(((max(cosine(vectors[d["id"]], v) for v in vs), n)
                         for n, _cid, vs in profiles), reverse=True)
        demo_best.append(ranked[0])
    print(f"  ASSIGN.EXISTING_CATEGORY   (nearest member, not centroid)")
    print(f"    memory vs its own category   p05 {percentile(right, 0.05):.4f}  "
          f"p10 {percentile(right, 0.10):.4f}  p50 {percentile(right, 0.50):.4f}")
    print(f"    memory vs a wrong category   p90 {percentile(wrong, 0.90):.4f}  "
          f"p99 {percentile(wrong, 0.99):.4f}")
    for score, cat in demo_best:
        print(f"    demo capture -> {cat} at {score:.4f}  (must clear the threshold)")
    ceiling = min(s for s, _ in demo_best)
    existing = round(min(percentile(right, 0.10), ceiling - 0.03), 2)
    print(f"    -> {existing}   (under the demo's weaker match, near the bottom decile of right answers)")
    print(f"    -> NEW_CHILD {round(existing - 0.04, 2)}\n")

def describe(label, mems, vectors):
    vecs = [vectors[m["id"]] for m in mems]
    coh = mean_pairwise_cosine(vecs)
    a, b, sep = two_means([(m["id"], vectors[m["id"]]) for m in mems])
    print(f"  {label:<12} n={len(mems):<3} cohesion={coh:.4f}  "
          f"clusters={len(a)}/{len(b)}  separation={sep:.4f}")
    return coh, sorted([len(a), len(b)]), sep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=PROVIDERS, default="voyage")
    ap.add_argument("--model", default=None)
    ap.add_argument("--relates-to", type=float, default=0.40,
                    help="cutoff used when rebuilding relates_to with --write-vectors")
    ap.add_argument("--propose", action="store_true",
                    help="derive a value for every similarity threshold")
    ap.add_argument("--dimensions", type=int, default=None,
                    help="request a narrower embedding (text-embedding-3-* only)")
    ap.add_argument("--write-vectors", action="store_true",
                    help="rewrite seed/*.json with the measured vectors")
    args = ap.parse_args()

    embed_fn, default_model = PROVIDERS[args.provider]
    model = args.model or default_model

    payload = json.load(open(os.path.join(SEED_DIR, "workspace.json")))
    demo = json.load(open(os.path.join(SEED_DIR, "demo-item.json")))
    all_memories = payload["memories"] + demo["memories"]

    if args.provider == "seed":
        print(f"Reusing the {model} vectors already in seed/ (no API call)…")
        raw = [m["vector"] for m in all_memories]
    else:
        print(f"Embedding {len(all_memories)} memories with {args.provider}/{model}…")
        raw = embed_fn([m["text"] for m in all_memories], model, args.dimensions)
    vectors = {m["id"]: v for m, v in zip(all_memories, raw)}
    dim = len(raw[0])
    print(f"  dimension: {dim}\n")

    report_distribution(payload, all_memories, vectors)
    if args.propose:
        propose_thresholds(payload, demo, all_memories, vectors)

    cat_by_id = {c["id"]: c for c in payload["categories"]}
    ai = next(c for c in payload["categories"] if c["name"] == "AI Tooling")
    seed_mems = [m for m in payload["memories"] if m["category_id"] == ai["id"]]
    post_mems = seed_mems + demo["memories"]

    print("AI Tooling — the demo category:")
    coh0, cl0, sep0 = describe("seed", seed_mems, vectors)
    coh1, cl1, sep1 = describe("after demo", post_mems, vectors)
    delta = coh1 - coh0
    print(f"  cohesion change: {delta:+.4f} "
          f"({'DROPS — mechanism holds' if delta < 0 else 'RISES — mechanism BROKEN'})\n")

    print("Every other category (must stay below the threshold's reach):")
    others = []
    for cat in payload["categories"]:
        mems = [m for m in payload["memories"] if m["category_id"] == cat["id"]]
        if cat["id"] == ai["id"] or len(mems) < 2:
            continue
        coh = mean_pairwise_cosine([vectors[m["id"]] for m in mems])
        others.append((cat["name"], len(mems), coh))
    for name, n, coh in sorted(others, key=lambda t: t[2]):
        gate = "  <-- reaches MIN_MEMORIES" if n >= SPLIT_MIN_MEMORIES else ""
        print(f"  {name:<22} n={n:<3} cohesion={coh:.4f}{gate}")
    print()

    # ---------------------------------------------------------------- verdict
    print("=" * 68)
    ok = True

    if delta >= 0:
        print("FAIL  Adding the demo memories does not lower cohesion under this")
        print("      model, so no threshold can produce the demo's split. The seed")
        print("      needs re-authoring against real embeddings, not re-tuning.")
        ok = False
    else:
        # A threshold must sit strictly between the two, and clear of anything
        # else that could reach MIN_MEMORIES.
        blockers = [(n_, c_) for n_, cnt, c_ in others if cnt >= SPLIT_MIN_MEMORIES and c_ < coh0]
        suggested = (coh0 + coh1) / 2
        print(f"Suggested MAX_MEAN_COHESION for {args.provider}/{model}: {suggested:.4f}")
        print(f"  (must sit between {coh1:.4f} and {coh0:.4f} — margin {abs(delta):.4f})")

        if abs(delta) < 0.01:
            print("WARN  Margin under 0.01. That is too tight to be reliable across")
            print("      model versions — re-author the seed for more separation.")
            ok = False
        if cl1[0] < SPLIT_MIN_CLUSTER_SIZE:
            print(f"FAIL  Post-demo clusters are {cl1}; the smaller is below "
                  f"MIN_CLUSTER_SIZE={SPLIT_MIN_CLUSTER_SIZE}.")
            ok = False
        if sep1 <= SPLIT_MIN_SEPARATION:
            print(f"FAIL  Post-demo separation {sep1:.4f} is below "
                  f"MIN_SEPARATION={SPLIT_MIN_SEPARATION}.")
            ok = False
        if blockers:
            print(f"FAIL  {len(blockers)} other categor(y/ies) reach MIN_MEMORIES and sit")
            print("      below the suggested threshold — they would split too, breaking")
            print("      'at most one structural operation per ingest':")
            for n_, c_ in blockers:
                print(f"        {n_} (cohesion {c_:.4f})")
            ok = False

    print()
    print("PASS  The demo mechanism survives real embeddings." if ok else
          "The demo mechanism does NOT survive real embeddings unchanged.")
    print("=" * 68)

    if args.write_vectors:
        for m in payload["memories"]:
            m["vector"] = [round(x, 6) for x in vectors[m["id"]]]
        for m in demo["memories"]:
            m["vector"] = [round(x, 6) for x in vectors[m["id"]]]

        # Rebuild relates_to from the vectors just written.
        #
        # Writing new vectors and leaving the old edges is the subtle version of
        # the mismatch this whole exercise is about: the map would keep drawing
        # 46 connections derived from a geometry that no longer exists, and
        # nothing would complain, because an edge is just two ids. Same rule as
        # the generator — top 3 per memory, above the cutoff, deduped.
        mems = payload["memories"]
        edges, seen = [], set()
        for m in mems:
            scored = sorted(
                ((cosine(m["vector"], o["vector"]), o) for o in mems if o["id"] != m["id"]),
                key=lambda t: -t[0],
            )[:3]
            for sim, other in scored:
                if sim < args.relates_to:
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
        was = len(payload.get("edges", []))
        payload["edges"] = edges

        write_seed(os.path.join(SEED_DIR, "workspace.json"), payload)
        write_seed(os.path.join(SEED_DIR, "demo-item.json"), demo)
        print(f"\nWrote {dim}-dimensional vectors into seed/.")
        print(f"Rebuilt relates_to at >= {args.relates_to}: {was} edges -> {len(edges)}.")
        print("Now update VECTOR_DIM in src/data/validateSeed.ts and the")
        print("thresholds in src/core/thresholds.ts to the proposed values above.")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
