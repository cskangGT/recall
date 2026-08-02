import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureInput } from '../data/dataSource';
import { useDismissable } from './useDismissable';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { detectCaptureType, TYPE_LABEL } from '../capture/detectType';
import { answerQuestion, isQuestion, SUGGESTED_QUESTIONS } from '../ask/scriptedAsk';
import { search, groupByCategory } from '../search/search';
import type { SourceType } from '../core/types';
import { askedCategories } from '../arc/interest';
import { useInterestStore } from '../store/interestStore';

export function CaptureBar({ onSubmit }: { onSubmit: (input?: CaptureInput) => void }) {
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen);
  const [text, setText] = useState('');
  const [hasImage, setHasImage] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const detected = detectCaptureType({ text, hasImage });

  const submit = () => {
    if (!text.trim() && !hasImage) return;
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
        ? { type: 'screenshot', content: text.trim(), imagePath: '/seed/demo-screenshot.png' }
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
        className="bar"
        data-testid="capture-bar"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-bar-title"
      >
        <div className="bar__head">
          <span id="capture-bar-title">Add to Recall</span>
          <span>esc</span>
        </div>
        <textarea
          ref={ref}
          data-testid="capture-input"
          rows={3}
          placeholder="Paste text, a link, or an image…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (Array.from(e.clipboardData.items).some((i) => i.type.startsWith('image/'))) {
              setHasImage(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="bar__foot">
          <div className="bar__types">
            {(['text', 'link', 'screenshot'] as SourceType[]).map((t) => (
              <button
                key={t}
                className={`bar__type${detected.type === t ? ' bar__type--on' : ''}`}
                onClick={() => t === 'screenshot' && setHasImage(!hasImage)}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <span>⏎ to add</span>
        </div>
      </div>
    </div>
  );
}

export function AskBar() {
  const setAskOpen = useUiStore((s) => s.setAskOpen);
  const setAnswer = useUiStore((s) => s.setAnswer);
  const recordInterest = useInterestStore((s) => s.record);
  const setHighlight = useUiStore((s) => s.setHighlight);
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
    if (!payload || !question.trim()) return;
    setAskOpen(false);

    const source = useWorkspaceStore.getState().source;
    const result = source.ask
      ? await source.ask(question).catch(() => answerQuestion(question, payload))
      : answerQuestion(question, payload);

    setAnswer({ ...result, question });
    /*
     * Asking is the strongest of the three signals the arc ranks by, and until
     * now it left no trace anywhere: the server writes `ask_history` and reads
     * it back nowhere, and the client never saw it at all. Recorded against the
     * top-level categories the answer actually drew on, so the arc reflects what
     * you were thinking about rather than what you happened to click.
     */
    for (const categoryId of askedCategories(payload, result.citations.map((c) => c.memory_id))) {
      recordInterest(categoryId, 'asked');
    }
    setHighlight(result.highlighted_node_ids);
    select(null);
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
            {searching ? 'Search' : 'Ask'}
          </span>
          <span>esc</span>
        </div>
        <input
          ref={ref}
          data-testid="ask-input"
          placeholder="Ask across everything you've saved…"
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
              <p className="bar__no-results">No matches.</p>
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
