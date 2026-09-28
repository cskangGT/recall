import { describe, it, expect } from 'vitest';
import { pageTitle, blockText, readNotionPages } from '../../server/notion/notionPages';

/**
 * The Notion reader's parsing, pinned against real API shapes, and the read
 * loop against an injected fetch — no token, no network, no Notion.
 */

describe('pageTitle', () => {
  it('finds the title property whatever it is called', () => {
    expect(
      pageTitle({
        properties: {
          이름: { type: 'title', title: [{ plain_text: '분기 ' }, { plain_text: '목표' }] },
          Status: { type: 'select' },
        },
      }),
    ).toBe('분기 목표');
    expect(pageTitle({ properties: {} })).toBe('');
  });
});

describe('blockText', () => {
  it('reads rich_text out of any text-bearing block type', () => {
    expect(
      blockText({ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '문단 내용' }] } }),
    ).toBe('문단 내용');
    expect(
      blockText({ type: 'heading_2', heading_2: { rich_text: [{ plain_text: '소제목' }] } }),
    ).toBe('소제목');
    expect(
      blockText({ type: 'to_do', to_do: { rich_text: [{ plain_text: '할 일' }], checked: true } }),
    ).toBe('[x] 할 일');
    expect(blockText({ type: 'divider', divider: {} })).toBe('');
  });
});

describe('readNotionPages', () => {
  const DAY = 864e5;
  const now = Date.now();

  const page = (id: string, title: string, editedMsAgo: number) => ({
    id,
    object: 'page',
    last_edited_time: new Date(now - editedMsAgo).toISOString(),
    url: `https://www.notion.so/${id}`,
    properties: { title: { type: 'title', title: [{ plain_text: title }] } },
  });

  const fakeFetch = (routes: Record<string, unknown>) =>
    (async (url: string) => {
      const path = String(url).replace('https://api.notion.com/v1', '').split('?')[0];
      const body = routes[path!];
      if (!body) return { ok: false, status: 404, text: async () => 'no route', json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    }) as unknown as typeof fetch;

  it('imports recent pages with their block text, drops secrets, skips old pages', async () => {
    const fetchImpl = fakeFetch({
      '/search': {
        results: [page('p1', '회의 메모', 2 * DAY), page('p2', '옛날 페이지', 40 * DAY)],
        has_more: false,
      },
      '/blocks/p1/children': {
        results: [
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: '다음 분기 목표를 정리했다.' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'sk_live_' + 'a'.repeat(24) }] } },
        ],
        has_more: false,
      },
    });

    const result = await readNotionPages('secret_token', 14, fetchImpl);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.title).toBe('회의 메모');
    expect(result.notes[0]!.content).toContain('다음 분기 목표');
    expect(result.notes[0]!.content).not.toContain('sk_live_');
    expect(result.droppedSecretLines).toBe(1);
    // The way back to the original — "safe to clear at the source" needs it.
    expect(result.notes[0]!.url).toBe('https://www.notion.so/p1');
  });

  it('says the honest thing on a bad token', async () => {
    const fetchImpl = (async () => ({
      ok: false, status: 401, text: async () => 'unauthorized', json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(readNotionPages('bad', 14, fetchImpl)).rejects.toThrow('Notion rejected the token');
  });

  it('a page whose blocks cannot be read is skipped, not fatal', async () => {
    const fetchImpl = fakeFetch({
      '/search': { results: [page('p1', '읽힘', DAY), page('p2', '안 읽힘', DAY)], has_more: false },
      '/blocks/p1/children': {
        results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '내용 있음' }] } }],
        has_more: false,
      },
      // p2's blocks route is absent → 404 → skipped
    });
    const result = await readNotionPages('secret_token', 14, fetchImpl);
    expect(result.notes.map((n) => n.title)).toEqual(['읽힘']);
  });
});
