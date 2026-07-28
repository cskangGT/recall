import type { GraphPayload } from '../core/types';
import { validateSeed } from './validateSeed';
import workspaceJson from '../../seed/workspace.json';

/**
 * The swap point the whole architecture was built around.
 *
 * `DataSource` grew from a single `load()` in Phase 1 to the full set of
 * mutations, because every one of them has to go somewhere when the data lives
 * on a server. Seed mode keeps them local; API mode sends them over HTTP. The
 * app above this line does not know which it is talking to.
 */

export interface CaptureInput {
  type: 'text' | 'link' | 'screenshot';
  content?: string;
  url?: string;
  imagePath?: string;
  referencedUrls?: string[];
}

export interface CaptureResult {
  addedMemoryIds: string[];
  reorg: {
    id: string;
    operation: string;
    banner_text: string;
    affected_category_ids: string[];
    created_category_ids: string[];
  } | null;
  graph: GraphPayload;
  note?: string;
}

export interface AskResult {
  answer: string;
  citations: { n: number; memory_id: string; source_id: string }[];
  highlighted_node_ids: string[];
  refused: boolean;
}

export interface DataSource {
  readonly mode: 'seed' | 'api';
  load(): Promise<GraphPayload>;
  /** Only implemented in API mode; seed mode drives capture through the store. */
  capture?(input: CaptureInput): Promise<CaptureResult>;
  ask?(question: string): Promise<AskResult>;
  undo?(reorgId: string): Promise<GraphPayload>;
  moveMemory?(memoryId: string, categoryId: string): Promise<GraphPayload>;
  updateCategory?(
    categoryId: string,
    fields: { name?: string; parentId?: string | null },
  ): Promise<GraphPayload>;
  /** Re-runs a capture whose processing failed. Only the API can do this. */
  retrySource?(sourceId: string): Promise<GraphPayload>;
}

export const SeedDataSource: DataSource = {
  mode: 'seed',
  async load() {
    return validateSeed(workspaceJson);
  },
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ApiDataSource implements DataSource {
  readonly mode = 'api' as const;

  constructor(
    private readonly workspaceId = 'ws_demo',
    private readonly base = '/api',
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}/workspaces/${this.workspaceId}${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new HttpError(response.status, body.error ?? `request failed (${response.status})`);
    }
    return body;
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async load(): Promise<GraphPayload> {
    // Validated on arrival, with the same validator the seed goes through. A
    // backend that starts returning a malformed payload should fail here, not
    // three layers up in the renderer.
    return validateSeed(await this.request<GraphPayload>('/graph'));
  }

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const result = await this.post<CaptureResult>('/capture', input);
    return { ...result, graph: validateSeed(result.graph) };
  }

  ask(question: string): Promise<AskResult> {
    return this.post<AskResult>('/ask', { question });
  }

  async undo(reorgId: string): Promise<GraphPayload> {
    const { graph } = await this.post<{ graph: GraphPayload }>(
      `/reorgs/${encodeURIComponent(reorgId)}/undo`,
    );
    return validateSeed(graph);
  }

  async moveMemory(memoryId: string, categoryId: string): Promise<GraphPayload> {
    const { graph } = await this.post<{ graph: GraphPayload }>(
      `/memories/${encodeURIComponent(memoryId)}/category`,
      { categoryId },
    );
    return validateSeed(graph);
  }

  async retrySource(sourceId: string): Promise<GraphPayload> {
    const { graph } = await this.post<{ graph: GraphPayload }>(
      `/sources/${encodeURIComponent(sourceId)}/retry`,
    );
    return validateSeed(graph);
  }

  async updateCategory(
    categoryId: string,
    fields: { name?: string; parentId?: string | null },
  ): Promise<GraphPayload> {
    const { graph } = await this.request<{ graph: GraphPayload }>(
      `/categories/${encodeURIComponent(categoryId)}`,
      { method: 'PATCH', body: JSON.stringify(fields) },
    );
    return validateSeed(graph);
  }
}

/**
 * Seed is the default, deliberately.
 *
 * The 60-second demo, the rehearsal harness, and the E2E suite all depend on
 * the app making zero network requests — that property is currently the
 * project's most valuable asset, and defaulting to the API would quietly spend
 * it. `?api=1` opts in.
 */
export function selectDataSource(search = typeof window === 'undefined' ? '' : window.location.search): DataSource {
  const params = new URLSearchParams(search);
  return params.get('api') === '1' ? new ApiDataSource() : SeedDataSource;
}
