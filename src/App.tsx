import { useCallback, useEffect, useRef, useState } from 'react';
import { MapCanvas, type RunningAnimation } from './components/MapCanvas';
import { ArcBrowser } from './components/ArcBrowser';
import { Sky } from './components/Sky';
import { SourcesView } from './components/SourcesView';
import { MapSearch } from './components/MapSearch';
import { Inspector } from './components/Inspector';
import { CaptureBar, AskBar } from './components/CommandBar';
import { ChangeBanner } from './components/ChangeBanner';
import { Settings } from './components/Settings';
import { LeftRail, TopBar, StatusTicker, Toasts, TooSmall, Loading } from './components/Chrome';
import { useUiStore } from './store/uiStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { ingestItem } from './capture/ingest';
import { ingestBatch } from './capture/batchRun';
import { parseInstagramZip, IMPORT_WINDOW_DAYS } from './capture/instagramZip';
import type { BatchItem } from './capture/batch';
import { BatchReveal } from './components/BatchReveal';
import type { CaptureInput } from './data/dataSource';
import { buildCaptureStory } from './capture/story';
import { reorgMotion } from './capture/reorgMotion';
import { type ReorgEvent } from './core/applyReorg';
import { undoLastReorg } from './capture/undo';
import { fitToBounds } from './graph/camera';
import { FOCUS_FRACTION } from './arc/layout';

const MIN_VIEWPORT_WIDTH = 1280;

/**
 * What a bulk drop will read. Text-shaped files only — an image in a multi-file
 * drop is skipped rather than failing the batch, because the pipeline behind
 * this reads text (screenshot upload is not built; see README "Not built yet").
 */
const TEXT_FILE = /\.(txt|md|markdown|csv|json)$/i;
const isTextLike = (f: File): boolean => f.type.startsWith('text/') || TEXT_FILE.test(f.name);

/** "meeting-notes_2026.md" → "meeting notes 2026" */
const titleFromFilename = (name: string): string =>
  name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();

/*
 * A floor on height as well as width.
 *
 * The width gate alone let the app render at 1280x720, where the scene runs out
 * of room vertically rather than horizontally: the crest sits at 86% of the
 * shell (619px), the figure is 190px tall so its head reaches 429px, and the
 * greeting starts at 26% (187px) — with the arc's innermost node between them.
 * All three converge, and `body { overflow: hidden }` means nothing can scroll
 * out of the collision. 760px clears it with the arc at its minimum radius.
 */
const MIN_VIEWPORT_HEIGHT = 760;

/** Must match `--rail-w` and `--inspector-w` in theme.css. */
const RAIL_W = 56;
const INSPECTOR_W = 360;

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
  const [roomy, setRoomy] = useState(
    typeof window === 'undefined' ||
      (window.innerWidth >= MIN_VIEWPORT_WIDTH && window.innerHeight >= MIN_VIEWPORT_HEIGHT),
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
    const onResize = () =>
      setRoomy(
        window.innerWidth >= MIN_VIEWPORT_WIDTH && window.innerHeight >= MIN_VIEWPORT_HEIGHT,
      );
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const capture = useCallback(async (input?: CaptureInput) => {
    if (busy.current) return;
    busy.current = true;
    const ui = useUiStore.getState();

    // Snapshotted before the ingest so novelty is measured against the corpus
    // as it was, not one that already contains the new memories.
    const before = useWorkspaceStore.getState().payload;
    const result = await ingestItem(input);
    const ws = useWorkspaceStore.getState();

    /*
     * Putting something in is looking around.
     *
     * The arc renders `welcomeDismissed ? nodes : []`, so on a fresh instance
     * the first capture landed in the database and nothing appeared — the
     * greeting was still up, and the greeting is what suppresses the arc. The
     * tool looked like it had done nothing at the exact moment it had done the
     * only thing it is for.
     */
    if (result.addedMemoryIds.length > 0) ui.dismissWelcome();

    if (before && ws.payload) {
      ui.setLastCapture(
        buildCaptureStory(
          before,
          ws.payload,
          result.addedMemoryIds,
          result.event !== null,
          result.alreadyHeld,
        ),
      );
    }

    // Nothing added is not nothing happened: everything in the source may
    // already have been held, and the story above says so.
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
      /*
       * Backspace deletes what is selected (spec 6.1). It was bound only inside
       * the arc, where it climbs a level, and nowhere else — so the keyboard
       * had no way to remove anything, which matched the rest of the app: until
       * now nothing at any layer could.
       *
       * Only memories, and only from the Inspector's selection. Deleting a
       * category is a different act with an unanswered question behind it —
       * where its memories go when it has no parent to inherit them.
       */
      if (e.key === 'Backspace' && ui.selectedId) {
        const ws = useWorkspaceStore.getState();
        const memory = ws.payload?.memories.find((m) => m.id === ui.selectedId);
        if (memory) {
          e.preventDefault();
          ws.deleteMemory(memory.id);
          ui.select(null);
          ui.toast('Deleted.');
          return;
        }
      }
      if (e.key === ',') {
        ui.setSettingsOpen(true);
        return;
      }
      /*
       * Space fits the map to its contents — and only the map.
       *
       * It used to fire in all three views, which was wrong twice over. On the
       * browsing screen `.arc__node` is `role="button" tabIndex={0}`, so Space
       * is also how you activate the star you have tabbed to: both handlers
       * ran, and opening a category with the keyboard silently re-aimed the map
       * camera on the way past. And the viewport it measured subtracted 416px
       * of chrome — the rail plus the inspector — while the browsing shell's
       * symmetric gutters make it 720px, so the camera was fitted against a
       * window 304px wider than the one it would appear in.
       *
       * Scoping it to the map fixes the collision and makes the arithmetic true
       * rather than merely unused: 416 is exactly the chrome the map has.
       */
      if (e.key === ' ' && ui.view === 'map') {
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        const chrome = RAIL_W + INSPECTOR_W;
        ui.setCamera(
          fitToBounds(ws.nodes, { w: window.innerWidth - chrome, h: window.innerHeight }),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!roomy) return <TooSmall />;
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

        /*
         * One file keeps the single-capture path and its choreography. Two or
         * more become a batch: read here (a File is only readable while the
         * event's DataTransfer is alive), then handed to the batch driver,
         * which owns the reveal. `busy` still guards both paths — a bulk drop
         * during a capture is dropped exactly like a second capture is.
         */
        const files = Array.from(e.dataTransfer.files);

        // An Instagram export: one ZIP that becomes a whole batch. Checked
        // before the text-file count, because a ZIP is one file and would
        // otherwise fall through to the single-capture path.
        const zip = files.find((f) => /\.zip$/i.test(f.name));
        if (zip) {
          if (busy.current) return;
          busy.current = true;
          void zip
            .arrayBuffer()
            .then(async (buf) => {
              const parsed = await parseInstagramZip(buf);
              if (parsed.items.length === 0) {
                useUiStore
                  .getState()
                  .toast(`Found ${parsed.total} saved posts, but none from the last ${IMPORT_WINDOW_DAYS} days.`);
                return;
              }
              await ingestBatch(parsed.items);
              if (parsed.older > 0) {
                useUiStore
                  .getState()
                  .toast(
                    `Imported the last ${IMPORT_WINDOW_DAYS} days — ${parsed.older} older ` +
                      `${parsed.older === 1 ? 'post' : 'posts'} stayed in the export.`,
                  );
              }
            })
            .catch((err: unknown) => {
              useUiStore
                .getState()
                .toast(
                  err instanceof Error
                    ? `Couldn't read that export — ${err.message}`
                    : "Couldn't read that export.",
                );
            })
            .finally(() => {
              busy.current = false;
            });
          return;
        }

        const textFiles = files.filter(isTextLike);
        if (textFiles.length >= 2) {
          if (busy.current) return;
          busy.current = true;
          void Promise.all(
            textFiles.map(async (f): Promise<BatchItem> => ({
              title: titleFromFilename(f.name),
              content: await f.text(),
            })),
          )
            .then((items) => ingestBatch(items))
            .finally(() => {
              busy.current = false;
            });
          return;
        }
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
        {/* The map is everything at once, so it needs a way to find one thing
            in it. Browse has the composer in the same slot. */}
        {view === 'map' && nodes.length > 0 && <MapSearch />}
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
        {/*
          The ticker names the stage the pipeline is on. On the browsing screen
          the capture story already names all four with the current one lit, so
          both were printing the same word at the same moment — one at the top of
          the screen and one at the bottom. The story panel's own docstring says
          it answers "the questions the ticker never did"; it should have taken
          the ticker's place then. Map and Sources have no story panel, so there
          it is still the only sign that anything is happening.
        */}
        {view !== 'browse' && <StatusTicker />}
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
      <BatchReveal />
      {captureOpen && <CaptureBar onSubmit={capture} />}
      {askOpen && <AskBar />}
      {settingsOpen && <Settings />}
    </div>
  );
}
