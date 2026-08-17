import { describe, it, expect } from 'vitest';
import {
  parseInstagramZip,
  parseSavedPosts,
  parseCollections,
  decodeMojibake,
} from '../../src/capture/instagramZip';
import { extractClaims } from '../../src/capture/extractLocal';
import { makeZip } from '../helpers/makeZip';

/**
 * The fixtures mirror a real 2026-08 export, byte-quirks included: entries are
 * `{ timestamp, label_values }`, captions are present in full, and non-ASCII
 * arrives as UTF-8 bytes escaped into Latin-1 (mojibake). The older folklore
 * shapes stay covered as degraded-but-not-broken.
 */

/** What the export does to Korean: UTF-8 bytes read back as Latin-1. */
const mojibake = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

const DAY = 86400;
const NEWEST = 1753500000; // 2025-07-26

const realEntry = (opts: {
  timestamp: number;
  url?: string;
  captions?: string[];
}) => ({
  timestamp: opts.timestamp,
  media: [],
  fbid: '1234',
  label_values: [
    ...(opts.url ? [{ label: 'URL', value: opts.url, href: opts.url }] : []),
    ...(opts.captions ?? []).map((c) => ({ label: 'Caption', value: mojibake(c) })),
    { label: 'Title', value: '' }, // always empty in the real export
  ],
});

const SAVED_POSTS = JSON.stringify([
  realEntry({
    timestamp: NEWEST,
    url: 'https://www.instagram.com/p/AAA/',
    captions: ['성수동 맛집 5곳 정리해봤어요.\n\n1. 파스타집 — 웨이팅 있어도 갈 가치'],
  }),
  realEntry({
    timestamp: NEWEST - 5 * DAY,
    url: 'https://www.instagram.com/reel/BBB/',
    // A carousel repeats the caption label; identical parts collapse to one.
    captions: ['러닝 폼 교정 꿀팁', '러닝 폼 교정 꿀팁'],
  }),
  realEntry({
    timestamp: NEWEST - 30 * DAY,
    url: 'https://www.instagram.com/p/CCC/',
    captions: ['한 달 전에 저장한 오래된 게시물'],
  }),
  // No URL at all — counted as unreadable, never imported.
  realEntry({ timestamp: NEWEST - 2 * DAY, captions: ['링크 없는 항목'] }),
]);

const COLLECTIONS = JSON.stringify([
  {
    timestamp: 1,
    label_values: [
      { label: 'Name', value: mojibake('맛집') },
      { label: 'Type', value: 'Default' },
      {
        dict: [
          { dict: [{ label: 'URL', value: 'https://www.instagram.com/p/AAA/', href: 'https://www.instagram.com/p/AAA/' }] },
        ],
      },
    ],
  },
]);

describe('decodeMojibake', () => {
  it('restores Korean from Latin-1-escaped UTF-8 bytes', () => {
    expect(decodeMojibake(mojibake('제 2의 뇌가 대체 뭐길래'))).toBe('제 2의 뇌가 대체 뭐길래');
  });

  it('leaves plain ASCII and real Unicode alone', () => {
    expect(decodeMojibake('just ascii text')).toBe('just ascii text');
    expect(decodeMojibake('이미 제대로 된 한글')).toBe('이미 제대로 된 한글');
  });
});

describe('parseSavedPosts — the real 2026 schema', () => {
  it('reads url, decoded caption, and the entry timestamp', () => {
    const posts = parseSavedPosts(SAVED_POSTS);
    expect(posts).toHaveLength(4);
    expect(posts[0]!.url).toBe('https://www.instagram.com/p/AAA/');
    expect(posts[0]!.caption).toContain('성수동 맛집 5곳');
    expect(posts[0]!.savedAt).toBe(NEWEST * 1000);
  });

  it('collapses a carousel’s repeated caption to one', () => {
    const posts = parseSavedPosts(SAVED_POSTS);
    expect(posts[1]!.caption).toBe('러닝 폼 교정 꿀팁');
  });

  it('still reads the folklore shapes, degraded but not broken', () => {
    const folklore = JSON.stringify({
      saved_saved_media: [
        {
          title: 'someone',
          string_map_data: { 'Saved on': { href: 'https://x.test/1', timestamp: 42 } },
        },
      ],
    });
    const posts = parseSavedPosts(folklore);
    expect(posts[0]!.url).toBe('https://x.test/1');
    expect(posts[0]!.savedAt).toBe(42 * 1000);
    expect(posts[0]!.caption).toBeNull();
  });

  it('rejects invalid JSON with a sayable error', () => {
    expect(() => parseSavedPosts('not json')).toThrow('not valid JSON');
  });
});

describe('parseCollections', () => {
  it('decodes names and maps each post URL to its collection', () => {
    const { byUrl, names } = parseCollections(COLLECTIONS);
    expect(names).toEqual(['맛집']);
    expect(byUrl.get('https://www.instagram.com/p/AAA/')).toBe('맛집');
  });
});

describe('parseInstagramZip', () => {
  const zip = (deflate: boolean) =>
    makeZip([
      ['your_instagram_activity/saved/saved_posts.json', SAVED_POSTS, deflate],
      ['your_instagram_activity/saved/saved_collections.json', COLLECTIONS, deflate],
    ]);

  it('imports the recent window with captions as content', async () => {
    const result = await parseInstagramZip(zip(false));

    // AAA and BBB are within 14 days of the newest save; CCC is 30 days out;
    // the linkless entry is unreadable.
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.older).toBe(1);
    expect(result.unreadable).toBe(1);
    expect(result.collections).toEqual(['맛집']);

    const first = result.items[0]!;
    expect(first.title).toBe('성수동 맛집 5곳 정리해봤어요.');
    expect(first.content).toContain('웨이팅 있어도 갈 가치');
    expect(first.content).toContain('Saved to the "맛집" collection');
    expect(first.content).toContain('https://www.instagram.com/p/AAA/');
  });

  it('reads deflated entries — what a real export actually contains', async () => {
    const result = await parseInstagramZip(zip(true));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.content).toContain('성수동');
  });

  it('produces content the local extractor can mine for claims', async () => {
    const result = await parseInstagramZip(zip(false));
    for (const item of result.items) {
      expect(extractClaims(item.content).length).toBeGreaterThan(0);
    }
  });

  it('says so when the export has no saved posts file', async () => {
    const bare = makeZip([['your_instagram_activity/comments/post_comments.json', '[]']]);
    await expect(parseInstagramZip(bare)).rejects.toThrow('no saved_posts.json');
  });

  it('rejects a non-ZIP file', async () => {
    await expect(parseInstagramZip(new TextEncoder().encode('hello').buffer)).rejects.toThrow(
      'not a ZIP file',
    );
  });
});
