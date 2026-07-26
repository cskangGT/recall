import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { detectCaptureType, TYPE_LABEL } from '../capture/detectType';
import { answerQuestion, isQuestion, SUGGESTED_QUESTIONS } from '../ask/scriptedAsk';
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
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const ask = (question: string) => {
    if (!payload || !question.trim()) return;
    const result = answerQuestion(question, payload);
    setAnswer({ ...result, question });
    setHighlight(result.highlighted_node_ids);
    select(null);
    setAskOpen(false);
  };

  return (
    <div className="overlay" onPointerDown={() => setAskOpen(false)}>
      <div className="bar" data-testid="ask-bar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="bar__head">
          <span>{isQuestion(text) ? 'Ask' : 'Search'}</span>
          <span>esc</span>
        </div>
        <input
          ref={ref}
          data-testid="ask-input"
          placeholder="Ask across everything you've saved…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              ask(text);
            }
          }}
        />
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
