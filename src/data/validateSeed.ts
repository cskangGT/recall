import type { GraphPayload } from '../types/graph';

export const VECTOR_DIM = 8;

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

  for (const m of p.memories) {
    if (!categoryIds.has(m.category_id)) fail(`memory ${m.id} has unknown category ${m.category_id}`);
    if (!sourceIds.has(m.source_id)) fail(`memory ${m.id} has unknown source ${m.source_id}`);
    if (m.vector.length !== VECTOR_DIM) {
      fail(`memory ${m.id} has vector dimension ${m.vector.length}, expected ${VECTOR_DIM}`);
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
