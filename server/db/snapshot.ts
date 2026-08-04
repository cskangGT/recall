import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Timestamped copies of the corpus, taken while it is running.
 *
 * `~/.recall/recall.db` became permanent the moment a launchd agent started
 * owning it, and nothing protected it. The README says so plainly — *"Nothing
 * backs that file up: copying it somewhere is how you keep it"* — which is an
 * honest sentence about a tool you open on purpose and an alarming one about a
 * tool that has been quietly accumulating your notes since login.
 *
 * **`VACUUM INTO`, not `cp`.** Copying a live SQLite file is a way to get a
 * corrupt one: in WAL mode the committed state is spread across the database
 * and its write-ahead log, and a plain copy catches them at different moments.
 * `VACUUM INTO` is SQLite's own answer — it takes a consistent snapshot from
 * inside a read transaction, and compacts it on the way out, so the copy is
 * both correct and smaller than the original.
 *
 * It refuses to write over an existing file, which is why the name carries the
 * timestamp rather than being rotated in place. That refusal is a feature: a
 * backup that can be silently overwritten by the next one is one bug away from
 * being no backup at all.
 */

/** How many to keep. A week of daily snapshots, which is the horizon in which
 * you notice you have lost something. */
export const KEEP = 7;

/** Snapshots older than this trigger a new one. */
export const INTERVAL_MS = 24 * 60 * 60 * 1000;

const PREFIX = 'recall-';
const SUFFIX = '.db';

/** `recall-2026-08-04T091500.db` — sorts chronologically as a string. */
export function snapshotName(at: Date): string {
  return `${PREFIX}${at.toISOString().replace(/[:.]/g, '').replace(/Z$/, '')}${SUFFIX}`;
}

/** Existing snapshots, oldest first. */
export function listSnapshots(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .sort();
  } catch {
    return [];
  }
}

/** Age of the newest snapshot in ms, or Infinity when there is none. */
export function ageOfNewest(dir: string, now: number): number {
  const all = listSnapshots(dir);
  const newest = all[all.length - 1];
  if (!newest) return Infinity;
  try {
    return now - statSync(path.join(dir, newest)).mtimeMs;
  } catch {
    return Infinity;
  }
}

export function isDue(dir: string, now: number, interval = INTERVAL_MS): boolean {
  return ageOfNewest(dir, now) >= interval;
}

/**
 * Due *and* worth taking.
 *
 * An always-on agent that nobody captured into all week should not fill a
 * directory with seven identical copies of an unchanged database. The file's
 * own mtime is the cheapest honest signal that something happened — SQLite
 * touches it on every commit — so a quiet week costs one `stat` a day.
 */
export function shouldSnapshot(
  dir: string,
  dbPath: string,
  now: number,
  interval = INTERVAL_MS,
): boolean {
  if (!isDue(dir, now, interval)) return false;

  const all = listSnapshots(dir);
  const newest = all[all.length - 1];
  if (!newest) return true; // nothing yet: the first one is always worth taking

  try {
    return statSync(dbPath).mtimeMs > statSync(path.join(dir, newest)).mtimeMs;
  } catch {
    // Cannot compare — take one. A spurious backup is a much smaller problem
    // than a missing one.
    return true;
  }
}

/**
 * Deletes all but the newest `keep`, and returns what it removed.
 *
 * Pruned after the new one is written, never before: a failure between the two
 * would otherwise leave you with fewer backups than you started with, which is
 * the opposite of what this is for.
 */
export function prune(dir: string, keep = KEEP): string[] {
  const all = listSnapshots(dir);
  const doomed = all.slice(0, Math.max(0, all.length - keep));
  for (const name of doomed) {
    try {
      rmSync(path.join(dir, name));
    } catch {
      // A snapshot we cannot delete is untidy, not dangerous.
    }
  }
  return doomed;
}

export interface SnapshotResult {
  path: string;
  bytes: number;
  pruned: string[];
}

/**
 * Takes one now. `vacuumInto` is passed in rather than a database handle so
 * this module stays free of node:sqlite and can be tested with a stub.
 */
export function takeSnapshot(
  dir: string,
  vacuumInto: (destination: string) => void,
  at: Date = new Date(),
  keep = KEEP,
): SnapshotResult {
  mkdirSync(dir, { recursive: true });
  const destination = path.join(dir, snapshotName(at));
  vacuumInto(destination);
  return {
    path: destination,
    bytes: statSync(destination).size,
    pruned: prune(dir, keep),
  };
}
