import type { Repository } from '../db/repository';
import type { GraphPayload, Memory } from '../../src/core/types';
import workspaceJson from '../../seed/workspace.json' with { type: 'json' };

/**
 * Loads seed/workspace.json into a repository.
 *
 * This is how the backend gets a corpus to reason about before any real capture
 * has happened, and how the demo condition (spec §12.4) stays reachable through
 * the backend path: the tuned vectors go in verbatim, so the gates see exactly
 * what they saw on the frontend.
 */
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

    // Parents before children: the depth trigger reads the parent row, and a
    // child inserted first would have nothing to check against.
    const parents = payload.categories.filter((c) => c.parent_id === null);
    const children = payload.categories.filter((c) => c.parent_id !== null);
    for (const c of [...parents, ...children]) repo.insertCategory(workspaceId, c);

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
