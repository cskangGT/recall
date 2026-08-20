import { create } from 'zustand';
import { t } from '../i18n';
import type { Camera } from '../graph/camera';
import type { ReorgEvent } from '../core/applyReorg';
import type { ScriptedAnswer } from '../ask/scriptedAsk';
import type { CaptureStory } from '../capture/story';
import type { BatchCategorySummary } from '../capture/batch';

export type CaptureStage = 'idle' | 'reading' | 'extracting' | 'connecting' | 'reorganizing';

/**
 * The reveal a bulk drop plays: dots pour in while items are read, gather
 * while the pipeline runs, and resolve into the declaration — what was
 * organized, into which interests. `declare` waits for a click; the first
 * sight of your corpus sorted is not a state to time out of.
 */
export interface BatchRevealState {
  phase: 'reading' | 'organizing' | 'declare';
  /** Items in the batch. */
  total: number;
  /** Items read so far — drives the pour of dots. */
  read: number;
  summary: {
    memories: number;
    skipped: number;
    sources: number;
    categories: BatchCategorySummary[];
    /** The stretch of time this batch rescued, when the import knows it. */
    period?: { from: string; to: string } | null;
    /** The batch's sources, in order — what "검수하기" walks through. */
    sourceIds?: string[];
  } | null;
}

export const STAGE_LABEL: Record<Exclude<CaptureStage, 'idle'>, string> = {
  reading: t('stage.reading'),
  extracting: t('stage.extracting'),
  connecting: t('stage.connecting'),
  reorganizing: t('stage.reorganizing'),
};

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
  /**
   * The conversation so far — answered questions, oldest first, capped at
   * three. Sent with the next question so a follow-up ("which of those?") has
   * a *those*. Each answer is still built from the corpus alone; the thread
   * disambiguates the question, it is never evidence. Dies with the answer:
   * dismissing the answer surface ends the conversation.
   */
  askThread: { question: string; answer: string }[];
  /**
   * True while a question is out with the model. One shared flag rather than
   * per-surface state: the composer, the summarize button, and the reveal's
   * suggested questions all ask through `runAsk`, and every one of them must
   * show the wait — an unanswered click is what sends a person off pressing
   * other buttons to see if anything is happening.
   */
  asking: boolean;
  /**
   * The answer as it streams in, before the final result lands. Rendered on
   * the same surface `answer` will occupy; `setAnswer` supersedes it, so the
   * validated result — including a refusal that overrides text the model
   * already streamed — always owns what persists.
   */
  answerDraft: { question: string; text: string } | null;
  /** The account of the last capture — what was read, what was new, where it went. */
  lastCapture: CaptureStory | null;
  /** True while a file is being dragged over the window. */
  dropActive: boolean;
  /** Non-null while a bulk drop is being read, organized, or declared. */
  batchReveal: BatchRevealState | null;
  /**
   * The review stepper — one source's original against what Mado made of it,
   * with the user's verdicts (spec §21). Non-null while reviewing; `index`
   * walks `sourceIds` so a batch reviews as a sequence, a single source as a
   * sequence of one.
   */
  review: { sourceIds: string[]; index: number } | null;
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
  setAnswer: (a: (ScriptedAnswer & { question: string }) | null) => void;
  setAsking: (asking: boolean) => void;
  setAnswerDraft: (draft: { question: string; text: string } | null) => void;
  /** Ends the conversation without touching the answer on screen. */
  clearAskThread: () => void;
  setLastCapture: (s: CaptureStory | null) => void;
  setDropActive: (active: boolean) => void;
  setBatchReveal: (state: BatchRevealState | null) => void;
  openReview: (sourceIds: string[]) => void;
  /** Steps to the next source, or closes after the last one. */
  advanceReview: () => void;
  closeReview: () => void;
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
  askThread: [],
  asking: false,
  answerDraft: null,
  lastCapture: null,
  dropActive: false,
  batchReveal: null,
  review: null,
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
  setAnswer: (answer) =>
    set((s) => ({
      answer,
      // The validated result supersedes whatever streamed in ahead of it.
      answerDraft: null,
      // An answered question extends the conversation; a refusal or a
      // dismissal does not — following up on "I don't have anything" is
      // following up on nothing.
      askThread:
        answer === null
          ? []
          : answer.refused
            ? s.askThread
            : [...s.askThread, { question: answer.question, answer: answer.answer }].slice(-3),
      openCategoryId:
        answer !== null && s.view === 'browse'
          ? ANSWER_FOLDER_ID
          : s.openCategoryId === ANSWER_FOLDER_ID
            ? null
            : s.openCategoryId,
    })),
  clearAskThread: () => set({ askThread: [] }),
  setAsking: (asking) => set({ asking }),
  // The draft opens the answer surface the way the answer itself would, so
  // the first streamed words land where the reader will keep reading.
  setAnswerDraft: (answerDraft) =>
    set((s) => ({
      answerDraft,
      openCategoryId:
        answerDraft !== null && s.view === 'browse' ? ANSWER_FOLDER_ID : s.openCategoryId,
    })),
  setLastCapture: (lastCapture) => set({ lastCapture }),
  setDropActive: (dropActive) => set({ dropActive }),
  setBatchReveal: (batchReveal) => set({ batchReveal }),
  // Opening the review dismisses the reveal — they occupy the same attention.
  openReview: (sourceIds) =>
    set(sourceIds.length > 0 ? { review: { sourceIds, index: 0 }, batchReveal: null } : {}),
  advanceReview: () =>
    set((s) => {
      if (!s.review) return {};
      const index = s.review.index + 1;
      return index >= s.review.sourceIds.length
        ? { review: null }
        : { review: { ...s.review, index } };
    }),
  closeReview: () => set({ review: null }),
  toast: (text) => set((s) => ({ toasts: [...s.toasts, { id: ++toastId, text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  escape: () => {
    const s = get();
    // The declaration is dismissable like any modal; the reading and organizing
    // phases are not — an Escape mid-pipeline would hide work that is still
    // happening, not cancel it.
    if (s.batchReveal?.phase === 'declare') {
      set({ batchReveal: null });
      return;
    }
    // The review is a modal too — Escape leaves it before touching anything
    // else. Verdicts not yet confirmed are simply not applied.
    if (s.review !== null) {
      set({ review: null });
      return;
    }
    if (s.captureOpen || s.askOpen || s.settingsOpen) {
      set({ captureOpen: false, askOpen: false, settingsOpen: false });
      return;
    }
    // An answer and its highlight are one surface, so they clear together. The
    // answer has to be checked independently: a refusal cites nothing and
    // therefore highlights nothing, and it must still be dismissable.
    if (s.highlightedIds.length > 0 || s.answer !== null || s.answerDraft !== null) {
      set({
        highlightedIds: [],
        answer: null,
        answerDraft: null,
        // The conversation dies with the answer surface it happened on.
        askThread: [],
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
