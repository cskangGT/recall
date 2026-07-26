import { useEffect } from 'react';
import { useUiStore, STAGE_LABEL } from '../store/uiStore';

export function LeftRail() {
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen);
  const setAskOpen = useUiStore((s) => s.setAskOpen);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  return (
    <nav className="rail">
      <div className="rail__mark">R</div>
      <button
        className={`rail__btn${view === 'map' ? ' rail__btn--active' : ''}`}
        title="Map (G)"
        data-testid="rail-map"
        onClick={() => setView('map')}
      >
        ◍
      </button>
      <button
        className={`rail__btn${view === 'tree' ? ' rail__btn--active' : ''}`}
        title="Tree (T)"
        data-testid="rail-tree"
        onClick={() => setView('tree')}
      >
        ⋮
      </button>
      <button className="rail__btn" disabled title="Sources — not built yet">
        ▤
      </button>
      <button
        className="rail__btn"
        title="Ask (⌘/)"
        data-testid="rail-ask"
        onClick={() => setAskOpen(true)}
      >
        ?
      </button>
      <div className="rail__spacer" />
      <button
        className="rail__btn"
        title="Add (⌘K)"
        data-testid="rail-capture"
        onClick={() => setCaptureOpen(true)}
      >
        +
      </button>
    </nav>
  );
}

export function StatusTicker() {
  const stage = useUiStore((s) => s.captureStage);
  if (stage === 'idle') return null;
  return (
    <div className="ticker" data-testid="status-ticker">
      <span className="ticker__dot" />
      {STAGE_LABEL[stage]}
    </div>
  );
}

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 4000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function TooSmall() {
  return <div className="too-small">Recall is desktop-first. Please open on a larger screen.</div>;
}

export function Loading() {
  return (
    <div className="loading">
      <div className="loading__mark" />
    </div>
  );
}
