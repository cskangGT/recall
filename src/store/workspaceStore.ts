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
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
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
}));
