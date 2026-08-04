import { createRequire } from 'node:module';
import path from 'node:path';
import { DB } from './recall-paths.mjs';

/**
 * A copy of the corpus, right now. `npm run backup`.
 *
 * The agent takes one a day on its own, which is the right cadence for a
 * background process and the wrong one for the moment before you do something
 * you are unsure about. This is that moment's button.
 *
 * `VACUUM INTO` rather than `cp`: the database is very likely open in the
 * agent's process while you run this, and in WAL mode the committed state lives
 * across the database and its write-ahead log — a plain copy catches them at
 * different instants and produces a file that may not open.
 */

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const dir = process.env.RECALL_BACKUPS ?? path.join(path.dirname(path.resolve(DB)), 'backups');

// The snapshot module is TypeScript the server runs directly; Node strips types
// for it the same way, so there is nothing to build here either.
const { takeSnapshot, listSnapshots } = await import('../server/db/snapshot.ts');

const db = new DatabaseSync(DB, { readOnly: true });
try {
  const { path: file, bytes, pruned } = takeSnapshot(dir, (destination) =>
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`),
  );
  console.log(`wrote ${file} (${Math.round(bytes / 1024)}KB)`);
  if (pruned.length > 0) console.log(`pruned ${pruned.length} older than the last seven`);
  console.log(`\n${listSnapshots(dir).length} snapshot(s) in ${dir}`);
  console.log('to restore: stop the agent, then copy one over');
  console.log(`  npm run agent:uninstall && cp <snapshot> ${DB} && npm run agent:install`);
} finally {
  db.close();
}
