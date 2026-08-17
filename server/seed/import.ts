import type { Repository } from '../db/repository.ts';
import type { GraphPayload, Memory } from '../../src/core/types.ts';
import workspaceJson from '../../seed/workspace.json' with { type: 'json' };
import workspaceKoJson from '../../seed/workspace.ko.json' with { type: 'json' };

/**
 * The demo corpus in the visitor's language.
 *
 * The Korean seed is not a translation: twelve Korean sources — a side
 * project's retro, a cafe-opening scout, running logs, a Jeju itinerary —
 * were run through the real pipeline (OpenAI extraction, embedding,
 * clustering) and the resulting workspace frozen, exactly how the English
 * seed's structure was earned. A Korean tester's first ten seconds are a map
 * that reads like their own life, not a founder's in another language.
 */
export function seedFor(locale?: 'en' | 'ko'): GraphPayload {
  return (locale === 'ko' ? workspaceKoJson : workspaceJson) as unknown as GraphPayload;
}

/**
 * Loads seed/workspace.json into a repository.
 *
 * This is how the backend gets a corpus to reason about before any real capture
 * has happened, and how the demo condition (spec §12.4) stays reachable through
 * the backend path: the tuned vectors go in verbatim, so the gates see exactly
 * what they saw on the frontend.
 */
/**
 * The same corpus under fresh ids.
 *
 * The schema has always been multi-tenant — every table carries a workspace_id
 * with a foreign key and an index — but the *seed* is not: its rows have fixed
 * primary keys (`src_00`, `mem_00`, `cat_hiring`), so importing it a second
 * time fails on `UNIQUE constraint failed: sources.id`. Which means that until
 * now exactly one workspace could exist, and nobody had noticed because exactly
 * one ever did.
 *
 * Giving each visitor a copy needs the ids namespaced, and every reference
 * rewritten with them: a category's parent, a memory's source and category and
 * entities, and both ends of every edge. Missing one produces a payload that
 * inserts cleanly and then fails `validateSeed` in the browser, which is a long
 * way from the mistake.
 */
export function namespaceSeed(payload: GraphPayload, prefix: string): GraphPayload {
  const id = (original: string) => `${prefix}_${original}`;
  return {
    ...payload,
    sources: payload.sources.map((s) => ({ ...s, id: id(s.id) })),
    categories: payload.categories.map((c) => ({
      ...c,
      id: id(c.id),
      parent_id: c.parent_id === null ? null : id(c.parent_id),
    })),
    entities: payload.entities.map((e) => ({ ...e, id: id(e.id) })),
    memories: payload.memories.map((m) => ({
      ...m,
      id: id(m.id),
      source_id: id(m.source_id),
      category_id: id(m.category_id),
      entity_ids: m.entity_ids.map(id),
    })),
    edges: payload.edges.map((e) => ({
      ...e,
      id: id(e.id),
      source_memory_id: id(e.source_memory_id),
      target_memory_id: id(e.target_memory_id),
    })),
  };
}

export function importSeed(
  repo: Repository,
  workspaceId = 'ws_demo',
  payload: GraphPayload = workspaceJson as unknown as GraphPayload,
): void {
  repo.transaction(() => {
    repo.createWorkspace({ id: workspaceId, name: payload.workspace.name, isDemo: true });

    for (const s of payload.sources) {
      repo.insertSource(workspaceId, {
        ...s,
        workspace_id: workspaceId,
        referenced_urls: [],
        status: 'complete',
        error_message: null,
        processed_at: s.created_at,
      });
    }

    // Payload order, not parents-then-children. The seed lists each parent
    // immediately before its own children, so the depth trigger is satisfied
    // anyway — and reordering here would make the taxonomy render differently
    // through the API than through the seed file.
    for (const c of payload.categories) {
      const parent = c.parent_id
        ? payload.categories.find((x) => x.id === c.parent_id)
        : null;
      if (c.parent_id && !parent) throw new Error(`${c.id} names a parent that is not in the seed`);
      repo.insertCategory(workspaceId, c);
    }

    for (const e of payload.entities) {
      repo.upsertEntity(workspaceId, {
        id: e.id,
        name: e.name,
        kind: e.kind,
        normalized_name: e.name.trim().toLowerCase(),
      });
    }

    repo.insertMemories(workspaceId, payload.memories as Memory[]);

    for (const m of payload.memories) {
      repo.assign({
        memoryId: m.id,
        categoryId: m.category_id,
        confidence: m.confidence,
        assignedBy: 'ai',
        locked: m.category_locked,
      });
      for (const entityId of m.entity_ids) repo.linkMemoryEntity(m.id, entityId);
    }

    repo.replaceRelatesToEdges(workspaceId, payload.edges);
  });
}
