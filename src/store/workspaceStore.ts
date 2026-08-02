import { create } from 'zustand';
import type { GraphPayload, GraphNode, GraphEdge } from '../core/types';
import { selectDataSource, type DataSource } from '../data/dataSource';
import { buildGraph } from '../graph/buildGraph';
import { runLayout } from '../graph/layout';

interface WorkspaceState {
  payload: GraphPayload | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  source: DataSource;
  load: () => Promise<void>;
  applyPayload: (payload: GraphPayload) => void;
  /** User re-categorizes a memory. The assignment locks — see spec 6.3. */
  moveMemory: (memoryId: string, categoryId: string) => void;
  /** Throws a memory away. Not reversible — the UI asks first. */
  deleteMemory: (memoryId: string) => void;
  /** User re-parents a child category. */
  moveCategory: (categoryId: string, parentId: string) => void;
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
