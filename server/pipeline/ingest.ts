import { randomUUID } from 'node:crypto';
import type { Repository, ReorgEventRow, SourceRow } from '../db/repository.ts';
import type { AiProvider, EmbeddingProvider } from '../ai/provider.ts';
import { fallbackName } from '../ai/provider.ts';
import type { Category, GraphPayload, Memory, SourceType } from '../../src/core/types.ts';
import { assignMemory, categoryProfiles } from '../../src/core/assign.ts';
import { evaluateReorg } from '../../src/core/gates.ts';
import { applyReorg } from '../../src/core/applyReorg.ts';
import { cosine } from '../../src/core/vectorMath.ts';
import { RELATES_TO_MIN_SIMILARITY, DUPLICATE_SIMILARITY } from '../../src/core/thresholds.ts';

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
  /**
   * What to call this source, when the caller knows better than we can guess.
   *
   * The browser extension does: it has the page's own `<title>`, which is
   * authoritative and free. Without it the title is the first sixty characters
   * of the body, which for a saved article is a sentence fragment.
   */
  title?: string;
  url?: string;
  imagePath?: string;
  referencedUrls?: string[];
  /** The viewer's language — category names are UI, not content. */
  locale?: 'en' | 'ko';
}

export interface IngestResult {
  sourceId: string;
  status: SourceRow['status'];
  addedMemoryIds: string[];
  touchedCategoryIds: string[];
  /**
   * Extracted memories that were not written because the corpus already held
   * them. Reported rather than dropped in silence: a source that produced four
   * memories and added one has to be able to say why, or the count looks like a
   * failure of extraction.
   */
  skipped: { text: string; similarity: number }[];
  reorg: ReorgEventRow | null;
  /** Populated when extraction produced nothing or a stage failed. */
  note?: string;
}

export interface BatchIngestResult {
  /** One per input, in input order. Per-item `reorg` is always null here. */
  results: IngestResult[];
  /**
   * Every structural operation the batch settled into, oldest first.
   *
   * A first fill is a different regime from a daily capture: spec 8.4.3's
   * one-op-per-ingest exists so a person can absorb one structural idea per
   * beat, but a bulk import's reveal summarizes the whole result at once —
   * so the gates run until they go quiet (capped), not once. Ninety-nine
   * memories that got exactly one split came out as one category holding
   * eighty-six of them, which is a pile with a name, not a map.
   */
  reorgs: ReorgEventRow[];
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

/**
 * Where each extracted memory goes, decided before anything is written.
 *
 * Pulled out of `persist` because naming a new category needs the model, the
 * model call is async, and `persist` runs inside a synchronous transaction. So
 * the decision happens first, the naming happens between, and the writing
 * happens last with the names already in hand.
 *
 * Pure on purpose — no repository, no clock, no model — so "would this memory
 * open a new category" is answerable in a test without any of them.
 *
 * The provisional profile at the end of the loop is the part worth keeping:
 * a category that memory 0 opens has to be visible to memory 1, or a source
 * that says two related things opens two categories for them.
 */
export type PlannedAssignment =
  | {
      kind: 'skip';
      index: number;
      text: string;
      similarity: number;
      /** The held memory this arrival reinforces — absent when it duplicates
       *  something from this same batch that has no id yet. */
      reinforcesMemoryId?: string;
    }
  | { kind: 'existing'; index: number; categoryId: string; score: number }
  /** Joins a category an earlier memory in this same batch opened. */
  | { kind: 'joins'; index: number; clusterId: string; score: number }
  | { kind: 'new'; index: number; parentId: string | null; score: number; clusterId: string };

export function planAssignments(
  payload: GraphPayload,
  texts: readonly string[],
  vectors: readonly number[][],
): PlannedAssignment[] {
  const profiles = categoryProfiles(payload.categories, payload.memories);
  const plan: PlannedAssignment[] = [];

  texts.forEach((text, index) => {
    const vector = vectors[index]!;
    const decision = assignMemory(vector, profiles);

    /*
     * Something already held is not written a second time.
     *
     * `assignMemory` takes the argmax of `bestMemberSimilarity` across every
     * profile, so `decision.score` *is* the candidate's nearest neighbour in the
     * whole corpus — the check is a comparison, not a computation. Decided here
     * rather than later so a duplicate cannot reach the namer on its way to
     * being discarded, and so it contributes no provisional profile of its own.
     */
    if (decision.score >= DUPLICATE_SIMILARITY) {
      /*
       * A duplicate is a signal, not noise: the same thought arriving again is
       * the most honest importance measure there is. Find the held memory it
       * echoes so persist() can count it — times_seen is what the UI ranks,
       * sizes and says "this thought keeps coming back" with.
       */
      let nearest: { id: string; score: number } | null = null;
      for (const m of payload.memories) {
        const score = cosine(vector, m.vector);
        if (!nearest || score > nearest.score) nearest = { id: m.id, score };
      }
      plan.push({
        kind: 'skip',
        index,
        text,
        similarity: decision.score,
        reinforcesMemoryId:
          nearest && nearest.score >= DUPLICATE_SIMILARITY ? nearest.id : undefined,
      });
      return;
    }

    if (decision.kind === 'existing') {
      /*
       * The category it matched may not exist yet — the provisional profiles
       * below carry synthetic ids, and a memory can land on one an earlier
       * memory in this same batch opened. Saying which of the two it is here
       * keeps `persist` from having to guess whether an id is real.
       */
      const openedHere = plan.find(
        (p) => p.kind === 'new' && p.clusterId === decision.categoryId,
      );
      plan.push(
        openedHere
          ? { kind: 'joins', index, clusterId: decision.categoryId!, score: decision.score }
          : { kind: 'existing', index, categoryId: decision.categoryId!, score: decision.score },
      );
      return;
    }

    const parentId = decision.kind === 'new_child' ? decision.parentId! : null;
    const clusterId = `new_${index}`;
    plan.push({ kind: 'new', index, parentId, score: decision.score, clusterId });
    profiles.push({ id: clusterId, parentId, vectors: [vector] });
  });

  return plan;
}


/**
 * True when the source's title was derived rather than given.
 *
 * A predicate rather than a `title_locked` column, and rather than a flag
 * threaded through `process()`. A column would need a migration, and
 * `migrate()` is `CREATE TABLE IF NOT EXISTS` only — a new column silently
 * never appears in a database that already exists, which after the launchd
 * agent means every real corpus. A flag would not survive `retry()`, which
 * reconstructs from the row and has no idea where the title came from.
 *
 * Reading it back off the row survives both.
 */
export function isDerivedTitle(source: SourceRow): boolean {
  const title = source.title;
  return (
    title === '' ||
    title === 'Untitled' ||
    title === source.url ||
    title === source.raw_content.slice(0, 60)
  );
}

export class IngestPipeline {
  // Written out rather than as constructor parameter properties: those emit
  // code, not just types, so Node's strip-only TypeScript loader rejects them —
  // and `node server/http/main.ts` with no build step is worth the four lines.
  private readonly repo: Repository;
  private readonly ai: AiProvider;
  private readonly embeddings: EmbeddingProvider;

  /**
   * All ingest work runs through here, one at a time.
   *
   * Spec 5.3 has always said captures process serially — parallel
   * reorganization of one taxonomy produces conflicting structural decisions —
   * but nothing enforced it, and the Notes button made the race real: two
   * imports interleaving transactions on one SQLite connection came out as
   * FOREIGN KEY failures on perfectly good notes. A promise chain is the whole
   * queue; the failure of one job must not dam the jobs behind it.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  constructor(repo: Repository, ai: AiProvider, embeddings: EmbeddingProvider) {
    this.repo = repo;
    this.ai = ai;
    this.embeddings = embeddings;
  }

  ingest(input: IngestInput, options: { reorganize?: boolean } = {}): Promise<IngestResult> {
    return this.serialize(() => this.ingestInner(input, options));
  }

  private async ingestInner(
    input: IngestInput,
    options: { reorganize?: boolean } = {},
  ): Promise<IngestResult> {
    const sourceId = id('src');

    // ---- 1. Persist the raw source first. A capture is never lost.
    const source: SourceRow = {
      id: sourceId,
      workspace_id: input.workspaceId,
      type: input.type,
      // `||` not `??`: a link capture with `content: ''` is not nullish, so the
      // old `??` gave it a title of the empty string.
      title: input.title?.trim() || input.content?.slice(0, 60) || input.url || 'Untitled',
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
    return this.process(input.workspaceId, source, { ...options, locale: input.locale });
  }

  /**
   * Many sources, one structural operation.
   *
   * Items are processed serially — parallel reorganization of the same taxonomy
   * produces conflicting structural decisions (spec §5.3) — with the per-item
   * reorganize suppressed. The gates then run once over everything the batch
   * touched, so "at most one structural operation per ingest" (spec 8.4.3)
   * holds for the batch as a whole: thirty items re-clustering thirty times is
   * a blob rearranging, and a reveal can only declare one structural sentence.
   *
   * A failed item is recorded on its own source row and does not stop the rest;
   * a batch that dies at item 17 of 30 with nothing to show would lose the
   * user's trust at the exact moment built to earn it.
   */
  ingestBatch(inputs: IngestInput[]): Promise<BatchIngestResult> {
    // One serialized section for the whole batch — items inside call the
    // unserialized inner path, or the batch would deadlock behind itself.
    return this.serialize(() => this.ingestBatchInner(inputs));
  }

  private async ingestBatchInner(inputs: IngestInput[]): Promise<BatchIngestResult> {
    const results: IngestResult[] = [];
    const touched = new Set<string>();

    for (const input of inputs) {
      const result = await this.ingestInner(input, { reorganize: false });
      results.push(result);
      for (const categoryId of result.touchedCategoryIds) touched.add(categoryId);
    }

    const reorgs: ReorgEventRow[] = [];
    const workspaceId = inputs[0]?.workspaceId;
    // The trigger source is the last item that actually landed memories — the
    // capture that tipped the geometry, which is what the column means.
    const trigger = [...results].reverse().find((r) => r.addedMemoryIds.length > 0);
    if (
      workspaceId !== undefined &&
      trigger !== undefined &&
      touched.size > 0 &&
      this.repo.getWorkspace(workspaceId)?.auto_reorganize !== false
    ) {
      /*
       * Run the gates until they go quiet. Each round widens the scope with
       * whatever the last operation touched or created — a split's children
       * are exactly the categories the next round needs to look at. The cap
       * is a backstop, not a target; the gates converge on their own because
       * every operation reduces the tension that fired it.
       */
      const MAX_ROUNDS = 5;
      const scope = new Set(touched);
      const locale = inputs[0]?.locale;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        try {
          const reorg = await this.reorganize(workspaceId, trigger.sourceId, [...scope], locale);
          if (!reorg) break;
          reorgs.push(reorg);
          for (const id of reorg.affected_category_ids) scope.add(id);
          for (const id of reorg.created_category_ids) scope.add(id);
        } catch {
          break; // silent by design — the memories all landed (spec §7.4)
        }
      }
    }

    return { results, reorgs };
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
  retry(workspaceId: string, sourceId: string): Promise<IngestResult> {
    return this.serialize(async () => {
      const source = this.repo.listSources(workspaceId).find((s) => s.id === sourceId);
      if (!source) throw new Error(`unknown source ${sourceId}`);
      if (source.status !== 'failed') {
        throw new Error(`source ${sourceId} is ${source.status}, not failed`);
      }

      this.repo.updateSourceStatus(sourceId, 'processing', { error_message: null });
      return this.process(workspaceId, { ...source, status: 'processing', error_message: null });
    });
  }

  /** Steps 2-6, shared by a first attempt and a retry. */
  private async process(
    workspaceId: string,
    source: SourceRow,
    options: { reorganize?: boolean; locale?: 'en' | 'ko' } = {},
  ): Promise<IngestResult> {
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
      // The curation signal rides in: the last few extractions this person
      // removed in review become negative examples (spec §21).
      const rejectedExamples = this.repo
        .listCuration(input.workspaceId, 'discard', 5)
        .map((c) => c.memory_text);
      const extracted = await this.ai.extract({
        content,
        sceneDescription,
        type: input.type,
        rejectedExamples,
      });

      if (extracted.memories.length === 0) {
        this.repo.updateSourceStatus(sourceId, 'no_memories', { processed_at: now() });
        return {
          sourceId, status: 'no_memories', addedMemoryIds: [], touchedCategoryIds: [],
          skipped: [], reorg: null,
          note: "Saved, but Mado couldn't find anything to remember in this. It's in your Sources.",
        };
      }

      // ---- 4. Embed
      const vectors = await this.embeddings.embed(extracted.memories.map((m) => m.text), 'document');

      // ---- 5. Assign, then apply. Everything from here is one transaction:
      // a half-applied ingest is worse than one that fails outright.
      const payload = this.repo.getGraphPayload(input.workspaceId);
      const plan = planAssignments(payload, extracted.memories.map((m) => m.text), vectors);
      // Named before the transaction opens, because this is the one part that
      // has to ask a model and a transaction cannot wait for one.
      const names = await this.nameNewCategories(input.workspaceId, plan, extracted, payload, options.locale);
      const result = this.repo.transaction(() =>
        this.persist(input.workspaceId, sourceId, extracted, vectors, payload, plan, names),
      );

      /*
       * `suggested_title` was extracted and thrown away.
       *
       * The extract prompt has always asked for it — "five words or fewer,
       * naming the source, not the contents" — and nothing ever wrote it down,
       * so a pasted note was titled with its own first sixty characters
       * forever. That is what Sources has been showing.
       *
       * It fills in only where nothing better exists. A title the caller gave
       * us wins: the extension has the page's own `<title>`, which is
       * authoritative, and a model's guess must not overwrite it. `null` is
       * "leave it alone" by the COALESCE above.
       */
      this.repo.updateSourceStatus(sourceId, 'complete', {
        summary: extracted.summary,
        processed_at: now(),
        title: isDerivedTitle(source) ? extracted.suggested_title.trim() || null : null,
      });

      // ---- 6. Reorganize. A failure here is silent by design (spec §7.4):
      // the user still got their memories; a structural change is a bonus.
      //
      // Skipped entirely when the workspace has auto-reorganize off. That field
      // has been in the schema and the payload since Phase 3 and was read by
      // nobody — declared and ignored.
      let reorg: ReorgEventRow | null = null;
      if (options.reorganize !== false && this.repo.getWorkspace(workspaceId)?.auto_reorganize !== false) {
        try {
          reorg = await this.reorganize(workspaceId, sourceId, result.touchedCategoryIds, options.locale);
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
        sourceId, status: 'failed', addedMemoryIds: [], touchedCategoryIds: [],
        skipped: [], reorg: null,
        note: "Couldn't process that — it's saved and you can retry.",
      };
    }
  }

  /**
   * Names every category this capture is about to open, in one call.
   *
   * One call rather than one each, so two categories born from the same source
   * cannot be handed the same name — `nameClusters` accumulates what it has
   * already used into `forbiddenNames` as it goes, and it retries twice before
   * falling back to term statistics.
   *
   * Those statistics were the *only* path until now, and they are hopeless here:
   * a brand-new category has one sentence in it, and one sentence has no term
   * frequencies to compare. It is why a note about lowering a pricing tier came
   * out called "Because Consider".
   */
  private async nameNewCategories(
    workspaceId: string,
    plan: PlannedAssignment[],
    extracted: Awaited<ReturnType<AiProvider['extract']>>,
    payload: GraphPayload,
    locale?: 'en' | 'ko',
  ): Promise<Map<string, string>> {
    const opening = plan.filter((p): p is Extract<PlannedAssignment, { kind: 'new' }> => p.kind === 'new');
    if (opening.length === 0) return new Map();

    const tombstones = this.repo.listTombstones(workspaceId);
    const parents = new Set(opening.map((o) => o.parentId));
    const siblings = payload.categories
      .filter((c) => parents.has(c.parent_id))
      .map((c) => c.name);

    const named = await this.ai.nameClusters({
      operation: 'new_category',
      clusters: opening.map((o) => ({
        cluster_id: o.clusterId,
        sample_texts: [extracted.memories[o.index]!.text],
      })),
      forbiddenNames: [...siblings, ...tombstones],
      locale,
    });

    return new Map(named.map((n) => [n.cluster_id, n.name]));
  }

  // ---------------------------------------------------------------- persist

  private persist(
    workspaceId: string,
    sourceId: string,
    extracted: Awaited<ReturnType<AiProvider['extract']>>,
    vectors: number[][],
    payload: GraphPayload,
    plan: PlannedAssignment[],
    names: Map<string, string>,
  ): { addedMemoryIds: string[]; touchedCategoryIds: string[];
       skipped: { text: string; similarity: number }[] } {
    const memories: Memory[] = [];
    /** Synthetic cluster id -> the real category it became, for `joins`. */
    const createdByCluster = new Map<string, string>();
    const assignments: { memoryId: string; categoryId: string; confidence: number }[] = [];
    const touched = new Set<string>();
    const skipped: { text: string; similarity: number }[] = [];
    /** Extracted index -> the row it became. Absent when it was a duplicate. */
    const memoryIdByExtractedIndex = new Map<number, string>();

    /*
     * Writing only. Every decision was made by `planAssignments` and every new
     * name by `nameNewCategories`, both before this transaction opened — the
     * namer gets no say in *whether* a category is created, only in what it is
     * called, which is the rule this pipeline has always been built on.
     */
    extracted.memories.forEach((extractedMemory, i) => {
      const step = plan[i]!;
      if (step.kind === 'skip') {
        skipped.push({ text: step.text, similarity: step.similarity });
        if (step.reinforcesMemoryId) this.repo.reinforceMemory(step.reinforcesMemoryId);
        return;
      }

      const vector = vectors[i]!;
      const memoryId = id('mem');

      let categoryId: string;
      if (step.kind === 'existing') {
        categoryId = step.categoryId;
      } else if (step.kind === 'joins') {
        categoryId = createdByCluster.get(step.clusterId)!;
      } else {
        const created: Category = {
          id: id('cat'),
          parent_id: step.parentId,
          name: names.get(step.clusterId) ?? fallbackName([extractedMemory.text], [[extractedMemory.text]]),
          rationale: `auto-created at similarity ${step.score.toFixed(3)}`,
          name_locked: false, user_created: false,
          x: null, y: null, pinned: false, created_by: 'ai',
        };
        this.repo.insertCategory(workspaceId, created);
        payload.categories.push(created);
        createdByCluster.set(step.clusterId, created.id);
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
      assignments.push({ memoryId, categoryId, confidence: step.score });
      memoryIdByExtractedIndex.set(i, memoryId);
      touched.add(categoryId);
    });

    this.repo.insertMemories(workspaceId, memories);
    for (const a of assignments) {
      this.repo.assign({ ...a, assignedBy: 'ai' });
    }

    /*
     * Entities, deduplicated by normalized name so casing variants stay one node.
     *
     * Keyed by the extracted memory's index rather than by position in
     * `memories`. Those were the same array until duplicates started being
     * skipped; now they are not, and indexing `memories[i]` would silently hang
     * every entity on the wrong memory — a corruption with no symptom, since
     * both ids are valid.
     */
    extracted.memories.forEach((extractedMemory, i) => {
      const memoryId = memoryIdByExtractedIndex.get(i);
      if (memoryId === undefined) return;
      for (const entity of extractedMemory.entities) {
        const entityId = this.repo.upsertEntity(workspaceId, {
          id: id('ent'),
          name: entity.name,
          kind: entity.kind,
          normalized_name: entity.name.trim().toLowerCase(),
        });
        this.repo.linkMemoryEntity(memoryId, entityId);
      }
    });

    this.rebuildEdges(workspaceId);

    return {
      addedMemoryIds: memories.map((m) => m.id),
      touchedCategoryIds: [...touched],
      skipped,
    };
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
          /*
           * Namespaced by workspace, because `edges.id` is a global primary key
           * and this counter only counts within one. It never collided while
           * exactly one workspace existed — and the moment a second visitor got
           * their own copy, their first capture died on
           * `UNIQUE constraint failed: edges.id`.
           */
          id: `edg_${workspaceId}_${seen.size.toString().padStart(4, '0')}`,
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
    locale?: 'en' | 'ko',
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
        locale,
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

  // ------------------------------------------------------------ user review

  /**
   * Applies one source's review verdicts atomically — the visible half of the
   * curation feature. Discards delete the row but keep the text in a verdict
   * record (charter: nothing is lost); edits re-embed and lock the assignment
   * (a user edit is a fact); keeps are recorded too, because "this survived
   * review" is as much taste signal as a cut. Edges rebuild once at the end.
   */
  async reviewSource(
    workspaceId: string,
    sourceId: string,
    input: { discard: string[]; edits: { memoryId: string; text: string }[] },
  ): Promise<void> {
    const memories = this.repo.listMemories(workspaceId);
    const bySource = memories.filter((m) => m.source_id === sourceId);
    const byId = new Map(bySource.map((m) => [m.id, m]));

    for (const mid of input.discard) {
      if (!byId.has(mid)) throw new Error(`memory ${mid} is not from this source`);
    }
    for (const e of input.edits) {
      if (!byId.has(e.memoryId)) throw new Error(`memory ${e.memoryId} is not from this source`);
      if (e.text.trim().length === 0) throw new Error('an edited memory must not be empty');
      if (input.discard.includes(e.memoryId)) {
        throw new Error('a memory cannot be both edited and discarded');
      }
    }

    // Embeddings before the transaction opens — it must stay synchronous.
    const editVectors = new Map<string, number[]>();
    if (input.edits.length > 0) {
      const vectors = await this.embeddings.embed(
        input.edits.map((e) => e.text.trim()),
        'document',
      );
      input.edits.forEach((e, i) => editVectors.set(e.memoryId, vectors[i]!));
    }

    const at = now();
    const record = (memoryText: string, verdict: 'keep' | 'discard' | 'edit', editedText: string | null) =>
      this.repo.insertCuration(workspaceId, {
        id: id('cur'),
        source_id: sourceId,
        memory_text: memoryText,
        verdict,
        edited_text: editedText,
        created_at: at,
      });

    this.repo.transaction(() => {
      const touched = new Set([...input.discard, ...input.edits.map((e) => e.memoryId)]);
      for (const mid of input.discard) {
        record(byId.get(mid)!.text, 'discard', null);
        this.repo.deleteMemory(mid);
      }
      for (const e of input.edits) {
        const memory = byId.get(e.memoryId)!;
        record(memory.text, 'edit', e.text.trim());
        this.repo.updateMemoryText(e.memoryId, e.text.trim(), editVectors.get(e.memoryId)!);
        // A user edit is a fact — no reorganization may reassign it.
        this.repo.assign({
          memoryId: e.memoryId,
          categoryId: memory.category_id,
          confidence: memory.confidence,
          assignedBy: 'user',
          locked: true,
        });
      }
      for (const m of bySource) {
        if (!touched.has(m.id)) record(m.text, 'keep', null);
      }
      this.repo.setSourceReviewed(sourceId, at);
    });

    this.rebuildEdges(workspaceId);
  }

  // -------------------------------------------------------------- user merge

  /** Whether the wired model can explain and draft a merge at all. */
  canMerge(): boolean {
    return typeof this.ai.mergeMemories === 'function';
  }

  /**
   * The AI's half of a user-driven merge: why these overlap, and the one text
   * that would hold everything. Reads nothing but the memories and writes
   * nothing at all — the user is about to decide, and a preview that mutated
   * state would be deciding for them.
   */
  async previewMerge(
    workspaceId: string,
    memoryIds: string[],
    locale?: 'en' | 'ko',
  ): Promise<{ reason: string; merged_text: string }> {
    if (!this.ai.mergeMemories) throw new Error('this model cannot draft merges');
    const byId = new Map(this.repo.listMemories(workspaceId).map((m) => [m.id, m]));
    const texts = memoryIds.map((mid) => byId.get(mid)?.text).filter((t): t is string => !!t);
    if (texts.length < 2) throw new Error('a merge needs at least two memories');
    return this.ai.mergeMemories({ texts, locale });
  }

  /**
   * Applies a merge the user confirmed, with the text they saw.
   *
   * Nothing is lost by construction: the merged text carries every fact (the
   * user approved it), the original sources stay untouched in the source list,
   * entity links are the union, and times_seen is the sum — three arrivals of
   * a thought are still three arrivals after it becomes one row. The merged
   * memory keeps the newest original's source and date, so the free-window
   * math treats it as the most recent time the thought showed up.
   */
  applyMerge(workspaceId: string, memoryIds: string[], mergedText: string): Memory {
    const all = this.repo.listMemories(workspaceId);
    const originals = memoryIds
      .map((mid) => all.find((m) => m.id === mid))
      .filter((m): m is Memory => m !== undefined);
    if (originals.length < 2) throw new Error('a merge needs at least two memories');
    const text = mergedText.trim();
    if (!text) throw new Error('merged text must not be empty');

    const newest = [...originals].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]!;
    /*
     * The merged vector is the normalized mean of the originals', not a fresh
     * embedding. Synchronous (this runs inside a transaction), free, and honest:
     * the merged row should sit where its parts sat, and the mean of vectors
     * this close is within noise of re-embedding their union.
     */
    const dims = newest.vector.length;
    const mean = new Array<number>(dims).fill(0);
    for (const m of originals) for (let i = 0; i < dims; i++) mean[i]! += m.vector[i]! / originals.length;
    const norm = Math.sqrt(mean.reduce((s, v) => s + v * v, 0)) || 1;
    const vector = mean.map((v) => v / norm);

    const merged: Memory = {
      id: id('mem'),
      source_id: newest.source_id,
      text,
      kind: newest.kind,
      confidence: Math.max(...originals.map((m) => m.confidence)),
      category_id: newest.category_id,
      // The merge itself is a user edit; no reorganization may quietly undo it.
      category_locked: true,
      entity_ids: [],
      vector,
      x: null,
      y: null,
      pinned: false,
      created_at: newest.created_at,
    };
    const timesSeen = originals.reduce((s, m) => s + (m.times_seen ?? 1), 0);
    const entityIds = [...new Set(originals.flatMap((m) => m.entity_ids))];

    this.repo.transaction(() => {
      this.repo.insertMemories(workspaceId, [merged]);
      this.repo.assign({
        memoryId: merged.id,
        categoryId: merged.category_id,
        confidence: merged.confidence,
        assignedBy: 'user',
        locked: true,
      });
      for (const entityId of entityIds) this.repo.linkMemoryEntity(merged.id, entityId);
      // times_seen starts at 1; count the other arrivals back in.
      for (let i = 1; i < timesSeen; i++) this.repo.reinforceMemory(merged.id);
      for (const m of originals) this.repo.deleteMemory(m.id);
    });

    this.rebuildEdges(workspaceId);
    return merged;
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
