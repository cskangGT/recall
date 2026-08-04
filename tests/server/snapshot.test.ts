import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  INTERVAL_MS, KEEP, ageOfNewest, isDue, listSnapshots, prune, shouldSnapshot,
  snapshotName, takeSnapshot,
} from '../../server/db/snapshot';

/**
 * `~/.recall/recall.db` became permanent when a launchd agent started owning
 * it, and nothing protected it. These are the rules of the thing that does.
 */

let dir: string;
let db: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'recall-snap-'));
  db = path.join(dir, 'recall.db');
  writeFileSync(db, 'pretend database');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const snaps = path.join('backups');
const backupDir = () => path.join(dir, snaps);

/** Writes a fake snapshot with a given age. */
function existing(name: string, ageMs = 0) {
  mkdirSync(backupDir(), { recursive: true });
  const full = path.join(backupDir(), name);
  writeFileSync(full, 'snapshot');
  const when = (Date.now() - ageMs) / 1000;
  utimesSync(full, when, when);
  return full;
}

describe('naming', () => {
  it('sorts chronologically as a plain string', () => {
    // The whole listing strategy is `readdir().sort()`, so the name has to
    // carry the ordering — a locale-formatted date would not.
    const names = [
      new Date('2026-08-04T09:15:00Z'),
      new Date('2026-01-04T09:15:00Z'),
      new Date('2026-08-04T10:15:00Z'),
    ].map(snapshotName);
    expect([...names].sort()).toEqual([names[1], names[0], names[2]]);
  });

  it('has no characters a filesystem argues about', () => {
    expect(snapshotName(new Date('2026-08-04T09:15:00.123Z'))).toMatch(/^recall-[0-9T-]+\.db$/);
  });
});

describe('when one is due', () => {
  beforeEach(() => rmSync(backupDir(), { recursive: true, force: true }));

  it('is due immediately when there are none', () => {
    expect(ageOfNewest(backupDir(), Date.now())).toBe(Infinity);
    expect(isDue(backupDir(), Date.now())).toBe(true);
  });

  it('is not due again until the interval has passed', () => {
    takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'));
    expect(isDue(backupDir(), Date.now())).toBe(false);
    expect(isDue(backupDir(), Date.now() + INTERVAL_MS + 1000)).toBe(true);
  });

  it('ignores files it did not write', () => {
    // A directory people can put things in should not have its schedule set by
    // whatever else is in there.
    takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'));
    writeFileSync(path.join(backupDir(), 'notes.txt'), 'unrelated');
    writeFileSync(path.join(backupDir(), 'something.db'), 'unrelated');
    expect(listSnapshots(backupDir())).toHaveLength(1);
  });

  it('says no rather than throwing when the directory does not exist', () => {
    expect(listSnapshots(path.join(dir, 'nope'))).toEqual([]);
  });
});

describe('and whether it is worth taking', () => {
  it('skips a quiet week instead of storing seven identical copies', () => {
    // An always-on agent nobody captured into should not fill the disk with
    // copies of an unchanged database.
    existing(snapshotName(new Date()), INTERVAL_MS * 2);
    const older = (Date.now() - INTERVAL_MS * 3) / 1000;
    utimesSync(db, older, older);

    expect(isDue(backupDir(), Date.now())).toBe(true);
    expect(shouldSnapshot(backupDir(), db, Date.now())).toBe(false);
  });

  it('takes one when the database has changed since the last', () => {
    existing(snapshotName(new Date()), INTERVAL_MS * 2);
    writeFileSync(db, 'a capture happened');
    expect(shouldSnapshot(backupDir(), db, Date.now())).toBe(true);
  });

  it('takes the first one whatever the mtimes say', () => {
    rmSync(backupDir(), { recursive: true, force: true });
    expect(shouldSnapshot(backupDir(), db, Date.now())).toBe(true);
  });

  it('takes one when it cannot tell — a spare backup beats a missing one', () => {
    existing(snapshotName(new Date()), INTERVAL_MS * 2);
    expect(shouldSnapshot(backupDir(), path.join(dir, 'gone.db'), Date.now())).toBe(true);
  });

  it('respects the interval even when the database is busy', () => {
    existing(snapshotName(new Date()), 60_000);
    writeFileSync(db, 'changed just now');
    expect(shouldSnapshot(backupDir(), db, Date.now())).toBe(false);
  });
});

describe('taking one', () => {
  it('writes where it says it did, and reports the size', () => {
    const result = takeSnapshot(backupDir(), (d) => writeFileSync(d, 'twelve bytes'));
    expect(existsSync(result.path)).toBe(true);
    expect(result.bytes).toBe('twelve bytes'.length);
    expect(path.dirname(result.path)).toBe(backupDir());
  });

  it('creates the directory on a fresh install', () => {
    rmSync(backupDir(), { recursive: true, force: true });
    expect(() => takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'))).not.toThrow();
  });

  it('never overwrites — each one gets its own name', () => {
    // `VACUUM INTO` refuses an existing file, and that refusal is a feature: a
    // backup the next backup can silently replace is one bug from being none.
    const a = takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'), new Date('2026-08-04T09:00:00Z'));
    const b = takeSnapshot(backupDir(), (d) => writeFileSync(d, 'y'), new Date('2026-08-04T10:00:00Z'));
    expect(a.path).not.toBe(b.path);
    expect(listSnapshots(backupDir())).toHaveLength(2);
  });
});

describe('pruning', () => {
  it('keeps a week and drops the rest, oldest first', () => {
    for (let i = 0; i < KEEP + 3; i++) {
      takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'),
        new Date(Date.UTC(2026, 7, 1, i)), KEEP);
    }
    const left = listSnapshots(backupDir());
    expect(left).toHaveLength(KEEP);
    // The survivors are the newest ones.
    expect(left[0]).toBe(snapshotName(new Date(Date.UTC(2026, 7, 1, 3))));
  });

  it('prunes after writing the new one, never before', () => {
    // A failure between the two would otherwise leave fewer backups than it
    // started with, which is the opposite of the point.
    for (let i = 0; i < KEEP; i++) {
      takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'), new Date(Date.UTC(2026, 7, 1, i)), KEEP);
    }
    const boom = () => {
      throw new Error('disk full');
    };
    expect(() => takeSnapshot(backupDir(), boom, new Date(Date.UTC(2026, 7, 2)), KEEP)).toThrow();
    expect(listSnapshots(backupDir())).toHaveLength(KEEP);
  });

  it('does nothing when there is nothing to prune', () => {
    takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'));
    expect(prune(backupDir(), KEEP)).toEqual([]);
  });

  it('leaves files it did not write alone', () => {
    for (let i = 0; i < KEEP + 2; i++) {
      takeSnapshot(backupDir(), (d) => writeFileSync(d, 'x'), new Date(Date.UTC(2026, 7, 1, i)), KEEP);
    }
    writeFileSync(path.join(backupDir(), 'IMPORTANT.txt'), 'do not delete me');
    prune(backupDir(), KEEP);
    expect(readdirSync(backupDir())).toContain('IMPORTANT.txt');
  });
});
