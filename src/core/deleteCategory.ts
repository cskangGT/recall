import type { Category, GraphPayload } from './types.ts';
import { bestMemberSimilarity, categoryProfiles } from './assign.ts';

/**
 * Where everything goes when a category is deleted.
 *
 * A plan rather than an action, and pure, for the reason every other structural
 * decision here is: the same function decides on the client and applies on the
 * server, and a confirmation can *show* you the plan before you agree to it.
 * "Delete" that silently moves five memories somewhere you did not choose is a
 * different button from one that says where they are going.
 *
 * **Deleting a category never deletes a memory** (spec §5.4, AC-30), and every
 * memory has exactly one category (§8.5). Between those two rules, the only
 * question is where they land — and for a *child* the spec answers it: the
 * parent. For a root it does not answer at all, and a root is the case that
 * actually comes up, because a young corpus is nothing but roots.
 *
 * So a root's memories are refiled by the same geometry that placed them: the
 * nearest remaining category, by best-member similarity. Two consequences worth
 * stating out loud.
 *
 * **No new category is ever created.** `assignMemory` would happily make one
 * below its threshold, and a delete that immediately recreates something like
 * what you just deleted is absurd. So this takes the argmax rather than
 * consulting `ASSIGN.EXISTING_CATEGORY` — that threshold exists to decide
 * *whether* to create a category, and here creating is off the table.
 *
 * **A deleted root's own children are candidates**, and usually win. Delete
 * "AI Tooling" and its loose memories fall into "Agent Frameworks" or "Evals &
 * Observability", which is exactly right — they are the nearest thing to what
 * you just removed.
 */

export interface CategoryMove {
  memoryId: string;
  toCategoryId: string;
  /** Cosine to the nearest member of the destination. 0 when nothing scored. */
  score: number;
}

export interface DeletionPlan {
  categoryId: string;
  /** Child categories that become roots, keeping the two-level rule (§8.5). */
  promoted: string[];
  moves: CategoryMove[];
  /** Grouped by destination, for the sentence the confirmation shows. */
  landing: { categoryId: string; name: string; count: number }[];
  /**
   * The name to tombstone, or null. An AI-created category the user deleted must
   * not be recreated by the next reorganization (spec §7.3, AC-25); one the user
   * made themselves carries no such judgement about the clustering.
   */
  tombstone: string | null;
}

export type DeletionOutcome = DeletionPlan | { refused: string };

export function planCategoryDeletion(
  payload: GraphPayload,
  categoryId: string,
): DeletionOutcome {
  const target = payload.categories.find((c) => c.id === categoryId);
  if (!target) return { refused: 'That category is already gone.' };

  const children = payload.categories.filter((c) => c.parent_id === categoryId);
  const direct = payload.memories.filter((m) => m.category_id === categoryId);

  /*
   * A child's memories go to the parent, full stop. No geometry: the spec names
   * the destination, the user can see it in the breadcrumb, and asking cosine
   * for a second opinion about a question that has already been answered would
   * only make the result harder to predict.
   */
  if (target.parent_id) {
    return {
      categoryId,
      promoted: [],
      moves: direct.map((m) => ({ memoryId: m.id, toCategoryId: target.parent_id!, score: 1 })),
      landing: landingOf(payload, direct.map(() => target.parent_id!)),
      tombstone: tombstoneFor(target),
    };
  }

  // A root. Its children survive as roots — they hold their own memories, and
  // promoting them keeps the taxonomy two levels deep rather than orphaning
  // them under a parent that no longer exists.
  const promoted = children.map((c) => c.id);
  const remaining = payload.categories.filter((c) => c.id !== categoryId);

  if (direct.length > 0 && remaining.length === 0) {
    return {
      refused:
        direct.length === 1
          ? 'That memory would have nowhere to go — this is the only category left.'
          : `Those ${direct.length} memories would have nowhere to go — this is the only category left.`,
    };
  }

  const profiles = categoryProfiles(remaining, payload.memories);
  const moves = direct.map((memory) => {
    const scored = profiles
      .map((p) => ({ id: p.id, score: bestMemberSimilarity(memory.vector, p) }))
      .filter((x): x is { id: string; score: number } => x.score !== null)
      // Ties broken by id, so two runs of the same plan agree — a confirmation
      // that showed one destination and applied another would be a lie.
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const best = scored[0];
    /*
     * Nothing scored means every remaining category is empty — it has no member
     * to be similar to. Rare, and it still has to land somewhere, so it takes
     * the first remaining category in the order the graph already presents them.
     */
    return best
      ? { memoryId: memory.id, toCategoryId: best.id, score: best.score }
      : { memoryId: memory.id, toCategoryId: remaining[0]!.id, score: 0 };
  });

  return {
    categoryId,
    promoted,
    moves,
    landing: landingOf(payload, moves.map((m) => m.toCategoryId)),
    tombstone: tombstoneFor(target),
  };
}

function tombstoneFor(category: Category): string | null {
  return category.user_created ? null : category.name;
}

/** Destinations with how many memories each is about to receive, largest first. */
function landingOf(payload: GraphPayload, destinations: string[]) {
  const counts = new Map<string, number>();
  for (const id of destinations) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([categoryId, count]) => ({
      categoryId,
      name: payload.categories.find((c) => c.id === categoryId)?.name ?? 'somewhere else',
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * What will happen, in a sentence, before you agree to it.
 *
 * The consequence only — the caller supplies the question. Written here rather
 * than in the component so every surface says the same thing and so it is
 * testable without a DOM. "Delete" that silently moves five memories somewhere
 * you did not choose is a different button from one that says where.
 */
export function describeDeletion(plan: DeletionPlan): string {
  const parts: string[] = [];

  if (plan.moves.length > 0) {
    const where =
      plan.landing.length === 1
        ? `to ${plan.landing[0]!.name}`
        : plan.landing.map((l) => `${l.count} to ${l.name}`).join(', ');
    parts.push(
      plan.moves.length === 1 ? `Its memory goes ${where}.` : `Its ${plan.moves.length} memories go ${where}.`,
    );
  }

  if (plan.promoted.length > 0) {
    parts.push(
      plan.promoted.length === 1
        ? 'Its one subcategory becomes a category of its own.'
        : `Its ${plan.promoted.length} subcategories become categories of their own.`,
    );
  }

  if (parts.length === 0) parts.push('It holds nothing, so nothing moves.');
  return parts.join(' ');
}
