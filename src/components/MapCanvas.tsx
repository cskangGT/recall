import { useEffect, useMemo, useRef, useState } from 'react';
import { drawFrame } from '../graph/renderer';
import {
  fitToBounds,
  lerpCamera,
  easeInOutCubic,
  clampZoom,
  screenToWorld,
  panToNode,
  isOffScreen,
  type Camera,
  type Viewport,
} from '../graph/camera';
import { hitTest } from '../graph/hitTest';
import { runLayout } from '../graph/layout';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore } from '../store/uiStore';
import { buildTimeline, phaseAt, MATERIALIZE_STAGGER_MS } from '../core/choreography';
import type { GraphNode } from '../core/types';
import { t } from '../i18n';
import type { ReorgEvent } from '../core/applyReorg';

export interface RunningAnimation {
  startedAt: number;
  hasStructure: boolean;
  newMemoryIds: string[];
  createdCategoryIds: string[];
  targetCategoryId: string | null;
  ghost: { x: number; y: number };
  event: ReorgEvent | null;
  /**
   * Categories that existed before this change and do not now — a merge's
   * absorbed side. They are already gone from the payload, so they can only be
   * drawn from the event's snapshot, converging into whatever absorbed them.
   */
  dissolving: { x: number; y: number; radius: number; intoX: number; intoY: number }[];
  /**
   * Categories that moved. A promotion pushes a child 320px clear of the parent
   * it is leaving; without this it simply appears somewhere else between frames.
   */
  travelling: { id: string; fromX: number; fromY: number }[];
}

/*
 * Honoured by the map, which is the one place motion was unconditional.
 *
 * The stylesheet respects `prefers-reduced-motion` in five places, but the map
 * animates in requestAnimationFrame — an 800ms entry zoom, a 400ms camera pan,
 * and a 2.4s reorganization — and CSS cannot reach any of it. `matchMedia`
 * appeared nowhere in src/, so a user who has asked their operating system to
 * stop moving things got the full choreography anyway.
 *
 * Zeroed rather than skipped: the same code path runs, the tween just completes
 * on its first frame. Nothing else has to know.
 */
const REDUCED =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ENTRY_MS = REDUCED ? 0 : 800;
const PAN_MS = REDUCED ? 0 : 400;

/**
 * Progress through a tween, 0 to 1.
 *
 * A zero duration has to return 1 rather than divide by it: on the very first
 * frame `now` and the start are the same instant, so the obvious arithmetic is
 * 0/0, and `Math.min(1, NaN)` is NaN — which would leave the camera stuck
 * rather than finished.
 */
const progress = (now: number, start: number, duration: number): number =>
  duration === 0 ? 1 : Math.min(1, (now - start) / duration);

export function MapCanvas({
  animation,
  onAnimationDone,
}: {
  animation: RunningAnimation | null;
  onAnimationDone: (event: ReorgEvent | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera | null>(null);
  const entryStart = useRef<number | null>(null);
  const panFrom = useRef<Camera | null>(null);
  const panTo = useRef<Camera | null>(null);
  const panStart = useRef<number | null>(null);
  const bannerFired = useRef(false);
  const [grabbing, setGrabbing] = useState(false);

  const baseNodes = useWorkspaceStore((s) => s.nodes);
  const baseEdges = useWorkspaceStore((s) => s.edges);
  const mapFocus = useUiStore((s) => s.mapFocus);

  /*
   * The regrouped view (2안): only what matched, pulled out of its scattered
   * territories and laid out fresh. Matched memories bring their category
   * along as an anchor; positions are zeroed so `runLayout`'s own ring
   * placement — the same code that seats a bulk import — re-clusters them by
   * category, and matched entities settle at the centroid of their mentions.
   * A temporary constellation; the full map is untouched underneath.
   */
  const focusScene = useMemo(() => {
    if (!mapFocus) return null;
    const byId = new Map(baseNodes.map((n) => [n.id, n]));

    const keep = new Set<string>();
    for (const id of mapFocus.ids) if (byId.has(id)) keep.add(id);
    // Each matched memory's category rides along as the anchor it clusters to.
    for (const id of [...keep]) {
      const n = byId.get(id)!;
      if (n.kind === 'memory' && n.parentId && byId.has(n.parentId)) keep.add(n.parentId);
    }
    if (keep.size === 0) return null;

    const nodes = [...keep].map((id) => {
      const n = byId.get(id)!;
      // Zeroed positions force a fresh layout; categories become loose roots.
      return { ...n, x: 0, y: 0, parentId: n.kind === 'memory' ? n.parentId : null };
    });
    const edges = baseEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
    return { nodes: runLayout(nodes, edges, { ticks: 60 }), edges };
  }, [mapFocus, baseNodes, baseEdges]);

  const nodes = focusScene?.nodes ?? baseNodes;
  const edges = focusScene?.edges ?? baseEdges;

  // The scene the RAF loop draws — a ref, because the loop lives outside React.
  const sceneRef = useRef<{ nodes: typeof baseNodes; edges: typeof baseEdges } | null>(null);
  sceneRef.current = focusScene;
  /** Detects focus entry inside the loop, to push history and fit the camera. */
  const focusEnteredRef = useRef(false);

  // Reset the banner latch whenever a new animation starts.
  useEffect(() => {
    bannerFired.current = false;
    panStart.current = null;
    panFrom.current = null;
    panTo.current = null;
  }, [animation?.startedAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;

    const loop = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const viewport: Viewport = { w: canvas.clientWidth, h: canvas.clientHeight };
      if (canvas.width !== viewport.w * dpr || canvas.height !== viewport.h * dpr) {
        canvas.width = viewport.w * dpr;
        canvas.height = viewport.h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const ui = useUiStore.getState();
      const store = useWorkspaceStore.getState();
      const current = sceneRef.current ?? { nodes: store.nodes, edges: store.edges };

      // ---- entering the regrouped view: remember where we stood, fit to it
      if (sceneRef.current && !focusEnteredRef.current) {
        focusEnteredRef.current = true;
        if (cameraRef.current) ui.pushCameraHistory(cameraRef.current);
        const fit = fitToBounds(current.nodes, viewport, 0.3);
        panFrom.current = cameraRef.current ?? fit;
        // A touch tighter than the search zoom: this view holds nothing else.
        panTo.current = { ...fit, zoom: Math.min(fit.zoom, 2.6) };
        panStart.current = now;
      }
      if (!sceneRef.current) focusEnteredRef.current = false;

      // ---- camera: entry animation on first paint, then user-controlled
      const target = fitToBounds(current.nodes, viewport, 0.1);
      if (!cameraRef.current && current.nodes.length > 0) {
        entryStart.current ??= now;
        const t = progress(now, entryStart.current, ENTRY_MS);
        const from: Camera = { ...target, zoom: target.zoom * 0.85 };
        const cam = lerpCamera(from, target, easeInOutCubic(t));
        if (t >= 1) {
          cameraRef.current = target;
          ui.setCamera(target);
        } else {
          drawScene(ctx, cam, viewport, current.nodes, current.edges, now);
          raf = requestAnimationFrame(loop);
          return;
        }
      }

      let camera = ui.camera ?? cameraRef.current ?? target;

      /*
       * ---- a zoom request from search (지도 검색 UX): fit the matched
       * nodes, remember where the camera stood so ← can walk back, and ride
       * the same pan tween every other camera move uses. The zoom is capped —
       * a single result should arrive close, not fill the screen with it.
       */
      const zoomIds = ui.consumeZoomTo();
      if (zoomIds && zoomIds.length > 0) {
        const targets = current.nodes.filter((n) => zoomIds.includes(n.id));
        if (targets.length > 0) {
          ui.pushCameraHistory(camera);
          const fit = fitToBounds(targets, viewport, 0.35);
          panFrom.current = camera;
          panTo.current = { ...fit, zoom: Math.min(fit.zoom, 2.2) };
          panStart.current = now;
        }
      }

      // ---- ← pressed: pop the trail and ride back on the same tween.
      const popped = ui.consumeCameraPop();
      if (popped) {
        panFrom.current = camera;
        panTo.current = popped;
        panStart.current = now;
      }

      // ---- the tree handed us a selection: centre on it
      const centerId = ui.consumeCenterOn();
      if (centerId) {
        const node = current.nodes.find((n) => n.id === centerId);
        if (node) {
          panFrom.current = camera;
          panTo.current = panToNode(node, camera);
          panStart.current = now;
        }
      }

      // ---- camera pan: pan only, never zoom (AC-20).
      // Drives both the reorganization pan and a centre-on from the tree.
      if (panStart.current !== null && panFrom.current && panTo.current) {
        const t = progress(now, panStart.current, PAN_MS);
        camera = lerpCamera(panFrom.current, panTo.current, easeInOutCubic(t));
        cameraRef.current = camera;
        if (t >= 1) {
          panStart.current = null;
          if (!animation) {
            panFrom.current = null;
            panTo.current = null;
          }
          useUiStore.getState().setCamera(camera);
        }
      }

      drawScene(ctx, camera, viewport, current.nodes, current.edges, now);
      raf = requestAnimationFrame(loop);
    };

    const drawScene = (
      c: CanvasRenderingContext2D,
      camera: Camera,
      viewport: Viewport,
      allNodes: GraphNode[],
      allEdges: typeof edges,
      now: number,
    ) => {
      const ui = useUiStore.getState();
      let renderNodes = allNodes;
      const scaleOverrides = new Map<string, number>();
      const desaturatedIds: string[] = [];
      let ghost: { x: number; y: number; pulse: number } | null = null;
      let bloom: { x: number; y: number; progress: number } | null = null;

      if (ui.captureStage !== 'idle' && !animation) {
        // Ghost node sits at the canvas edge nearest the camera centre.
        const world = screenToWorld({ sx: viewport.w - 90, sy: viewport.h / 2 }, camera, viewport);
        ghost = { ...world, pulse: now / 260 };
      }

      if (animation) {
        const t = now - animation.startedAt;
        const timeline = buildTimeline(animation.hasStructure);
        const phase = phaseAt(timeline, t);
        const newIds = new Set(animation.newMemoryIds);
        const createdIds = new Set(animation.createdCategoryIds);

        // Trigger the pan once, at t=1000, if the affected category is off-screen.
        if (
          animation.hasStructure &&
          t >= 1000 &&
          panStart.current === null &&
          panFrom.current === null &&
          animation.targetCategoryId
        ) {
          const targetNode = allNodes.find((n) => n.id === animation.targetCategoryId);
          if (targetNode && isOffScreen(targetNode, camera, viewport)) {
            panFrom.current = camera;
            panTo.current = panToNode(targetNode, camera);
            panStart.current = now;
          } else {
            panFrom.current = camera;
            panTo.current = camera;
          }
        }

        renderNodes = allNodes.map((n) => {
          if (newIds.has(n.id)) {
            // materialize 0-200ms (staggered), travel 200-1000ms from the ghost.
            const i = animation.newMemoryIds.indexOf(n.id);
            const local = t - i * MATERIALIZE_STAGGER_MS;
            if (local < 0) {
              scaleOverrides.set(n.id, 0);
              return n;
            }
            const grow = Math.min(1, local / 200);
            scaleOverrides.set(n.id, grow * 2.2);
            const travel = easeInOutCubic(Math.min(1, Math.max(0, (local - 200) / 800)));
            return {
              ...n,
              x: animation.ghost.x + (n.x - animation.ghost.x) * travel,
              y: animation.ghost.y + (n.y - animation.ghost.y) * travel,
            };
          }
          const moving = animation.travelling.find((t) => t.id === n.id);
          if (moving) {
            // Same 1400–1900ms window the split's children emerge in, so a
            // promotion and a split feel like the same kind of event.
            const progress = easeInOutCubic(Math.min(1, Math.max(0, (t - 1400) / 500)));
            return {
              ...n,
              x: moving.fromX + (n.x - moving.fromX) * progress,
              y: moving.fromY + (n.y - moving.fromY) * progress,
            };
          }
          if (createdIds.has(n.id)) {
            // Children emerge from the parent during `transform` (1400-1900ms).
            const grow = Math.min(1, Math.max(0, (t - 1400) / 500));
            scaleOverrides.set(n.id, easeInOutCubic(grow));
            const parent = allNodes.find((p) => p.id === n.parentId);
            if (parent && grow < 1) {
              const e = easeInOutCubic(grow);
              return { ...n, x: parent.x + (n.x - parent.x) * e, y: parent.y + (n.y - parent.y) * e };
            }
          }
          return n;
        });

        if (phase === 'desaturate' || (animation.hasStructure && t >= 1000 && t < 1400)) {
          if (animation.targetCategoryId) {
            desaturatedIds.push(animation.targetCategoryId);
            scaleOverrides.set(animation.targetCategoryId, 0.7);
          }
        }
        if (animation.hasStructure && t >= 1400 && t < 1900 && animation.targetCategoryId) {
          const back = 0.7 + 0.3 * Math.min(1, (t - 1400) / 500);
          scaleOverrides.set(animation.targetCategoryId, back);
        }

        // The bloom rides the `transform` window (1400–1900ms) — the same beat
        // the children emerge in, so the light has a cause.
        if (animation.hasStructure && animation.targetCategoryId) {
          const target = allNodes.find((n) => n.id === animation.targetCategoryId);
          const progress = (t - 1400) / 900;
          if (target && progress > 0 && progress < 1) {
            bloom = { x: target.x, y: target.y, progress };
          }
        }

        const total = animation.hasStructure ? 2400 : 1800;
        if (t >= total && !bannerFired.current) {
          bannerFired.current = true;
          onAnimationDone(animation.event);
        }
      }

      // A merge's absorbed category, drawn from the snapshot and collapsing into
      // whatever took it. It no longer exists in `nodes`, so nothing else can
      // show it going.
      const dissolving = animation
        ? animation.dissolving
            .map((d) => {
              const progress = (now - animation.startedAt - 1400) / 500;
              if (progress <= 0 || progress >= 1) return null;
              const e = easeInOutCubic(progress);
              return {
                x: d.x + (d.intoX - d.x) * e,
                y: d.y + (d.intoY - d.y) * e,
                radius: d.radius * (1 - e),
                alpha: 1 - e,
              };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null)
        : [];

      drawFrame(c, {
        nodes: renderNodes,
        edges: allEdges,
        camera,
        viewport,
        hoveredId: ui.hoveredId,
        selectedId: ui.selectedId,
        highlightedIds: ui.highlightedIds,
        dimOpacity: 0.15,
        scaleOverrides,
        desaturatedIds,
        ghost,
        bloom,
        dissolving,
      });
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animation, onAnimationDone, edges]);

  // ---------------------------------------------------------------- pointer

  const viewportOf = (): Viewport => {
    const c = canvasRef.current!;
    return { w: c.clientWidth, h: c.clientHeight };
  };

  const toScreen = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const dragging = useRef<{ sx: number; sy: number; cam: Camera } | null>(null);

  const camera = (): Camera =>
    useUiStore.getState().camera ?? cameraRef.current ?? { x: 0, y: 0, zoom: 1 };

  return (
    <canvas
      ref={canvasRef}
      data-testid="map-canvas"
      className={`canvas${grabbing ? ' canvas--grabbing' : ''}`}
      onPointerMove={(e) => {
        const p = toScreen(e);
        if (dragging.current) {
          const cam = dragging.current.cam;
          const next: Camera = {
            x: cam.x - (p.sx - dragging.current.sx) / cam.zoom,
            y: cam.y - (p.sy - dragging.current.sy) / cam.zoom,
            zoom: cam.zoom,
          };
          cameraRef.current = next;
          useUiStore.getState().setCamera(next);
          return;
        }
        const hit = hitTest(nodes, camera(), viewportOf(), p);
        useUiStore.getState().setHovered(hit?.id ?? null);
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = { ...toScreen(e), cam: camera() };
        setGrabbing(true);
      }}
      onPointerUp={(e) => {
        const start = dragging.current;
        dragging.current = null;
        setGrabbing(false);
        const p = toScreen(e);
        // A drag is not a click.
        if (start && Math.hypot(p.sx - start.sx, p.sy - start.sy) > 4) return;
        const hit = hitTest(nodes, camera(), viewportOf(), p);
        const ui = useUiStore.getState();
        if (hit?.sleeping) {
          // A sleeping star answers with why it is dim, and the door to wake it.
          ui.toast(t('toast.sleepingTap'));
          ui.setUpgradeSheet(true);
          return;
        }
        if (hit) {
          ui.select(hit.id);
          // A lit search hit pulls you in when clicked — the word you found
          // becomes the place you are (뒤로가기 is a frame away).
          if (ui.highlightedIds.includes(hit.id)) ui.requestZoomTo([hit.id]);
        } else ui.clearSelection();
      }}
      onWheel={(e) => {
        const cam = camera();
        const v = viewportOf();
        const p = toScreen(e);
        const before = screenToWorld(p, cam, v);
        const zoom = clampZoom(cam.zoom * Math.pow(1.0015, -e.deltaY));
        const after = screenToWorld(p, { ...cam, zoom }, v);
        const next: Camera = { x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y), zoom };
        cameraRef.current = next;
        useUiStore.getState().setCamera(next);
      }}
    />
  );
}
