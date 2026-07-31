import { useEffect } from 'react';
import { useUiStore, STAGE_LABEL } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Where you are, and the one place that is not here.
 *
 * It spans the window, not the middle column. Living inside the browser it
 * stopped at that column's right edge, which is an invisible seam with a blank
 * inspector on the other side of it — so the controls crowded a line nobody can
 * see and the window's actual right edge stayed empty.
 *
 * There is no `Ask` link. Asking is the box at the bottom of the screen; a
 * header link to it was a second door onto the same room, and the rail still
 * has `?` for anyone who wants a button.
 */
export function TopBar() {
  const arcLevelId = useUiStore((s) => s.arcLevelId);
  const setView = useUiStore((s) => s.setView);
  const payload = useWorkspaceStore((s) => s.payload);

  const here =
    arcLevelId === null
      ? 'Everything'
      : (payload?.categories.find((c) => c.id === arcLevelId)?.name ?? 'Everything');

  return (
    <div className="topbar">
      <span>{here}</span>
      <button className="topbar__link" data-testid="go-map" onClick={() => setView('map')}>
        See the big picture ⇢
      </button>
    </div>
  );
}

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
        className={`rail__btn${view === 'browse' ? ' rail__btn--active' : ''}`}
        title="Browse (T)"
        data-testid="rail-tree"
        onClick={() => setView('browse')}
      >
        ⊞
      </button>
      <button
        className={`rail__btn${view === 'sources' ? ' rail__btn--active' : ''}`}
        title="Sources (S)"
        data-testid="rail-sources"
        onClick={() => setView('sources')}
      >
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
        title="Settings (,)"
        data-testid="rail-settings"
        onClick={() => useUiStore.getState().setSettingsOpen(true)}
      >
        ⚙
      </button>
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
