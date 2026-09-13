#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Lines that look like credentials never leave the machine — the server's own
// filter, which carries the story of why. One list, one place.
import { stripSecrets } from '../server/notes/appleNotes.ts';
import { INSTAGRAM_SEEN, revealUrl } from './recall-paths.mjs';

/**
 * Instagram saves → Mado.  `npm run import:instagram -- --file=posts.json`
 *
 * Instagram has no API for what you saved, and its export carries captions
 * only — "👇 link in bio" tells nobody what the post was. So the reading is
 * done by an agent in your own logged-in browser (the import-instagram skill),
 * which opens each saved post, looks at it, and writes a few sentences about
 * what it shows. That JSON is this script's input; the pipeline does the rest,
 * as it does to everything else.
 *
 * The ZIP path (src/capture/instagramZip.ts) lays a memory out the same way —
 * caption, collection line, link last. Keep the two in step: a memory should
 * read the same whichever door it came through.
 *
 * Input: a JSON array of
 *   { url, author, caption?, postedAt?, description, collection?, kind? }
 * `code` and `kind` come from the url; `description` is the agent's account
 * of the post; either it or the caption must be present.
 *
 * Flags:
 *   --file=<path>        the JSON the skill wrote (required)
 *   --port=N             the Mado server port (default 5174, `npm run dev:api`)
 *   --server=<origin>    a server elsewhere (default http://127.0.0.1:<port>)
 *   --app=<origin>       where the app is served, for the link (default http://localhost:5173)
 *   --workspace=<id>     the workspace to write into (default ws_demo)
 *   --invite=<token>     the x-recall-invite header, when the server demands one
 *   --locale=ko|en       category-name language (default ko)
 *   --max=N              send at most N posts (newest in the file first)
 *   --force              send posts the seen-set already holds
 *   --list-seen          print the urls already imported, one per line, and exit
 *   --dry-run            print what would be sent, send nothing
 */

const BATCH_CAP = 100;
const TITLE_MAX = 60;
const CONTENT_MAX = 20_000;

const POST_URL = /^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|reels)\/([A-Za-z0-9_-]+)\/?/;

/** One address per post — no tracking query, no fragment, one host, one slash. */
export function canonicalUrl(url) {
  const m = POST_URL.exec(String(url ?? '').trim());
  if (!m) return null;
  const kind = m[1] === 'p' ? 'p' : 'reel';
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

/**
 * The file, checked row by row. A bad row is dropped with its reason and the
 * run goes on — one malformed post should not cost the other forty.
 */
export function validatePosts(json) {
  if (!Array.isArray(json)) throw new Error('the file must hold a JSON array of posts');
  const posts = [];
  const dropped = [];
  json.forEach((row, index) => {
    const url = row && typeof row === 'object' ? canonicalUrl(row.url) : null;
    if (!url) {
      dropped.push({ index, reason: 'not an instagram post url' });
      return;
    }
    const caption = typeof row.caption === 'string' && row.caption.trim() ? row.caption.trim() : null;
    const description =
      typeof row.description === 'string' && row.description.trim() ? row.description.trim() : null;
    if (!caption && !description) {
      dropped.push({ index, reason: 'no text' });
      return;
    }
    const postedAt =
      typeof row.postedAt === 'string' && Number.isFinite(Date.parse(row.postedAt))
        ? new Date(row.postedAt).toISOString()
        : null;
    const m = POST_URL.exec(url);
    posts.push({
      url,
      code: m[2],
      kind: m[1] === 'p' ? 'post' : 'reel',
      author: String(row.author ?? '').trim().replace(/^@/, ''),
      caption,
      postedAt,
      description,
      collection:
        typeof row.collection === 'string' && row.collection.trim() ? row.collection.trim() : null,
    });
  });
  return { posts, dropped };
}

/**
 * One post → one batch item, laid out the way the ZIP path lays out its own
 * (src/capture/instagramZip.ts): the agent's account first — it is the richest
 * signal the extractor gets — then provenance, the caption, the collection
 * line, and the link last so the source keeps its way back.
 */
/** Within the limit, and at a word when the cut would fall through one. */
function trimTitle(full) {
  if (full.length <= TITLE_MAX) return full.trim();
  const cut = full.slice(0, TITLE_MAX);
  const atWord = /\s/.test(full[TITLE_MAX]) ? cut : cut.slice(0, cut.lastIndexOf(' '));
  return (atWord.length > TITLE_MAX / 2 ? atWord : cut).trim();
}

export function toItem(post) {
  let droppedLines = 0;
  const clean = (text) => {
    if (!text) return null;
    const { kept, dropped } = stripSecrets(text);
    droppedLines += dropped;
    return kept.trim() || null;
  };
  const description = clean(post.description);
  const caption = clean(post.caption);

  const by = post.author ? ` by @${post.author}` : '';
  const when = post.postedAt ? `, posted ${post.postedAt.slice(0, 10)}` : '';
  const lines = [
    description,
    `Instagram ${post.kind}${by}${when}.`,
    caption,
    post.collection ? `Saved to the "${post.collection}" collection on Instagram.` : null,
    post.url,
  ].filter((l) => l !== null);

  const opener =
    (caption ?? '').split('\n')[0]?.trim() ||
    (description ?? '').split(/(?<=[.!?。])\s/)[0]?.trim() ||
    post.code;
  const who = post.author ? `@${post.author}` : `Instagram ${post.kind}`;
  const title = trimTitle(`${who} · ${opener}`);

  const content = lines.join('\n\n');
  return {
    item: {
      type: 'text',
      title,
      content: content.length > CONTENT_MAX ? content.slice(0, CONTENT_MAX) : content,
      url: post.url,
    },
    droppedLines,
  };
}

/**
 * The reading list shows a source's title once per source; ten captionless
 * posts by one author would read as one. Colliding titles get the post code —
 * only the colliding ones, so the common case stays clean.
 */
export function uniqueTitles(items) {
  const count = new Map();
  for (const i of items) count.set(i.title, (count.get(i.title) ?? 0) + 1);
  return items.map((i) => (count.get(i.title) > 1 ? { ...i, title: `${i.title} · ${i.code}` } : i));
}

export function chunk(arr, size = BATCH_CAP) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** The days the posts span — what the declaration calls the stretch it rescued. */
export function periodOf(posts) {
  const times = posts.map((p) => (p.postedAt ? Date.parse(p.postedAt) : NaN)).filter(Number.isFinite);
  if (times.length === 0) return null;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  return { from: day(Math.min(...times)), to: day(Math.max(...times)) };
}

// ------------------------------------------------------------------ seen-set

export function loadSeen(file = INSTAGRAM_SEEN) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { version: 1, posts: {} };
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.posts !== 'object') throw new Error();
    return { version: 1, posts: parsed.posts ?? {} };
  } catch {
    throw new Error(
      `${path.basename(file)} is not readable — move it aside to start over (${file})`,
    );
  }
}

/** Written whole, then renamed into place: a crash mid-write leaves the old file, not half a new one. */
export function saveSeen(file, seen) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(seen, null, 2)}\n`);
  renameSync(tmp, file);
}

// ---------------------------------------------------------------------- main

function parseArgs(argv) {
  return Object.fromEntries(
    argv.map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    }),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const PORT = Number(args.port ?? 5174);
  const SERVER = String(args.server ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
  const APP = String(args.app ?? 'http://localhost:5173').replace(/\/$/, '');
  const WORKSPACE = String(args.workspace ?? 'ws_demo');
  const INVITE = typeof args.invite === 'string' ? args.invite : null;
  const LOCALE = args.locale === 'en' ? 'en' : 'ko';
  const MAX = args.max ? Number(args.max) : Infinity;
  const DRY = Boolean(args['dry-run']);
  const FORCE = Boolean(args.force);

  const seen = loadSeen();
  if (args['list-seen']) {
    for (const url of Object.keys(seen.posts)) console.log(url);
    return;
  }

  if (typeof args.file !== 'string') {
    console.error('usage: npm run import:instagram -- --file=<posts.json> [--dry-run]');
    process.exit(2);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(args.file, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${args.file}: ${err.message}`);
    process.exit(1);
  }

  const { posts: all, dropped } = validatePosts(json);
  const fresh = FORCE ? all : all.filter((p) => !(p.url in seen.posts));
  const posts = fresh.slice(0, Number.isFinite(MAX) ? MAX : fresh.length);
  console.log(
    `${json.length} posts in file` +
      (dropped.length > 0 ? ` · ${dropped.length} dropped (${dropped.map((d) => d.reason).join(', ')})` : '') +
      (all.length - fresh.length > 0 ? ` · ${all.length - fresh.length} already imported` : '') +
      (fresh.length - posts.length > 0 ? ` · ${fresh.length - posts.length} held back by --max` : '') +
      ` · ${posts.length} to send`,
  );
  if (posts.length === 0) return;

  let droppedLines = 0;
  const items = uniqueTitles(
    posts.map((p) => {
      const { item, droppedLines: n } = toItem(p);
      droppedLines += n;
      return { ...item, code: p.code };
    }),
  ).map(({ code, ...item }) => item);
  if (droppedLines > 0) {
    console.log(
      `${droppedLines} line(s) looked like credentials and were NOT sent anywhere — ` +
        'secrets belong in a password manager, not a memory.',
    );
  }

  if (DRY) {
    for (const item of items) console.log(`- ${item.title} (${item.content.length} chars)`);
    return;
  }

  const sourceIds = [];
  let added = 0;
  let skipped = 0;
  let reorgs = 0;
  const batches = chunk(items);
  for (const [i, batch] of batches.entries()) {
    const response = await fetch(`${SERVER}/api/workspaces/${WORKSPACE}/capture/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(INVITE ? { 'x-recall-invite': INVITE } : {}),
      },
      body: JSON.stringify({ items: batch, locale: LOCALE, includeGraph: false }),
    }).catch(() => null);

    if (!response) {
      console.error(`No Mado server at ${SERVER} — start one with: npm run dev:api`);
      process.exit(1);
    }
    if (!response.ok) {
      console.error(`Server answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
      process.exit(1);
    }
    const result = await response.json();
    const batchAdded = result.results.reduce((n, r) => n + r.addedMemoryIds.length, 0);
    const batchSkipped = result.results.reduce((n, r) => n + r.skipped.length, 0);
    added += batchAdded;
    skipped += batchSkipped;
    reorgs += result.reorgs.length;

    // Results come back in item order; what landed is remembered before the
    // next batch goes out, so a failure later still leaves this one behind.
    const offset = i * BATCH_CAP;
    result.results.forEach((r, j) => {
      const post = posts[offset + j];
      if (!post || r.status === 'failed') return;
      sourceIds.push(r.sourceId);
      seen.posts[post.url] = {
        sourceId: r.sourceId,
        workspace: WORKSPACE,
        importedAt: new Date().toISOString(),
      };
    });
    saveSeen(INSTAGRAM_SEEN, seen);

    console.log(
      `batch ${i + 1}/${batches.length}: ${batch.length} posts → ${batchAdded} memories` +
        (batchSkipped > 0 ? ` (${batchSkipped} already held)` : '') +
        (result.reorgs.length > 0 ? ` · ${result.reorgs.length} reorganization${result.reorgs.length > 1 ? 's' : ''}` : ''),
    );
  }

  console.log(
    `done: ${posts.length} posts → ${added} memories` +
      (skipped > 0 ? ` (${skipped} already held)` : '') +
      (reorgs > 0 ? ` · ${reorgs} reorganizations` : ''),
  );
  if (sourceIds.length > 0) {
    console.log(`open ${revealUrl(sourceIds, periodOf(posts), APP)} to look around`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
