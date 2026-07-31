import { useCallback, useEffect, useRef, useState } from 'react';
import { MapCanvas, type RunningAnimation } from './components/MapCanvas';
import { ArcBrowser } from './components/ArcBrowser';
import { Sky } from './components/Sky';
import { SourcesView } from './components/SourcesView';
import { Inspector } from './components/Inspector';
import { CaptureBar, AskBar } from './components/CommandBar';
import { ChangeBanner } from './components/ChangeBanner';
import { Settings } from './components/Settings';
import { LeftRail, TopBar, StatusTicker, Toasts, TooSmall, Loading } from './components/Chrome';
import { useUiStore } from './store/uiStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { ingestItem } from './capture/ingest';
import { buildCaptureStory } from './capture/story';
import { reorgMotion } from './capture/reorgMotion';
import { type ReorgEvent } from './core/applyReorg';
import { undoLastReorg } from './capture/undo';
import { fitToBounds } from './graph/camera';
import { FOCUS_FRACTION } from './arc/layout';

const MIN_VIEWPORT_WIDTH = 1280;

export function App() {
  const load = useWorkspaceStore((s) => s.load);
  const loading = useWorkspaceStore((s) => s.loading);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const captureOpen = useUiStore((s) => s.captureOpen);
  const askOpen = useUiStore((s) => s.askOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const view = useUiStore((s) => s.view);
  const openCategoryId = useUiStore((s) => s.openCategoryId);
  const dropActive = useUiStore((s) => s.dropActive);

  const [animation, setAnimation] = useState<RunningAnimation | null>(null);
  const [wide, setWide] = useState(
    typeof window === 'undefined' || window.innerWidth >= MIN_VIEWPORT_WIDTH,
  );
  const busy = useRef(false);

  useEffect(() => {
    void load();
  }, [load]);

  // `?skipWelcome=1` exists for the rehearsal script and the E2E suite, which
  // must not spend a keystroke on a greeting to reach the thing under test.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('skipWelcome') === '1') {
      useUiStore.getState().dismissWelcome();
    }
  }, []);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= MIN_VIEWPORT_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const capture = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const ui = useUiStore.getState();

    // Snapshotted before the ingest so novelty is measured against the corpus
    // as it was, not one that already contains the new memories.
    const before = useWorkspaceStore.getState().payload;
    const result = await ingestItem();
    const ws = useWorkspaceStore.getState();

    if (before && ws.payload) {
      ui.setLastCapture(
        buildCaptureStory(before, ws.payload, result.addedMemoryIds, result.event !== null),
      );
    }

    if (result.addedMemoryIds.length === 0) {
      busy.current = false;
      return;
    }

    // The ghost sits where the processing indicator was: right edge, mid-height.
    const camera = ui.camera ?? fitToBounds(ws.nodes, { w: 1200, h: 800 });
    const ghost = { x: camera.x + 520 / camera.zoom, y: camera.y };

    const motion = ws.payload
      ? reorgMotion(result.event, ws.payload)
      : { dissolving: [], travelling: [] };

    setAnimation({
      startedAt: performance.now(),
      hasStructure: result.event !== null,
      newMemoryIds: result.addedMemoryIds,
      createdCategoryIds: result.event?.created_category_ids ?? [],
      targetCategoryId: result.targetCategoryId,
      ghost,
      event: result.event,
      ...motion,
    });
  }, []);

  // The reorganization choreography lives on the canvas, so when a capture
  // happens anywhere else nothing is there to finish it — the app would stay
  // busy forever and the banner would never fire. Resolve it on the timeline's
  // own clock instead.
  useEffect(() => {
    if (!animation || view === 'map') return;
    const total = animation.hasStructure ? 2400 : 1800;
    const elapsed = performance.now() - animation.startedAt;
    const t = setTimeout(() => onAnimationDoneRef.current(animation.event), Math.max(0, total - elapsed));
    return () => clearTimeout(t);
  }, [animation, view]);

  const onAnimationDone = useCallback((event: ReorgEvent | null) => {
    const ui = useUiStore.getState();
    if (event) {
      ui.pushReorg(event);
    } else {
      ui.toast('Added 2 memories.');
    }
    setAnimation(null);
    busy.current = false;
  }, []);

  // Held in a ref so the timer above does not need to re-run when the callback
  // identity changes.
  const onAnimationDoneRef = useRef(onAnimationDone);
  onAnimationDoneRef.current = onAnimationDone;

  // Keyboard map (spec 6.1, Phase 1 subset).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setCaptureOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        ui.setAskOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoLastReorg();
        return;
      }
      if (e.key === 'Escape') {
        ui.escape();
        return;
      }
      if (typing) return;
      if (e.key === 'g' || e.key === 'G') {
        ui.setView('map');
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        ui.setView('browse');
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        ui.setView('sources');
        return;
      }
      if (e.key === ',') {
        ui.setSettingsOpen(true);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        ui.setCamera(fitToBounds(ws.nodes, { w: window.innerWidth - 416, h: window.innerHeight }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!wide) return <TooSmall />;
  if (loading) return <Loading />;

  return (
    <div
      className={`shell${view === 'browse' ? ' shell--mono sky sky--dusk' : ''}`}
      // Dropping a screenshot on the window is the shortest path from "I saw
      // something" to "Recall has it" — shorter than ⌘K, and the gesture people
      // already use for files.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        useUiStore.getState().setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        useUiStore.getState().setDropActive(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        useUiStore.getState().setDropActive(false);
        void capture();
      }}
    >
      {/*
        The hilltop, drawn at window level rather than inside the browser.
        Confined to the middle column it read as a violet panel bolted between
        two black ones — the seam against the rail and the inspector was the
        first thing the eye found. The crest lands on the arc's focus, which is
        where the figure sits, so the two have to agree: both take it from
        FOCUS_FRACTION rather than from a number typed twice.
      */}
      {view === 'browse' && (
        <Sky
          crestTop={`${100 * (openCategoryId !== null ? FOCUS_FRACTION.open : FOCUS_FRACTION.closed)}%`}
        />
      )}

      {dropActive && (
        <div className="dropzone" data-testid="dropzone">
          <div className="dropzone__inner">Drop it anywhere — Recall will read it and file it</div>
        </div>
      )}
      <LeftRail />
      {view === 'browse' && <TopBar />}
      <div className="canvas-wrap">
        {view === 'browse' ? (
          <ArcBrowser />
        ) : view === 'sources' ? (
          <SourcesView />
        ) : (
          <MapCanvas animation={animation} onAnimationDone={onAnimationDone} />
        )}
        {view === 'map' && nodes.length === 0 && (
          <div className="canvas-empty">
            <h2>Nothing saved yet.</h2>
            <p>Add a note, a link, or a screenshot and Recall will start building your map.</p>
            <button onClick={() => useUiStore.getState().setCaptureOpen(true)}>
              Add your first item
            </button>
          </div>
        )}
        <ChangeBanner />
        <StatusTicker />
        <Toasts />
        {/* Map and Sources have no composer, so they still need a visible way
            in. Browse has one in the composer, and two `+` on one screen is the
            duplication this change exists to remove. */}
        {view !== 'browse' && (
          <button
            className="fab"
            data-testid="fab"
            onClick={() => useUiStore.getState().setCaptureOpen(true)}
          >
            +
          </button>
        )}
      </div>
      <Inspector />
      {captureOpen && <CaptureBar onSubmit={capture} />}
      {askOpen && <AskBar />}
      {settingsOpen && <Settings />}
    </div>
  );
}
