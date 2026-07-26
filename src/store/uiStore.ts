import { create } from 'zustand';
import type { Camera } from '../graph/camera';
import type { ReorgEvent } from '../reorg/applyReorg';
import type { ScriptedAnswer } from '../ask/scriptedAsk';

export type CaptureStage = 'idle' | 'reading' | 'extracting' | 'connecting' | 'reorganizing';

export const STAGE_LABEL: Record<Exclude<CaptureStage, 'idle'>, string> = {
  reading: 'Reading…',
  extracting: 'Extracting memories…',
  connecting: 'Finding connections…',
  reorganizing: 'Reorganizing…',
};

export interface Toast {
  id: number;
  text: string;
}

export type View = 'map' | 'tree';

interface UiState {
  view: View;
  /** Category ids whose children are shown in the tree. */
  expandedIds: string[];
  /**
   * Set when the tree hands a selection back to the map, so the canvas knows to
   * centre on it. Cleared by the canvas once consumed.
   */
  centerOnId: string | null;
  hoveredId: string | null;
  selectedId: string | null;
  highlightedIds: string[];
  camera: Camera | null;
  captureOpen: boolean;
  askOpen: boolean;
  captureStage: CaptureStage;
  reorgHistory: ReorgEvent[];
  answer: (ScriptedAnswer & { question: string }) | null;
  toasts: Toast[];

  setView: (view: View) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, open: boolean) => void;
  consumeCenterOn: () => string | null;
  setHovered: (id: string | null) => void;
  select: (id: string | null) => void;
  clearSelection: () => void;
  setHighlight: (ids: string[]) => void;
  setCamera: (c: Camera) => void;
  setCaptureOpen: (open: boolean) => void;
  setAskOpen: (open: boolean) => void;
  setCaptureStage: (s: CaptureStage) => void;
  pushReorg: (e: ReorgEvent) => void;
  popReorg: () => ReorgEvent | null;
  setAnswer: (a: (ScriptedAnswer & { question: string }) | null) => void;
  toast: (text: string) => void;
  dismissToast: (id: number) => void;
  /** Esc order: close modal -> clear highlight -> clear selection (spec 6.1). */
  escape: () => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  view: 'map',
  expandedIds: [],
  centerOnId: null,
  hoveredId: null,
  selectedId: null,
  highlightedIds: [],
  camera: null,
  captureOpen: false,
  askOpen: false,
  captureStage: 'idle',
  reorgHistory: [],
  answer: null,
  toasts: [],

  // Switching back to the map carries the selection with it and asks the canvas
  // to centre on it, so the two views never lose each other.
  setView: (view) =>
    set((s) => ({
      view,
      centerOnId: view === 'map' ? s.selectedId : null,
    })),

  toggleExpanded: (id) =>
    set((s) => ({
      expandedIds: s.expandedIds.includes(id)
        ? s.expandedIds.filter((x) => x !== id)
        : [...s.expandedIds, id],
    })),

  setExpanded: (id, open) =>
    set((s) => ({
      expandedIds: open
        ? s.expandedIds.includes(id)
          ? s.expandedIds
          : [...s.expandedIds, id]
        : s.expandedIds.filter((x) => x !== id),
    })),

  consumeCenterOn: () => {
    const id = get().centerOnId;
    if (id !== null) set({ centerOnId: null });
    return id;
  },

  setHovered: (hoveredId) => set({ hoveredId }),
  select: (selectedId) => set({ selectedId }),
  clearSelection: () => set({ selectedId: null, highlightedIds: [] }),
  setHighlight: (highlightedIds) => set({ highlightedIds }),
  setCamera: (camera) => set({ camera }),
  setCaptureOpen: (captureOpen) => set({ captureOpen }),
  setAskOpen: (askOpen) => set({ askOpen }),
  setCaptureStage: (captureStage) => set({ captureStage }),

  // 10 deep, session-scoped (spec 8.4.5).
  pushReorg: (e) => set((s) => ({ reorgHistory: [e, ...s.reorgHistory].slice(0, 10) })),
  popReorg: () => {
    const [head, ...rest] = get().reorgHistory;
    if (!head) return null;
    set({ reorgHistory: rest });
    return head;
  },

  setAnswer: (answer) => set({ answer }),
  toast: (text) => set((s) => ({ toasts: [...s.toasts, { id: ++toastId, text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  escape: () => {
    const s = get();
    if (s.captureOpen || s.askOpen) {
      set({ captureOpen: false, askOpen: false });
      return;
    }
    // An answer and its highlight are one surface, so they clear together. The
    // answer has to be checked independently: a refusal cites nothing and
    // therefore highlights nothing, and it must still be dismissable.
    if (s.highlightedIds.length > 0 || s.answer !== null) {
      set({ highlightedIds: [], answer: null });
      return;
    }
    set({ selectedId: null });
  },
}));
