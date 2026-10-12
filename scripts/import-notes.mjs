#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
// Lines that look like credentials never leave the machine — the server's own
// filter, which carries the story of why. One list, one place.
import { stripSecrets } from '../server/notes/appleNotes.ts';
import { revealUrl } from './recall-paths.mjs';

/**
 * Apple Notes → Mado.  `npm run import:notes`
 *
 * Apple gives Notes no API, but it does give it AppleScript, and this machine
 * already runs Mado's server — so the shortest honest path from "my notes"
 * to "my map" is: read them locally, post them to the batch endpoint, let the
 * pipeline do what it does to everything else. Nothing leaves the machine
 * except what already leaves it (the extraction calls the server makes).
 *
 * The first run pops macOS's one-time automation consent ("Terminal wants to
 * control Notes") — that is the operating system asking, not this script
 * hiding anything. Decline it and the script says why it got nothing.
 *
 * Flags:
 *   --days=N        modified in the last N days (default 14 — the free window)
 *   --days=all      every note
 *   --port=N        the Mado server port (default 5174, `npm run dev:api`)
 *   --locale=ko|en  category-name language (default ko)
 *   --dry-run       print what would be sent, send nothing
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const DAYS = args.days === 'all' ? Infinity : Number(args.days ?? 14);
const PORT = Number(args.port ?? 5174);
const LOCALE = args.locale === 'en' ? 'en' : 'ko';
const DRY = Boolean(args['dry-run']);
const BATCH_CAP = 100;

/*
 * One AppleScript pass, emitting a unit-separated record per note.
 * `plaintext` spares us parsing the HTML `body`; the separators are control
 * characters no note body can plausibly contain.
 */
const SCRIPT = `
set out to ""
tell application "Notes"
  repeat with n in notes
    set out to out & (name of n) & (ASCII character 31) & (modification date of n as «class isot» as string) & (ASCII character 31) & (plaintext of n) & (ASCII character 30)
  end repeat
end tell
return out
`;

function readNotes() {
  let raw;
  try {
    raw = execFileSync('osascript', ['-e', SCRIPT], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (err) {
    const message = String(err.stderr ?? err.message ?? err);
    if (/not allowed|authoriz|1743/i.test(message)) {
      console.error(
        'macOS declined access to Notes. Allow it under System Settings →\n' +
          'Privacy & Security → Automation → (your terminal) → Notes, then re-run.',
      );
    } else {
      console.error(`Could not read Notes: ${message.trim()}`);
    }
    process.exit(1);
  }

  return raw
    .split('')
    .map((record) => record.split(''))
    .filter((f) => f.length === 3)
    .map(([title, modified, body]) => ({
      title: title.trim(),
      modified: new Date(modified.trim()),
      body: body.trim(),
    }))
    .filter((n) => n.body.length > 0);
}

/** The days the sent notes span — what the declaration calls the stretch it rescued. */
function periodOf(notes) {
  const times = notes.map((n) => n.modified.getTime()).filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  return { from: day(Math.min(...times)), to: day(Math.max(...times)) };
}

async function main() {
  const all = readNotes();
  const cutoff = Date.now() - DAYS * 864e5;
  const recent = all
    .filter((n) => !Number.isFinite(DAYS) || n.modified.getTime() >= cutoff)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());

  console.log(
    `${all.length} notes in Notes.app · ${recent.length} modified in the last ` +
      `${Number.isFinite(DAYS) ? `${DAYS} days` : 'forever'}`,
  );
  if (recent.length === 0) return;
  if (recent.length > BATCH_CAP) {
    console.log(`capping at ${BATCH_CAP} (newest first) — re-run with --days to narrow`);
    recent.length = BATCH_CAP;
  }

  let droppedLines = 0;
  const items = recent
    .map((n) => {
      const { kept, dropped } = stripSecrets(n.body);
      droppedLines += dropped;
      return {
        type: 'text',
        title: n.title || kept.slice(0, 60),
        content: kept.length > 20_000 ? kept.slice(0, 20_000) : kept,
      };
    })
    .filter((item) => item.content.trim().length > 0);
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

  const response = await fetch(`http://127.0.0.1:${PORT}/api/workspaces/ws_demo/capture/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items, locale: LOCALE }),
  }).catch(() => null);

  if (!response) {
    console.error(`No Mado server on port ${PORT} — start one with: npm run dev:api`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`Server answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    process.exit(1);
  }

  const result = await response.json();
  const added = result.results.reduce((n, r) => n + r.addedMemoryIds.length, 0);
  const skipped = result.results.reduce((n, r) => n + r.skipped.length, 0);
  console.log(
    `done: ${items.length} notes → ${added} memories` +
      (skipped > 0 ? ` (${skipped} already held)` : '') +
      (result.reorgs.length > 0 ? ` · ${result.reorgs.length} reorganizations` : ''),
  );
  const period = periodOf(recent);
  console.log(`open ${revealUrl(result.results.map((r) => r.sourceId), period)} to look around`);
}

await main();
