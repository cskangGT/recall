import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { t } from '../i18n';

/**
 * Screenshots in.
 *
 * The server has always been able to read an image — the capture bar's small
 * "add a photo" link sent one — but every other way a screenshot naturally
 * arrives was shut: dropped on the window it was refused as unreadable, the
 * file picker greyed it out, and a full-size retina capture overran the
 * request limit once it was base64. This is the one routine all those ways
 * now share.
 *
 * One image opens the add bar with the picture already laid in, so words can
 * go beside it; several are kept as they are, one after another. Large images
 * are scaled down first: the model reads a 2400px screenshot as well as a
 * 5000px one, and the smaller one arrives.
 */

const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif)$/i;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;
export const isImage = (f: File): boolean => IMAGE_TYPE.test(f.type) || IMAGE_FILE.test(f.name);
export const isPdf = (f: File): boolean => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Past this an image is redrawn smaller before it is sent. */
const MAX_EDGE = 2400;
const MAX_RAW_BYTES = 3_000_000;

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsDataURL(file);
  });

/** The image as a data URL the server will take — scaled down when it is large. */
export async function imageDataUrl(file: File): Promise<string> {
  const raw = await readAsDataUrl(file);
  // A GIF would lose its frames to a canvas; it goes as it is.
  if (/gif$/i.test(file.type) || /\.gif$/i.test(file.name)) return raw;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('unreadable image'));
    el.src = raw;
  });
  const edge = Math.max(img.naturalWidth, img.naturalHeight);
  if (edge <= MAX_EDGE && file.size <= MAX_RAW_BYTES) return raw;
  const scale = Math.min(1, MAX_EDGE / edge);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * Takes the images out of a pile of files. Returns true when it handled any,
 * so the caller knows not to call the pile unreadable.
 */
export async function takeImages(files: File[]): Promise<boolean> {
  const images = files.filter(isImage);
  if (images.length === 0) return false;
  const ui = useUiStore.getState();

  try {
    if (images.length === 1) {
      // One picture: into the add bar, where words can go beside it.
      ui.setPendingImage(await imageDataUrl(images[0]!));
      ui.setCaptureOpen(true);
      return true;
    }
    const store = useWorkspaceStore.getState();
    if (!store.source.capture) {
      // The seed pipeline has nowhere to keep a picture; it takes one at a time, through the bar.
      ui.setPendingImage(await imageDataUrl(images[0]!));
      ui.setCaptureOpen(true);
      return true;
    }
    ui.setCaptureStage('reading');
    let kept = 0;
    const keptSources: string[] = [];
    for (const file of images) {
      const result = await store.source.capture({
        type: 'screenshot',
        content: '',
        title: file.name.replace(/\.[^.]+$/, ''),
        imageData: await imageDataUrl(file),
      });
      useWorkspaceStore.getState().applyPayload(result.graph);
      kept += 1;
      const sid = sourceOf(result);
      if (sid) keptSources.push(sid);
    }
    ui.dismissWelcome();
    ui.toast(t('toast.imagesKept', { count: kept }));
    showWhatWasKept(keptSources);
  } catch (err) {
    ui.toast(
      err instanceof Error ? t('toast.captureFailedWith', { message: err.message }) : t('toast.captureFailed'),
    );
  } finally {
    ui.setCaptureStage('idle');
  }
  return true;
}

/**
 * Where a hand-over ends. "Kept ten memories" and then nothing was a sentence
 * with no door in it: the person had to go looking for what was just read.
 * One original opens as its page — the text, the memories taken from it, and
 * the way to check them; several land in the archive, newest first.
 */
function showWhatWasKept(sourceIds: string[]): void {
  const ui = useUiStore.getState();
  const ids = [...new Set(sourceIds)];
  if (ids.length === 1) ui.openSourcePage(ids[0]!);
  else if (ids.length > 1) ui.setView('sources');
}

/** The source a capture made, read off the memories it added (or, with none, the newest source). */
function sourceOf(result: { addedMemoryIds: string[]; graph: { memories: { id: string; source_id: string }[]; sources: { id: string; created_at: string }[] } }): string | null {
  const added = result.graph.memories.find((m) => result.addedMemoryIds.includes(m.id));
  if (added) return added.source_id;
  return [...result.graph.sources].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ?? null;
}

/** The server's own limit (saveImage) — said here first, so a large file is refused before it is read. */
const MAX_PDF_BYTES = 10_000_000;

/**
 * PDFs in. The file goes to the server whole; the model reads the document
 * out, and what it read becomes the source's text — so a PDF is a text
 * source like any note, with its own words as the original. Reading takes a
 * while (a long document is a long read), so the ticker runs meanwhile.
 * Returns true when it handled any.
 */
export async function takePdfs(files: File[]): Promise<boolean> {
  const pdfs = files.filter(isPdf);
  if (pdfs.length === 0) return false;
  const ui = useUiStore.getState();
  const store = useWorkspaceStore.getState();
  if (!store.source.capture || !store.source.readsPdf) {
    ui.toast(t('toast.pdfNotYet'));
    return true;
  }

  ui.setCaptureStage('reading');
  ui.toast(t('toast.pdfReading', { count: pdfs.length }));
  let kept = 0;
  let memories = 0;
  let redacted = 0;
  const keptSources: string[] = [];
  try {
    for (const file of pdfs) {
      if (file.size > MAX_PDF_BYTES) {
        ui.toast(t('toast.pdfTooLarge', { name: file.name }));
        continue;
      }
      const result = await store.source.capture({
        type: 'text',
        title: file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim(),
        content: '',
        fileData: await readAsDataUrl(file),
      });
      useWorkspaceStore.getState().applyPayload(result.graph);
      kept += 1;
      memories += result.addedMemoryIds?.length ?? 0;
      redacted += result.redacted ?? 0;
      const sid = sourceOf(result);
      if (sid) keptSources.push(sid);
    }
    if (kept > 0) {
      ui.dismissWelcome();
      ui.toast(t('toast.pdfKept', { count: kept, memories }));
      if (redacted > 0) ui.toast(t('toast.redacted', { count: redacted }));
      showWhatWasKept(keptSources);
    }
  } catch (err) {
    ui.toast(
      err instanceof Error ? t('toast.captureFailedWith', { message: err.message }) : t('toast.captureFailed'),
    );
  } finally {
    ui.setCaptureStage('idle');
  }
  return true;
}
