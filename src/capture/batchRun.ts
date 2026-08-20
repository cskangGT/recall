import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore } from '../store/uiStore';
import { t } from '../i18n';
import type { CaptureBatchResult, CaptureInput, CaptureResult } from '../data/dataSource';
import type { ReorgEvent } from '../core/applyReorg';
import { runBatchPipeline, type BatchItem, type BatchResult } from './batch';

/**
 * The driver for a bulk drop: runs the batch pipeline, paces the reveal, and
 * lands the result in the stores. The pure work lives in batch.ts; this file
 * is the part that knows about time and state.
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long the pour of dots lasts, spread across the batch. */
const READ_TOTAL_MS = 1600;
const READ_TICK_MIN_MS = 45;
const READ_TICK_MAX_MS = 260;
const ORGANIZE_MS = 1900;

let running = false;

export async function ingestBatch(
  items: BatchItem[],
  meta: { period?: { from: string; to: string } | null } = {},
): Promise<void> {
  const ws = useWorkspaceStore.getState();
  if (running || !ws.payload || items.length === 0) return;
  running = true;

  const ui = useUiStore.getState();
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  ui.setBatchReveal({ phase: 'reading', total: items.length, read: 0, summary: null });

  try {
    let result: BatchResult;
    if (ws.source.captureBatch) {
      // One request; the server suppresses per-item reorgs and fires the gates
      // once. The dots pour on the response, not per item — a single round trip
      // has no per-item progress to report honestly.
      result = await batchViaEndpoint(ws.source.captureBatch.bind(ws.source), items);
    } else if (ws.source.capture) {
      // An API without the batch route: one request per item, serially. The
      // count is real progress here, not theater.
      result = await batchViaApi(ws.source.capture.bind(ws.source), items);
    } else {
      result = runBatchPipeline(ws.payload, items);
      if (!reduced) {
        const tick = Math.min(READ_TICK_MAX_MS, Math.max(READ_TICK_MIN_MS, READ_TOTAL_MS / items.length));
        for (let read = 1; read <= items.length; read++) {
          await wait(tick);
          useUiStore.getState().setBatchReveal({ phase: 'reading', total: items.length, read, summary: null });
        }
      }
    }

    if (!reduced) {
      useUiStore
        .getState()
        .setBatchReveal({ phase: 'organizing', total: items.length, read: items.length, summary: null });
      await wait(ORGANIZE_MS);
    }

    useWorkspaceStore.getState().applyPayload(result.payload);
    // Putting something in is looking around — same rule as single capture.
    useUiStore.getState().dismissWelcome();
    // Oldest first, so the banner (history[0]) ends on the latest change.
    for (const event of result.events) useUiStore.getState().pushReorg(event);

    useUiStore.getState().setBatchReveal({
      phase: 'declare',
      total: items.length,
      read: items.length,
      summary: {
        memories: result.addedMemoryIds.length,
        skipped: result.skippedCount,
        sources: items.length,
        categories: result.categories,
        period: meta.period ?? null,
        sourceIds: result.sourceIds,
      },
    });
  } catch (err) {
    useUiStore.getState().setBatchReveal(null);
    useUiStore
      .getState()
      .toast(
        err instanceof Error ? t('toast.batchFailedWith', { message: err.message }) : t('toast.batchFailed'),
      );
  } finally {
    running = false;
  }
}

/**
 * A reader-import: ask the server to read a connected source (Apple Notes,
 * Notion, whatever comes next), then land the result in the same reveal a
 * file drop gets. One round trip; the dots pour on the answer because there
 * is no honest per-item progress to show.
 */
export async function importAppleNotesFlow(): Promise<void> {
  const source = useWorkspaceStore.getState().source;
  return runReaderImport(source.importAppleNotes?.bind(source));
}

export async function importNotionFlow(): Promise<void> {
  const source = useWorkspaceStore.getState().source;
  return runReaderImport(source.importNotionPages?.bind(source));
}

async function runReaderImport(
  read: (() => Promise<import('../data/dataSource').NotesImportResult>) | undefined,
): Promise<void> {
  const ws = useWorkspaceStore.getState();
  const ui = useUiStore.getState();
  if (running || !ws.payload) return;
  if (!read) {
    ui.toast(t('toast.notesNeedsLocal'));
    return;
  }
  running = true;

  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  ui.setBatchReveal({ phase: 'organizing', total: 1, read: 1, summary: null });

  try {
    const before = ws.payload;
    const knownCategoryIds = new Set(before.categories.map((c) => c.id));
    const response = await read();

    if (response.notes.droppedSecretLines > 0) {
      useUiStore
        .getState()
        .toast(t('toast.notesSecrets', { count: response.notes.droppedSecretLines }));
    }
    if (response.notes.imported === 0) {
      useUiStore.getState().setBatchReveal(null);
      useUiStore.getState().toast(t('toast.notesEmpty'));
      return;
    }

    const addedMemoryIds = response.results.flatMap((r) => r.addedMemoryIds);
    const skippedCount = response.results.reduce((n, r) => n + r.skipped.length, 0);
    const added = new Set(addedMemoryIds);
    const byCategory = new Map<string, number>();
    for (const m of response.graph.memories) {
      if (added.has(m.id)) byCategory.set(m.category_id, (byCategory.get(m.category_id) ?? 0) + 1);
    }
    const nameOf = new Map(response.graph.categories.map((c) => [c.id, c.name] as const));

    if (!reduced) await wait(ORGANIZE_MS);
    useWorkspaceStore.getState().applyPayload(response.graph);
    useUiStore.getState().dismissWelcome();
    for (const reorg of response.reorgs) {
      useUiStore.getState().pushReorg({
        id: reorg.id,
        operation: reorg.operation as ReorgEvent['operation'],
        affected_category_ids: reorg.affected_category_ids,
        created_category_ids: reorg.created_category_ids,
        banner_text: reorg.banner_text,
        before_state: response.graph,
        created_at: new Date().toISOString(),
      });
    }

    useUiStore.getState().setBatchReveal({
      phase: 'declare',
      total: response.notes.imported,
      read: response.notes.imported,
      summary: {
        memories: addedMemoryIds.length,
        skipped: skippedCount,
        sources: response.notes.imported,
        sourceIds: response.results.map((r) => r.sourceId),
        categories: [...byCategory.entries()]
          .map(([id, count]) => ({
            id,
            name: nameOf.get(id) ?? '',
            added: count,
            isNew: !knownCategoryIds.has(id),
          }))
          .sort((a, b) => b.added - a.added || a.name.localeCompare(b.name)),
      },
    });
  } catch (err) {
    useUiStore.getState().setBatchReveal(null);
    useUiStore
      .getState()
      .toast(
        err instanceof Error ? t('toast.batchFailedWith', { message: err.message }) : t('toast.batchFailed'),
      );
  } finally {
    running = false;
  }
}

/** The batch endpoint: one round trip, one reorganization, one graph. */
async function batchViaEndpoint(
  captureBatch: (items: CaptureInput[]) => Promise<CaptureBatchResult>,
  items: BatchItem[],
): Promise<BatchResult> {
  const before = useWorkspaceStore.getState().payload!;
  const knownCategoryIds = new Set(before.categories.map((c) => c.id));

  const response = await captureBatch(
    items.map((i) => ({ type: 'text' as const, content: i.content, title: i.title })),
  );

  const addedMemoryIds = response.results.flatMap((r) => r.addedMemoryIds);
  const skippedCount = response.results.reduce((n, r) => n + r.skipped.length, 0);
  const failed = response.results.filter((r) => r.status === 'failed').length;
  if (failed > 0) {
    useUiStore.getState().toast(t('toast.batchPartial', { failed, total: items.length }));
  }

  const added = new Set(addedMemoryIds);
  const byCategory = new Map<string, number>();
  for (const m of response.graph.memories) {
    if (added.has(m.id)) byCategory.set(m.category_id, (byCategory.get(m.category_id) ?? 0) + 1);
  }
  const nameOf = new Map(response.graph.categories.map((c) => [c.id, c.name] as const));

  return {
    payload: response.graph,
    addedMemoryIds,
    sourceIds: response.results.map((r) => r.sourceId),
    claimCount: addedMemoryIds.length + skippedCount,
    skippedCount,
    categories: [...byCategory.entries()]
      .map(([id, count]) => ({
        id,
        name: nameOf.get(id) ?? '',
        added: count,
        isNew: !knownCategoryIds.has(id),
      }))
      .sort((a, b) => b.added - a.added || a.name.localeCompare(b.name)),
    events: response.reorgs.map((reorg) => ({
      id: reorg.id,
      operation: reorg.operation as ReorgEvent['operation'],
      affected_category_ids: reorg.affected_category_ids,
      created_category_ids: reorg.created_category_ids,
      banner_text: reorg.banner_text,
      before_state: response.graph,
      created_at: new Date().toISOString(),
    })),
  };
}

/**
 * Fallback for an API without the batch route: one request per item, serially —
 * the server's pipeline is one-source-per-transaction and parallel
 * reorganization of the same taxonomy produces conflicting structural
 * decisions (spec 5.3). A failed item is skipped, not fatal: a batch that dies
 * at item 17 of 30 with nothing to show would lose the user's trust in the
 * exact moment built to earn it.
 */
async function batchViaApi(
  capture: (input: CaptureInput) => Promise<CaptureResult>,
  items: BatchItem[],
): Promise<BatchResult> {
  const before = useWorkspaceStore.getState().payload!;
  const knownCategoryIds = new Set(before.categories.map((c) => c.id));

  let last: CaptureResult | null = null;
  const addedMemoryIds: string[] = [];
  let skippedCount = 0;
  let failed = 0;
  const events: ReorgEvent[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    try {
      const result = await capture({ type: 'text', content: item.content, title: item.title });
      last = result;
      addedMemoryIds.push(...result.addedMemoryIds);
      skippedCount += result.skipped?.length ?? 0;
      if (result.reorg) {
        events.push({
          id: result.reorg.id,
          operation: result.reorg.operation as ReorgEvent['operation'],
          affected_category_ids: result.reorg.affected_category_ids,
          created_category_ids: result.reorg.created_category_ids,
          banner_text: result.reorg.banner_text,
          before_state: result.graph,
          created_at: new Date().toISOString(),
        });
      }
    } catch {
      failed++;
    }
    useUiStore
      .getState()
      .setBatchReveal({ phase: 'reading', total: items.length, read: i + 1, summary: null });
  }

  if (!last) throw new Error(`none of the ${items.length} items could be saved`);
  if (failed > 0) useUiStore.getState().toast(t('toast.batchPartial', { failed, total: items.length }));

  const payload = last.graph;
  const added = new Set(addedMemoryIds);
  const byCategory = new Map<string, number>();
  for (const m of payload.memories) {
    if (added.has(m.id)) byCategory.set(m.category_id, (byCategory.get(m.category_id) ?? 0) + 1);
  }
  const nameOf = new Map(payload.categories.map((c) => [c.id, c.name] as const));

  return {
    payload,
    addedMemoryIds,
    sourceIds: [],
    claimCount: addedMemoryIds.length + skippedCount,
    skippedCount,
    categories: [...byCategory.entries()]
      .map(([id, count]) => ({
        id,
        name: nameOf.get(id) ?? '',
        added: count,
        isNew: !knownCategoryIds.has(id),
      }))
      .sort((a, b) => b.added - a.added || a.name.localeCompare(b.name)),
    events,
  };
}
