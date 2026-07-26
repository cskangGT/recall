import { useCallback, useEffect, useRef, useState } from 'react';
import { MapCanvas, type RunningAnimation } from './components/MapCanvas';
import { TreeView } from './components/TreeView';
import { Inspector } from './components/Inspector';
import { CaptureBar, AskBar } from './components/CommandBar';
import { ChangeBanner } from './components/ChangeBanner';
import { LeftRail, StatusTicker, Toasts, TooSmall, Loading } from './components/Chrome';
import { useUiStore } from './store/uiStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { ingestItem } from './capture/ingest';
import { undoReorg, type ReorgEvent } from './reorg/applyReorg';
import { fitToBounds } from './graph/camera';

const MIN_VIEWPORT_WIDTH = 1280;

export function App() {
  const load = useWorkspaceStore((s) => s.load);
  const loading = useWorkspaceStore((s) => s.loading);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const captureOpen = useUiStore((s) => s.captureOpen);
  const askOpen = useUiStore((s) => s.askOpen);
  const view = useUiStore((s) => s.view);

  const [animation, setAnimation] = useState<RunningAnimation | null>(null);
  const [wide, setWide] = useState(
    typeof window === 'undefined' || window.innerWidth >= MIN_VIEWPORT_WIDTH,
  );
  const busy = useRef(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= MIN_VIEWPORT_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const capture = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const ui = useUiStore.getState();

    const result = await ingestItem();
    const ws = useWorkspaceStore.getState();

    if (result.addedMemoryIds.length === 0) {
      busy.current = false;
      return;
    }

    // The ghost sits where the processing indicator was: right edge, mid-height.
    const camera = ui.camera ?? fitToBounds(ws.nodes, { w: 1200, h: 800 });
    const ghost = { x: camera.x + 520 / camera.zoom, y: camera.y };

    setAnimation({
      startedAt: performance.now(),
      hasStructure: result.event !== null,
      newMemoryIds: result.addedMemoryIds,
      createdCategoryIds: result.event?.created_category_ids ?? [],
      targetCategoryId: result.targetCategoryId,
      ghost,
      event: result.event,
    });
  }, []);

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
        const popped = ui.popReorg();
        if (popped) {
          useWorkspaceStore.getState().applyPayload(undoReorg(popped));
          ui.toast('Reverted.');
        }
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
        ui.setView('tree');
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
    <div className="shell">
      <LeftRail />
      <div className="canvas-wrap">
        {view === 'tree' ? (
          <TreeView />
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
        <button
          className="fab"
          data-testid="fab"
          onClick={() => useUiStore.getState().setCaptureOpen(true)}
        >
          +
        </button>
      </div>
      <Inspector />
      {captureOpen && <CaptureBar onSubmit={capture} />}
      {askOpen && <AskBar />}
    </div>
  );
}
