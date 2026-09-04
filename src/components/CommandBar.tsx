import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureInput } from '../data/dataSource';
import { useDismissable } from './useDismissable';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { detectCaptureType, TYPE_LABEL } from '../capture/detectType';
import { isQuestion, SUGGESTED_QUESTIONS } from '../ask/scriptedAsk';
import { runAsk } from '../ask/runAsk';
import { t } from '../i18n';
import { search, groupByCategory } from '../search/search';
import type { SourceType } from '../core/types';

export function CaptureBar({ onSubmit }: { onSubmit: (input?: CaptureInput) => void }) {
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen);
  const [text, setText] = useState('');
  /** The photo laid beside the words — kept as a data URL until submit. */
  const [image, setImage] = useState<string | null>(null);
  const hasImage = image !== null;
  const fileRef = useRef<HTMLInputElement>(null);
  const readImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' && setImage(reader.result);
    reader.readAsDataURL(file);
  };
  /*
   * The look-before-keeping step for links. A pasted URL is not yet a memory:
   * the server reads the page, this card shows what it found, and the person
   * decides. What was fetched then rides into capture as the content, so a
   * kept link's memories come from the page, not from its address.
   */
  const [preview, setPreview] = useState<
    | { loading: true; url: string }
    | { loading: false; url: string; title: string | null; description: string | null; excerpt: string | null; failed?: boolean }
    | null
  >(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const detected = detectCaptureType({ text, hasImage });

  const keepLink = () => {
    if (!preview || preview.loading) return;
    const enriched = [preview.title, preview.description, preview.excerpt]
      .filter(Boolean)
      .join('\n');
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
    if (preview && !preview.loading) {
      keepLink();
      return;
    }
    // A link goes through the look first — where the server can look at all.
    const reader = useWorkspaceStore.getState().source.previewLink;
    if (detected.type === 'link' && !hasImage && reader && !preview) {
      const url = text.trim();
      setPreview({ loading: true, url });
      reader(url).then(
        (p) => setPreview({ loading: false, ...p }),
        () =>
          setPreview({
            loading: false,
            url,
            title: null,
            description: null,
            excerpt: null,
            failed: true,
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
        className="bar bar--capture"
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
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          data-testid="capture-photo-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readImage(file);
            e.target.value = '';
          }}
        />
        {preview && (
          <div className="bar__preview" data-testid="link-preview">
            {preview.loading ? (
              <span className="bar__preview-reading">{t('capture.linkReading')}</span>
            ) : (
              <>
                <span className="bar__preview-title">
                  {preview.failed ? t('capture.linkFailed') : (preview.title ?? preview.url)}
                </span>
                {!preview.failed && (preview.description ?? preview.excerpt) && (
                  <span className="bar__preview-desc">
                    {preview.description ?? preview.excerpt}
                  </span>
                )}
                <span className="bar__preview-ask">{t('capture.linkAsk')}</span>
                <span className="bar__preview-actions">
                  <button
                    className="bar__preview-keep"
                    data-testid="link-preview-keep"
                    autoFocus
                    onClick={keepLink}
                  >
                    {t('capture.linkKeep')}
                  </button>
                  <button
                    className="bar__preview-skip"
                    data-testid="link-preview-skip"
                    onClick={() => setPreview(null)}
                  >
                    {t('capture.linkSkip')}
                  </button>
                </span>
              </>
            )}
          </div>
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
