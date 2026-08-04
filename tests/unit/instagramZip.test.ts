import { describe, it, expect } from 'vitest';
import { parseInstagramZip, parseSavedPosts } from '../../src/capture/instagramZip';
import { extractClaims } from '../../src/capture/extractLocal';
import { makeZip } from '../helpers/makeZip';

/**
 * The fixture ZIP is synthetic — Meta documents that the export exists, not
 * its schema, so these tests pin the shapes the parser tolerates. Validating
 * against a real export is a standing task that needs a real account's ZIP.
 */

// ---------------------------------------------------------------- fixtures

/** Epoch seconds. Newest save anchors the window. */
const NEWEST = 1753500000; // 2025-07-26
const DAY = 86400;

const SAVED_POSTS = JSON.stringify({
  saved_saved_media: [
    {
      title: 'chef_maria',
      string_map_data: {
        'Saved on': { href: 'https://www.instagram.com/p/AAA/', timestamp: NEWEST },
      },
    },
    {
      title: 'run_club_nyc',
      // The list-shaped variant other export files use.
      string_list_data: [
        { href: 'https://www.instagram.com/reel/BBB/', timestamp: NEWEST - 5 * DAY },
      ],
    },
    {
      title: 'old_account',
      string_map_data: {
        'Saved on': { href: 'https://www.instagram.com/p/CCC/', timestamp: NEWEST - 30 * DAY },
      },
    },
    {
      // No link at all — counted as unreadable, never imported.
      title: 'deleted_post',
      string_map_data: { 'Saved on': { timestamp: NEWEST - 2 * DAY } },
    },
  ],
});

describe('parseSavedPosts', () => {
  it('reads both the map-shaped and list-shaped entries', () => {
    const posts = parseSavedPosts(SAVED_POSTS);
    expect(posts).toHaveLength(4);
    expect(posts[0]).toEqual({
      author: 'chef_maria',
      url: 'https://www.instagram.com/p/AAA/',
      savedAt: NEWEST * 1000,
    });
    expect(posts[1]!.url).toBe('https://www.instagram.com/reel/BBB/');
  });

  it('tolerates an unknown wrapper key by taking the first array', () => {
    const posts = parseSavedPosts(
      JSON.stringify({
        some_future_key: [
          { title: 'a', string_map_data: { X: { href: 'https://x.test/1', timestamp: 1 } } },
        ],
      }),
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://x.test/1');
  });

  it('rejects invalid JSON with a sayable error', () => {
    expect(() => parseSavedPosts('not json')).toThrow('not valid JSON');
  });
});

describe('parseInstagramZip', () => {
  const zipWith = (deflate: boolean) =>
    makeZip([
      ['your_instagram_activity/saved/saved_posts.json', SAVED_POSTS, deflate],
      ['your_instagram_activity/comments/post_comments.json', '[]', deflate],
    ]);

  it('imports the last two weeks and reports what it left behind', async () => {
    const result = await parseInstagramZip(zipWith(false));

    // chef_maria and run_club_nyc are within 14 days of the newest save;
    // old_account is 30 days out; deleted_post has no link.
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.older).toBe(1);
    expect(result.unreadable).toBe(1);

    expect(result.items[0]!.title).toBe('@chef_maria on Instagram');
    expect(result.items[0]!.content).toContain('https://www.instagram.com/p/AAA/');
    expect(result.items[0]!.content).toContain('2025-07-26');
  });

  it('reads deflated entries — what a real export actually contains', async () => {
    const result = await parseInstagramZip(zipWith(true));
    expect(result.items).toHaveLength(2);
  });

  it('produces content the local extractor accepts as a claim', async () => {
    const result = await parseInstagramZip(zipWith(false));
    for (const item of result.items) {
      expect(extractClaims(item.content)).toHaveLength(1);
    }
  });

  it('says so when the export has no saved posts file', async () => {
    const zip = makeZip([['your_instagram_activity/comments/post_comments.json', '[]']]);
    await expect(parseInstagramZip(zip)).rejects.toThrow('no saved_posts.json');
  });

  it('rejects a non-ZIP file', async () => {
    await expect(parseInstagramZip(new TextEncoder().encode('hello').buffer)).rejects.toThrow(
      'not a ZIP file',
    );
  });
});
