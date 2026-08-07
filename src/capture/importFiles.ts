import { useUiStore } from '../store/uiStore';
import { ingestBatch } from './batchRun';
import { parseInstagramZip, IMPORT_WINDOW_DAYS } from './instagramZip';
import { t } from '../i18n';
import type { BatchItem } from './batch';

/**
 * Files in, reveal out — shared by every way files arrive.
 *
 * The window drop and the welcome screen's "fill your memory" door take the
 * same kinds of files and must behave identically; this is the one place that
 * decides what a pile of files means. A ZIP is an Instagram export; text-like
 * files become a batch; anything else is named rather than silently dropped.
 */

const TEXT_FILE = /\.(txt|md|markdown|csv|json)$/i;
export const isTextLike = (f: File): boolean => f.type.startsWith('text/') || TEXT_FILE.test(f.name);
export const isZip = (f: File): boolean => /\.zip$/i.test(f.name);

/** "meeting-notes_2026.md" → "meeting notes 2026" */
export const titleFromFilename = (name: string): string =>
  name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();

export async function importFiles(files: File[]): Promise<void> {
  const ui = useUiStore.getState();

  const zip = files.find(isZip);
  if (zip) {
    try {
      const parsed = await parseInstagramZip(await zip.arrayBuffer());
      if (parsed.items.length === 0) {
        ui.toast(t('toast.zipNoneRecent', { total: parsed.total, days: IMPORT_WINDOW_DAYS }));
        return;
      }
      await ingestBatch(parsed.items);
      if (parsed.older === 1) {
        useUiStore.getState().toast(t('toast.zipOlder.one', { days: IMPORT_WINDOW_DAYS }));
      } else if (parsed.older > 1) {
        useUiStore
          .getState()
          .toast(t('toast.zipOlder.many', { days: IMPORT_WINDOW_DAYS, count: parsed.older }));
      }
    } catch (err) {
      useUiStore
        .getState()
        .toast(
          err instanceof Error
            ? t('toast.zipFailedWith', { message: err.message })
            : t('toast.zipFailed'),
        );
    }
    return;
  }

  const textFiles = files.filter(isTextLike);
  if (textFiles.length === 0) {
    ui.toast(t('toast.nothingReadable'));
    return;
  }

  const items = await Promise.all(
    textFiles.map(async (f): Promise<BatchItem> => ({
      title: titleFromFilename(f.name),
      content: await f.text(),
    })),
  );
  await ingestBatch(items);
}
