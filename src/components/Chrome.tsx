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
    /*
     * Six glyphs are the entire navigation of this app, and to a screen reader
     * they were the entire *name* of it too — "◍", "⊞", "▤", "?", "⚙", "+".
     * `title` is a tooltip, not a label: it is announced by some readers, by
     * some settings, sometimes. `aria-label` is the one that always is.
     *
     * The shortcut stays in the name rather than being stripped, because a
     * keyboard user is exactly who benefits from being told there is a key for
     * this. `aria-current` marks where you are — the active view was carrying
     * that in a CSS class, which is invisible to everything but a monitor.
     */
    <nav className="rail" aria-label="Views">
      <div className="rail__mark" aria-hidden="true">
        R
      </div>
      <button
        className={`rail__btn${view === 'map' ? ' rail__btn--active' : ''}`}
        title="Map (G)"
        aria-label="Map (G)"
        aria-current={view === 'map' ? 'page' : undefined}
        data-testid="rail-map"
        onClick={() => setView('map')}
      >
        <span aria-hidden="true">◍</span>
      </button>
      <button
        className={`rail__btn${view === 'browse' ? ' rail__btn--active' : ''}`}
        title="Browse (T)"
        aria-label="Browse (T)"
        aria-current={view === 'browse' ? 'page' : undefined}
        data-testid="rail-tree"
        onClick={() => setView('browse')}
      >
        <span aria-hidden="true">⊞</span>
      </button>
      <button
        className={`rail__btn${view === 'sources' ? ' rail__btn--active' : ''}`}
        title="Sources (S)"
        aria-label="Sources (S)"
        aria-current={view === 'sources' ? 'page' : undefined}
        data-testid="rail-sources"
        onClick={() => setView('sources')}
      >
        <span aria-hidden="true">▤</span>
      </button>
      <button
        className="rail__btn"
        title="Ask (⌘/)"
        aria-label="Ask (⌘/)"
        data-testid="rail-ask"
        onClick={() => setAskOpen(true)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <div className="rail__spacer" />
      <button
        className="rail__btn"
        title="Settings (,)"
        aria-label="Settings (,)"
        data-testid="rail-settings"
        onClick={() => useUiStore.getState().setSettingsOpen(true)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      <button
        className="rail__btn"
        title="Add (⌘K)"
        aria-label="Add (⌘K)"
        data-testid="rail-capture"
        onClick={() => setCaptureOpen(true)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </nav>
  );
}

/**
 * Spec AC-7's queue badge.
 *
 * Its own component because the thing it belongs beside is different per view:
 * Map and Sources have the ticker, and the browse view replaces the ticker with
 * the capture story panel. A badge that only appeared on two of three screens
 * would be missing from the default one.
 */
export function QueueBadge() {
  const waiting = useUiStore((s) => s.captureQueue.length);
  if (waiting === 0) return null;
  return (
    <span className="ticker__queue" data-testid="queue-badge">
      {waiting} waiting
    </span>
  );
}

export function StatusTicker() {
  const stage = useUiStore((s) => s.captureStage);
  if (stage === 'idle') return null;
  return (
    // The only sign the pipeline is doing anything on Map and Sources.
    <div className="ticker" data-testid="status-ticker" aria-live="polite">
      <span className="ticker__dot" />
      {STAGE_LABEL[stage]}
      <QueueBadge />
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
    /*
     * Announced, because this is where the confirmations live: every
     * drag-to-re-file lands here, and so does the refusal when you try to nest
     * a third level. A sighted user sees the answer to "did that work"; without
     * a live region nobody else gets one.
     *
     * `polite` rather than `assertive` — these follow an action the user just
     * took, so they can wait for a pause rather than cutting in.
     *
     * `aria-live` alone rather than `role="status"`, which would have implied
     * it. The change banner already claims that role, and a second one makes
     * "the status region" ambiguous — for anyone navigating by role, and for
     * the four tests that locate the banner that way.
     */
    <div className="toasts" aria-live="polite">
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
