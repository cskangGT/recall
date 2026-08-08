import type { Category, GraphPayload, Memory, Source } from '../core/types';
import { assignMemory, categoryProfiles, type CategoryProfile } from '../core/assign';
import { DUPLICATE_SIMILARITY } from '../core/thresholds';
import { evaluateReorg, type ReorgCandidate } from '../core/gates';
import { applyReorg, type ReorgEvent } from '../core/applyReorg';
import { uniqueName } from '../core/naming';
import { extractClaims } from './extractLocal';
import { localVector } from './embedLocal';

/**
 * Bulk ingest — many sources in, one reorganization out.
 *
 * The single-capture path holds two promises this one has to bend, not break:
 *
 * - **"One item per capture"** becomes one *batch* per capture. Items inside it
 *   are still processed serially, in drop order, so the result is independent
 *   of anything but the input.
 * - **"At most one structural operation per ingest"** (spec 8.4.3) is applied
 *   to the batch as a whole: every item attaches first, and the gates run once
 *   over everything that was touched. Thirty items re-clustering thirty times
 *   would be a blob rearranging — the exact thing the one-op rule exists to
 *   prevent — and the reveal can only declare one structural sentence anyway.
 *
 * Pure: payload in, payload out. The driver in App wires it to the stores and
 * paces the reveal; tests call it directly.
 */

export interface BatchItem {
  title: string;
  content: string;
}

export interface BatchCategorySummary {
  id: string;
  name: string;
  /** Memories this batch added to it. */
  added: number;
  /** Opened by this batch rather than already on the map. */
  isNew: boolean;
}

export interface BatchResult {
  payload: GraphPayload;
  addedMemoryIds: string[];
  sourceIds: string[];
  /** Claims extracted across every item, before deduplication. */
  claimCount: number;
  /** Claims the corpus (or an earlier item in this batch) already held. */
  skippedCount: number;
  categories: BatchCategorySummary[];
  /**
   * Every structural operation the batch settled into, oldest first. A first
   * fill runs the gates to convergence rather than once — the reveal
   * summarizes everything anyway, and one split over ninety-nine memories
   * leaves a pile with a name, not a map.
   */
  events: ReorgEvent[];
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_b${(++counter).toString(36)}`;

/** Test hook — keeps generated ids stable across test files. */
export function resetBatchIds(): void {
  counter = 0;
}

interface OpenedCategory {
  category: Category;
  memberTexts: string[];
}

export function runBatchPipeline(
  base: GraphPayload,
  items: readonly BatchItem[],
  capturedAt: string = new Date().toISOString(),
): BatchResult {
  const sources: Source[] = [];
  const memories: Memory[] = [];
  const opened: OpenedCategory[] = [];
  const addedByCategory = new Map<string, number>();
  let claimCount = 0;
  let skippedCount = 0;

  /*
   * Profiles are shared across the whole batch and grown as it goes — the
   * category item 0 opens has to be visible to item 1 (the same provisional
   * trick as the server's planAssignments). Unlike the server, an *assigned*
   * vector also joins its category's profile: nearest-member is about members,
   * and the memory two lines up is one.
   */
  const profiles: CategoryProfile[] = categoryProfiles(base.categories, base.memories);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const joinProfile = (categoryId: string, parentId: string | null, vector: number[]) => {
    const existing = profileById.get(categoryId);
    if (existing) {
      existing.vectors.push(vector);
      return;
    }
    const fresh: CategoryProfile = { id: categoryId, parentId, vectors: [vector] };
    profiles.push(fresh);
    profileById.set(categoryId, fresh);
  };

  const anchorCorpus = () => [...base.memories, ...memories];

  for (const item of items) {
    const claims = extractClaims(item.content);
    const source: Source = {
      id: nextId('src'),
      type: 'text',
      title: item.title.trim() || item.content.slice(0, 60),
      raw_content: item.content,
      scene_description: null,
      url: null,
      image_path: null,
      created_at: capturedAt,
      status: claims.length === 0 ? 'no_memories' : 'complete',
    };
    sources.push(source);
    claimCount += claims.length;

    for (const text of claims) {
      const vector = localVector(text, anchorCorpus());
      const decision = assignMemory(vector, profiles);

      // Something already held is not written a second time — decision.score is
      // the nearest neighbour across corpus and batch alike.
      if (decision.score >= DUPLICATE_SIMILARITY) {
        skippedCount++;
        continue;
      }

      let categoryId: string;
      if (decision.kind === 'existing') {
        categoryId = decision.categoryId!;
      } else {
        const parentId = decision.kind === 'new_child' ? decision.parentId! : null;
        const category: Category = {
          id: nextId('cat'),
          parent_id: parentId,
          // Named after the loop, once the category knows everything it holds.
          name: '',
          rationale: null,
          name_locked: false,
          user_created: false,
          x: null,
          y: null,
          pinned: false,
          created_by: 'ai',
        };
        opened.push({ category, memberTexts: [] });
        categoryId = category.id;
      }

      const openedEntry = opened.find((o) => o.category.id === categoryId);
      if (openedEntry) openedEntry.memberTexts.push(text);

      memories.push({
        id: nextId('mem'),
        source_id: source.id,
        text,
        kind: 'fact',
        confidence: 0.6,
        category_id: categoryId,
        category_locked: false,
        entity_ids: [],
        vector,
        x: null,
        y: null,
        pinned: false,
        created_at: capturedAt,
      });
      joinProfile(categoryId, decision.kind === 'new_child' ? decision.parentId! : null, vector);
      addedByCategory.set(categoryId, (addedByCategory.get(categoryId) ?? 0) + 1);
    }
  }

  // Name what the batch opened, forbidding collisions with everything that
  // exists and everything named one line earlier.
  const allDocs = items.map((i) => extractClaims(i.content));
  const forbidden = base.categories.map((c) => c.name);
  for (const o of opened) {
    o.category.name = uniqueName(o.memberTexts, allDocs, forbidden);
    forbidden.push(o.category.name);
  }

  const attached: GraphPayload = {
    ...base,
    sources: [...base.sources, ...sources],
    memories: [...base.memories, ...memories],
    categories: [...base.categories, ...opened.map((o) => o.category)],
  };

  const scope = new Set(addedByCategory.keys());
  let payload = attached;
  const events: ReorgEvent[] = [];

  if (attached.workspace.auto_reorganize) {
    // To convergence, capped — same regime as the server's batch (see
    // BatchResult.events). Each round widens the scope with what the last
    // operation touched or created.
    const MAX_ROUNDS = 5;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const candidate = evaluateReorg(payload, [...scope]);
      if (!candidate) break;
      const names = splitNames(candidate, payload);
      const applied = applyReorg(payload, candidate, names);
      payload = applied.payload;
      events.push(applied.event);
      for (const id of applied.event.affected_category_ids) scope.add(id);
      for (const id of applied.event.created_category_ids) scope.add(id);
    }
  }

  const nameOf = new Map(payload.categories.map((c) => [c.id, c.name] as const));
  const openedIds = new Set(opened.map((o) => o.category.id));
  const categories: BatchCategorySummary[] = [...addedByCategory.entries()]
    .map(([id, added]) => ({
      id,
      // A category the reorg dissolved (split child, merged sibling) keeps its
      // pre-reorg name in the summary; the banner tells the rest of the story.
      name: nameOf.get(id) ?? attached.categories.find((c) => c.id === id)?.name ?? '',
      added,
      isNew: openedIds.has(id),
    }))
    .sort((a, b) => b.added - a.added || a.name.localeCompare(b.name));

  return {
    payload,
    addedMemoryIds: memories.map((m) => m.id),
    sourceIds: sources.map((s) => s.id),
    claimCount,
    skippedCount,
    categories,
    events,
  };
}

/**
 * Names for the one structural operation, when it needs any: a split names its
 * two halves from their member texts; a merge keeps the survivor's name
 * (applyMerge's default when no name is passed); a promote never renames.
 */
function splitNames(candidate: ReorgCandidate, payload: GraphPayload): string[] {
  if (candidate.operation !== 'split' || !candidate.clusters) return [];
  const textOf = new Map(payload.memories.map((m) => [m.id, m.text] as const));
  const texts = (ids: string[]) => ids.map((id) => textOf.get(id)).filter((t): t is string => !!t);
  const siblings = payload.categories.map((c) => c.name);

  const a = uniqueName(texts(candidate.clusters.a), [texts(candidate.clusters.a)], siblings);
  const b = uniqueName(texts(candidate.clusters.b), [texts(candidate.clusters.b)], [...siblings, a]);
  return [a, b];
}
