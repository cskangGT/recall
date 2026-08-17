import { useWorkspaceStore } from '../store/workspaceStore';
import { partitionDuplicates } from './duplicate';
import { useUiStore, type CaptureStage } from '../store/uiStore';
import { t } from '../i18n';
import { evaluateReorg } from '../core/gates';
import { applyReorg, type ReorgEvent } from '../core/applyReorg';
import type { GraphPayload, Memory, Source } from '../core/types';
import type { CaptureInput, CaptureResult } from '../data/dataSource';
import demoItem from '../../seed/demo-item.json';

/**
 * Capture, in whichever mode the data source is running.
 *
 * Seed mode does the whole pipeline in the browser against
 * seed/demo-item.json, at the latencies the real one has. API mode posts to the
 * server and lets it decide. Both drive the same ticker and hand back the same
 * shape, so the animation above does not know which one ran.
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
  /** What the source said that the corpus already held, so it was not written. */
  alreadyHeld: { text: string; similarity: number }[];
}

/**
 * API mode: the server decides everything, the client only paces it.
 *
 * The four ticker stages are cosmetic here — the server answers in one round
 * trip, but the choreography in spec 8.4.5 is timed against them and the demo's
 * whole middle beat is the presenter talking over those labels. Collapsing them
 * to a spinner would be faster and worse.
 */
async function ingestViaApi(
  capture: (input: CaptureInput) => Promise<CaptureResult>,
  input?: CaptureInput,
): Promise<IngestResult> {
  const ui = useUiStore.getState();
  ui.setCaptureStage('reading');

  const request = capture(
    input ?? { type: 'screenshot', content: 'demo capture', imagePath: '/seed/demo-screenshot.png' },
  );

  // Advance the ticker while the request is in flight rather than after it, so
  // a fast server does not skip straight from "Reading…" to a finished split.
  const paced = (async () => {
    for (const stage of ['extracting', 'connecting'] as const) {
      await wait(STAGE_MS[stage]);
      useUiStore.getState().setCaptureStage(stage);
    }
  })();

  let result: CaptureResult;
  try {
    [result] = await Promise.all([request, paced]);
  } catch (err) {
    useUiStore.getState().setCaptureStage('idle');
    useUiStore.getState().toast(
      err instanceof Error ? t('toast.captureFailedWith', { message: err.message }) : t('toast.captureFailed'),
    );
    return { event: null, addedMemoryIds: [], targetCategoryId: null, alreadyHeld: [] };
  }

  if (result.reorg) {
    useUiStore.getState().setCaptureStage('reorganizing');
    await wait(STAGE_MS.reorganizing);
  }

  useWorkspaceStore.getState().applyPayload(result.graph);
  useUiStore.getState().setCaptureStage('idle');
  if (result.note) useUiStore.getState().toast(result.note);

  // The animation needs a ReorgEvent, and the server's row carries the same
  // fields plus its own snapshots — which the client never needs, because undo
  // goes back over HTTP by id.
  const event = result.reorg
    ? ({
        id: result.reorg.id,
        operation: result.reorg.operation as ReorgEvent['operation'],
        affected_category_ids: result.reorg.affected_category_ids,
        created_category_ids: result.reorg.created_category_ids,
        banner_text: result.reorg.banner_text,
        before_state: result.graph,
        created_at: new Date().toISOString(),
      } satisfies ReorgEvent)
    : null;

  return {
    event,
    addedMemoryIds: result.addedMemoryIds,
    targetCategoryId: result.reorg?.affected_category_ids[0] ?? null,
    // The server decides this one; it has the corpus and the vectors.
    alreadyHeld: result.skipped ?? [],
  };
}

export async function ingestItem(input?: CaptureInput): Promise<IngestResult> {
  const ui = useUiStore.getState();
  const ws = useWorkspaceStore.getState();
  if (!ws.payload) return { event: null, addedMemoryIds: [], targetCategoryId: null, alreadyHeld: [] };

  if (ws.source.capture) return ingestViaApi(ws.source.capture.bind(ws.source), input);

  for (const stage of ['reading', 'extracting', 'connecting'] as const) {
    ui.setCaptureStage(stage);
    await wait(STAGE_MS[stage]);
  }

  const extracted = demoItem.memories as unknown as Memory[];

  /*
   * Nothing already held is written a second time.
   *
   * This replaces an exact-id guard, which was the same idea in its narrowest
   * form: re-capturing the demo item produced memories with ids the payload
   * already contained. Similarity subsumes it — an identical memory scores 1.0
   * against itself — and it also covers the case ids cannot, which is the same
   * thing arriving under new ones.
   *
   * The comparison is against the corpus as it stands, which is also what
   * `buildCaptureStory` compares against, so the story and the decision can
   * never disagree about what was already there.
   */
  const { kept: newMemories, skipped } = partitionDuplicates(extracted, ws.payload.memories);

  const alreadyHeld = skipped.map((sk) => ({
    text: sk.candidate.text,
    similarity: sk.similarity,
  }));

  if (newMemories.length === 0) {
    useUiStore.getState().setCaptureStage('idle');
    useUiStore.getState().toast(
      skipped.length === 1
        ? t('toast.alreadySaved.one')
        : t('toast.alreadySaved.many', { count: skipped.length }),
    );
    return { event: null, addedMemoryIds: [], targetCategoryId: null, alreadyHeld };
  }

  // What was already held is not rewritten — it is counted. `of` is the held
  // memory each skipped candidate echoes; its times_seen is the visible trace.
  const reinforcedIds = new Map<string, number>();
  for (const sk of skipped) {
    reinforcedIds.set(sk.of.id, (reinforcedIds.get(sk.of.id) ?? 0) + 1);
  }
  const withReinforcement = ws.payload.memories.map((m) =>
    reinforcedIds.has(m.id)
      ? { ...m, times_seen: (m.times_seen ?? 1) + reinforcedIds.get(m.id)! }
      : m,
  );

  const attached: GraphPayload = {
    ...ws.payload,
    sources: [...ws.payload.sources, demoItem.source as Source],
    memories: [...withReinforcement, ...newMemories],
  };

  const touched = [...new Set(newMemories.map((m) => m.category_id))];
  // `auto_reorganize` has been in the schema and the payload since Phase 3 and
  // was read by nobody — declared and ignored. Off means the memories still
  // file, the structure just stops moving on its own.
  const candidate = attached.workspace.auto_reorganize ? evaluateReorg(attached, touched) : null;

  if (!candidate || candidate.operation !== 'split') {
    useWorkspaceStore.getState().applyPayload(attached);
    useUiStore.getState().setCaptureStage('idle');
    return {
      event: null,
      addedMemoryIds: newMemories.map((m) => m.id),
      targetCategoryId: touched[0] ?? null,
      alreadyHeld,
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
    alreadyHeld,
  };
}
