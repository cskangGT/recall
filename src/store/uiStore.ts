import { create } from 'zustand';
import type { Camera } from '../graph/camera';
import type { ReorgEvent } from '../core/applyReorg';
import type { ScriptedAnswer } from '../ask/scriptedAsk';
import type { CaptureStory } from '../capture/story';

export type CaptureStage = 'idle' | 'reading' | 'extracting' | 'connecting' | 'reorganizing';

export const STAGE_LABEL: Record<Exclude<CaptureStage, 'idle'>, string> = {
  reading: 'Reading…',
  extracting: 'Extracting memories…',
  connecting: 'Finding connections…',
  reorganizing: 'Reorganizing…',
};

/** A decoded, downscaled image the capture bar is holding. */
export interface PendingImage {
  data: string;
  mediaType: string;
  /** For the chip, so you can see which file you attached. */
  name: string;
}

export interface Toast {
  id: number;
  text: string;
}

export type View = 'map' | 'browse' | 'sources';
export type SourceFilter = 'all' | 'text' | 'link' | 'screenshot';

/**
 * A pseudo-folder holding the memories an answer cited.
 *
 * Ask is the product — the arc is how you read what it pulled. Rather than
 * bolting a second answer surface onto the browser, the answer just becomes a
 * folder on the arc: same rows, same click-to-inspect, same drag-to-re-file. It
 * is not a real category, so it carries a sentinel id nothing can collide with.
 */
export const ANSWER_FOLDER_ID = '__answer__';

interface UiState {
  view: View;
  sourceFilter: SourceFilter;
  /**
   * Which folder's memories the reading list is showing. Separate from
   * `selectedId` because clicking a memory in the list must not close the
   * folder you are standing in.
   */
  openCategoryId: string | null;
  /**
   * Which folder's children the arc is currently showing. `null` is the top
   * level. Distinct from `openCategoryId`: standing inside Fundraising's arc
   * and reading Investor Notes are two different facts.
   */
  arcLevelId: string | null;
  /** False until the welcome screen has been dismissed for this session. */
  welcomeDismissed: boolean;
  /**
   * Set when the arc hands a selection back to the map, so the canvas knows to
   * centre on it. Cleared by the canvas once consumed.
   */
  centerOnId: string | null;
  hoveredId: string | null;
  selectedId: string | null;
  highlightedIds: string[];
  camera: Camera | null;
  captureOpen: boolean;
  askOpen: boolean;
  settingsOpen: boolean;
  captureStage: CaptureStage;
  reorgHistory: ReorgEvent[];
  answer: (ScriptedAnswer & { question: string }) | null;
  /** The account of the last capture — what was read, what was new, where it went. */
  lastCapture: CaptureStory | null;
  /** True while a file is being dragged over the window. */
  dropActive: boolean;
  toasts: Toast[];

  setView: (view: View) => void;
  setSourceFilter: (filter: SourceFilter) => void;
  openCategory: (id: string | null) => void;
  setArcLevel: (id: string | null) => void;
  dismissWelcome: () => void;
  consumeCenterOn: () => string | null;
  setHovered: (id: string | null) => void;
  select: (id: string | null) => void;
  clearSelection: () => void;
  setHighlight: (ids: string[]) => void;
  setCamera: (c: Camera) => void;
  setCaptureOpen: (open: boolean) => void;
  setAskOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCaptureStage: (s: CaptureStage) => void;
  pushReorg: (e: ReorgEvent) => void;
  popReorg: () => ReorgEvent | null;
  /**
   * An image waiting to be captured, held here rather than in the capture bar
   * because a drop on the window must be able to open the bar *with the file
   * already attached* — and the bar is not mounted when the drop lands.
   */
  pendingImage: PendingImage | null;
  setPendingImage: (image: PendingImage | null) => void;
  setAnswer: (a: (ScriptedAnswer & { question: string }) | null) => void;
  setLastCapture: (s: CaptureStory | null) => void;
  setDropActive: (active: boolean) => void;
  toast: (text: string) => void;
  dismissToast: (id: number) => void;
  /** Esc order: close modal -> clear highlight -> clear selection (spec 6.1). */
  escape: () => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  view: 'browse',
  sourceFilter: 'all',
  openCategoryId: null,
  arcLevelId: null,
  welcomeDismissed: false,
  centerOnId: null,
  hoveredId: null,
  selectedId: null,
  highlightedIds: [],
  camera: null,
  captureOpen: false,
  askOpen: false,
  settingsOpen: false,
  captureStage: 'idle',
  reorgHistory: [],
  answer: null,
  lastCapture: null,
  dropActive: false,
  toasts: [],

  // Switching back to the map carries the selection with it and asks the canvas
  // to centre on it, so the two views never lose each other.
  setView: (view) =>
    set((s) => ({
      view,
      centerOnId: view === 'map' ? s.selectedId : null,
      // Leaving for the map or the sources list *is* looking around, so coming
      // back cannot land on a greeting that asks whether you would like to.
      // Worse, the top bar renders over it offering "See the big picture" —
      // which is the picture you just came back from.
      welcomeDismissed: s.welcomeDismissed || view !== 'browse',
    })),

  setSourceFilter: (sourceFilter) => set({ sourceFilter }),
  openCategory: (openCategoryId) => set({ openCategoryId }),

  setArcLevel: (arcLevelId) => set({ arcLevelId }),
  dismissWelcome: () => set({ welcomeDismissed: true }),

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
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCaptureStage: (captureStage) => set({ captureStage }),

  // 10 deep, session-scoped (spec 8.4.5).
  pushReorg: (e) => set((s) => ({ reorgHistory: [e, ...s.reorgHistory].slice(0, 10) })),
  popReorg: () => {
    const [head, ...rest] = get().reorgHistory;
    if (!head) return null;
    set({ reorgHistory: rest });
    return head;
  },

  // An answer arriving while you are browsing opens its own folder, so the
  // citations land where you are already reading instead of only on the map.
  pendingImage: null,
  setPendingImage: (pendingImage) => set({ pendingImage }),
  setAnswer: (answer) =>
    set((s) => ({
      answer,
      openCategoryId:
        answer !== null && s.view === 'browse'
          ? ANSWER_FOLDER_ID
          : s.openCategoryId === ANSWER_FOLDER_ID
            ? null
            : s.openCategoryId,
    })),
  setLastCapture: (lastCapture) => set({ lastCapture }),
  setDropActive: (dropActive) => set({ dropActive }),
  toast: (text) => set((s) => ({ toasts: [...s.toasts, { id: ++toastId, text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  escape: () => {
    const s = get();
    if (s.captureOpen || s.askOpen || s.settingsOpen) {
      set({ captureOpen: false, askOpen: false, settingsOpen: false });
      return;
    }
    // An answer and its highlight are one surface, so they clear together. The
    // answer has to be checked independently: a refusal cites nothing and
    // therefore highlights nothing, and it must still be dismissable.
    if (s.highlightedIds.length > 0 || s.answer !== null) {
      set({
        highlightedIds: [],
        answer: null,
        // The answer folder cannot outlive the answer it holds.
        openCategoryId: s.openCategoryId === ANSWER_FOLDER_ID ? null : s.openCategoryId,
      });
      return;
    }
    if (s.selectedId !== null) {
      set({ selectedId: null });
      return;
    }
    // Last in the chain. The capture story is ambient — it must never swallow
    // the Escape that was meant for the answer (spec 6.1 fixes that order).
    set({ lastCapture: null });
  },
}));
