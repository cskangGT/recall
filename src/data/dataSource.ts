import type { GraphPayload } from '../core/types';
import { currentLocale } from '../i18n';
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
  /** What to call the source. The extension has the page's own <title>. */
  title?: string;
  url?: string;
  imagePath?: string;
  referencedUrls?: string[];
}

export interface CaptureResult {
  addedMemoryIds: string[];
  /** Extracted memories the corpus already held, so they were not written. */
  skipped?: { text: string; similarity: number }[];
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

export interface CaptureBatchResult {
  /** One per item, in item order. */
  results: {
    sourceId: string;
    status: string;
    addedMemoryIds: string[];
    touchedCategoryIds: string[];
    skipped: { text: string; similarity: number }[];
    note?: string;
  }[];
  /** Every structural operation the batch settled into, oldest first. */
  reorgs: NonNullable<CaptureResult['reorg']>[];
  graph: GraphPayload;
}

export interface NotesImportResult extends CaptureBatchResult {
  notes: { total: number; imported: number; droppedSecretLines: number };
}

export interface AskResult {
  answer: string;
  citations: { n: number; memory_id: string; source_id: string }[];
  highlighted_node_ids: string[];
  refused: boolean;
}

/** One prior exchange, for follow-up questions. Oldest first. */
export interface AskTurn {
  question: string;
  answer: string;
}

export interface DataSource {
  readonly mode: 'seed' | 'api';
  load(): Promise<GraphPayload>;
  /** Only implemented in API mode; seed mode drives capture through the store. */
  capture?(input: CaptureInput): Promise<CaptureResult>;
  /** Many items, one reorganization — the server half of the bulk-drop reveal. */
  captureBatch?(items: CaptureInput[]): Promise<CaptureBatchResult>;
  /** Reads the Mac's Notes.app — only a local darwin server can. */
  importAppleNotes?(days?: number): Promise<NotesImportResult>;
  /** Reads Notion pages — present when the server holds a token. */
  importNotionPages?(days?: number): Promise<NotesImportResult>;
  ask?(question: string, history?: AskTurn[]): Promise<AskResult>;
  undo?(reorgId: string): Promise<GraphPayload>;
  moveMemory?(memoryId: string, categoryId: string): Promise<GraphPayload>;
  /** Removes a memory. Not reversible — see Repository.deleteMemory. */
  deleteMemory?(memoryId: string): Promise<GraphPayload>;
  updateCategory?(
    categoryId: string,
    fields: { name?: string; parentId?: string | null },
  ): Promise<GraphPayload>;
  /** Re-runs a capture whose processing failed. Only the API can do this. */
  retrySource?(sourceId: string): Promise<GraphPayload>;
  setAutoReorganize?(enabled: boolean): Promise<GraphPayload>;
  /**
   * Starts a Pro checkout and returns the Stripe-hosted URL to redirect to.
   * The plan flips when the server's webhook confirms payment, never client-side.
   */
  upgrade?(returnUrl: string): Promise<{ url: string }>;
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
    // The locale rides along so category names arrive in the viewer's
    // language — a name is UI, and the server has no other way to know.
    const result = await this.post<CaptureResult>('/capture', { ...input, locale: currentLocale() });
    return { ...result, graph: validateSeed(result.graph) };
  }

  async captureBatch(items: CaptureInput[]): Promise<CaptureBatchResult> {
    const result = await this.post<CaptureBatchResult>('/capture/batch', {
      items,
      locale: currentLocale(),
    });
    return { ...result, graph: validateSeed(result.graph) };
  }

  async importAppleNotes(days = 14): Promise<NotesImportResult> {
    const result = await this.post<NotesImportResult>('/import/apple-notes', {
      days,
      locale: currentLocale(),
    });
    return { ...result, graph: validateSeed(result.graph) };
  }

  async importNotionPages(days = 14): Promise<NotesImportResult> {
    const result = await this.post<NotesImportResult>('/import/notion', {
      days,
      locale: currentLocale(),
    });
    return { ...result, graph: validateSeed(result.graph) };
  }

  upgrade(returnUrl: string): Promise<{ url: string }> {
    return this.post<{ url: string }>('/billing/checkout', { returnUrl });
  }

  ask(question: string, history?: AskTurn[]): Promise<AskResult> {
    return this.post<AskResult>('/ask', { question, history });
  }

  async undo(reorgId: string): Promise<GraphPayload> {
    const { graph } = await this.post<{ graph: GraphPayload }>(
      `/reorgs/${encodeURIComponent(reorgId)}/undo`,
    );
    return validateSeed(graph);
  }

  async deleteMemory(memoryId: string): Promise<GraphPayload> {
    const { graph } = await this.request<{ graph: GraphPayload }>(
      `/memories/${encodeURIComponent(memoryId)}`,
      { method: 'DELETE' },
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

  async setAutoReorganize(enabled: boolean): Promise<GraphPayload> {
    const { graph } = await this.request<{ graph: GraphPayload }>('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ autoReorganize: enabled }),
    });
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
/**
 * `?offline=1` wins over `?api=1`.
 *
 * Spec 15.4 promises the demo survives a venue whose network has failed. Seed
 * mode already is that — everything runs in the page against committed data at
 * the real latencies — so offline is not a separate implementation, it is a
 * refusal to reach for the server. Checked first precisely because the flag is
 * reached for in a panic, and a flag that loses an argument to another flag is
 * worse than no flag.
 */
export function isOffline(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('offline') === '1';
}

/**
 * Where the corpus comes from.
 *
 * The polarity used to be the wrong way round: the seed fixture was the default
 * and the real backend was behind `?api=1`, so a deployment that forgot the
 * flag served 47 hard-coded memories and looked entirely functional. A demo
 * that is convincingly wrong is worse than one that is obviously broken.
 *
 * `VITE_API_DEFAULT` is set at build time by the image that ships with a
 * server. Local development and the test suite build without it and keep the
 * fixture, which is what they want — and `?api=1` still forces it on for
 * checking a local server against the dev build.
 */
export function selectDataSource(search = typeof window === 'undefined' ? '' : window.location.search): DataSource {
  if (isOffline(search)) return SeedDataSource;
  const params = new URLSearchParams(search);
  if (params.get('api') === '1') return new ApiDataSource();
  const builtForApi = (import.meta.env ?? {}).VITE_API_DEFAULT === '1';
  return builtForApi ? new ApiDataSource() : SeedDataSource;
}
