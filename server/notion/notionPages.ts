import { stripSecrets } from '../notes/appleNotes.ts';
import type { NotesReadResult } from '../notes/appleNotes.ts';

/**
 * Notion, through the front door.
 *
 * Unlike Instagram, Notion wants to be read: an official API, real OAuth, and
 * an internal-integration token for the single-workspace case — which is this
 * one, until the hosted deployment gives OAuth a redirect to land on. The
 * user makes an integration once (notion.so/my-integrations), connects it to
 * the pages they want Mado to see, and drops the token in the environment.
 * Only pages the integration was explicitly connected to are visible — the
 * permission model is Notion's own, page by page, and that is a feature.
 *
 * Raw fetch, no SDK — three endpoints do not justify a dependency, and the
 * fixture-tested parsing below is the part that could actually break.
 *
 * Read shape: search pages by last-edited, newest first → flatten each page's
 * blocks to plain text → the same NotesReadResult Apple Notes produces, so
 * the route, the batch path, and the secret filter are shared, not copied.
 */

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** Bounded on purpose: a first fill is a window, not an archive migration. */
const MAX_PAGES = 50;
const MAX_BLOCK_REQUESTS_PER_PAGE = 5;

/** ~3 requests/second is Notion's ceiling; pace block fetches under it. */
const PACE_MS = 250;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type FetchLike = typeof fetch;

async function notionRequest(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: FetchLike = fetch,
): Promise<unknown> {
  const response = await fetchImpl(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'notion-version': NOTION_VERSION,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new Error('Notion rejected the token — check NOTION_TOKEN and try again');
    }
    throw new Error(`Notion answered ${response.status}: ${detail.slice(0, 160)}`);
  }
  return response.json();
}

// ---------------------------------------------------------------- parsing

/** The title property's key varies per database; its `type` does not. */
export function pageTitle(page: unknown): string {
  const properties = (page as { properties?: Record<string, unknown> }).properties ?? {};
  for (const prop of Object.values(properties)) {
    const p = prop as { type?: string; title?: { plain_text?: string }[] };
    if (p.type === 'title' && Array.isArray(p.title)) {
      return p.title.map((t) => t.plain_text ?? '').join('').trim();
    }
  }
  return '';
}

/**
 * One block → one line of plain text. Every text-bearing block type carries a
 * `rich_text` array under its own key; the key is the block's `type`, which is
 * the one honest generalisation the API offers.
 */
export function blockText(block: unknown): string {
  const b = block as { type?: string } & Record<string, unknown>;
  if (!b.type) return '';
  const payload = b[b.type] as { rich_text?: { plain_text?: string }[]; expression?: string } | undefined;
  if (!payload) return '';
  if (Array.isArray(payload.rich_text)) {
    const text = payload.rich_text.map((t) => t.plain_text ?? '').join('');
    if (b.type === 'to_do') {
      const checked = (payload as { checked?: boolean }).checked;
      return text.length > 0 ? `[${checked ? 'x' : ' '}] ${text}` : '';
    }
    return text;
  }
  return '';
}

// ---------------------------------------------------------------- reading

export async function readNotionPages(
  token: string,
  days: number,
  fetchImpl: FetchLike = fetch,
): Promise<NotesReadResult> {
  const cutoff = Date.now() - days * 864e5;

  // Search is already sorted newest-edited first, so pagination can stop the
  // moment a page falls out of the window.
  const pages: { id: string; title: string; modified: Date; url?: string }[] = [];
  let cursor: string | undefined;
  let total = 0;
  while (pages.length < MAX_PAGES) {
    const body: Record<string, unknown> = {
      filter: { property: 'object', value: 'page' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const result = (await notionRequest(token, '/search', { method: 'POST', body }, fetchImpl)) as {
      results?: unknown[];
      has_more?: boolean;
      next_cursor?: string;
    };
    const batch = result.results ?? [];
    total += batch.length;

    let sawOlder = false;
    for (const page of batch) {
      const p = page as { id?: string; last_edited_time?: string; archived?: boolean; url?: string };
      if (!p.id || p.archived) continue;
      const modified = new Date(p.last_edited_time ?? 0);
      if (Number.isFinite(days) && modified.getTime() < cutoff) {
        sawOlder = true;
        break;
      }
      pages.push({ id: p.id, title: pageTitle(page), modified, url: p.url });
      if (pages.length >= MAX_PAGES) break;
    }

    if (sawOlder || !result.has_more || !result.next_cursor) break;
    cursor = result.next_cursor;
    await wait(PACE_MS);
  }

  // Page bodies, paced under the rate ceiling.
  let droppedSecretLines = 0;
  const notes: NotesReadResult['notes'] = [];
  for (const page of pages) {
    await wait(PACE_MS);
    const lines: string[] = [];
    let blockCursor: string | undefined;
    for (let request = 0; request < MAX_BLOCK_REQUESTS_PER_PAGE; request++) {
      const query = blockCursor ? `?page_size=100&start_cursor=${blockCursor}` : '?page_size=100';
      let result: { results?: unknown[]; has_more?: boolean; next_cursor?: string };
      try {
        result = (await notionRequest(token, `/blocks/${page.id}/children${query}`, {}, fetchImpl)) as typeof result;
      } catch {
        break; // an unreadable page is skipped, not fatal — same as a bad note
      }
      for (const block of result.results ?? []) {
        const text = blockText(block);
        if (text.trim().length > 0) lines.push(text);
      }
      if (!result.has_more || !result.next_cursor) break;
      blockCursor = result.next_cursor;
      await wait(PACE_MS);
    }

    const raw = lines.join('\n');
    if (raw.trim().length === 0) continue;
    const { kept, dropped } = stripSecrets(raw);
    droppedSecretLines += dropped;
    if (kept.trim().length === 0) continue;
    notes.push({
      title: page.title || kept.slice(0, 60),
      content: kept.length > 20_000 ? kept.slice(0, 20_000) : kept,
      modified: page.modified,
      // The way back to the original, for the day the user clears it there.
      url: page.url,
    });
  }

  return { notes, droppedSecretLines, total };
}
