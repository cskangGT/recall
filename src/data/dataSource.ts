import type { GraphPayload } from '../types/graph';
import { validateSeed } from './validateSeed';
import workspaceJson from '../../seed/workspace.json';

/**
 * The Phase 4 swap point. Replacing SeedDataSource with an ApiDataSource is the
 * only change the frontend needs when the backend arrives.
 */
export interface DataSource {
  load(): Promise<GraphPayload>;
}

export const SeedDataSource: DataSource = {
  async load() {
    return validateSeed(workspaceJson);
  },
};
