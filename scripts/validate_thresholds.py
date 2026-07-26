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


def embed_voyage(texts, model):
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


def embed_openai(texts, model):
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("pip install openai  (or use --provider voyage)")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY is not set.")
    client = OpenAI()
    out = []
    for i in range(0, len(texts), 128):
        resp = client.embeddings.create(model=model, input=texts[i:i + 128])
        out.extend(d.embedding for d in resp.data)
    return out


def embed_seed(_texts, _model):
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
        raw = embed_fn([m["text"] for m in all_memories], model)
    vectors = {m["id"]: v for m, v in zip(all_memories, raw)}
    dim = len(raw[0])
    print(f"  dimension: {dim}\n")

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
        json.dump(payload, open(os.path.join(SEED_DIR, "workspace.json"), "w"), indent=2)
        json.dump(demo, open(os.path.join(SEED_DIR, "demo-item.json"), "w"), indent=2)
        print(f"\nWrote {dim}-dimensional vectors into seed/. Update VECTOR_DIM in")
        print("src/data/validateSeed.ts and MAX_MEAN_COHESION in src/reorg/thresholds.ts.")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
