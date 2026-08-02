import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Your own instance. `npm start`.
 *
 * One process, one port, one command — because two terminals and a `?api=1` in
 * the URL is a thing you have to remember, and the point of a tool you use
 * every day is that you do not.
 *
 * What this arranges that the raw server does not:
 *
 * - **It remembers.** `RECALL_DB` defaults to `:memory:`, which is right for the
 *   test suite and is the one bug a memory tool cannot survive. Here it is a
 *   file.
 * - **It is empty.** The server seeds a workspace it does not find, which is
 *   right for the demo and wrong for you: your instance should not open holding
 *   somebody else's notes. `npm run demo` is the seeded one.
 * - **The client reaches the server.** `VITE_API_DEFAULT=1` at build time,
 *   without which the page serves the bundled fixture and looks entirely
 *   functional while ignoring everything you save.
 *
 * The file lives in your home directory rather than in the checkout, because a
 * checkout is something you delete, move or re-clone and your memories should
 * not be inside a directory you treat as disposable.
 */

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOME = path.join(homedir(), '.recall');
const DB = process.env.RECALL_DB ?? path.join(HOME, 'recall.db');

mkdirSync(HOME, { recursive: true });

const run = (command, args, env) => {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

/*
 * Rebuilt every time rather than only when dist is missing. A stale bundle
 * against a changed server is the kind of confusion that costs an hour, and the
 * build takes about a second.
 */
console.log('building the client…');
run('npm', ['run', 'build'], { VITE_API_DEFAULT: '1' });

const fresh = !existsSync(DB);
console.log(
  fresh
    ? `\nstarting fresh — your memories will live in ${DB}`
    : `\nopening ${DB}`,
);
if (fresh && process.env.RECALL_SEED !== '1') {
  console.log('nothing in it yet. Paste something and it will start filling.\n');
}

run('node', ['--env-file-if-exists=.env.local', 'server/http/main.ts'], {
  RECALL_DB: DB,
  RECALL_STATIC: path.join(ROOT, 'dist'),
  PORT: process.env.PORT ?? '5170',
});
