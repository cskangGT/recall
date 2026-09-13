import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  canonicalUrl,
  validatePosts,
  toItem,
  uniqueTitles,
  chunk,
  periodOf,
  loadSeen,
  saveSeen,
} from '../../scripts/import-instagram.mjs';

/**
 * The Instagram importer's pure half: a JSON file the browsing skill wrote →
 * batch items the server ingests, with the same shape the ZIP path produces
 * (src/capture/instagramZip.ts) so a memory reads the same whichever door it
 * came through.
 */
const post = {
  url: 'https://www.instagram.com/p/ABC123/',
  author: 'cafe_owner',
  caption: '새로 문 연 카페 ☕\n주차는 뒷골목',
  postedAt: '2026-09-01T10:00:00.000Z',
  description: 'A photo of a bright corner café with a chalkboard menu listing three pour-overs.',
};

describe('canonicalUrl', () => {
  it('drops tracking and fragments, keeps the post', () => {
    expect(canonicalUrl('https://www.instagram.com/p/ABC123/?igsh=xyz#top')).toBe(
      'https://www.instagram.com/p/ABC123/',
    );
    expect(canonicalUrl('https://instagram.com/reel/XYZ')).toBe('https://www.instagram.com/reel/XYZ/');
  });
});

describe('validatePosts', () => {
  it('derives the code and the kind from the url', () => {
    const { posts } = validatePosts([post, { ...post, url: 'https://www.instagram.com/reel/R1/' }]);
    expect(posts[0]).toMatchObject({ code: 'ABC123', kind: 'post', author: 'cafe_owner' });
    expect(posts[1]).toMatchObject({ code: 'R1', kind: 'reel' });
  });

  it('strips a leading @ from the author', () => {
    expect(validatePosts([{ ...post, author: '@cafe_owner' }]).posts[0]!.author).toBe('cafe_owner');
  });

  it('drops a row with nothing to say, and says why', () => {
    const { posts, dropped } = validatePosts([
      post,
      { url: 'https://www.instagram.com/p/EMPTY/', author: 'x', caption: null, description: '' },
      { url: 'not a url', author: 'x', caption: 'hi', description: 'hi' },
    ]);
    expect(posts).toHaveLength(1);
    expect(dropped).toEqual([
      { index: 1, reason: 'no text' },
      { index: 2, reason: 'not an instagram post url' },
    ]);
  });

  it('refuses anything but an array', () => {
    expect(() => validatePosts({ url: 'x' })).toThrow(/array/);
  });
});

describe('toItem', () => {
  const [p] = validatePosts([post]).posts;

  it('titles the memory by author and first caption line, within 60 characters', () => {
    const { item } = toItem(p!);
    expect(item.title).toBe('@cafe_owner · 새로 문 연 카페 ☕');
    const long = validatePosts([{ ...post, caption: 'x'.repeat(200) }]).posts[0]!;
    expect(toItem(long).item.title.length).toBeLessThanOrEqual(60);
  });

  it('cuts a long title at a word, not through one', () => {
    const wordy = validatePosts([
      { ...post, caption: 'The quick brown fox jumps over the lazy dog and keeps on running' },
    ]).posts[0]!;
    expect(toItem(wordy).item.title).toBe('@cafe_owner · The quick brown fox jumps over the lazy dog');
  });

  it('a caption that is only an emoji or a pointer is no title — the description is', () => {
    const arrow = validatePosts([{ ...post, caption: '👇' }]).posts[0]!;
    expect(toItem(arrow).item.title).toBe('@cafe_owner · A photo of a bright corner café with a');
    const dots = validatePosts([{ ...post, caption: '...\n👇👇' }]).posts[0]!;
    expect(toItem(dots).item.title).toBe('@cafe_owner · A photo of a bright corner café with a');
  });

  it('falls back to the description when there is no caption', () => {
    const p2 = validatePosts([{ ...post, caption: null }]).posts[0]!;
    expect(toItem(p2).item.title).toBe('@cafe_owner · A photo of a bright corner café with a');
  });

  it('lays the content out description first, link last, like the ZIP path', () => {
    const { item } = toItem({ ...p!, collection: '맛집' });
    expect(item.content.split('\n\n')).toEqual([
      post.description,
      'Instagram post by @cafe_owner, posted 2026-09-01.',
      post.caption,
      'Saved to the "맛집" collection on Instagram.',
      'https://www.instagram.com/p/ABC123/',
    ]);
    expect(item.type).toBe('text');
    expect(item.url).toBe('https://www.instagram.com/p/ABC123/');
  });

  it('leaves out what it does not know', () => {
    const bare = validatePosts([{ ...post, caption: null, postedAt: null }]).posts[0]!;
    expect(toItem(bare).item.content.split('\n\n')).toEqual([
      post.description,
      'Instagram post by @cafe_owner.',
      'https://www.instagram.com/p/ABC123/',
    ]);
  });

  it('drops credential-shaped lines and counts them', () => {
    const leaky = validatePosts([{ ...post, caption: 'wifi\npassword: hunter2\nenjoy' }]).posts[0]!;
    const { item, droppedLines } = toItem(leaky);
    expect(droppedLines).toBe(1);
    expect(item.content).not.toContain('hunter2');
    expect(item.content).toContain('wifi\nenjoy');
  });
});

describe('uniqueTitles', () => {
  it('suffixes the code only where titles collide', () => {
    const items = uniqueTitles([
      { title: '@a · same', code: 'ONE' },
      { title: '@a · same', code: 'TWO' },
      { title: '@a · other', code: 'THREE' },
    ]);
    expect(items.map((i) => i.title)).toEqual(['@a · same · ONE', '@a · same · TWO', '@a · other']);
  });
});

describe('chunk', () => {
  it('splits into batches the server accepts', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i), 100).map((c) => c.length)).toEqual([
      100, 100, 50,
    ]);
    expect(chunk([], 100)).toEqual([]);
  });
});

describe('periodOf', () => {
  it('spans the posted dates', () => {
    const posts = validatePosts([
      post,
      { ...post, url: 'https://www.instagram.com/p/B/', postedAt: '2026-08-20T00:00:00Z' },
      { ...post, url: 'https://www.instagram.com/p/C/', postedAt: null },
    ]).posts;
    expect(periodOf(posts)).toEqual({ from: '2026-08-20', to: '2026-09-01' });
    expect(periodOf([posts[2]!])).toBeNull();
  });
});

describe('seen-set', () => {
  it('round-trips, and a missing file is an empty set', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mado-seen-'));
    const file = path.join(dir, 'nested', 'instagram-seen.json');
    expect(loadSeen(file)).toEqual({ version: 1, posts: {} });
    const seen = {
      version: 1,
      posts: {
        'https://www.instagram.com/p/ABC123/': {
          sourceId: 'src_1',
          workspace: 'ws_demo',
          importedAt: '2026-09-12T00:00:00.000Z',
        },
      },
    };
    saveSeen(file, seen);
    expect(existsSync(file)).toBe(true);
    expect(loadSeen(file)).toEqual(seen);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(seen);
  });

  it('a corrupt file is reported, not silently emptied', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mado-seen-'));
    const file = path.join(dir, 'instagram-seen.json');
    writeFileSync(file, '{not json');
    expect(() => loadSeen(file)).toThrow(/instagram-seen\.json/);
  });
});
