import { create } from 'zustand';
import type { GraphPayload, GraphNode, GraphEdge } from '../core/types';
import type { MeetingsResponse } from '../core/meetingTypes';
import { selectDataSource, type DataSource } from '../data/dataSource';
import { buildGraph } from '../graph/buildGraph';
import { runLayout } from '../graph/layout';
import { answerQuestion } from '../ask/scriptedAsk';
import { t } from '../i18n';

interface WorkspaceState {
  payload: GraphPayload | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  source: DataSource;
  /**
   * The calendar window, once it has been asked for. Null before the first
   * answer and on a source that has no calendar door — the meetings view
   * reads null as "not connected", which is also what it is.
   */
  meetings: MeetingsResponse | null;
  /**
   * "What have I been into lately?", asked once a day and kept: the paragraph
   * the briefing opens with, in the memory's own voice, with the memories it
   * leaned on. Null before the first answer or when there is nothing to say.
   */
  lately: { answer: string; citations: { memory_id: string }[] } | null;
  load: () => Promise<void>;
  /**
   * Asks the reflective question through whatever answers here — the server's
   * model, or the seed's counts — and remembers the answer for the day, so a
   * reload does not spend another call. The cache is keyed on the day, the
   * source and the corpus size: a new capture earns a fresh look.
   */
  loadLately: () => Promise<void>;
  /**
   * Asks for the window. A failure keeps what was already here rather than
   * blanking it: a list that was true a minute ago beats an empty page.
   */
  loadMeetings: (refresh?: boolean) => Promise<void>;
  applyPayload: (payload: GraphPayload) => void;
  /** User re-categorizes a memory. The assignment locks — see spec 6.3. */
  moveMemory: (memoryId: string, categoryId: string) => void;
  /** Put a memory down, or pick it back up. It is never removed by this. */
  settleMemory: (memoryId: string, settled: boolean) => void;
  /** Throws a memory away. Not reversible — the UI asks first. */
  deleteMemory: (memoryId: string) => void;
  /** User re-parents a child category. */
  moveCategory: (categoryId: string, parentId: string) => void;
  /** A category made by hand around picked memories. Resolves to its id. */
  createCategory: (name: string, memoryIds: string[]) => Promise<string>;
  /** Renames a category and locks it against future reorganization. */
  renameCategory: (categoryId: string, name: string) => void;
  /** Whether Recall may restructure on its own. */
  setAutoReorganize: (enabled: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  payload: null,
  nodes: [],
  edges: [],
  loading: true,
  source: selectDataSource(),
  meetings: null,
  lately: null,

  loadLately: async () => {
    const { source, payload } = get();
    if (!payload || payload.memories.length === 0) return;
    const KEY = 'mado.briefing.lately';
    const day = new Date().toISOString().slice(0, 10);
    const stamp = { day, mode: source.mode, count: payload.memories.length };
    try {
      const cached = JSON.parse(localStorage.getItem(KEY) ?? 'null') as
        | ({ lately: WorkspaceState['lately'] } & typeof stamp)
        | null;
      if (cached && cached.day === day && cached.mode === stamp.mode && cached.count === stamp.count) {
        set({ lately: cached.lately });
        return;
      }
    } catch {
      // A missing or broken cache is just a cache miss.
    }
    const question = t('briefing.latelyQuestion');
    const result = source.ask
      ? await source.ask(question).catch(() => null)
      : answerQuestion(question, payload);
    const lately =
      result && !result.refused
        ? { answer: result.answer, citations: result.citations.map((c) => ({ memory_id: c.memory_id })) }
        : null;
    set({ lately });
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...stamp, lately }));
    } catch {
      // Storage can be unavailable; the answer still stands for this session.
    }
  },

  loadMeetings: async (refresh = false) => {
    const { source } = get();
    if (!source.listMeetings) return;
    try {
      const meetings = await source.listMeetings(refresh);
      set({ meetings });
    } catch {
      // Keep the previous window.
    }
  },

  load: async () => {
    const payload = await get().source.load();
    const { nodes, edges } = buildGraph(payload);
    set({ payload, nodes: runLayout(nodes, edges), edges, loading: false });
  },

  applyPayload: (payload) => {
    const { nodes, edges } = buildGraph(payload);
    set({ payload, nodes: runLayout(nodes, edges), edges });
  },

  deleteMemory: (memoryId) => {
    const current = get().payload;
    if (!current) return;
    /*
     * Everything that pointed at it goes too, so the client's copy matches what
     * the schema does on the server — memory_category, memory_entity and both
     * edge endpoints are ON DELETE CASCADE there. Leaving a dangling edge here
     * would draw a line to a node that no longer exists.
     */
    const next: GraphPayload = {
      ...current,
      memories: current.memories.filter((m) => m.id !== memoryId),
      edges: current.edges.filter(
        (e) => e.source_memory_id !== memoryId && e.target_memory_id !== memoryId,
      ),
    };
    get().applyPayload(next);
    const { source } = get();
    void source
      .deleteMemory?.(memoryId)
      .then(get().applyPayload)
      .catch(() => void get().load());
  },

  settleMemory: (memoryId, settled) => {
    const current = get().payload;
    if (!current) return;
    const at = settled ? new Date().toISOString() : null;
    // Optimistic, like a move: the row should leave the table under the hand.
    get().applyPayload({
      ...current,
      memories: current.memories.map((m) => (m.id === memoryId ? { ...m, settled_at: at } : m)),
    });
    const { source } = get();
    void source.settleMemory?.(memoryId, settled)
      .then(get().applyPayload)
      .catch(() => void get().load());
  },

  moveMemory: (memoryId, categoryId) => {
    const current = get().payload;
    if (!current) return;
    const next: GraphPayload = {
      ...current,
      memories: current.memories.map((m) =>
        m.id === memoryId
          ? {
              ...m,
              category_id: categoryId,
              // The AI proposes structure; the user's edits are facts. Once
              // moved by hand, no reorganization pass may reassign it.
              category_locked: true,
              // Drop the hand-placed position so the node regroups on the map.
              x: m.pinned ? m.x : null,
              y: m.pinned ? m.y : null,
            }
          : m,
      ),
    };
    // Optimistic either way: the map should move under the user's hand, not a
    // round trip later. In API mode the server's payload replaces this one, and
    // a rejection surfaces as the graph snapping back to server truth.
    get().applyPayload(next);
    const { source } = get();
    void source.moveMemory?.(memoryId, categoryId)
      .then(get().applyPayload)
      .catch(() => void get().load());
  },

  /**
   * Renaming is a correction, so it locks.
   *
   * `gates.ts` drops locked categories before any scoring, which means a name
   * you chose is not merely preserved — the category stops being a candidate
   * for restructuring at all. That is the promise in spec 4.2: the AI does the
   * work, the user keeps authority, and a correction is never quietly undone.
   */
  setAutoReorganize: (enabled) => {
    const current = get().payload;
    if (!current) return;
    get().applyPayload({
      ...current,
      workspace: { ...current.workspace, auto_reorganize: enabled },
    });
    const { source } = get();
    void source.setAutoReorganize?.(enabled)
      .then(get().applyPayload)
      .catch(() => void get().load());
  },

  renameCategory: (categoryId, name) => {
    const current = get().payload;
    const trimmed = name.trim();
    if (!current || trimmed.length === 0) return;

    const existing = current.categories.find((c) => c.id === categoryId);
    if (!existing || existing.name === trimmed) return;

    const next: GraphPayload = {
      ...current,
      categories: current.categories.map((c) =>
        c.id === categoryId ? { ...c, name: trimmed, name_locked: true } : c,
      ),
    };
    get().applyPayload(next);
    const { source } = get();
    void source.updateCategory?.(categoryId, { name: trimmed })
      .then(get().applyPayload)
      .catch(() => void get().load());
  },

  createCategory: async (name, memoryIds) => {
    const { source } = get();
    if (source.createCategory) {
      const result = await source.createCategory(name, memoryIds);
      get().applyPayload(result.graph);
      return result.categoryId;
    }
    // Seed mode: the same shape, made locally — theirs, locked, at the root.
    const current = get().payload;
    if (!current) throw new Error('no workspace');
    const categoryId = `cat_user_${Date.now().toString(36)}`;
    const ids = new Set(memoryIds);
    get().applyPayload({
      ...current,
      categories: [
        ...current.categories,
        {
          id: categoryId,
          parent_id: null,
          name,
          rationale: null,
          name_locked: true,
          user_created: true,
          x: null,
          y: null,
          pinned: false,
          created_by: 'user',
        },
      ],
      memories: current.memories.map((m) =>
        ids.has(m.id) ? { ...m, category_id: categoryId, category_locked: true, x: null, y: null } : m,
      ),
    });
    return categoryId;
  },

  moveCategory: (categoryId, parentId) => {
    const current = get().payload;
    if (!current) return;
    const parent = current.categories.find((c) => c.id === parentId);
    // Two levels only: a category may only ever be re-parented onto a root.
    if (!parent || parent.parent_id !== null) return;
    const next: GraphPayload = {
      ...current,
      categories: current.categories.map((c) =>
        c.id === categoryId ? { ...c, parent_id: parentId, x: null, y: null } : c,
      ),
    };
    get().applyPayload(next);
    const { source } = get();
    void source.updateCategory?.(categoryId, { parentId })
      .then(get().applyPayload)
      .catch(() => void get().load());
  },
}));
