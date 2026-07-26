export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function centroid(vectors: number[][]): number[] {
  const dim = vectors[0]?.length ?? 0;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] = (out[i] ?? 0) + (v[i] ?? 0) / vectors.length;
  }
  return out;
}

export function meanPairwiseCosine(vectors: number[][]): number {
  if (vectors.length < 2) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      total += cosine(vectors[i]!, vectors[j]!);
      pairs++;
    }
  }
  return total / pairs;
}

export interface Clusterable {
  id: string;
  vector: number[];
}

/**
 * 2-means with deterministic seeding: the two most mutually distant items.
 * Random initialization would make the same input produce different maps on
 * different runs, which is unusable on stage.
 */
export function twoMeans<T extends Clusterable>(items: T[]): { a: T[]; b: T[]; separation: number } {
  if (items.length < 2) return { a: items, b: [], separation: 0 };

  let seedA = items[0]!;
  let seedB = items[1]!;
  let worst = Infinity;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const s = cosine(items[i]!.vector, items[j]!.vector);
      if (s < worst) {
        worst = s;
        seedA = items[i]!;
        seedB = items[j]!;
      }
    }
  }

  let ca = seedA.vector;
  let cb = seedB.vector;
  let a: T[] = [];
  let b: T[] = [];

  for (let iter = 0; iter < 50; iter++) {
    a = [];
    b = [];
    for (const item of items) {
      if (cosine(item.vector, ca) >= cosine(item.vector, cb)) a.push(item);
      else b.push(item);
    }
    if (a.length === 0 || b.length === 0) break;
    const na = centroid(a.map((x) => x.vector));
    const nb = centroid(b.map((x) => x.vector));
    const settled = cosine(na, ca) > 0.9999 && cosine(nb, cb) > 0.9999;
    ca = na;
    cb = nb;
    if (settled) break;
  }

  return { a, b, separation: 1 - cosine(ca, cb) };
}
