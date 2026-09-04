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
  /** The day a diary entry belongs to (YYYY-MM-DD). Diary captures only. */
  diaryDate?: string;
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

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  excerpt: string | null;
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
  /** Reads a pasted link's title and excerpt so the person can decide to keep it. */
  previewLink?(url: string): Promise<LinkPreview>;
  /** Reads Notion pages — present when the server holds a token. */
  importNotionPages?(days?: number): Promise<NotesImportResult>;
  ask?(question: string, history?: AskTurn[]): Promise<AskResult>;
  /** The diary's look back over [from, to] — the memory's own voice, longer form. */
  diaryRetro?(from: string, to: string): Promise<{ reflection: string; days: number }>;
  /**
   * `ask`, with the answer text arriving as it is generated. `onDelta` gets
   * each new run of text; the resolved result is exactly what `ask` would
   * have returned, and callers treat the deltas as a draft it supersedes.
   */
  askStream?(
    question: string,
    onDelta: (text: string) => void,
    history?: AskTurn[],
  ): Promise<AskResult>;
  /**
   * The AI's half of a user-driven merge: why these memories overlap and the
   * one text that would hold everything. Writes nothing — the user decides.
   */
  mergePreview?(memoryIds: string[]): Promise<{ reason: string; merged_text: string }>;
  /** Applies a merge the user confirmed, with the exact text they approved. */
  mergeMemories?(
    memoryIds: string[],
    mergedText: string,
  ): Promise<{ mergedMemoryId: string; graph: GraphPayload }>;
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
  /**
   * Applies one source's review verdicts atomically — unlisted memories are
   * kept. The server records every verdict as the curation signal (spec §21).
   */
  reviewSource?(
    sourceId: string,
    input: { discard: string[]; edits: { memoryId: string; text: string }[] },
  ): Promise<GraphPayload>;
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

const INVITE_KEY = 'mado.invite';

/**
 * The invite token, resolved once per load: a `?invite=` in the link wins and
 * is remembered, so a tester clicks one link once and every later visit still
 * writes. Pure over its inputs for the tests; the wrapper below feeds it the
 * real location and storage.
 */
export function resolveInvite(
  search: string,
  stored: string | null,
  remember: (token: string) => void = () => {},
): string | null {
  const fromLink = new URLSearchParams(search).get('invite');
  if (fromLink && fromLink.trim().length > 0) {
    remember(fromLink);
    return fromLink;
  }
  return stored;
}

function currentInvite(): string | null {
  if (typeof window === 'undefined') return null;
  return resolveInvite(
    window.location.search,
    localStorage.getItem(INVITE_KEY),
    (token) => localStorage.setItem(INVITE_KEY, token),
  );
}

export class ApiDataSource implements DataSource {
  readonly mode = 'api' as const;

  /**
   * `workspaceId` fixed (dev's `?api=1` keeps everyone on ws_demo, where the
   * local server's corpus lives) or absent — the hosted case, where each
   * visitor gets their own workspace: minted once via POST /workspaces,
   * remembered in localStorage, and shared by every later visit. Without
   * this, the first tester who deleted something would delete it for all.
   */
  private wsPromise: Promise<string> | null = null;

  constructor(
    private readonly workspaceId?: string,
    private readonly base = '/api',
  ) {}

  private ensureWorkspace(): Promise<string> {
    if (this.workspaceId) return Promise.resolve(this.workspaceId);
    this.wsPromise ??= (async () => {
      const stored = localStorage.getItem('mado.workspace');
      if (stored) return stored;
      const invite = currentInvite();
      // The locale rides along so the starter corpus arrives in the visitor's
      // language — the Korean seed is a different authored workspace, not a
      // translation.
      const response = await fetch(`${this.base}/workspaces`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(invite ? { 'x-recall-invite': invite } : {}),
        },
        body: JSON.stringify({ locale: currentLocale() }),
      });
      const body = (await response.json()) as { workspaceId?: string; error?: string };
      if (!response.ok || !body.workspaceId) {
        // Do not cache a failure — the next request should try again.
        this.wsPromise = null;
        throw new HttpError(response.status, body.error ?? 'could not create a workspace');
      }
      localStorage.setItem('mado.workspace', body.workspaceId);
      return body.workspaceId;
    })();
    return this.wsPromise;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    // The invite rides on every request as a header — never a query parameter,
    // which would leak it into access logs and shared links (routes.ts says
    // the same from the server's side).
    const invite = currentInvite();
    const workspace = await this.ensureWorkspace();
    const response = await fetch(`${this.base}/workspaces/${workspace}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(invite ? { 'x-recall-invite': invite } : {}),
      },
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
    const [graph] = await Promise.all([this.request<GraphPayload>('/graph'), this.probe()]);
    return validateSeed(graph);
  }

  /**
   * Asks the server which import doors it can open, once, before the first
   * paint that could draw them. Doors default to open: only a server that
   * answers "no" closes one, so a failed probe never hides a working door.
   */
  private probed = false;

  private async probe(): Promise<void> {
    if (this.probed) return;
    this.probed = true;
    try {
      const response = await fetch(`${this.base}/capabilities`);
      if (!response.ok) return;
      const caps = (await response.json()) as { appleNotes?: boolean; notion?: boolean };
      if (!caps.appleNotes) this.importAppleNotes = undefined;
      if (!caps.notion) this.importNotionPages = undefined;
    } catch {
      // Leave the doors as they are.
    }
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

  previewLink?: (url: string) => Promise<LinkPreview> = (url) =>
    this.post<LinkPreview>('/link/preview', { url });

  importAppleNotes?: (days?: number) => Promise<NotesImportResult> = async (days = 14) => {
    const result = await this.post<NotesImportResult>('/import/apple-notes', {
      days,
      locale: currentLocale(),
    });
    return { ...result, graph: validateSeed(result.graph) };
  };

  importNotionPages?: (days?: number) => Promise<NotesImportResult> = async (days = 14) => {
    const result = await this.post<NotesImportResult>('/import/notion', {
      days,
      locale: currentLocale(),
    });
    return { ...result, graph: validateSeed(result.graph) };
  };

  upgrade(returnUrl: string): Promise<{ url: string }> {
    return this.post<{ url: string }>('/billing/checkout', { returnUrl });
  }

  ask(question: string, history?: AskTurn[]): Promise<AskResult> {
    return this.post<AskResult>('/ask', { question, history });
  }

  async askStream(
    question: string,
    onDelta: (text: string) => void,
    history?: AskTurn[],
  ): Promise<AskResult> {
    const invite = currentInvite();
    const workspace = await this.ensureWorkspace();
    const response = await fetch(`${this.base}/workspaces/${workspace}/ask/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(invite ? { 'x-recall-invite': invite } : {}),
      },
      body: JSON.stringify({ question, history }),
    });
    if (!response.ok || !response.body) {
      throw new HttpError(response.status, `stream failed (${response.status})`);
    }

    // SSE frames: `event: X\ndata: {...}\n\n`, possibly split across chunks —
    // only complete double-newline-terminated frames are consumed.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: AskResult | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (!event || !data) continue;
        if (event === 'delta') onDelta((JSON.parse(data) as { text: string }).text);
        else if (event === 'done') result = JSON.parse(data) as AskResult;
        else if (event === 'error') {
          throw new HttpError(502, (JSON.parse(data) as { error: string }).error);
        }
      }
    }
    if (!result) throw new HttpError(502, 'stream ended without a result');
    return result;
  }

  diaryRetro(from: string, to: string): Promise<{ reflection: string; days: number }> {
    return this.post<{ reflection: string; days: number }>('/diary/retro', {
      from,
      to,
      locale: currentLocale(),
    });
  }

  mergePreview(memoryIds: string[]): Promise<{ reason: string; merged_text: string }> {
    return this.post<{ reason: string; merged_text: string }>('/memories/merge-preview', {
      memoryIds,
      locale: currentLocale(),
    });
  }

  async mergeMemories(
    memoryIds: string[],
    mergedText: string,
  ): Promise<{ mergedMemoryId: string; graph: GraphPayload }> {
    const result = await this.post<{ mergedMemoryId: string; graph: GraphPayload }>(
      '/memories/merge',
      { memoryIds, mergedText },
    );
    return { ...result, graph: validateSeed(result.graph) };
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

  async reviewSource(
    sourceId: string,
    input: { discard: string[]; edits: { memoryId: string; text: string }[] },
  ): Promise<GraphPayload> {
    const { graph } = await this.post<{ graph: GraphPayload }>(
      `/sources/${encodeURIComponent(sourceId)}/review`,
      input,
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
  // `?api=1` is the developer's door and keeps everyone on the local server's
  // one corpus; a build shipped with a server gives each visitor their own.
  if (params.get('api') === '1') return new ApiDataSource('ws_demo');
  const builtForApi = (import.meta.env ?? {}).VITE_API_DEFAULT === '1';
  return builtForApi ? new ApiDataSource() : SeedDataSource;
}
