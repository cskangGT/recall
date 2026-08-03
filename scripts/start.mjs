import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { DB, HOME, PORT, ROOT, STATIC, probe } from './recall-paths.mjs';

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

mkdirSync(HOME, { recursive: true });

const run = (command, args, env) => {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

/*
 * Somebody may already own this port — most likely the launchd agent, which is
 * the whole point of having installed it.
 *
 * Without this you get an EADDRINUSE a second later and, worse, the temptation
 * to "fix" it by starting a second instance on another port against the *same*
 * database. That is a real hazard rather than an inconvenience: node:sqlite in
 * WAL mode allows many readers and one writer, so the loser of a race gets
 * SQLITE_BUSY in the middle of a capture.
 */
const state = await probe(PORT);
if (state === 'recall') {
  console.log(
    `Recall is already running on ${PORT} — that will be the launchd agent.\n\n` +
      `  open      http://127.0.0.1:${PORT}\n` +
      `  rebuild   npm run build && npm run agent:restart\n` +
      `  stop it   npm run agent:uninstall\n\n` +
      `For a second, throwaway instance, give it its own database:\n` +
      `  PORT=5171 RECALL_DB=/tmp/scratch.db npm start`,
  );
  process.exit(0);
}
if (state === 'occupied') {
  console.error(
    `something is listening on ${PORT} and it is not Recall.\n` +
      `Stop it, or run Recall elsewhere: PORT=5171 npm start`,
  );
  process.exit(1);
}

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
  RECALL_STATIC: STATIC,
  PORT: String(PORT),
});
