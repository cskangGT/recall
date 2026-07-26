import { randomUUID } from 'node:crypto';
import type { Repository, ReorgEventRow, SourceRow } from '../db/repository';
import type { AiProvider, EmbeddingProvider } from '../ai/provider';
import { fallbackName, validateName } from '../ai/provider';
import type { Category, GraphPayload, Memory, SourceType } from '../../src/core/types';
import { assignMemory, categoryProfiles } from '../../src/core/assign';
import { evaluateReorg } from '../../src/core/gates';
import { applyReorg } from '../../src/core/applyReorg';
import { cosine } from '../../src/core/vectorMath';
import { RELATES_TO_MIN_SIMILARITY } from '../../src/core/thresholds';

/**
 * The ingest pipeline — spec §5.3, §8.3, §8.4.
 *
 * The order matters and is not arbitrary: the source is persisted **before**
 * any model call, so extraction, assignment, and reorganization can each fail
 * independently without losing the capture (spec §7.4). Everything downstream
 * of the source write is best-effort.
 *
 * Structural decisions come from `src/core/` — the same modules the frontend
 * imports, not a reimplementation. That is what makes "Phase 4 swaps the data
 * source and behaviour does not change" a fact rather than an aspiration.
 */

export interface IngestInput {
  workspaceId: string;
  type: SourceType;
  /** Pasted text, or the fetched body of a link. */
  content?: string;
  url?: string;
  imagePath?: string;
  referencedUrls?: string[];
}

export interface IngestResult {
  sourceId: string;
  status: SourceRow['status'];
  addedMemoryIds: string[];
  touchedCategoryIds: string[];
  reorg: ReorgEventRow | null;
  /** Populated when extraction produced nothing or a stage failed. */
  note?: string;
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

export class IngestPipeline {
  constructor(
    private readonly repo: Repository,
    private readonly ai: AiProvider,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async ingest(input: IngestInput): Promise<IngestResult> {
    const sourceId = id('src');

    // ---- 1. Persist the raw source first. A capture is never lost.
    const source: SourceRow = {
      id: sourceId,
      workspace_id: input.workspaceId,
      type: input.type,
      title: input.content?.slice(0, 60) ?? input.url ?? 'Untitled',
      raw_content: input.content ?? '',
      scene_description: null,
      url: input.url ?? null,
      image_path: input.imagePath ?? null,
      referenced_urls: input.referencedUrls ?? [],
      status: 'processing',
      error_message: null,
      created_at: now(),
      processed_at: null,
    };
    this.repo.transaction(() => this.repo.insertSource(input.workspaceId, source));

    try {
      // ---- 2. Normalize (screenshots only — spec §10.1)
      let content = input.content ?? '';
      let sceneDescription: string | undefined;
      if (input.type === 'screenshot') {
        const normalized = await this.ai.normalize({
          type: input.type, text: input.content, imagePath: input.imagePath,
        });
        content = normalized.ocr_text || input.content || '';
        sceneDescription = normalized.scene_description;
      }

      // ---- 3. Extract
      const extracted = await this.ai.extract({ content, sceneDescription, type: input.type });

      if (extracted.memories.length === 0) {
        this.repo.updateSourceStatus(sourceId, 'no_memories', { processed_at: now() });
        return {
          sourceId, status: 'no_memories', addedMemoryIds: [], touchedCategoryIds: [], reorg: null,
          note: "Saved, but Recall couldn't find anything to remember in this. It's in your Sources.",
        };
      }

      // ---- 4. Embed
      const vectors = await this.embeddings.embed(extracted.memories.map((m) => m.text), 'document');

      // ---- 5. Assign, then apply. Everything from here is one transaction:
      // a half-applied ingest is worse than one that fails outright.
      const payload = this.repo.getGraphPayload(input.workspaceId);
      const result = this.repo.transaction(() =>
        this.persist(input.workspaceId, sourceId, extracted, vectors, payload),
      );

      this.repo.updateSourceStatus(sourceId, 'complete', {
        summary: extracted.summary, processed_at: now(),
      });

      // ---- 6. Reorganize. A failure here is silent by design (spec §7.4):
      // the user still got their memories; a structural change is a bonus.
      let reorg: ReorgEventRow | null = null;
      try {
        reorg = await this.reorganize(input.workspaceId, sourceId, result.touchedCategoryIds);
      } catch {
        reorg = null;
      }

      return { sourceId, status: 'complete', ...result, reorg };
    } catch (err) {
      this.repo.updateSourceStatus(sourceId, 'failed', {
        error_message: err instanceof Error ? err.message : String(err),
        processed_at: now(),
      });
      return {
        sourceId, status: 'failed', addedMemoryIds: [], touchedCategoryIds: [], reorg: null,
        note: "Couldn't process that — it's saved and you can retry.",
      };
    }
  }

  // ---------------------------------------------------------------- persist

  private persist(
    workspaceId: string,
    sourceId: string,
    extracted: Awaited<ReturnType<AiProvider['extract']>>,
    vectors: number[][],
    payload: GraphPayload,
  ): { addedMemoryIds: string[]; touchedCategoryIds: string[] } {
    const profiles = categoryProfiles(payload.categories, payload.memories);
    const tombstones = new Set(this.repo.listTombstones(workspaceId));
    const memories: Memory[] = [];
    const assignments: { memoryId: string; categoryId: string; confidence: number }[] = [];
    const touched = new Set<string>();

    extracted.memories.forEach((extractedMemory, i) => {
      const vector = vectors[i]!;
      const memoryId = id('mem');
      const decision = assignMemory(vector, profiles);

      let categoryId: string;
      if (decision.kind === 'existing') {
        categoryId = decision.categoryId!;
      } else {
        // A new category needs a name. The namer gets no say in *whether* one is
        // created — that came from geometry above.
        const parentId = decision.kind === 'new_child' ? decision.parentId! : null;
        const siblings = payload.categories
          .filter((c) => c.parent_id === parentId)
          .map((c) => c.name);
        const forbidden = [...siblings, ...tombstones];
        const proposed = fallbackName([extractedMemory.text], [[extractedMemory.text]]);
        const name = validateName(proposed, forbidden).ok ? proposed : `${proposed} Notes`;

        const created: Category = {
          id: id('cat'), parent_id: parentId, name,
          rationale: `auto-created at similarity ${decision.score.toFixed(3)}`,
          name_locked: false, user_created: false,
          x: null, y: null, pinned: false, created_by: 'ai',
        };
        this.repo.insertCategory(workspaceId, created);
        payload.categories.push(created);
        profiles.push({ id: created.id, parentId, vectors: [vector] });
        categoryId = created.id;
      }

      memories.push({
        id: memoryId,
        source_id: sourceId,
        text: extractedMemory.text,
        kind: extractedMemory.kind,
        confidence: extractedMemory.confidence,
        category_id: categoryId,
        category_locked: false,
        entity_ids: [],
        vector,
        x: null,
        y: null,
        pinned: false,
        created_at: now(),
      });
      assignments.push({ memoryId, categoryId, confidence: decision.score });
      touched.add(categoryId);
    });

    this.repo.insertMemories(workspaceId, memories);
    for (const a of assignments) {
      this.repo.assign({ ...a, assignedBy: 'ai' });
    }

    // Entities, deduplicated by normalized name so casing variants stay one node.
    extracted.memories.forEach((extractedMemory, i) => {
      for (const entity of extractedMemory.entities) {
        const entityId = this.repo.upsertEntity(workspaceId, {
          id: id('ent'),
          name: entity.name,
          kind: entity.kind,
          normalized_name: entity.name.trim().toLowerCase(),
        });
        this.repo.linkMemoryEntity(memories[i]!.id, entityId);
      }
    });

    this.rebuildEdges(workspaceId);

    return { addedMemoryIds: memories.map((m) => m.id), touchedCategoryIds: [...touched] };
  }

  /**
   * relates_to edges: cosine at or above the threshold, top 3 per memory,
   * deduplicated. The cap is load-bearing — without it the graph becomes a
   * hairball around 200 memories (spec §8.1).
   */
  private rebuildEdges(workspaceId: string): void {
    const memories = this.repo.listMemories(workspaceId);
    const seen = new Set<string>();
    const edges = [];

    for (const m of memories) {
      const scored = memories
        .filter((o) => o.id !== m.id)
        .map((o) => ({ o, sim: cosine(m.vector, o.vector) }))
        .sort((a, b) => (b.sim - a.sim) || a.o.id.localeCompare(b.o.id))
        .slice(0, 3);

      for (const { o, sim } of scored) {
        if (sim < RELATES_TO_MIN_SIMILARITY) continue;
        const [a, b] = [m.id, o.id].sort();
        const key = `${a}|${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          id: `edg_${seen.size.toString().padStart(4, '0')}`,
          source_memory_id: a!,
          target_memory_id: b!,
          similarity: Math.round(sim * 1e4) / 1e4,
        });
      }
    }
    this.repo.replaceRelatesToEdges(workspaceId, edges);
  }

  // ---------------------------------------------------------------- reorganize

  private async reorganize(
    workspaceId: string,
    sourceId: string,
    touchedCategoryIds: string[],
  ): Promise<ReorgEventRow | null> {
    const before = this.repo.getGraphPayload(workspaceId);
    const candidate = evaluateReorg(before, touchedCategoryIds);

    if (!candidate) return null;
    // Only SPLIT is applied so far — MERGE and PROMOTE gates fire and are
    // tested, but applyReorg has no branch for them yet.
    if (candidate.operation !== 'split') return null;

    const target = before.categories.find((c) => c.id === candidate.categoryIds[0])!;
    const textOf = (ids: string[]) =>
      ids.slice(0, 12).map((mid) => before.memories.find((m) => m.id === mid)?.text ?? '');

    const siblings = before.categories
      .filter((c) => c.parent_id === (target.parent_id ?? target.id) && c.id !== target.id)
      .map((c) => c.name);
    const named = await this.ai.nameClusters({
      operation: 'split',
      clusters: [
        { cluster_id: 'a', sample_texts: textOf(candidate.clusters!.a) },
        { cluster_id: 'b', sample_texts: textOf(candidate.clusters!.b) },
      ],
      forbiddenNames: [...siblings, ...this.repo.listTombstones(workspaceId), target.name],
    });

    const names = ['a', 'b'].map((cid) => named.find((n) => n.cluster_id === cid)?.name ?? '');
    const { payload: after, event } = applyReorg(before, candidate, names);

    const row: ReorgEventRow = {
      id: id('reorg'),
      trigger_source_id: sourceId,
      operation: 'split',
      status: 'applied',
      affected_category_ids: event.affected_category_ids,
      created_category_ids: event.created_category_ids,
      banner_text: event.banner_text,
      before_state: before,
      after_state: after,
      created_at: now(),
    };

    this.repo.transaction(() => {
      for (const created of after.categories.filter(
        (c) => !before.categories.some((b) => b.id === c.id),
      )) {
        this.repo.insertCategory(workspaceId, created);
      }
      for (const m of after.memories) {
        const previous = before.memories.find((b) => b.id === m.id);
        if (!previous || previous.category_id === m.category_id) continue;
        if (this.repo.isAssignmentLocked(m.id)) continue; // a user edit is a fact
        this.repo.assign({
          memoryId: m.id, categoryId: m.category_id,
          confidence: m.confidence, assignedBy: 'ai',
        });
        this.repo.updateMemoryPosition(m.id, m.x, m.y, m.pinned);
      }
      this.repo.insertReorgEvent(workspaceId, row);
    });

    return row;
  }

  /** Pure restore from the event's snapshot — spec §8.4.5, AC-22. */
  undo(workspaceId: string, event: ReorgEventRow): void {
    this.repo.transaction(() => {
      for (const createdId of event.created_category_ids) {
        const category = event.after_state?.categories.find((c) => c.id === createdId);
        if (category) this.repo.addTombstone(workspaceId, category.name);
        this.repo.deleteCategory(createdId);
      }
      for (const m of event.before_state.memories) {
        this.repo.assign({
          memoryId: m.id, categoryId: m.category_id,
          confidence: m.confidence, assignedBy: 'ai', locked: m.category_locked,
        });
        this.repo.updateMemoryPosition(m.id, m.x, m.y, m.pinned);
      }
      this.repo.markReorgUndone(event.id);
    });
  }
}
