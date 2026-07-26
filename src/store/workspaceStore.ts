import { create } from 'zustand';
import type { GraphPayload, GraphNode, GraphEdge } from '../types/graph';
import { SeedDataSource } from '../data/dataSource';
import { buildGraph } from '../graph/buildGraph';
import { runLayout } from '../graph/layout';

interface WorkspaceState {
  payload: GraphPayload | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  load: () => Promise<void>;
  applyPayload: (payload: GraphPayload) => void;
  /** User re-categorizes a memory. The assignment locks — see spec 6.3. */
  moveMemory: (memoryId: string, categoryId: string) => void;
  /** User re-parents a child category. */
  moveCategory: (categoryId: string, parentId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  payload: null,
  nodes: [],
  edges: [],
  loading: true,

  load: async () => {
    const payload = await SeedDataSource.load();
    const { nodes, edges } = buildGraph(payload);
    set({ payload, nodes: runLayout(nodes, edges), edges, loading: false });
  },

  applyPayload: (payload) => {
    const { nodes, edges } = buildGraph(payload);
    set({ payload, nodes: runLayout(nodes, edges), edges });
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
    get().applyPayload(next);
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
  },
}));
