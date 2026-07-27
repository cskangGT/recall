import { useEffect, useRef, useState } from 'react';
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
import { useWorkspaceStore } from '../store/workspaceStore';
import { useUiStore } from '../store/uiStore';
import { buildTimeline, phaseAt, MATERIALIZE_STAGGER_MS } from '../core/choreography';
import type { GraphNode } from '../core/types';
import type { ReorgEvent } from '../core/applyReorg';

export interface RunningAnimation {
  startedAt: number;
  hasStructure: boolean;
  newMemoryIds: string[];
  createdCategoryIds: string[];
  targetCategoryId: string | null;
  ghost: { x: number; y: number };
  event: ReorgEvent | null;
}

const ENTRY_MS = 800;
const PAN_MS = 400;

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

  const nodes = useWorkspaceStore((s) => s.nodes);
  const edges = useWorkspaceStore((s) => s.edges);

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
      const current = useWorkspaceStore.getState();

      // ---- camera: entry animation on first paint, then user-controlled
      const target = fitToBounds(current.nodes, viewport, 0.1);
      if (!cameraRef.current && current.nodes.length > 0) {
        entryStart.current ??= now;
        const t = Math.min(1, (now - entryStart.current) / ENTRY_MS);
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
        const t = Math.min(1, (now - panStart.current) / PAN_MS);
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
        if (hit) ui.select(hit.id);
        else ui.clearSelection();
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
