import { randomUUID } from 'node:crypto';
import type { Repository, ReorgEventRow, SourceRow } from '../db/repository.ts';
import type { AiProvider, EmbeddingProvider } from '../ai/provider.ts';
import { fallbackName, validateName } from '../ai/provider.ts';
import type { Category, GraphPayload, Memory, SourceType } from '../../src/core/types.ts';
import { assignMemory, categoryProfiles } from '../../src/core/assign.ts';
import { evaluateReorg } from '../../src/core/gates.ts';
import { applyReorg } from '../../src/core/applyReorg.ts';
import { cosine } from '../../src/core/vectorMath.ts';
import { RELATES_TO_MIN_SIMILARITY } from '../../src/core/thresholds.ts';

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
  // Written out rather than as constructor parameter properties: those emit
  // code, not just types, so Node's strip-only TypeScript loader rejects them —
  // and `node server/http/main.ts` with no build step is worth the four lines.
  private readonly repo: Repository;
  private readonly ai: AiProvider;
  private readonly embeddings: EmbeddingProvider;

  constructor(repo: Repository, ai: AiProvider, embeddings: EmbeddingProvider) {
    this.repo = repo;
    this.ai = ai;
    this.embeddings = embeddings;
  }

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
    return this.process(input.workspaceId, source);
  }

  /**
   * Re-runs a source that failed, keeping its id.
   *
   * The failure note has always said "it's saved and you can retry" — this is
   * the retry. Reusing the id matters: a new one would leave the failed capture
   * sitting in Sources forever beside its own successful replacement.
   *
   * Only failures are retried. Re-running a completed source would extract its
   * memories a second time, and nothing here de-duplicates.
   */
  async retry(workspaceId: string, sourceId: string): Promise<IngestResult> {
    const source = this.repo.listSources(workspaceId).find((s) => s.id === sourceId);
    if (!source) throw new Error(`unknown source ${sourceId}`);
    if (source.status !== 'failed') {
      throw new Error(`source ${sourceId} is ${source.status}, not failed`);
    }

    this.repo.updateSourceStatus(sourceId, 'processing', { error_message: null });
    return this.process(workspaceId, { ...source, status: 'processing', error_message: null });
  }

  /** Steps 2-6, shared by a first attempt and a retry. */
  private async process(workspaceId: string, source: SourceRow): Promise<IngestResult> {
    const sourceId = source.id;
    const input = {
      workspaceId,
      type: source.type,
      content: source.raw_content,
      imagePath: source.image_path ?? undefined,
    };

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
      //
      // Skipped entirely when the workspace has auto-reorganize off. That field
      // has been in the schema and the payload since Phase 3 and was read by
      // nobody — declared and ignored.
      let reorg: ReorgEventRow | null = null;
      if (this.repo.getWorkspace(workspaceId)?.auto_reorganize !== false) {
        try {
          reorg = await this.reorganize(workspaceId, sourceId, result.touchedCategoryIds);
        } catch {
          reorg = null;
        }
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

    const target = before.categories.find((c) => c.id === candidate.categoryIds[0])!;
    const textOf = (ids: string[]) =>
      ids.slice(0, 12).map((mid) => before.memories.find((m) => m.id === mid)?.text ?? '');
    const memoryTextsIn = (categoryId: string) =>
      before.memories.filter((m) => m.category_id === categoryId).slice(0, 12).map((m) => m.text);

    // PROMOTE keeps the name it already has — the banner says "X grew into its
    // own category", so there is nothing to name and no reason to spend a call.
    let names: string[] = [];
    if (candidate.operation !== 'promote') {
      const siblings = before.categories
        .filter((c) => c.parent_id === (target.parent_id ?? target.id))
        .filter((c) => !candidate.categoryIds.includes(c.id))
        .map((c) => c.name);
      const forbidden = [...siblings, ...this.repo.listTombstones(workspaceId)];

      const clusters =
        candidate.operation === 'split'
          ? [
              { cluster_id: 'a', sample_texts: textOf(candidate.clusters!.a) },
              { cluster_id: 'b', sample_texts: textOf(candidate.clusters!.b) },
            ]
          : [{ cluster_id: 'merged', sample_texts: candidate.categoryIds.flatMap(memoryTextsIn) }];

      const named = await this.ai.nameClusters({
        operation: candidate.operation,
        clusters,
        // A split must not reuse the name it is dividing; a merge may keep the
        // surviving category's name, so those names stay allowed.
        forbiddenNames:
          candidate.operation === 'split' ? [...forbidden, target.name] : forbidden,
      });
      names = clusters.map((c) => named.find((n) => n.cluster_id === c.cluster_id)?.name ?? '');
    }

    const { payload: after, event } = applyReorg(before, candidate, names);

    const row: ReorgEventRow = {
      id: id('reorg'),
      trigger_source_id: sourceId,
      operation: candidate.operation,
      status: 'applied',
      affected_category_ids: event.affected_category_ids,
      created_category_ids: event.created_category_ids,
      banner_text: event.banner_text,
      before_state: before,
      after_state: after,
      created_at: now(),
    };

    // A general category diff rather than insert-only: SPLIT creates, MERGE
    // removes and renames, PROMOTE re-parents and moves. Diffing covers all
    // three without the pipeline knowing which one ran.
    this.repo.transaction(() => {
      for (const created of after.categories.filter(
        (c) => !before.categories.some((b) => b.id === c.id),
      )) {
        this.repo.insertCategory(workspaceId, created);
      }
      for (const c of after.categories) {
        const previous = before.categories.find((b) => b.id === c.id);
        if (!previous) continue;
        if (
          previous.name === c.name && previous.parent_id === c.parent_id &&
          previous.x === c.x && previous.y === c.y
        ) continue;
        this.repo.updateCategory(c.id, {
          name: c.name, parent_id: c.parent_id, x: c.x, y: c.y,
        });
      }
      for (const removed of before.categories.filter(
        (b) => !after.categories.some((c) => c.id === b.id),
      )) {
        // Tombstone before deleting, so the same clustering signal cannot
        // resurrect the name on a later pass (spec §11.4).
        this.repo.addTombstone(workspaceId, removed.name);
        this.repo.deleteCategory(removed.id);
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
