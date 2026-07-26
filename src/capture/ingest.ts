import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore, type CaptureStage } from '../store/uiStore';
import { evaluateReorg } from '../reorg/gates';
import { applyReorg, type ReorgEvent } from '../reorg/applyReorg';
import type { GraphPayload, Memory, Source } from '../types/graph';
import demoItem from '../../seed/demo-item.json';

/**
 * Phase 1's "AI" is a lookup into seed/demo-item.json, run at the latencies the
 * real pipeline will have so the ticker gives the presenter four labelled beats
 * to talk over. Phase 4 replaces the body of this function and nothing else.
 */
const STAGE_MS: Record<Exclude<CaptureStage, 'idle'>, number> = {
  reading: 1200,
  extracting: 1800,
  connecting: 1200,
  reorganizing: 800,
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The names a model would return in Phase 3. Fixed so the demo is reproducible. */
export const SPLIT_NAMES = ['Agent Frameworks', 'Evals & Observability'];

export interface IngestResult {
  event: ReorgEvent | null;
  addedMemoryIds: string[];
  targetCategoryId: string | null;
}

export async function ingestItem(): Promise<IngestResult> {
  const ui = useUiStore.getState();
  const ws = useWorkspaceStore.getState();
  if (!ws.payload) return { event: null, addedMemoryIds: [], targetCategoryId: null };

  for (const stage of ['reading', 'extracting', 'connecting'] as const) {
    ui.setCaptureStage(stage);
    await wait(STAGE_MS[stage]);
  }

  const newMemories = demoItem.memories as unknown as Memory[];
  const alreadyIngested = ws.payload.memories.some((m) => m.id === newMemories[0]?.id);
  if (alreadyIngested) {
    useUiStore.getState().setCaptureStage('idle');
    useUiStore.getState().toast('Already saved — this is the demo item.');
    return { event: null, addedMemoryIds: [], targetCategoryId: null };
  }

  const attached: GraphPayload = {
    ...ws.payload,
    sources: [...ws.payload.sources, demoItem.source as Source],
    memories: [...ws.payload.memories, ...newMemories],
  };

  const touched = [...new Set(newMemories.map((m) => m.category_id))];
  const candidate = evaluateReorg(attached, touched);

  if (!candidate || candidate.operation !== 'split') {
    useWorkspaceStore.getState().applyPayload(attached);
    useUiStore.getState().setCaptureStage('idle');
    return {
      event: null,
      addedMemoryIds: newMemories.map((m) => m.id),
      targetCategoryId: touched[0] ?? null,
    };
  }

  useUiStore.getState().setCaptureStage('reorganizing');
  await wait(STAGE_MS.reorganizing);

  const { payload, event } = applyReorg(attached, candidate, SPLIT_NAMES);
  useWorkspaceStore.getState().applyPayload(payload);
  useUiStore.getState().setCaptureStage('idle');

  return {
    event,
    addedMemoryIds: newMemories.map((m) => m.id),
    targetCategoryId: candidate.categoryIds[0] ?? null,
  };
}
