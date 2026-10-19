import type { GraphPayload } from '../core/types';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { t } from '../i18n';

/**
 * Where a finished review lands.
 *
 * The card closes on "done reviewing" and, before this, the screen behind it
 * was wherever you were — which said nothing about where the memories you
 * just judged had gone. Now the reading list opens on the category that took
 * most of them, with one selected: the trail from "saved" to "here", walked
 * for you. Only on the last source of a run — landing after every one of ten
 * would break the stepper's rhythm — and never after a throw-away, which
 * leaves nothing to land on.
 */

export interface Landing {
  categoryId: string;
  memoryId: string;
}

/** The category holding most of this source's memories, and one memory in it. */
export function landingOf(payload: GraphPayload, sourceId: string): Landing | null {
  const mine = payload.memories.filter((m) => m.source_id === sourceId);
  if (mine.length === 0) return null;
  const count = new Map<string, number>();
  for (const m of mine) count.set(m.category_id, (count.get(m.category_id) ?? 0) + 1);
  // Ties go to the earliest memory's category — stable, and the order the
  // extractor wrote them in is the order the source told them in.
  let best: string | null = null;
  for (const m of mine) {
    if (best === null || count.get(m.category_id)! > count.get(best)!) best = m.category_id;
  }
  const memory = mine.find((m) => m.category_id === best)!;
  return { categoryId: best!, memoryId: memory.id };
}

/** Opens the reading list where this source's memories went, and says so. */
export function landAfterReview(sourceId: string): void {
  const payload = useWorkspaceStore.getState().payload;
  if (!payload) return;
  const landing = landingOf(payload, sourceId);
  if (!landing) return;
  const ui = useUiStore.getState();
  ui.setView('browse');
  ui.openCategory(landing.categoryId);
  ui.select(landing.memoryId);
  const name = payload.categories.find((c) => c.id === landing.categoryId)?.name ?? '';
  ui.toast(t('toast.reviewLanded', { name }));
}
