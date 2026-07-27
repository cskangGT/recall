import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { detectCaptureType, TYPE_LABEL } from '../capture/detectType';
import { answerQuestion, isQuestion, SUGGESTED_QUESTIONS } from '../ask/scriptedAsk';
import { search, groupByCategory } from '../search/search';
import type { SourceType } from '../core/types';

export function CaptureBar({ onSubmit }: { onSubmit: () => void }) {
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen);
  const [text, setText] = useState('');
  const [hasImage, setHasImage] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const detected = detectCaptureType({ text, hasImage });

  const submit = () => {
    if (!text.trim() && !hasImage) return;
    setCaptureOpen(false);
    onSubmit();
  };

  return (
    <div className="overlay" onPointerDown={() => setCaptureOpen(false)}>
      <div className="bar" data-testid="capture-bar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="bar__head">
          <span>Add to Recall</span>
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
    if (useUiStore.getState().view === 'tree' && memory) {
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
    setHighlight(result.highlighted_node_ids);
    select(null);
  };

  return (
    <div className="overlay" onPointerDown={() => setAskOpen(false)}>
      <div className="bar" data-testid="ask-bar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="bar__head">
          <span data-testid="bar-mode">{searching ? 'Search' : 'Ask'}</span>
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
