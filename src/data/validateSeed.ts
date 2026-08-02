import type { GraphPayload } from '../core/types';

/**
 * The width every vector in a payload must share.
 *
 * Derived from the payload rather than declared, because the number is a
 * property of whoever embedded it — 8 while the seed carried hand-authored
 * vectors, 1024 now that it carries real ones, 1536 if someone drops the
 * narrowing. Pinning it as a constant meant every change of embedder was also
 * an edit here, and forgetting made the app throw on boot.
 *
 * What is worth checking is not the number but the agreement. `cosine`
 * (src/core/vectorMath.ts) walks `a.length` with `?? 0`, so comparing an 8-wide
 * vector against a 1024-wide one returns a plausible wrong number instead of
 * failing — a corpus half re-embedded would rank by nonsense and look fine.
 */
export function vectorDimOf(p: GraphPayload): number {
  return p.memories[0]?.vector.length ?? 0;
}

export class SeedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedValidationError';
  }
}

function fail(message: string): never {
  throw new SeedValidationError(message);
}

export function validateSeed(raw: unknown): GraphPayload {
  const p = raw as GraphPayload;
  if (!p || typeof p !== 'object') fail('seed is not an object');
  for (const key of ['sources', 'memories', 'categories', 'entities', 'edges'] as const) {
    if (!Array.isArray(p[key])) fail(`seed.${key} must be an array`);
  }

  const categoryIds = new Set(p.categories.map((c) => c.id));
  const sourceIds = new Set(p.sources.map((s) => s.id));
  const entityIds = new Set(p.entities.map((e) => e.id));

  for (const c of p.categories) {
    if (c.parent_id === null) continue;
    if (!categoryIds.has(c.parent_id)) fail(`category ${c.id} has unknown parent ${c.parent_id}`);
    const parent = p.categories.find((x) => x.id === c.parent_id);
    if (parent && parent.parent_id !== null) {
      fail(`category ${c.id} nests three deep — Recall keeps categories two levels deep`);
    }
  }

  const dim = vectorDimOf(p);
  if (dim === 0) fail('seed has no memories to take a vector width from');

  for (const m of p.memories) {
    if (!categoryIds.has(m.category_id)) fail(`memory ${m.id} has unknown category ${m.category_id}`);
    if (!sourceIds.has(m.source_id)) fail(`memory ${m.id} has unknown source ${m.source_id}`);
    if (m.vector.length !== dim) {
      fail(`memory ${m.id} has vector dimension ${m.vector.length}, expected ${dim}`);
    }
    for (const id of m.entity_ids) {
      if (!entityIds.has(id)) fail(`memory ${m.id} references unknown entity ${id}`);
    }
  }

  const memoryIds = new Set(p.memories.map((m) => m.id));
  for (const e of p.edges) {
    if (!memoryIds.has(e.source_memory_id) || !memoryIds.has(e.target_memory_id)) {
      fail(`edge ${e.id} references an unknown memory`);
    }
  }

  return p;
}
