import { imageDataUrl, isPdf, showWhatWasKept, sourceOf, takePdfs } from '../capture/images';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureInput } from '../data/dataSource';
import { useDismissable } from './useDismissable';
import { useUiStore } from '../store/uiStore';
import { HttpError, type LinkFailure, type LinkPreview } from '../data/dataSource';
import { ReadCard, readLineFor } from './ReadCard';
import type { PendingRead } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { detectCaptureType, TYPE_LABEL } from '../capture/detectType';
import { isQuestion, SUGGESTED_QUESTIONS } from '../ask/scriptedAsk';
import { runAsk } from '../ask/runAsk';
import { t } from '../i18n';
import { search, groupByCategory } from '../search/search';
import type { SourceType } from '../core/types';

const LINK_FAILURES: readonly string[] = ['invalid', 'scheme', 'private', 'status', 'timeout', 'network'];
const isLinkFailure = (r: unknown): r is LinkFailure => typeof r === 'string' && LINK_FAILURES.includes(r);

export function CaptureBar({ onSubmit }: { onSubmit: (input?: CaptureInput) => void }) {
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen);
  const [text, setText] = useState('');
  /** The photo laid beside the words — kept as a data URL until submit. */
  const [image, setImage] = useState<string | null>(null);
  const hasImage = image !== null;
  const fileRef = useRef<HTMLInputElement>(null);
  const readImage = (file: File) => {
    // Scaled down when large, so a full-size retina capture still arrives.
    void imageDataUrl(file).then(setImage, () =>
      useUiStore.getState().toast(t('toast.captureFailed')),
    );
  };
  // A picture dropped on the window or picked from the fill door arrives here.
  const pendingImage = useUiStore((st) => st.pendingImage);
  useEffect(() => {
    if (!pendingImage) return;
    setImage(pendingImage);
    useUiStore.getState().setPendingImage(null);
  }, [pendingImage]);
  /*
   * A file read out and waiting: its card stands in for the box. Kept, it
   * becomes a source with the stored file as its original and the chosen
   * words as its text; skipped, the next file's card comes up, and with none
   * left the box closes. Closing the box by hand abandons the queue (the
   * store empties it on close).
   */
  const pending = useUiStore((st) => st.pendingReads[0] ?? null);
  const nextRead = () => {
    const ui = useUiStore.getState();
    ui.shiftRead();
    if (ui.pendingReads.length === 0) ui.setCaptureOpen(false);
  };
  const keepFile = async (read: PendingRead, content: string) => {
    const store = useWorkspaceStore.getState();
    nextRead();
    if (!store.source.capture) {
      onSubmit({ type: 'text', content, title: read.title });
      return;
    }
    const ui = useUiStore.getState();
    ui.setCaptureStage('reading');
    try {
      const result = await store.source.capture({ type: 'text', title: read.title, content, imagePath: read.path ?? undefined });
      useWorkspaceStore.getState().applyPayload(result.graph);
      ui.dismissWelcome();
      ui.toast(t('toast.fileKept', { name: read.title, memories: result.addedMemoryIds?.length ?? 0 }));
      const sid = sourceOf(result);
      if (sid && useUiStore.getState().pendingReads.length === 0) showWhatWasKept([sid]);
    } catch (err) {
      ui.toast(err instanceof Error ? t('toast.captureFailedWith', { message: err.message }) : t('toast.captureFailed'));
    } finally {
      useUiStore.getState().setCaptureStage('idle');
    }
  };
  /*
   * The look-before-keeping step for links. A pasted URL is not yet a memory:
   * the server reads the page, this card shows what it found, and the person
   * decides. What was fetched then rides into capture as the content, so a
   * kept link's memories come from the page, not from its address.
   */
  const [preview, setPreview] = useState<
    | { loading: true; url: string }
    | ({ loading: false; failed?: false } & LinkPreview)
    | { loading: false; url: string; failed: true; reason: LinkFailure; httpStatus?: number }
    | null
  >(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const detected = detectCaptureType({ text, hasImage });

  // The card hands over what to keep, assembled; a failed read keeps the address alone.
  const keepLink = (content = '') => {
    if (!preview || preview.loading) return;
    const enriched = content;
    setCaptureOpen(false);
    onSubmit({
      type: 'link',
      content: enriched || preview.url,
      url: preview.url,
      referencedUrls: detected.referencedUrls,
    });
  };

  const submit = () => {
    if (!text.trim() && !hasImage) return;
    // The card has its own keep; the box behind it does nothing on Enter.
    if (preview && !preview.loading) return;
    // A link goes through the look first — where the server can look at all.
    const reader = useWorkspaceStore.getState().source.previewLink;
    if (detected.type === 'link' && !hasImage && reader && !preview) {
      const url = text.trim();
      setPreview({ loading: true, url });
      reader(url).then(
        (p) => setPreview({ loading: false, ...p }),
        (err: unknown) =>
          setPreview({
            loading: false,
            url,
            failed: true,
            reason: err instanceof HttpError && isLinkFailure(err.reason) ? err.reason : 'network',
            httpStatus: err instanceof HttpError ? err.httpStatus : undefined,
          }),
      );
      return;
    }
    setCaptureOpen(false);
    /*
     * What you typed, sent on.
     *
     * This box collected text, detected its type, showed you the verdict — and
     * then called `onSubmit()` with nothing, so every capture ingested the same
     * hard-coded demo item regardless. Harmless while the only backend was the
     * fixture; the moment a personal instance ran against real extraction it
     * meant the tool could not save anything you actually wrote.
     *
     * A screenshot still has no path to send: there is no upload, so an image
     * capture falls back to the demo's own file (spec §10.1's OCR path is
     * implemented server-side and unreachable without object storage).
     */
    onSubmit(
      hasImage
        ? {
            type: 'screenshot',
            content: text.trim(),
            // The API stores the photo itself; the seed pipeline has no
            // storage and falls back to its demo file as before.
            imageData: image ?? undefined,
            imagePath: '/seed/demo-screenshot.png',
          }
        : {
            type: detected.type,
            content: text.trim(),
            url: detected.type === 'link' ? text.trim() : undefined,
            // Already parsed out of the text for the type verdict; the server
            // stores them rather than parsing the same string a second time.
            referencedUrls: detected.referencedUrls,
          },
    );
  };

  return (
    /*
     * A dialog, and dismissed on click rather than on pointerdown.
     *
     * Neither of these was true. Without `role="dialog"` and `aria-modal` a
     * reader treats this as more page — it reads the map behind it, and there
     * is nothing to say you have entered anything. And closing on
     * *pointerdown* meant selecting text inside the box and releasing a few
     * pixels outside it threw the panel away along with everything typed into
     * it, which is a gesture people make constantly.
     */
    <div className="overlay" {...useDismissable(() => setCaptureOpen(false))}>
      <div
        className={`bar bar--capture${pending ? ' bar--reading' : ''}`}
        data-testid="capture-bar"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-bar-title"
      >
        <div className="bar__head">
          <span id="capture-bar-title">{t('capture.title')}</span>
          <span>esc</span>
        </div>
        <textarea
          ref={ref}
          data-testid="capture-input"
          rows={3}
          placeholder={t('capture.placeholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((i) =>
              i.type.startsWith('image/'),
            );
            const file = item?.getAsFile();
            if (file) readImage(file);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {image && (
          <div className="bar__photo" data-testid="capture-photo">
            <img className="bar__photo-img" src={image} alt="" />
            <button
              className="bar__photo-remove"
              data-testid="capture-photo-remove"
              aria-label={t('capture.photoRemove')}
              onClick={() => setImage(null)}
            >
              ×
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,.pdf,application/pdf"
          hidden
          data-testid="capture-photo-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            // A PDF is not laid beside the words — it is its own original. The
            // bar steps aside and the document is read.
            if (isPdf(file)) {
              setCaptureOpen(false);
              void takePdfs([file]);
              return;
            }
            readImage(file);
          }}
        />
        {pending && (
          <ReadCard
            prefix="file"
            title={pending.title}
            text={pending.text}
            chars={pending.chars}
            readLine={readLineFor({ chars: pending.chars, redacted: pending.redacted })}
            askLine={t('capture.fileAsk')}
            keepLabel={t('capture.linkKeep')}
            skipLabel={t('capture.linkSkip')}
            onKeep={(content) => void keepFile(pending, content)}
            onSkip={() => nextRead()}
          />
        )}
        {preview && preview.loading && (
          <div className="bar__preview" data-testid="link-preview">
            <span className="bar__preview-reading">{t('capture.linkReading')}</span>
          </div>
        )}
        {preview && !preview.loading && preview.failed && (
          <div className="bar__preview" data-testid="link-preview">
            <span className="bar__preview-title">{t('capture.linkFailed')}</span>
            <span className="bar__preview-note" data-testid="link-preview-note">
              {t(`capture.linkFail.${preview.reason}`, { status: preview.httpStatus ?? 0 })}
            </span>
            <span className="bar__preview-ask">{t('capture.linkAskAddress')}</span>
            <span className="bar__preview-actions">
              <button className="bar__preview-keep" data-testid="link-preview-keep" autoFocus onClick={() => keepLink('')}>
                {t('capture.linkKeep')}
              </button>
              <button className="bar__preview-skip" data-testid="link-preview-skip" onClick={() => setPreview(null)}>
                {t('capture.linkSkip')}
              </button>
            </span>
          </div>
        )}
        {preview && !preview.loading && !preview.failed && (
          <ReadCard
            prefix="link"
            title={preview.title ?? preview.url}
            description={preview.description}
            excerpt={preview.excerpt}
            text={preview.text}
            chars={preview.chars}
            readLine={readLineFor({ chars: preview.chars, truncated: preview.truncated, note: preview.note })}
            askLine={t('capture.linkAsk')}
            keepLabel={t('capture.linkKeep')}
            skipLabel={t('capture.linkSkip')}
            onKeep={keepLink}
            onSkip={() => setPreview(null)}
          />
        )}
        <div className="bar__foot">
          <div className="bar__types">
            {(['text', 'link', 'screenshot'] as SourceType[]).map((t) => (
              <button
                key={t}
                className={`bar__type${detected.type === t ? ' bar__type--on' : ''}`}
                onClick={() => {
                  if (t !== 'screenshot') return;
                  if (hasImage) setImage(null);
                  else fileRef.current?.click();
                }}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <span className="bar__foot-right">
            <button
              className="bar__photo-add"
              data-testid="capture-photo-add"
              onClick={() => fileRef.current?.click()}
            >
              {t('capture.photoAdd')}
            </button>
            <span>{t('capture.submit')}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function AskBar() {
  const setAskOpen = useUiStore((s) => s.setAskOpen);
  const askThread = useUiStore((s) => s.askThread);
  const clearAskThread = useUiStore((s) => s.clearAskThread);
  const select = useUiStore((s) => s.select);
  const payload = useWorkspaceStore((s) => s.payload);
  const setHovered = useUiStore((s) => s.setHovered);
  const setView = useUiStore((s) => s.setView);
  const openCategory = useUiStore((s) => s.openCategory);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => ref.current?.focus(), []);

  // Spec §5.6: 120ms debounce, results within 150ms of the last keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 120);
    return () => clearTimeout(t);
  }, [text]);

  const searching = text.trim().length > 0 && !isQuestion(text);
  const results = useMemo(
    () => (payload && searching ? search(payload, debounced) : []),
    [payload, searching, debounced],
  );
  const groups = useMemo(() => groupByCategory(results), [results]);

  /**
   * Reveal the result where you already are.
   *
   * It used to force the map. But search belongs to the manual mode — you are
   * browsing folders and looking for one specific thing — and yanking you onto
   * the map answered a question you had not asked. So: in the browser it opens
   * the memory's folder, on the map it centres on the node.
   */
  const openResult = (memoryId: string) => {
    setHovered(null);
    const memory = payload?.memories.find((m) => m.id === memoryId);
    if (useUiStore.getState().view === 'browse' && memory) {
      openCategory(memory.category_id);
    } else {
      setView('map');
    }
    select(memoryId);
    setAskOpen(false);
  };

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setAskOpen(false);
    await runAsk(question);
  };

  return (
    <div className="overlay" {...useDismissable(() => setAskOpen(false))}>
      <div
        className="bar"
        data-testid="ask-bar"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-bar-title"
      >
        <div className="bar__head">
          <span id="ask-bar-title" data-testid="bar-mode">
            {searching ? t('ask.mode.search') : t('ask.mode.ask')}
          </span>
          <span>esc</span>
        </div>
        {/* The conversation, named. A follow-up only works if you can see what
            it would follow — and end it, because "start fresh" must never
            require dismissing the answer you are looking at. */}
        {!searching && askThread.length > 0 && (
          <div className="bar__followup" data-testid="ask-followup">
            <span className="bar__followup-q">
              {t('ask.followingUp', { question: askThread[askThread.length - 1]!.question })}
            </span>
            <button
              className="bar__followup-clear"
              data-testid="ask-followup-clear"
              onClick={clearAskThread}
            >
              {t('ask.startFresh')}
            </button>
          </div>
        )}
        <input
          ref={ref}
          data-testid="ask-input"
          placeholder={
            askThread.length > 0
              ? t('ask.placeholderFollowUp')
              : t('ask.placeholder')
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            // The chip is the contract: in Search mode Enter opens the top
            // result, it does not silently run an Ask instead.
            if (searching) {
              // Enter must act on what you typed, not on what the 120ms debounce
              // has caught up to. Type fast, hit Enter, and the old code found an
              // empty result list and did nothing at all.
              const top =
                debounced === text ? results[0] : payload ? search(payload, text)[0] : undefined;
              if (top) openResult(top.memory.id);
              return;
            }
            void ask(text);
          }}
        />

        {searching && (
          <div className="bar__results" data-testid="search-results">
            {results.length === 0 ? (
              <p className="bar__no-results">{t('ask.noMatches')}</p>
            ) : (
              groups.map((group) => (
                <div key={group.categoryId} className="bar__group">
                  <div className="bar__group-name">{group.categoryName}</div>
                  {group.results.map((result) => (
                    <button
                      key={result.memory.id}
                      className="bar__result"
                      data-testid={`search-result-${result.memory.id}`}
                      onMouseEnter={() => setHovered(result.memory.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => openResult(result.memory.id)}
                    >
                      <span className="bar__result-text">
                        {result.segments.map((seg, i) =>
                          seg.matched ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
                        )}
                      </span>
                      <span className="bar__result-meta">{result.sourceTitle}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {text.length === 0 && (
          <div className="bar__suggestions">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} className="bar__suggestion" onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
