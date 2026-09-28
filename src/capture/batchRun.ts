import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore } from '../store/uiStore';
import { t } from '../i18n';
import type { CaptureBatchResult, CaptureInput, CaptureResult, ImportList } from '../data/dataSource';
import type { ReorgEvent } from '../core/applyReorg';
import { runBatchPipeline, summarizeCategories, type BatchItem, type BatchResult } from './batch';

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

    // Whether this was the first thing this person ever handed Mado, decided
    // before the payload swap so "the sky that was already there" means the
    // seed, not their own fresh stars.
    const firstDrop = !localStorage.getItem('mado.ob.firstDrop');
    const skyWasSeeded = ws.payload.memories.length > 0;

    useWorkspaceStore.getState().applyPayload(result.payload);
    // Putting something in is looking around — same rule as single capture.
    useUiStore.getState().dismissWelcome();
    if (firstDrop && result.addedMemoryIds.length > 0) {
      localStorage.setItem('mado.ob.firstDrop', '1');
      // Only a seeded sky has something to step back — an empty one has no
      // "someone else's stars" to hand over.
      if (skyWasSeeded) {
        useUiStore.getState().setSkyCeremony({ categoryIds: result.categories.map((c) => c.id) });
      }
    }
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
/**
 * A connected reader is remembered, and the next visit offers *sync* instead
 * of a fresh full import — only the days since the last one are read.
 */
export function lastSyncOf(reader: 'notes' | 'notion'): string | null {
  return localStorage.getItem(`mado.ob.sync.${reader}`);
}

/** Days to ask the reader for: since the last sync (plus a day of overlap), or the default window. */
function syncDays(reader: 'notes' | 'notion'): number | undefined {
  const last = lastSyncOf(reader);
  if (!last) return undefined;
  const days = Math.ceil((Date.now() - Date.parse(last)) / 86400_000) + 1;
  return Math.max(1, Math.min(days, 3650));
}

export async function importAppleNotesFlow(): Promise<void> {
  const source = useWorkspaceStore.getState().source;
  const list = source.listAppleNotes?.bind(source);
  if (list) return openImportPicker('notes', () => list(syncDays('notes')));
  const read = source.importAppleNotes?.bind(source);
  return runReaderImport(read && (() => read(syncDays('notes'))), 'notes');
}

export async function importNotionFlow(): Promise<void> {
  const source = useWorkspaceStore.getState().source;
  const list = source.listNotionPages?.bind(source);
  if (list) return openImportPicker('notion', () => list(syncDays('notion')));
  const read = source.importNotionPages?.bind(source);
  return runReaderImport(read && (() => read(syncDays('notion'))), 'notion');
}

/**
 * The look before keeping, for a reader: read what it holds, keep nothing,
 * and put the list in front of the person to choose from. What they choose
 * goes through the ordinary batch — words in hand, so nothing is read twice.
 */
async function openImportPicker(reader: 'notes' | 'notion', list: () => Promise<ImportList>): Promise<void> {
  const ui = useUiStore.getState();
  if (running || !useWorkspaceStore.getState().payload) return;
  ui.setImportPick({ reader, loading: true, notes: [], total: 0, droppedSecretLines: 0 });
  try {
    const result = await list();
    const since = lastSyncOf(reader);
    // The read succeeded — the connection holds, and the next visit lists from here.
    localStorage.setItem(`mado.ob.sync.${reader}`, new Date().toISOString());
    if (result.droppedSecretLines > 0) useUiStore.getState().toast(t('toast.notesSecrets', { count: result.droppedSecretLines }));
    useUiStore.getState().setImportPick({ reader, loading: false, notes: result.notes, total: result.total, droppedSecretLines: result.droppedSecretLines, since });
  } catch (err) {
    useUiStore.getState().setImportPick(null);
    useUiStore.getState().toast(err instanceof Error ? t('import.failedWith', { message: err.message }) : t('import.failed'));
  }
}

/** The chosen notes, kept: the same batch a file drop takes, with the way back on each. */
export async function keepImportPicks(items: BatchItem[]): Promise<void> {
  useUiStore.getState().setImportPick(null);
  await ingestBatch(items);
}

async function runReaderImport(
  read: (() => Promise<import('../data/dataSource').NotesImportResult>) | undefined,
  reader?: 'notes' | 'notion',
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
    // The read succeeded — the connection holds, and the next visit syncs
    // from here instead of importing the window again.
    if (reader) localStorage.setItem(`mado.ob.sync.${reader}`, new Date().toISOString());

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
        categories: summarizeCategories(response.graph, addedMemoryIds, knownCategoryIds),
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
    items.map((i) => ({ type: 'text' as const, content: i.content, title: i.title, url: i.url })),
  );

  const addedMemoryIds = response.results.flatMap((r) => r.addedMemoryIds);
  const skippedCount = response.results.reduce((n, r) => n + r.skipped.length, 0);
  const failed = response.results.filter((r) => r.status === 'failed').length;
  if (failed > 0) {
    useUiStore.getState().toast(t('toast.batchPartial', { failed, total: items.length }));
  }
  const redacted = response.results.reduce((n, r) => n + (r.redacted ?? 0), 0);
  if (redacted > 0) useUiStore.getState().toast(t('toast.redacted', { count: redacted }));

  return {
    payload: response.graph,
    addedMemoryIds,
    sourceIds: response.results.map((r) => r.sourceId),
    claimCount: addedMemoryIds.length + skippedCount,
    skippedCount,
    categories: summarizeCategories(response.graph, addedMemoryIds, knownCategoryIds),
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
  return {
    payload,
    addedMemoryIds,
    sourceIds: [],
    claimCount: addedMemoryIds.length + skippedCount,
    skippedCount,
    categories: summarizeCategories(payload, addedMemoryIds, knownCategoryIds),
    events,
  };
}
